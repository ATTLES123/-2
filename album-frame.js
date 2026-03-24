import {
    ACHIEVEMENTS,
    ACHIEVEMENT_INDEX,
    CHAPTERS,
} from './data/achievements.js';
import { getAchievementAsset } from './data/asset-manifest.js';

const PAGE_SIZE = 4;
const TURN_STRIP_COUNT = 24;

const OPEN_SUMMON_MS = 520;
const OPEN_MORPH_MS = 380;
const OPEN_RELEASE_MS = 180;
const OPEN_COVER_MS = 640;
const OPEN_SETTLE_MS = 180;
const CLOSE_CATCH_MS = 170;
const CLOSE_COVER_MS = 460;
const CLOSE_MORPH_MS = 320;
const CLOSE_DISMISS_MS = 460;
const TURN_COMMIT_MS = 420;
const TURN_ROLLBACK_MS = 280;
const BROWSE_RETURN_MS = 240;
const WHEEL_TURN_THRESHOLD = 24;

const dom = {
    root: document.documentElement,
    scene: document.getElementById('scene'),
    closedBook: document.getElementById('closedBook'),
    rig: document.getElementById('rig'),
    pageViewport: document.getElementById('pageViewport'),
    pageSheet: document.getElementById('pageSheet'),
    pageTurner: document.getElementById('pageTurner'),
    chapterRail: document.getElementById('chapterRail'),
    insideTitle: document.getElementById('insideTitle'),
    insideUnlockCount: document.getElementById('insideUnlockCount'),
    insideTotalCount: document.getElementById('insideTotalCount'),
    closeCorner: document.getElementById('closeCorner'),
    unlockToast: document.getElementById('unlockToast'),
    unlockToastTitle: document.getElementById('unlockToastTitle'),
    unlockToastId: document.getElementById('unlockToastId'),
};

const runtime = {
    session: {
        bindId: '',
        profile: '',
        version: 1,
        characterName: '',
        launcherRect: null,
    },
    unlocked: new Set(),
    pages: [],
    pageIndexByAchievement: new Map(),
    firstPageByChapter: new Map(),
    currentPageIndex: 0,
    activeChapterId: CHAPTERS[0]?.id ?? '',
    selectedAchievementId: '',
    phase: 'closed',
    animationToken: 0,
    toastTimer: 0,
    turn: {
        active: false,
        armed: false,
        direction: 1,
        progress: 0,
        gripY: 0.5,
        pointerId: null,
        startX: 0,
        startY: 0,
        moved: false,
        fromIndex: 0,
        toIndex: 0,
        downInteractive: false,
    },
    closeDrag: {
        active: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        progress: 0,
        moved: false,
    },
    motion: createMotion(),
    turnStrips: [],
};

function createMotion() {
    return {
        portalX: 0,
        portalY: 0,
        portalScale: 1,
        portalRotate: 0,
        closedAlpha: 1,
        rigAlpha: 0,
        rigScale: 0.88,
        rigLift: 40,
        rigYaw: -10,
        rigPitch: 14,
        coverOpen: 0,
        sceneDim: 0,
        sceneGlow: 0.08,
        pageTilt: 0,
        pageShift: 0,
        pageReveal: 0,
        pageDepth: 18,
        coverLift: 0,
        coverTwist: 0,
        stackLeftShift: 0,
        stackRightShift: 0,
        stackLeftScale: 1,
        stackRightScale: 1,
        hingeShadow: 0.18,
        spineGlow: 0.12,
    };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function lerp(start, end, amount) {
    return start + (end - start) * amount;
}

function easeOutCubic(value) {
    return 1 - ((1 - value) ** 3);
}

function easeInOutCubic(value) {
    return value < 0.5
        ? 4 * value * value * value
        : 1 - (((-2 * value) + 2) ** 3) / 2;
}

function easeOutBack(value) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + (c3 * ((value - 1) ** 3)) + (c1 * ((value - 1) ** 2));
}

function easeInBack(value) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * value * value * value - c1 * value * value;
}

function normalizeAchievementId(value) {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim().toUpperCase();
    const match = trimmed.match(/^([A-Z]{2})_?([0-9]{3})$/);
    if (!match) {
        return '';
    }

    return `${match[1]}_${match[2]}`;
}

