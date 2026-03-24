import {
    ACHIEVEMENTS,
    ACHIEVEMENT_INDEX,
    CHAPTERS,
} from './data/achievements.js';
import { getAchievementAsset } from './data/asset-manifest.js';

const PAGE_SIZE = 4;
const TURN_STRIP_COUNT = 18;

const OPEN_SUMMON_MS = 520;
const OPEN_MORPH_MS = 380;
const OPEN_COVER_MS = 640;
const CLOSE_COVER_MS = 460;
const CLOSE_MORPH_MS = 320;
const CLOSE_DISMISS_MS = 460;
const TURN_COMMIT_MS = 420;
const TURN_ROLLBACK_MS = 280;
const BROWSE_RETURN_MS = 240;

const dom = {
    root: document.documentElement,
    scene: document.getElementById('scene'),
    portal: document.getElementById('portal'),
    closedBook: document.getElementById('closedBook'),
    rig: document.getElementById('rig'),
    cover: document.getElementById('cover'),
    pageViewport: document.getElementById('pageViewport'),
    pageSurface: document.getElementById('pageSurface'),
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
    phase: 'closed',
    animationToken: 0,
    hoverPointer: null,
    toastTimer: 0,
    turn: {
        active: false,
        direction: 1,
        progress: 0,
        gripY: 0.5,
        pointerId: null,
        startX: 0,
        startY: 0,
        moved: false,
        fromIndex: 0,
        toIndex: 0,
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

function isUnlocked(id) {
    return runtime.unlocked.has(normalizeAchievementId(id));
}

function getViewportMetrics() {
    return {
        width: window.innerWidth,
        height: window.innerHeight,
        rigHeight: Math.min(window.innerHeight * 0.8, 900),
        closedWidth: Math.min(window.innerWidth * 0.23, 300),
        closedHeight: Math.min(window.innerWidth * 0.17, 222),
    };
}

function getLauncherRect() {
    const fallback = {
        left: window.innerWidth - 126,
        top: window.innerHeight - 96,
        width: 104,
        height: 78,
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

    return {
        portalX: rectCenterX - (viewport.width / 2),
        portalY: rectCenterY - (viewport.height / 2) - (viewport.rigHeight * 0.06),
        portalScale: clamp(rect.width / viewport.closedWidth, 0.32, 0.72),
        portalRotate: rect.left > viewport.width * 0.52 ? 7 : -7,
        closedAlpha: 1,
        rigAlpha: 0,
        rigScale: 0.86,
        rigLift: 54,
        rigYaw: -14,
        rigPitch: 16,
        coverOpen: 0,
        sceneDim: 0,
        sceneGlow: 0.08,
        pageTilt: 0,
        pageShift: 0,
    };
}

function buildSummonPose() {
    return {
        portalX: 0,
        portalY: 0,
        portalScale: 1.08,
        portalRotate: 0,
        closedAlpha: 1,
        rigAlpha: 0,
        rigScale: 0.92,
        rigLift: 26,
        rigYaw: -11,
        rigPitch: 12,
        coverOpen: 0,
        sceneDim: 0.24,
        sceneGlow: 0.14,
        pageTilt: 0,
        pageShift: 0,
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
        rigScale: 0.98,
        rigLift: 10,
        rigYaw: -7.2,
        rigPitch: 8.8,
        coverOpen: 0,
        sceneDim: 0.58,
        sceneGlow: 0.2,
        pageTilt: 8,
        pageShift: 16,
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
        rigYaw: -4.8,
        rigPitch: 6.2,
        coverOpen: 1,
        sceneDim: 0.78,
        sceneGlow: 0.28,
        pageTilt: 0,
        pageShift: 0,
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
    const asset = getAchievementAsset(meta.assetKey || meta.id);
    const photoUrl = unlocked ? resolveAssetUrl(asset?.thumb || asset?.full || '') : '';
    const photoStyle = photoUrl
        ? ` style="background-image:url('${escapeAttribute(photoUrl)}');background-size:${escapeAttribute(asset?.fit || 'cover')};background-position:center center;background-repeat:no-repeat;"`
        : '';
    const photoContent = photoUrl ? '' : escapeHtml(photoLabel);

    const photoLabel = unlocked
        ? (asset?.placeholder || meta.name || meta.id).slice(0, 18)
        : '?';

    const title = unlocked ? meta.name : '未解锁';
    const desc = unlocked
        ? (meta.desc || meta.cond || meta.keywords || '新的记忆已收录。')
        : '这一张仍覆着灰尘与封条，等待对应成就触发。';
    const metaLine = unlocked
        ? (meta.cond || meta.chapterSubtitle || '成就已收录')
        : '条件暂未公开';

    return `
        <article class="memory-card ${unlocked ? 'is-unlocked' : 'is-locked'}" data-achievement-id="${escapeAttribute(meta.id)}">
            <div class="memory-card__photo ${photoUrl ? 'has-asset' : ''}"${photoStyle}>${photoContent}</div>
            <div class="memory-card__title">${escapeHtml(title)}</div>
            <div class="memory-card__desc">${escapeHtml(desc)}</div>
            <div class="memory-card__meta">${escapeHtml(metaLine)}</div>
            <div class="memory-card__id">${escapeHtml(meta.id)}</div>
        </article>
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
    const cards = [];
    for (let index = 0; index < PAGE_SIZE; index += 1) {
        cards.push(buildCardMarkup(page.items[index] ?? null));
    }

    return `
        <section class="${forTurn ? 'turn-page' : 'page-sheet'}" data-page-key="${escapeAttribute(page.key)}">
            <header class="page-sheet__header">
                <div>
                    <span class="page-sheet__eyebrow">${escapeHtml(page.chapterId)} · PAGE ${String(page.pageIndex + 1).padStart(2, '0')}</span>
                    <h2 class="page-sheet__title">${escapeHtml(page.chapterTitle)}</h2>
                    <div class="page-sheet__subtitle">${escapeHtml(page.chapterSubtitle || '私人档案馆中的记忆切片')}</div>
                </div>
                <div class="page-sheet__badge">${unlockedCount} / ${page.items.length}<br>Unlocked</div>
            </header>
            <div class="page-sheet__grid">${cards.join('')}</div>
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
    const gripTilt = (0.5 - runtime.turn.gripY) * 14;
    const lastIndex = Math.max(1, TURN_STRIP_COUNT - 1);

    runtime.turnStrips.forEach((strip, index) => {
        const edgeFactor = direction === 1
            ? ((TURN_STRIP_COUNT - 1) - index) / lastIndex
            : index / lastIndex;
        const lag = edgeFactor * 0.2;
        const local = clamp((progress - lag) / Math.max(0.001, 1 - lag), 0, 1);
        const wave = Math.sin(local * Math.PI);
        const angle = (direction === 1 ? -1 : 1) * (180 * local);
        const lift = wave * (8 + ((1 - edgeFactor) * 26));
        const skewY = ((0.5 - edgeFactor) * 6) * wave;
        const rotateX = gripTilt * wave;
        const shadowOpacity = clamp((wave * 0.56) + (progress * 0.18), 0, 0.76);
        const shineOpacity = clamp((wave * 0.38) + (progress * 0.08), 0, 0.46);

        strip.el.style.transformOrigin = direction === 1 ? 'left center' : 'right center';
        strip.el.style.zIndex = direction === 1
            ? String(TURN_STRIP_COUNT - index)
            : String(index + 1);
        strip.el.style.transform = `
            translate3d(0, ${skewY.toFixed(2)}px, ${lift.toFixed(2)}px)
            rotateX(${rotateX.toFixed(2)}deg)
            rotateY(${angle.toFixed(2)}deg)
        `;
        strip.shadow.style.opacity = shadowOpacity.toFixed(3);
        strip.shine.style.opacity = shineOpacity.toFixed(3);
    });

    runtime.motion.pageTilt = (direction === 1 ? -1 : 1) * (progress * 8);
    runtime.motion.pageShift = (direction === 1 ? -1 : 1) * (progress * 18);
    runtime.motion.rigYaw = lerp(buildBrowsePose().rigYaw, buildBrowsePose().rigYaw + ((direction === 1 ? -1 : 1) * 1.8), progress);
    runtime.motion.rigPitch = lerp(buildBrowsePose().rigPitch, buildBrowsePose().rigPitch + 1.8, progress);
    runtime.motion.sceneGlow = lerp(buildBrowsePose().sceneGlow, buildBrowsePose().sceneGlow + 0.08, progress);
    applyMotion();
}

function clearTurner() {
    releaseTurn(runtime.turn.pointerId);
    runtime.turn.active = false;
    runtime.turn.progress = 0;
    runtime.turn.moved = false;
    runtime.turn.gripY = 0.5;
    dom.pageTurner.classList.remove('is-active');

    runtime.turnStrips.forEach(strip => {
        strip.el.style.transform = '';
        strip.el.style.transformOrigin = '';
        strip.el.style.zIndex = '';
        strip.shadow.style.opacity = '0';
        strip.shine.style.opacity = '0';
    });

    Object.assign(runtime.motion, buildBrowsePose());
    applyMotion();
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
    clearTurner();
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

    const paused = await waitForPause(90, token);
    if (!paused) {
        return;
    }

    const opened = await tweenMotion(buildBrowsePose(), OPEN_COVER_MS, easeInOutCubic, token);
    if (!opened) {
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

    const covered = await tweenMotion(buildCoverPose(), CLOSE_COVER_MS, easeInOutCubic, token);
    if (!covered) {
        return;
    }

    const morphed = await tweenMotion(buildSummonPose(), CLOSE_MORPH_MS, easeInOutCubic, token);
    if (!morphed) {
        return;
    }

    runtime.phase = 'dismiss';
    const dismissed = await tweenMotion(buildLauncherPose(), CLOSE_DISMISS_MS, easeInOutCubic, token);
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
    const progress = clamp(delta / (bounds.width * 0.9), 0, 1);

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
    if (event.button !== 0 || runtime.phase !== 'browse' || runtime.closeDrag.active) {
        return;
    }

    const bounds = dom.pageViewport.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const direction = pointerX >= bounds.width / 2 ? 1 : -1;

    if (!prepareTurn(direction)) {
        return;
    }

    runtime.turn.pointerId = event.pointerId;
    runtime.turn.startX = event.clientX;
    runtime.turn.startY = event.clientY;
    runtime.turn.moved = false;

    dom.pageViewport.setPointerCapture(event.pointerId);
    event.preventDefault();
}

function handleTurnPointerMove(event) {
    if (!runtime.turn.active || runtime.turn.pointerId !== event.pointerId) {
        return;
    }

    updateTurnProgressFromPointer(event);
}

async function handleTurnPointerUp(event) {
    if (!runtime.turn.active || runtime.turn.pointerId !== event.pointerId) {
        return;
    }

    releaseTurn(event.pointerId);

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
    if (!runtime.turn.active || runtime.turn.pointerId !== event.pointerId) {
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
    const progress = clamp(deltaX / 180, 0, 1);
    runtime.closeDrag.progress = progress;
    runtime.closeDrag.moved = runtime.closeDrag.moved || progress > 0.03;

    Object.assign(runtime.motion, mixPose(buildBrowsePose(), buildCoverPose(), progress));
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
    Object.assign(runtime.motion, buildLauncherPose());
    applyMotion();
    clearTurner();
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
    const button = event.target.closest('[data-chapter-id]');
    if (!button) {
        return;
    }

    jumpToChapter(button.getAttribute('data-chapter-id'));
}

function handleSceneKeyDown(event) {
    if (event.key === 'Escape') {
        event.preventDefault();
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
    dom.chapterRail.addEventListener('click', handleChapterRailClick);

    dom.pageViewport.addEventListener('pointerdown', handleTurnPointerDown);
    dom.pageViewport.addEventListener('pointermove', handleTurnPointerMove);
    dom.pageViewport.addEventListener('pointerup', event => {
        void handleTurnPointerUp(event);
    });
    dom.pageViewport.addEventListener('pointercancel', handleTurnPointerCancel);

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
