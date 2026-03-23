import fs from 'node:fs';
import path from 'node:path';

const inputPath = process.argv[2] || 'C:\\Users\\16680\\Desktop\\成就清单.txt';
const outputPath = process.argv[3] || path.resolve(process.cwd(), 'album-pure-plugin', 'data', 'achievements.js');

const raw = fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/);

const headingLineRegex = /^=====+\s*(?<body>.+?)\s*=====+$/;
const rangedHeadingRegex = /^(?<title>.+?)（(?<start>[A-Z]{2}_[0-9]{3})~(?<end>[A-Z]{2}_[0-9]{3})）(?:——(?<subtitle>.+))?$/;
const singleHeadingRegex = /^(?<title>.+?)（(?<single>[A-Z]{2}_[0-9]{3})）(?:——(?<subtitle>.+))?$/;
const itemRegex = /^(?<id>[A-Z]{2}_[0-9]{3})\s*\|\s*(?<name>[^|]+?)\s*\|\s*(?<desc>[^|]+?)\s*\|\s*(?<cond>[^|]+?)\s*\|\s*(?<kw>.+)$/;

const fallbackTitles = {
    RE: '一、初遇篇',
    DA: '二、日常篇',
    WI: '三、愿望篇',
    LO: '四、感情篇',
    TR: '五、旅行篇',
    ME: '六、记忆篇',
    IL: '七、病情篇',
    TI: '八、季节/时间篇',
    SP: '九、特殊事件篇',
    OB: '十、物件篇',
    AT: '十一、天气篇',
    EM: '十二、情绪篇',
    FU: '十三、葬礼与之后篇',
    AF: '十四、余生篇',
    HI: '十五、隐藏/稀有成就篇',
    IF: '十六、IF线·治愈结婚篇',
    FI: '十七、终章',
};

function toSequenceNumber(id) {
    return Number(id.slice(3));
}

function computeExpectedTotal(startId, endId) {
    if (!startId || !endId || startId.slice(0, 2) !== endId.slice(0, 2)) {
        return null;
    }

    return toSequenceNumber(endId) - toSequenceNumber(startId) + 1;
}

function parseHeading(line) {
    const lineMatch = line.match(headingLineRegex);
    if (!lineMatch) {
        return null;
    }

    const body = lineMatch.groups?.body?.trim() || '';
    if (!body || body === '统计') {
        return null;
    }

    const ranged = body.match(rangedHeadingRegex);
    if (ranged) {
        const startId = ranged.groups.start.trim();
        const endId = ranged.groups.end.trim();
        return {
            title: ranged.groups.title.trim(),
            subtitle: ranged.groups.subtitle?.trim() || '',
            prefix: startId.slice(0, 2),
            startId,
            endId,
            expectedTotal: computeExpectedTotal(startId, endId),
        };
    }

    const single = body.match(singleHeadingRegex);
    if (single) {
        const id = single.groups.single.trim();
        return {
            title: single.groups.title.trim(),
            subtitle: single.groups.subtitle?.trim() || '',
            prefix: id.slice(0, 2),
            startId: id,
            endId: id,
            expectedTotal: 1,
        };
    }

    return null;
}

function getOrCreateChapterMeta(metaByPrefix, chapterOrder, prefix, currentSection) {
    if (!metaByPrefix.has(prefix)) {
        metaByPrefix.set(prefix, {
            prefix,
            title: currentSection?.prefix === prefix ? currentSection.title : (fallbackTitles[prefix] || prefix),
            subtitle: currentSection?.prefix === prefix ? currentSection.subtitle : '',
            expectedTotal: currentSection?.prefix === prefix ? currentSection.expectedTotal : null,
        });
        chapterOrder.push(prefix);
    }

    return metaByPrefix.get(prefix);
}

const chapterMetaByPrefix = new Map();
const chapterItems = new Map();
const chapterOrder = [];
const achievements = [];
const seenIds = new Set();
const warnings = [];

let currentSection = null;

for (const originalLine of lines) {
    const line = originalLine.trim();
    if (!line) {
        continue;
    }

    const heading = parseHeading(line);
    if (heading) {
        currentSection = heading;
        getOrCreateChapterMeta(chapterMetaByPrefix, chapterOrder, heading.prefix, heading);
        continue;
    }

    const itemMatch = line.match(itemRegex);
    if (!itemMatch) {
        continue;
    }

    const id = itemMatch.groups.id.trim();
    if (seenIds.has(id)) {
        warnings.push(`Duplicate achievement ignored: ${id}`);
        continue;
    }

    seenIds.add(id);

    const chapterId = id.slice(0, 2);
    const chapterMeta = getOrCreateChapterMeta(chapterMetaByPrefix, chapterOrder, chapterId, currentSection);

    if (!chapterItems.has(chapterId)) {
        chapterItems.set(chapterId, []);
    }

    const ids = chapterItems.get(chapterId);
    ids.push(id);

    achievements.push({
        id,
        chapterId,
        chapterTitle: chapterMeta.title,
        chapterSubtitle: chapterMeta.subtitle,
        sequence: ids.length,
        name: itemMatch.groups.name.trim(),
        desc: itemMatch.groups.desc.trim(),
        cond: itemMatch.groups.cond.trim(),
        keywords: itemMatch.groups.kw.trim(),
        assetKey: id,
    });
}

const chapters = chapterOrder
    .filter(chapterId => (chapterItems.get(chapterId) || []).length > 0)
    .map((chapterId, index) => {
        const meta = chapterMetaByPrefix.get(chapterId);
        const ids = chapterItems.get(chapterId) || [];

        if (meta?.expectedTotal && meta.expectedTotal !== ids.length) {
            warnings.push(`Section ${chapterId} expected ${meta.expectedTotal} items but found ${ids.length}`);
        }

        return {
            id: chapterId,
            order: index,
            title: meta?.title || fallbackTitles[chapterId] || chapterId,
            subtitle: meta?.subtitle || '',
            total: ids.length,
            ids,
        };
    });

const content = `export const CHAPTERS = ${JSON.stringify(chapters, null, 4)};

export const ACHIEVEMENTS = ${JSON.stringify(achievements, null, 4)};

export const CHAPTER_INDEX = Object.fromEntries(CHAPTERS.map(item => [item.id, item]));
export const ACHIEVEMENT_INDEX = Object.fromEntries(ACHIEVEMENTS.map(item => [item.id, item]));
export const ACHIEVEMENTS_BY_CHAPTER = Object.fromEntries(
    CHAPTERS.map(chapter => [
        chapter.id,
        ACHIEVEMENTS.filter(item => item.chapterId === chapter.id),
    ]),
);
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, content, 'utf8');

console.log(`Imported ${achievements.length} achievements across ${chapters.length} chapters to ${outputPath}`);
if (warnings.length) {
    console.log('Warnings:');
    for (const warning of warnings) {
        console.log(`- ${warning}`);
    }
}