function uniqueIds(values) {
    return [...new Set(
        values
            .map(normalizeAchievementId)
            .filter(Boolean),
    )];
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function resolveAssetUrl(value) {
    if (!value || typeof value !== 'string') {
        return '';
    }

    try {
        return new URL(value, import.meta.url).href;
    } catch {
        return value;
    }
}

function getClosestElement(target, selector) {
    if (!target) {
        return null;
    }

    if (typeof target.closest === 'function') {
        return target.closest(selector);
    }

    if (target.parentElement && typeof target.parentElement.closest === 'function') {
        return target.parentElement.closest(selector);
    }

    return null;
}

function isUnlocked(id) {
    return runtime.unlocked.has(normalizeAchievementId(id));
}

function getViewportMetrics() {
    const closedWidth = Math.min(window.innerWidth * 0.18, 320);
    return {
        width: window.innerWidth,
        height: window.innerHeight,
        rigHeight: Math.min(window.innerHeight * 0.84, 940),
        closedWidth,
        closedHeight: closedWidth * 1.26,
    };
}

function getLauncherRect() {
    const fallback = {
        left: window.innerWidth - 126,
        top: window.innerHeight - 154,
        width: 106,
        height: 136,
    };

    const source = runtime.session.launcherRect;
    if (!source || typeof source !== 'object') {
        return fallback;
    }

    const left = Number(source.left);
    const top = Number(source.top);
    const width = Number(source.width);
    const height = Number(source.height);

    if (![left, top, width, height].every(Number.isFinite)) {
        return fallback;
    }

    return {
        left,
        top,
        width: Math.max(1, width),
        height: Math.max(1, height),
    };
}

function buildLauncherPose() {
    const viewport = getViewportMetrics();
    const rect = getLauncherRect();
    const rectCenterX = rect.left + (rect.width / 2);
    const rectCenterY = rect.top + (rect.height / 2);
    const scale = clamp(
        Math.min(rect.width / viewport.closedWidth, rect.height / viewport.closedHeight),
        0.22,
        0.72,
    );

    return {
        portalX: rectCenterX - (viewport.width / 2),
        portalY: rectCenterY - (viewport.height / 2),
        portalScale: scale,
        portalRotate: rect.left > viewport.width * 0.52 ? 10 : -10,
        closedAlpha: 1,
        rigAlpha: 0,
        rigScale: 0.76,
        rigLift: 84,
        rigYaw: -18,
        rigPitch: 22,
        coverOpen: 0,
        sceneDim: 0,
        sceneGlow: 0.08,
        pageTilt: 0,
        pageShift: 0,
        pageReveal: 0,
        pageDepth: 14,
        coverLift: 0,
        coverTwist: -1.6,
        stackLeftShift: 0,
        stackRightShift: 0,
        stackLeftScale: 0.96,
        stackRightScale: 0.96,
        hingeShadow: 0.08,
        spineGlow: 0.06,
    };
}

function buildSummonPose() {
    return {
        portalX: 0,
        portalY: 0,
        portalScale: 1.02,
        portalRotate: 0,
        closedAlpha: 1,
        rigAlpha: 0,
        rigScale: 0.84,
        rigLift: 52,
        rigYaw: -13,
        rigPitch: 18,
        coverOpen: 0,
        sceneDim: 0.14,
        sceneGlow: 0.12,
        pageTilt: 0,
        pageShift: 0,
        pageReveal: 0,
        pageDepth: 26,
        coverLift: -6,
        coverTwist: -1.4,
        stackLeftShift: -4,
        stackRightShift: 4,
        stackLeftScale: 0.98,
        stackRightScale: 0.99,
        hingeShadow: 0.16,
        spineGlow: 0.14,
    };
}

function buildCoverPose() {
    return {
        portalX: 0,
        portalY: 0,
        portalScale: 1,
        portalRotate: 0,
        closedAlpha: 0,
        rigAlpha: 1,
        rigScale: 0.96,
        rigLift: 18,
        rigYaw: -9.8,
        rigPitch: 10.8,
        coverOpen: 0,
        sceneDim: 0.54,
        sceneGlow: 0.18,
        pageTilt: 14,
        pageShift: 34,
        pageReveal: 0,
        pageDepth: 54,
        coverLift: -10,
        coverTwist: -1.2,
        stackLeftShift: -8,
        stackRightShift: 8,
        stackLeftScale: 0.988,
        stackRightScale: 1.006,
        hingeShadow: 0.28,
        spineGlow: 0.24,
    };
}

function buildBrowsePose() {
    return {
        portalX: 0,
        portalY: 0,
        portalScale: 1,
        portalRotate: 0,
        closedAlpha: 0,
        rigAlpha: 1,
        rigScale: 1,
        rigLift: 0,
        rigYaw: -5.2,
        rigPitch: 6.4,
        coverOpen: 1,
        sceneDim: 0.78,
        sceneGlow: 0.28,
        pageTilt: 0,
        pageShift: 0,
        pageReveal: 1,
        pageDepth: 66,
        coverLift: 0,
        coverTwist: 0,
        stackLeftShift: -12,
        stackRightShift: 12,
        stackLeftScale: 0.984,
        stackRightScale: 1.014,
        hingeShadow: 0.42,
        spineGlow: 0.34,
    };
}

function buildRevealPose() {
    return {
        portalX: 0,
        portalY: -8,
        portalScale: 1.006,
        portalRotate: 0,
        closedAlpha: 0,
        rigAlpha: 1,
        rigScale: 1.014,
        rigLift: -4,
        rigYaw: -5.8,
        rigPitch: 6.9,
        coverOpen: 1.024,
        sceneDim: 0.8,
        sceneGlow: 0.32,
        pageTilt: 0,
        pageShift: 0,
        pageReveal: 1,
        pageDepth: 72,
        coverLift: -4,
        coverTwist: -0.4,
        stackLeftShift: -14,
        stackRightShift: 14,
        stackLeftScale: 0.982,
        stackRightScale: 1.018,
        hingeShadow: 0.5,
        spineGlow: 0.4,
    };
}

function buildReleasePose() {
    return {
        portalX: 0,
        portalY: -2,
        portalScale: 1.002,
        portalRotate: 0,
        closedAlpha: 0,
        rigAlpha: 1,
        rigScale: 0.988,
        rigLift: 8,
        rigYaw: -8.2,
        rigPitch: 8.6,
        coverOpen: 0.18,
        sceneDim: 0.62,
        sceneGlow: 0.22,
        pageTilt: 6,
        pageShift: 18,
        pageReveal: 0.16,
        pageDepth: 58,
        coverLift: -14,
        coverTwist: -1.4,
        stackLeftShift: -10,
        stackRightShift: 9,
        stackLeftScale: 0.986,
        stackRightScale: 1.01,
        hingeShadow: 0.34,
        spineGlow: 0.28,
    };
}

function buildCloseCatchPose() {
    return {
        portalX: 0,
        portalY: -4,
        portalScale: 1.004,
        portalRotate: 0,
        closedAlpha: 0,
        rigAlpha: 1,
        rigScale: 0.994,
        rigLift: 4,
        rigYaw: -6.2,
        rigPitch: 7.2,
        coverOpen: 0.88,
        sceneDim: 0.76,
        sceneGlow: 0.3,
        pageTilt: 2,
        pageShift: 4,
        pageReveal: 1,
        pageDepth: 70,
        coverLift: -5,
        coverTwist: 0.4,
        stackLeftShift: -13,
        stackRightShift: 13,
        stackLeftScale: 0.982,
        stackRightScale: 1.018,
        hingeShadow: 0.52,
        spineGlow: 0.38,
    };
}

function applyMotion() {
    const style = dom.root.style;
    const motion = runtime.motion;

    style.setProperty('--portal-x', `${motion.portalX.toFixed(2)}px`);
    style.setProperty('--portal-y', `${motion.portalY.toFixed(2)}px`);
    style.setProperty('--portal-scale', motion.portalScale.toFixed(4));
    style.setProperty('--portal-rotate', `${motion.portalRotate.toFixed(2)}deg`);
    style.setProperty('--closed-alpha', motion.closedAlpha.toFixed(4));
    style.setProperty('--rig-alpha', motion.rigAlpha.toFixed(4));
    style.setProperty('--rig-scale', motion.rigScale.toFixed(4));
    style.setProperty('--rig-lift', `${motion.rigLift.toFixed(2)}px`);
    style.setProperty('--rig-yaw', `${motion.rigYaw.toFixed(2)}deg`);
    style.setProperty('--rig-pitch', `${motion.rigPitch.toFixed(2)}deg`);
    style.setProperty('--cover-open', motion.coverOpen.toFixed(4));
    style.setProperty('--scene-dim', motion.sceneDim.toFixed(4));
    style.setProperty('--scene-glow', motion.sceneGlow.toFixed(4));
    style.setProperty('--page-tilt', `${motion.pageTilt.toFixed(2)}deg`);
    style.setProperty('--page-shift', `${motion.pageShift.toFixed(2)}px`);
    style.setProperty('--page-reveal', motion.pageReveal.toFixed(4));
    style.setProperty('--page-depth', `${motion.pageDepth.toFixed(2)}px`);
    style.setProperty('--cover-lift', `${motion.coverLift.toFixed(2)}px`);
    style.setProperty('--cover-twist', `${motion.coverTwist.toFixed(2)}deg`);
    style.setProperty('--stack-left-shift', `${motion.stackLeftShift.toFixed(2)}px`);
    style.setProperty('--stack-right-shift', `${motion.stackRightShift.toFixed(2)}px`);
    style.setProperty('--stack-left-scale', motion.stackLeftScale.toFixed(4));
    style.setProperty('--stack-right-scale', motion.stackRightScale.toFixed(4));
    style.setProperty('--hinge-shadow', motion.hingeShadow.toFixed(4));
    style.setProperty('--spine-glow', motion.spineGlow.toFixed(4));

    dom.pageViewport.style.pointerEvents = motion.pageReveal >= 0.72 ? 'auto' : 'none';
    dom.chapterRail.style.pointerEvents = motion.coverOpen >= 0.72 ? 'auto' : 'none';
    dom.closeCorner.style.pointerEvents = motion.coverOpen >= 0.72 ? 'auto' : 'none';
    dom.closedBook?.setAttribute('aria-hidden', motion.closedAlpha <= 0.02 ? 'true' : 'false');
    dom.rig?.setAttribute('aria-hidden', motion.rigAlpha <= 0.02 ? 'true' : 'false');
}

function buildPages() {
    const chapterOrder = [...CHAPTERS].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
    const groups = new Map(chapterOrder.map(chapter => [chapter.id, []]));

    for (const achievement of ACHIEVEMENTS) {
        const bucket = groups.get(achievement.chapterId);
        if (bucket) {
            bucket.push(achievement);
        }
    }

    const pages = [];
    const pageIndexByAchievement = new Map();
    const firstPageByChapter = new Map();

    let globalIndex = 0;
    for (const chapter of chapterOrder) {
        const items = (groups.get(chapter.id) ?? [])
            .slice()
            .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));

        const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
        firstPageByChapter.set(chapter.id, globalIndex);

        for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
            const pageItems = items.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE);
            const page = {
                key: `${chapter.id}:${pageIndex + 1}`,
                chapterId: chapter.id,
                chapterTitle: pageItems[0]?.chapterTitle || chapter.title || chapter.id,
                chapterSubtitle: pageItems[0]?.chapterSubtitle || chapter.subtitle || '',
                chapterTotal: Number(chapter.total || items.length || 0),
                pageIndex,
                pageCount: totalPages,
                globalIndex,
                items: pageItems,
            };

            for (const item of pageItems) {
                pageIndexByAchievement.set(item.id, globalIndex);
            }

            pages.push(page);
            globalIndex += 1;
        }
    }

    runtime.pages = pages;
    runtime.pageIndexByAchievement = pageIndexByAchievement;
    runtime.firstPageByChapter = firstPageByChapter;
}

function getCurrentPage() {
    return runtime.pages[runtime.currentPageIndex] ?? runtime.pages[0] ?? null;
}

function getPageAt(index) {
    return runtime.pages[clamp(index, 0, Math.max(0, runtime.pages.length - 1))] ?? null;
}

function getChapterProgress(chapterId) {
    const items = ACHIEVEMENTS.filter(item => item.chapterId === chapterId);
    const unlocked = items.reduce((count, item) => count + (isUnlocked(item.id) ? 1 : 0), 0);
    return {
        unlocked,
        total: items.length,
    };
}

function getSelectedAchievement(page = getCurrentPage()) {
    if (!page || !runtime.selectedAchievementId) {
        return null;
    }

    const achievement = page.items.find(item => item?.id === runtime.selectedAchievementId) ?? null;
    if (!achievement || !isUnlocked(achievement.id)) {
        return null;
    }

    return achievement;
}

function buildCardMarkup(meta) {
    if (!meta) {
        return `
            <article class="memory-card is-locked">
                <div class="memory-card__photo">?</div>
                <div class="memory-card__title">未收录</div>
                <div class="memory-card__desc">这一格会在后续成就导入后自动补齐。</div>
                <div class="memory-card__meta">等待分配</div>
                <div class="memory-card__id">EMPTY</div>
            </article>
        `;
    }

    const unlocked = isUnlocked(meta.id);
    const selected = runtime.selectedAchievementId === meta.id;
    const asset = getAchievementAsset(meta.assetKey || meta.id);
    const photoUrl = unlocked ? resolveAssetUrl(asset?.thumb || asset?.full || '') : '';
    const photoLabel = unlocked
        ? (asset?.placeholder || meta.name || meta.id).slice(0, 18)
        : '?';
    const photoStyle = photoUrl
        ? ` style="background-image:url('${escapeAttribute(photoUrl)}');background-size:${escapeAttribute(asset?.fit || 'cover')};background-position:center center;background-repeat:no-repeat;"`
        : '';
    const photoContent = photoUrl ? '' : escapeHtml(photoLabel);

    const title = unlocked ? meta.name : '未解锁';
    const desc = unlocked
        ? (meta.desc || meta.cond || meta.keywords || '新的记忆已收录。')
        : '这一张仍覆着灰尘与封条，等待对应成就触发。';
    const metaLine = unlocked
        ? (meta.cond || meta.chapterSubtitle || '成就已收录')
        : '条件暂未公开';

    return `
        <article class="memory-card ${unlocked ? 'is-unlocked' : 'is-locked'} ${selected ? 'is-selected' : ''}" data-achievement-id="${escapeAttribute(meta.id)}">
            <div class="memory-card__photo ${photoUrl ? 'has-asset' : ''}"${photoStyle}>${photoContent}</div>
            <div class="memory-card__title">${escapeHtml(title)}</div>
            <div class="memory-card__desc">${escapeHtml(desc)}</div>
            <div class="memory-card__meta">${escapeHtml(metaLine)}</div>
            <div class="memory-card__id">${escapeHtml(meta.id)}</div>
        </article>
    `;
}

function buildFocusMarkup(page, { forTurn = false } = {}) {
    if (forTurn) {
        return '';
    }

    const selected = getSelectedAchievement(page);
    if (!selected) {
        return '';
    }

    const asset = getAchievementAsset(selected.assetKey || selected.id);
    const previewUrl = resolveAssetUrl(asset?.full || asset?.thumb || '');
    const previewStyle = previewUrl
        ? ` style="background-image:url('${escapeAttribute(previewUrl)}');background-size:${escapeAttribute(asset?.fit || 'cover')};background-position:center center;background-repeat:no-repeat;"`
        : '';

    return `
        <section class="page-sheet__focus">
            <div class="page-sheet__focus-photo"${previewStyle}>${previewUrl ? '' : escapeHtml(selected.name || selected.id)}</div>
            <div class="page-sheet__focus-copy">
                <div class="page-sheet__focus-id">${escapeHtml(selected.id)}</div>
                <h3 class="page-sheet__focus-title">${escapeHtml(selected.name || selected.id)}</h3>
                <div class="page-sheet__focus-desc">${escapeHtml(selected.desc || selected.cond || selected.keywords || '新的回忆已经被妥善收录。')}</div>
                <div class="page-sheet__focus-meta">${escapeHtml(selected.cond || selected.chapterSubtitle || selected.chapterTitle || '点击其他相片可切换聚焦。')}</div>
            </div>
        </section>
    `;
}

function buildPageSheetMarkup(page, { forTurn = false } = {}) {
    if (!page) {
        return `
            <section class="${forTurn ? 'turn-page' : 'page-sheet'}">
                <header class="page-sheet__header">
                    <div>
                        <span class="page-sheet__eyebrow">Album Empty</span>
                        <h2 class="page-sheet__title">No Data</h2>
                        <div class="page-sheet__subtitle">当前尚未加载到任何成就数据。</div>
                    </div>
                    <div class="page-sheet__badge">0 / 0</div>
                </header>
            </section>
        `;
    }

    const unlockedCount = page.items.reduce((count, item) => count + (isUnlocked(item.id) ? 1 : 0), 0);
    const hasFocus = Boolean(getSelectedAchievement(page)) && !forTurn;
    const cards = [];
    for (let index = 0; index < PAGE_SIZE; index += 1) {
        cards.push(buildCardMarkup(page.items[index] ?? null));
    }

    return `
        <section class="${forTurn ? 'turn-page' : 'page-sheet'} ${hasFocus ? 'has-focus' : ''}" data-page-key="${escapeAttribute(page.key)}">
            <header class="page-sheet__header">
                <div>
                    <span class="page-sheet__eyebrow">${escapeHtml(page.chapterId)} · PAGE ${String(page.pageIndex + 1).padStart(2, '0')}</span>
                    <h2 class="page-sheet__title">${escapeHtml(page.chapterTitle)}</h2>
                    <div class="page-sheet__subtitle">${escapeHtml(page.chapterSubtitle || '私人档案馆中的记忆切片')}</div>
                </div>
                <div class="page-sheet__badge">${unlockedCount} / ${page.items.length}<br>Unlocked</div>
            </header>
            <div class="page-sheet__grid">${cards.join('')}</div>
            ${buildFocusMarkup(page, { forTurn })}
            <footer class="page-sheet__footer">
                <span>${escapeHtml(page.chapterTitle)}</span>
                <span class="page-sheet__page-number">${String(page.globalIndex + 1).padStart(2, '0')}</span>
            </footer>
        </section>
    `;
}

function setCurrentPageIndex(index, { render = true } = {}) {
    runtime.currentPageIndex = clamp(index, 0, Math.max(0, runtime.pages.length - 1));
    runtime.activeChapterId = getCurrentPage()?.chapterId || runtime.activeChapterId;
    if (!getSelectedAchievement(getCurrentPage())) {
        runtime.selectedAchievementId = '';
    }

    if (render) {
        renderStaticPage(runtime.currentPageIndex);
        renderInsideCover();
    }
}

function renderStaticPage(index = runtime.currentPageIndex) {
    const page = getPageAt(index);
    dom.pageSheet.innerHTML = buildPageSheetMarkup(page);
}

function renderInsideCover() {
    const title = runtime.session.characterName
        ? `${runtime.session.characterName} · 成就档案`
        : '成就档案';
    const totalUnlocked = runtime.unlocked.size;
    const totalCount = ACHIEVEMENTS.length;

    dom.insideTitle.textContent = title;
    dom.insideUnlockCount.textContent = String(totalUnlocked);
    dom.insideTotalCount.textContent = String(totalCount);

    const chapterMarkup = CHAPTERS
        .slice()
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
        .map(chapter => {
            const progress = getChapterProgress(chapter.id);
            const active = chapter.id === runtime.activeChapterId;
            const trackWidth = progress.total > 0
                ? `${((progress.unlocked / progress.total) * 100).toFixed(2)}%`
                : '0%';

            return `
                <button type="button" class="chapter-item ${active ? 'is-active' : ''}" data-chapter-id="${escapeAttribute(chapter.id)}">
                    <div class="chapter-item__top">
                        <span class="chapter-item__id">${escapeHtml(chapter.id)}</span>
                        <span class="chapter-item__count">${progress.unlocked} / ${progress.total}</span>
                    </div>
                    <div class="chapter-item__title">${escapeHtml(chapter.title || chapter.id)}</div>
                    <div class="chapter-item__subtitle">${escapeHtml(chapter.subtitle || '未填写章节说明')}</div>
                    <div class="chapter-item__track"><span style="width:${trackWidth}"></span></div>
                </button>
            `;
        })
        .join('');

    dom.chapterRail.innerHTML = chapterMarkup;
}

function createTurnStrips() {
    if (runtime.turnStrips.length) {
        return;
    }

    dom.root.style.setProperty('--turn-strips', String(TURN_STRIP_COUNT));

    const fragment = document.createDocumentFragment();
    for (let index = 0; index < TURN_STRIP_COUNT; index += 1) {
        const strip = document.createElement('div');
        strip.className = 'page-turn-strip';
        strip.style.setProperty('--strip-index', String(index));
        strip.innerHTML = `
            <div class="page-turn-strip__face page-turn-strip__face--front">
                <div class="page-turn-strip__viewport"></div>
                <div class="page-turn-strip__shadow"></div>
            </div>
            <div class="page-turn-strip__face page-turn-strip__face--back">
                <div class="page-turn-strip__viewport"></div>
                <div class="page-turn-strip__shine"></div>
            </div>
        `;

        const frontFace = strip.children[0];
        const backFace = strip.children[1];
        const frontViewport = frontFace.querySelector('.page-turn-strip__viewport');
        const backViewport = backFace.querySelector('.page-turn-strip__viewport');
        const shadow = frontFace.querySelector('.page-turn-strip__shadow');
        const shine = backFace.querySelector('.page-turn-strip__shine');

        runtime.turnStrips.push({
            el: strip,
            frontViewport,
            backViewport,
            shadow,
            shine,
        });

        fragment.appendChild(strip);
    }

    dom.pageTurner.appendChild(fragment);
}

function setTurnerMarkup(frontMarkup, backMarkup) {
    runtime.turnStrips.forEach((strip, index) => {
        strip.frontViewport.innerHTML = `<div class="page-turn-strip__page">${frontMarkup}</div>`;
        strip.backViewport.innerHTML = `<div class="page-turn-strip__page">${backMarkup}</div>`;
        strip.frontViewport.style.transform = `translateX(-${index * 100}%)`;
        strip.backViewport.style.transform = `translateX(-${index * 100}%)`;
    });
}

function updateTurnerTransforms() {
    if (!runtime.turn.active) {
        dom.pageTurner.classList.remove('is-active');
        return;
    }

    dom.pageTurner.classList.add('is-active');

    const direction = runtime.turn.direction;
    const progress = clamp(runtime.turn.progress, 0, 1);
    const progressEase = easeInOutCubic(progress);
    const gripBias = 0.5 - runtime.turn.gripY;
    const gripTilt = gripBias * 14;
    const gripStrength = 0.82 + (Math.abs(gripBias) * 0.92);
    const lastIndex = Math.max(1, TURN_STRIP_COUNT - 1);

    runtime.turnStrips.forEach((strip, index) => {
        const stripRatio = index / lastIndex;
        const anchorFalloff = direction === 1
            ? ((TURN_STRIP_COUNT - 1) - index) / lastIndex
            : index / lastIndex;
        const freeSpan = 1 - anchorFalloff;
        const lag = (anchorFalloff ** 1.18) * 0.3;
        const localRaw = clamp((progressEase - lag) / Math.max(0.001, 1 - lag), 0, 1);
        const local = easeInOutCubic(localRaw);
        const swing = Math.sin(local * Math.PI);
        const curlProfile = Math.sin((freeSpan ** 0.82) * Math.PI * 0.96);
        const bellyProfile = Math.sin(stripRatio * Math.PI);
        const bow = swing * (0.32 + (curlProfile * 0.68));
        const angle = (direction === 1 ? -1 : 1) * lerp(0, 180, local);
        const lift = bow * (12 + (curlProfile * 34) + (bellyProfile * 12) + (local * 10));
        const driftY = gripBias * (4 + (curlProfile * 6.5)) * swing * gripStrength;
        const rotateX = gripBias * (10 + (curlProfile * 16)) * swing * gripStrength;
        const rotateZ = (direction === 1 ? -1 : 1) * swing * (1.2 + (curlProfile * 5.4) + (bellyProfile * 1.6));
        const driftX = (direction === 1 ? -1 : 1) * bow * (5 + (curlProfile * 16) + (local * 6));
        const shadowOpacity = clamp((bow * 0.58) + (progress * 0.22) + (curlProfile * 0.08), 0, 0.86);
        const shineOpacity = clamp((bow * 0.34) + ((1 - anchorFalloff) * 0.08) + (progress * 0.12), 0, 0.56);

        strip.el.style.transformOrigin = direction === 1 ? 'left center' : 'right center';
        strip.el.style.zIndex = direction === 1
            ? String(TURN_STRIP_COUNT - index)
            : String(index + 1);
        strip.el.style.transform = `
            translate3d(${driftX.toFixed(2)}px, ${driftY.toFixed(2)}px, ${lift.toFixed(2)}px)
            rotateX(${rotateX.toFixed(2)}deg)
            rotateY(${angle.toFixed(2)}deg)
            rotateZ(${rotateZ.toFixed(2)}deg)
        `;
        strip.shadow.style.opacity = shadowOpacity.toFixed(3);
        strip.shine.style.opacity = shineOpacity.toFixed(3);
    });

    const browsePose = buildBrowsePose();
    const sway = direction === 1 ? -1 : 1;
    const flex = Math.sin(progressEase * Math.PI);

    runtime.motion.pageTilt = sway * ((progressEase * 7.6) + (flex * 2.2));
    runtime.motion.pageShift = sway * ((progressEase * 14) + (flex * 9));
    runtime.motion.pageDepth = lerp(browsePose.pageDepth, browsePose.pageDepth + 16 + (flex * 4), progressEase);
    runtime.motion.coverLift = lerp(browsePose.coverLift, -4 - (Math.abs(gripBias) * 5.5) - (flex * 3.2), progressEase);
    runtime.motion.coverTwist = lerp(browsePose.coverTwist, sway * (1.4 + (Math.abs(gripBias) * 1.8)), progressEase);
    runtime.motion.coverOpen = browsePose.coverOpen + (flex * 0.022);
    runtime.motion.stackLeftShift = lerp(browsePose.stackLeftShift, browsePose.stackLeftShift + (direction === 1 ? -8 : 18), progressEase);
    runtime.motion.stackRightShift = lerp(browsePose.stackRightShift, browsePose.stackRightShift + (direction === 1 ? 18 : -8), progressEase);
    runtime.motion.stackLeftScale = lerp(browsePose.stackLeftScale, direction === 1 ? 0.974 : 0.991, progressEase);
    runtime.motion.stackRightScale = lerp(browsePose.stackRightScale, direction === 1 ? 1.025 : 1.004, progressEase);
    runtime.motion.hingeShadow = lerp(browsePose.hingeShadow, browsePose.hingeShadow + 0.18 + (flex * 0.04), progressEase);
    runtime.motion.spineGlow = lerp(browsePose.spineGlow, browsePose.spineGlow + 0.14 + (Math.abs(gripBias) * 0.04), progressEase);
    runtime.motion.rigYaw = lerp(browsePose.rigYaw, browsePose.rigYaw + (sway * (1.4 + (flex * 1.1))), progressEase);
    runtime.motion.rigPitch = lerp(browsePose.rigPitch, browsePose.rigPitch + 2.2 + (flex * 1.4), progressEase);
    runtime.motion.rigLift = lerp(browsePose.rigLift, -1.5 - (flex * 2.4), progressEase);
    runtime.motion.sceneGlow = lerp(browsePose.sceneGlow, browsePose.sceneGlow + 0.1, progressEase);
    applyMotion();
}

function clearTurner({ resetPose = true } = {}) {
    releaseTurn(runtime.turn.pointerId);
    runtime.turn.active = false;
    runtime.turn.armed = false;
    runtime.turn.progress = 0;
    runtime.turn.moved = false;
    runtime.turn.gripY = 0.5;
    runtime.turn.direction = 1;
    runtime.turn.downInteractive = false;
    dom.pageTurner.classList.remove('is-active');

    runtime.turnStrips.forEach(strip => {
        strip.el.style.transform = '';
        strip.el.style.transformOrigin = '';
        strip.el.style.zIndex = '';
        strip.shadow.style.opacity = '0';
        strip.shine.style.opacity = '0';
    });

    if (resetPose) {
        Object.assign(runtime.motion, buildBrowsePose());
        applyMotion();
    }
}

function emitHostEvent(type, payload = {}) {
    try {
        window.parent?.__albumBridgePluginHost?.handleFrameEvent?.({
            type,
            ...payload,
        });
    } catch (error) {
        console.warn('[Album Frame] Host event failed:', error);
    }
}

function syncUnlockedSet(ids) {
    runtime.unlocked = new Set(uniqueIds(ids));
    if (runtime.selectedAchievementId && !isUnlocked(runtime.selectedAchievementId)) {
        runtime.selectedAchievementId = '';
    }
    renderInsideCover();

    if (!runtime.turn.active) {
        renderStaticPage();
    }
}

function findPageIndexByAchievement(id) {
    const normalizedId = normalizeAchievementId(id);
    if (!normalizedId) {
        return -1;
    }

    return runtime.pageIndexByAchievement.get(normalizedId) ?? -1;
}

function getNextPageIndex(direction) {
    return runtime.currentPageIndex + direction;
}

function hasTurnTarget(direction) {
    const nextIndex = getNextPageIndex(direction);
    return nextIndex >= 0 && nextIndex < runtime.pages.length;
}

function prepareTurn(direction) {
    if (runtime.turn.active || runtime.closeDrag.active || runtime.phase !== 'browse') {
        return false;
    }

    if (!hasTurnTarget(direction)) {
        return false;
    }

    const fromPage = getCurrentPage();
    const toIndex = getNextPageIndex(direction);
    const toPage = getPageAt(toIndex);
    if (!fromPage || !toPage) {
        return false;
    }

    runtime.turn.active = true;
    runtime.turn.direction = direction;
    runtime.turn.fromIndex = runtime.currentPageIndex;
    runtime.turn.toIndex = toIndex;
    runtime.turn.progress = 0;
    runtime.turn.gripY = 0.5;
    runtime.phase = 'dragging';

    setTurnerMarkup(
        buildPageSheetMarkup(fromPage, { forTurn: true }),
        buildPageSheetMarkup(toPage, { forTurn: true }),
    );
    renderStaticPage(toIndex);
    updateTurnerTransforms();
    return true;
}

function syncSession(payload = {}) {
    runtime.session = {
        ...runtime.session,
        ...payload,
    };

    if (Array.isArray(payload.unlockedIds)) {
        syncUnlockedSet(payload.unlockedIds);
    } else {
        renderInsideCover();
    }

    if (runtime.phase === 'closed') {
        Object.assign(runtime.motion, buildLauncherPose());
        applyMotion();
    }
}

function tweenMotion(targetPatch, duration, easing = easeInOutCubic, token = runtime.animationToken) {
    const from = { ...runtime.motion };
    const target = {
        ...runtime.motion,
        ...targetPatch,
    };

    return new Promise(resolve => {
        const start = performance.now();

        function frame(now) {
            if (token !== runtime.animationToken) {
                resolve(false);
                return;
            }

            const progress = clamp((now - start) / duration, 0, 1);
            const eased = easing(progress);
            for (const key of Object.keys(target)) {
                runtime.motion[key] = lerp(from[key], target[key], eased);
            }

            applyMotion();

            if (progress < 1) {
                window.requestAnimationFrame(frame);
                return;
            }

            resolve(true);
        }

        window.requestAnimationFrame(frame);
    });
}

function waitForPause(duration, token = runtime.animationToken) {
    return new Promise(resolve => {
        window.setTimeout(() => {
            resolve(token === runtime.animationToken);
        }, duration);
    });
}

async function settleToBrowse() {
    const token = ++runtime.animationToken;
    runtime.phase = 'settling';
    const completed = await tweenMotion(buildBrowsePose(), BROWSE_RETURN_MS, easeOutCubic, token);
    if (!completed) {
        return;
    }

    runtime.phase = 'browse';
}

async function openBook() {
    if (runtime.pages.length === 0) {
        return;
    }

    if (runtime.phase === 'browse' || runtime.phase === 'dragging' || runtime.phase === 'settling') {
        return;
    }

    const token = ++runtime.animationToken;
    runtime.phase = 'summoning';

    clearTimeout(runtime.toastTimer);
    clearTurner({ resetPose: false });
    Object.assign(runtime.motion, buildLauncherPose());
    renderStaticPage();
    renderInsideCover();
    applyMotion();

    const summoned = await tweenMotion(buildSummonPose(), OPEN_SUMMON_MS, easeOutCubic, token);
    if (!summoned) {
        return;
    }

    runtime.phase = 'opening';
    const morphed = await tweenMotion(buildCoverPose(), OPEN_MORPH_MS, easeInOutCubic, token);
    if (!morphed) {
        return;
    }

    const released = await tweenMotion(buildReleasePose(), OPEN_RELEASE_MS, easeOutCubic, token);
    if (!released) {
        return;
    }

    const paused = await waitForPause(48, token);
    if (!paused) {
        return;
    }

    const opened = await tweenMotion(buildRevealPose(), OPEN_COVER_MS, easeOutBack, token);
    if (!opened) {
        return;
    }

    const settled = await tweenMotion(buildBrowsePose(), OPEN_SETTLE_MS, easeOutCubic, token);
    if (!settled) {
        return;
    }

    runtime.phase = 'browse';
}

async function closeBook(notifyParent = true) {
    if (runtime.phase === 'closed' || runtime.phase === 'closing' || runtime.phase === 'dismiss') {
        return;
    }

    const token = ++runtime.animationToken;
    releaseCloseDrag(runtime.closeDrag.pointerId);
    runtime.closeDrag.active = false;
    runtime.phase = 'closing';
    clearTimeout(runtime.toastTimer);

    if (runtime.turn.active) {
        renderStaticPage(runtime.turn.fromIndex);
        clearTurner();
    }

    const caught = await tweenMotion(buildCloseCatchPose(), CLOSE_CATCH_MS, easeInOutCubic, token);
    if (!caught) {
        return;
    }

    const covered = await tweenMotion(buildCoverPose(), CLOSE_COVER_MS, easeInOutCubic, token);
    if (!covered) {
        return;
    }

    const morphed = await tweenMotion(buildSummonPose(), CLOSE_MORPH_MS, easeInOutCubic, token);
    if (!morphed) {
        return;
    }

    runtime.phase = 'dismiss';
    const dismissed = await tweenMotion(buildLauncherPose(), CLOSE_DISMISS_MS, easeInBack, token);
    if (!dismissed) {
        return;
    }

    runtime.phase = 'closed';
    if (notifyParent) {
        emitHostEvent('closed');
    }
}

async function animateTurnTo(targetProgress, duration, onComplete) {
    const token = ++runtime.animationToken;
    const start = runtime.turn.progress;
    runtime.phase = 'settling';

    return new Promise(resolve => {
        const startedAt = performance.now();

        function frame(now) {
            if (token !== runtime.animationToken || !runtime.turn.active) {
                resolve(false);
                return;
            }

            const progress = clamp((now - startedAt) / duration, 0, 1);
            runtime.turn.progress = lerp(start, targetProgress, easeInOutCubic(progress));
            updateTurnerTransforms();

            if (progress < 1) {
                window.requestAnimationFrame(frame);
                return;
            }

            onComplete?.();
            resolve(true);
        }

        window.requestAnimationFrame(frame);
    });
}

async function commitTurn() {
    const completed = await animateTurnTo(1, TURN_COMMIT_MS, () => {
        setCurrentPageIndex(runtime.turn.toIndex);
        clearTurner();
        runtime.phase = 'browse';
    });

    if (!completed) {
        return;
    }
}

async function rollbackTurn() {
    const completed = await animateTurnTo(0, TURN_ROLLBACK_MS, () => {
        renderStaticPage(runtime.turn.fromIndex);
        clearTurner();
        runtime.phase = 'browse';
    });

    if (!completed) {
        return;
    }
}

function updateTurnProgressFromPointer(event) {
    const bounds = dom.pageViewport.getBoundingClientRect();
    const direction = runtime.turn.direction;
    const delta = direction === 1
        ? (runtime.turn.startX - event.clientX)
        : (event.clientX - runtime.turn.startX);
    const progress = clamp(delta / Math.max(bounds.width * 0.76, 220), 0, 1);

    runtime.turn.progress = progress;
    runtime.turn.gripY = clamp((event.clientY - bounds.top) / bounds.height, 0.08, 0.92);
    runtime.turn.moved = runtime.turn.moved || progress > 0.02;
    updateTurnerTransforms();
}

function releaseTurn(pointerId) {
    if (pointerId !== null && dom.pageViewport.hasPointerCapture(pointerId)) {
        dom.pageViewport.releasePointerCapture(pointerId);
    }
    runtime.turn.pointerId = null;
}

function handleTurnPointerDown(event) {
    if (
        event.button !== 0
        || runtime.phase !== 'browse'
        || runtime.closeDrag.active
        || runtime.turn.active
        || runtime.turn.armed
    ) {
        return;
    }

    const bounds = dom.pageViewport.getBoundingClientRect();
    runtime.turn.armed = true;
    runtime.turn.pointerId = event.pointerId;
    runtime.turn.startX = event.clientX;
    runtime.turn.startY = event.clientY;
    runtime.turn.gripY = clamp((event.clientY - bounds.top) / bounds.height, 0.08, 0.92);
    runtime.turn.moved = false;
    runtime.turn.direction = 1;
    runtime.turn.fromIndex = runtime.currentPageIndex;
    runtime.turn.toIndex = runtime.currentPageIndex;
    runtime.turn.downInteractive = Boolean(
        getClosestElement(
            event.target,
            '[data-achievement-id], .page-sheet__focus, button, a, input, textarea, select, label',
        ),
    );
}

function handleTurnPointerMove(event) {
    if (runtime.turn.pointerId !== event.pointerId) {
        return;
    }

    if (!runtime.turn.active) {
        if (!runtime.turn.armed) {
            return;
        }

        const deltaX = event.clientX - runtime.turn.startX;
        const deltaY = event.clientY - runtime.turn.startY;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);
        const threshold = runtime.turn.downInteractive ? 18 : 10;

        if (absX < threshold || absX < absY * 1.08) {
            return;
        }

        let direction = deltaX < 0 ? 1 : -1;
        if (!hasTurnTarget(direction)) {
            const fallback = hasTurnTarget(1)
                ? 1
                : (hasTurnTarget(-1) ? -1 : 0);
            if (!fallback) {
                runtime.turn.armed = false;
                runtime.turn.pointerId = null;
                runtime.turn.downInteractive = false;
                return;
            }
            direction = fallback;
        }

        if (!prepareTurn(direction)) {
            return;
        }

        runtime.turn.armed = false;
        dom.pageViewport.setPointerCapture(event.pointerId);
        updateTurnProgressFromPointer(event);
        event.preventDefault();
        return;
    }

    updateTurnProgressFromPointer(event);
    event.preventDefault();
}

async function handleTurnPointerUp(event) {
    if (runtime.turn.pointerId !== event.pointerId) {
        return;
    }

    if (!runtime.turn.active) {
        runtime.turn.armed = false;
        runtime.turn.pointerId = null;
        runtime.turn.downInteractive = false;
        runtime.turn.moved = false;
        return;
    }

    releaseTurn(event.pointerId);
    event.preventDefault();

    if (!runtime.turn.moved && hasTurnTarget(runtime.turn.direction)) {
        runtime.turn.progress = 0.56;
    }

    if (runtime.turn.progress >= 0.42) {
        await commitTurn();
        return;
    }

    await rollbackTurn();
}

function handleTurnPointerCancel(event) {
    if (runtime.turn.pointerId !== event.pointerId) {
        return;
    }

    if (!runtime.turn.active) {
        runtime.turn.armed = false;
        runtime.turn.pointerId = null;
        runtime.turn.downInteractive = false;
        runtime.turn.moved = false;
        return;
    }

    releaseTurn(event.pointerId);
    void rollbackTurn();
}

function mixPose(left, right, amount) {
    const result = createMotion();
    const keys = Object.keys(result);

    for (const key of keys) {
        result[key] = lerp(left[key], right[key], amount);
    }

    return result;
}

function releaseCloseDrag(pointerId) {
    if (pointerId !== null && dom.closeCorner.hasPointerCapture(pointerId)) {
        dom.closeCorner.releasePointerCapture(pointerId);
    }

    runtime.closeDrag.pointerId = null;
}

function handleCloseCornerDown(event) {
    if (event.button !== 0 || runtime.phase !== 'browse' || runtime.turn.active) {
        return;
    }

    runtime.closeDrag.active = true;
    runtime.closeDrag.pointerId = event.pointerId;
    runtime.closeDrag.startX = event.clientX;
    runtime.closeDrag.startY = event.clientY;
    runtime.closeDrag.progress = 0;
    runtime.closeDrag.moved = false;
    dom.closeCorner.setPointerCapture(event.pointerId);
    event.preventDefault();
}

function handleCloseCornerMove(event) {
    if (!runtime.closeDrag.active || runtime.closeDrag.pointerId !== event.pointerId) {
        return;
    }

    const deltaX = Math.max(0, event.clientX - runtime.closeDrag.startX);
    const deltaY = Math.max(0, runtime.closeDrag.startY - event.clientY);
    const sweep = clamp(deltaX / 180, 0, 1);
    const peel = clamp(deltaY / 110, 0, 1);
    const progress = clamp((sweep * 0.84) + (peel * 0.16), 0, 1);
    runtime.closeDrag.progress = progress;
    runtime.closeDrag.moved = runtime.closeDrag.moved || progress > 0.03;

    const catchBlend = clamp(progress / 0.42, 0, 1);
    const coverBlend = clamp((progress - 0.3) / 0.7, 0, 1);
    const catchPose = mixPose(buildBrowsePose(), buildCloseCatchPose(), easeOutCubic(catchBlend));
    const coverPose = mixPose(catchPose, buildCoverPose(), easeInOutCubic(coverBlend));
    const flex = Math.sin(progress * Math.PI);

    Object.assign(runtime.motion, coverPose, {
        rigYaw: coverPose.rigYaw - (progress * 0.8),
        rigPitch: coverPose.rigPitch + (progress * 0.4),
        coverTwist: coverPose.coverTwist - (flex * 1.4),
        coverLift: coverPose.coverLift - (flex * 3.2),
    });
    applyMotion();
}

async function handleCloseCornerUp(event) {
    if (!runtime.closeDrag.active || runtime.closeDrag.pointerId !== event.pointerId) {
        return;
    }

    releaseCloseDrag(event.pointerId);
    const shouldClose = runtime.closeDrag.progress >= 0.36 || !runtime.closeDrag.moved;
    runtime.closeDrag.active = false;

    if (shouldClose) {
        await closeBook(true);
        return;
    }

    await settleToBrowse();
}

function handleCloseCornerCancel(event) {
    if (!runtime.closeDrag.active || runtime.closeDrag.pointerId !== event.pointerId) {
        return;
    }

    releaseCloseDrag(event.pointerId);
    runtime.closeDrag.active = false;
    void settleToBrowse();
}

function jumpToChapter(chapterId) {
    if (!chapterId || runtime.turn.active || runtime.closeDrag.active) {
        return;
    }

    const index = runtime.firstPageByChapter.get(chapterId);
    if (!Number.isInteger(index)) {
        return;
    }

    setCurrentPageIndex(index);
    void settleToBrowse();
}

function jumpToAchievement(id) {
    const index = findPageIndexByAchievement(id);
    if (index < 0) {
        return false;
    }

    runtime.selectedAchievementId = normalizeAchievementId(id);
    setCurrentPageIndex(index);
    return true;
}

function applyAmbientTilt(event) {
    if (runtime.phase !== 'browse' || runtime.turn.active || runtime.closeDrag.active) {
        return;
    }

    const nx = clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1);
    const ny = clamp((event.clientY / window.innerHeight) * 2 - 1, -1, 1);
    const pose = buildBrowsePose();

    runtime.motion.rigYaw = pose.rigYaw + (nx * 1.6);
    runtime.motion.rigPitch = pose.rigPitch - (ny * 1.2);
    runtime.motion.sceneGlow = pose.sceneGlow + ((1 - Math.min(1, Math.hypot(nx, ny))) * 0.06);
    applyMotion();
}

function clearAmbientTilt() {
    if (runtime.phase !== 'browse' || runtime.turn.active || runtime.closeDrag.active) {
        return;
    }

    Object.assign(runtime.motion, buildBrowsePose());
    applyMotion();
}

function showUnlockToast(id) {
    const normalizedId = normalizeAchievementId(id);
    if (!normalizedId) {
        return;
    }

    const achievement = ACHIEVEMENT_INDEX[normalizedId];
    dom.unlockToastTitle.textContent = achievement?.name || '新的记忆被收录';
    dom.unlockToastId.textContent = normalizedId;
    dom.unlockToast.classList.add('is-visible');

    window.clearTimeout(runtime.toastTimer);
    runtime.toastTimer = window.setTimeout(() => {
        dom.unlockToast.classList.remove('is-visible');
    }, 2200);
}

function syncUnlocked(ids) {
    syncUnlockedSet(ids);
}

function unlock(id, allIds = null) {
    const normalizedId = normalizeAchievementId(id);
    if (!normalizedId) {
        return;
    }

    const nextIds = Array.isArray(allIds)
        ? uniqueIds(allIds)
        : uniqueIds([...runtime.unlocked, normalizedId]);

    syncUnlockedSet(nextIds);
    showUnlockToast(normalizedId);
}

function lock(id, allIds = null) {
    const normalizedId = normalizeAchievementId(id);
    if (!normalizedId) {
        return;
    }

    const nextIds = Array.isArray(allIds)
        ? uniqueIds(allIds)
        : [...runtime.unlocked].filter(item => item !== normalizedId);

    syncUnlockedSet(nextIds);
}

function applySession(payload = {}) {
    syncSession(payload);
}

function openTo(id) {
    jumpToAchievement(id);
    if (runtime.phase === 'closed') {
        void openBook();
        return;
    }

    renderStaticPage();
    renderInsideCover();
}

function hibernate() {
    runtime.animationToken += 1;
    runtime.phase = 'closed';
    releaseTurn(runtime.turn.pointerId);
    releaseCloseDrag(runtime.closeDrag.pointerId);
    runtime.turn.active = false;
    runtime.closeDrag.active = false;
    dom.unlockToast.classList.remove('is-visible');
    renderStaticPage();
    renderInsideCover();
    clearTurner({ resetPose: false });
    Object.assign(runtime.motion, buildLauncherPose());
    applyMotion();
}

function getState() {
    return {
        phase: runtime.phase,
        currentPageIndex: runtime.currentPageIndex,
        currentPageKey: getCurrentPage()?.key || '',
        activeChapterId: runtime.activeChapterId,
        unlockedCount: runtime.unlocked.size,
    };
}

function handleChapterRailClick(event) {
    const button = getClosestElement(event.target, '[data-chapter-id]');
    if (!button) {
        return;
    }

    jumpToChapter(button.getAttribute('data-chapter-id'));
}

function handlePageSheetClick(event) {
    const card = getClosestElement(event.target, '[data-achievement-id]');
    if (!card) {
        if (runtime.selectedAchievementId) {
            runtime.selectedAchievementId = '';
            renderStaticPage();
        }
        return;
    }

    const achievementId = normalizeAchievementId(card.getAttribute('data-achievement-id'));
    if (!achievementId || !isUnlocked(achievementId)) {
        return;
    }

    runtime.selectedAchievementId = runtime.selectedAchievementId === achievementId ? '' : achievementId;
    renderStaticPage();
}

function handlePageWheel(event) {
    if (runtime.phase !== 'browse' || runtime.turn.active || runtime.closeDrag.active) {
        return;
    }

    if (Math.abs(event.deltaY) < WHEEL_TURN_THRESHOLD) {
        return;
    }

    const direction = event.deltaY > 0 ? 1 : -1;
    if (!hasTurnTarget(direction)) {
        return;
    }

    event.preventDefault();
    if (prepareTurn(direction)) {
        runtime.turn.progress = 0.58;
        void commitTurn();
    }
}

function handleSceneKeyDown(event) {
    if (event.key === 'Escape') {
        event.preventDefault();
        if (runtime.selectedAchievementId && runtime.phase === 'browse') {
            runtime.selectedAchievementId = '';
            renderStaticPage();
            return;
        }
        void closeBook(true);
        return;
    }

    if (runtime.phase !== 'browse') {
        return;
    }

    if (event.key === 'ArrowRight' && hasTurnTarget(1)) {
        event.preventDefault();
        if (prepareTurn(1)) {
            runtime.turn.progress = 0.56;
            void commitTurn();
        }
        return;
    }

    if (event.key === 'ArrowLeft' && hasTurnTarget(-1)) {
        event.preventDefault();
        if (prepareTurn(-1)) {
            runtime.turn.progress = 0.56;
            void commitTurn();
        }
    }
}

function handleResize() {
    if (runtime.phase === 'closed') {
        Object.assign(runtime.motion, buildLauncherPose());
    } else if (!runtime.turn.active && !runtime.closeDrag.active) {
        Object.assign(runtime.motion, buildBrowsePose());
    }

    applyMotion();
}

function bindEvents() {
    dom.closedBook.addEventListener('click', () => {
        if (runtime.phase === 'closed') {
            void openBook();
        }
    });

    dom.chapterRail.addEventListener('click', handleChapterRailClick);

    dom.pageViewport.addEventListener('pointerdown', handleTurnPointerDown);
    dom.pageViewport.addEventListener('pointermove', handleTurnPointerMove);
    dom.pageViewport.addEventListener('pointerup', event => {
        void handleTurnPointerUp(event);
    });
    dom.pageViewport.addEventListener('pointercancel', handleTurnPointerCancel);
    dom.pageViewport.addEventListener('wheel', handlePageWheel, { passive: false });
    dom.pageSheet.addEventListener('click', handlePageSheetClick);

    dom.closeCorner.addEventListener('pointerdown', handleCloseCornerDown);
    dom.closeCorner.addEventListener('pointermove', handleCloseCornerMove);
    dom.closeCorner.addEventListener('pointerup', event => {
        void handleCloseCornerUp(event);
    });
    dom.closeCorner.addEventListener('pointercancel', handleCloseCornerCancel);

    dom.scene.addEventListener('pointermove', applyAmbientTilt);
    dom.scene.addEventListener('pointerleave', clearAmbientTilt);
    window.addEventListener('keydown', handleSceneKeyDown);
    window.addEventListener('resize', handleResize);

    dom.pageViewport.style.touchAction = 'none';
    dom.closeCorner.style.touchAction = 'none';
}

function initialize() {
    buildPages();
    createTurnStrips();
    setCurrentPageIndex(0);
    Object.assign(runtime.motion, buildLauncherPose());
    applyMotion();
    bindEvents();

    window.AlbumFrame = {
        applySession,
        syncUnlocked,
        unlock,
        lock,
        openBook: () => void openBook(),
        closeBook: () => void closeBook(true),
        openTo,
        hibernate,
        getState,
    };
}

initialize();
