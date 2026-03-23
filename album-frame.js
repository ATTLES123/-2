import {
    ACHIEVEMENTS,
    ACHIEVEMENT_INDEX,
    ACHIEVEMENTS_BY_CHAPTER,
    CHAPTER_INDEX,
    CHAPTERS,
} from './data/achievements.js';
import { getAchievementAsset } from './data/asset-manifest.js';

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

function emitHostEvent(event) {
    try {
        window.parent?.__albumBridgePluginHost?.handleFrameEvent?.(event);
    } catch {
    }
}

const PAGE_SIZE = 8;
const CLOSED_POSE = Object.freeze({
    openAmount: 0,
    yaw: -12,
    pitch: 12,
    scale: 0.88,
    shiftX: 0,
    shiftY: 18,
    sceneGlow: 0.14,
});
const OPEN_POSE = Object.freeze({
    openAmount: 1,
    yaw: -6,
    pitch: 8,
    scale: 1,
    shiftX: 0,
    shiftY: 0,
    sceneGlow: 0.32,
});

const state = {
    bindId: '',
    characterName: '',
    profile: 'pure-plugin-flagship',
    unlockedIds: [],
    activeChapterIndex: 0,
    activePage: 0,
    stageMode: 'closed',
    drag: null,
    flip: {
        visible: false,
        side: 'right',
        direction: 1,
    },
    freshUnlockId: '',
    timers: {
        open: 0,
        close: 0,
        toast: 0,
        freshUnlock: 0,
        rollback: 0,
        commit: 0,
    },
    visual: {
        current: {
            openAmount: CLOSED_POSE.openAmount,
            yawOffset: 0,
            pitchOffset: 0,
            shiftX: CLOSED_POSE.shiftX,
            shiftY: CLOSED_POSE.shiftY,
            flipProgress: 0,
            flipCurl: 0,
            flipLift: 0,
            flipShadow: 0,
            unlockFlash: 0,
            pageLeftTilt: 0,
            pageRightTilt: 0,
            pageLeftShift: 0,
            pageRightShift: 0,
            sceneGlow: CLOSED_POSE.sceneGlow,
        },
        target: {
            openAmount: CLOSED_POSE.openAmount,
            yawOffset: 0,
            pitchOffset: 0,
            shiftX: CLOSED_POSE.shiftX,
            shiftY: CLOSED_POSE.shiftY,
            flipProgress: 0,
            flipCurl: 0,
            flipLift: 0,
            flipShadow: 0,
            unlockFlash: 0,
            pageLeftTilt: 0,
            pageRightTilt: 0,
            pageLeftShift: 0,
            pageRightShift: 0,
            sceneGlow: CLOSED_POSE.sceneGlow,
        },
        lastTime: 0,
        frame: 0,
    },
};

const ui = {
    shell: document.getElementById('bookShell'),
    chapterList: document.getElementById('chapterList'),
    achievementGrid: document.getElementById('achievementGrid'),
    chapterTitle: document.getElementById('chapterTitle'),
    chapterEyebrow: document.getElementById('chapterEyebrow'),
    chapterProgress: document.getElementById('chapterProgress'),
    bookTitle: document.getElementById('bookTitle'),
    bookSubtitle: document.getElementById('bookSubtitle'),
    globalUnlockCount: document.getElementById('globalUnlockCount'),
    globalAchievementCount: document.getElementById('globalAchievementCount'),
    leftPageNumber: document.getElementById('leftPageNumber'),
    rightPageNumber: document.getElementById('rightPageNumber'),
    nextHotspot: document.getElementById('nextHotspot'),
    prevHotspot: document.getElementById('prevHotspot'),
    closeHotspot: document.getElementById('closeHotspot'),
    flipSheet: document.getElementById('flipSheet'),
    flipFrontContent: document.getElementById('flipFrontContent'),
    flipBackContent: document.getElementById('flipBackContent'),
    unlockToast: document.getElementById('unlockToast'),
    unlockToastTitle: document.getElementById('unlockToastTitle'),
    unlockToastId: document.getElementById('unlockToastId'),
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function mix(a, b, t) {
    return a + (b - a) * t;
}

function damp(current, target, speed, deltaSeconds) {
    const factor = 1 - Math.exp(-speed * deltaSeconds);
    return current + (target - current) * factor;
}

function clearTimer(name) {
    if (state.timers[name]) {
        window.clearTimeout(state.timers[name]);
        state.timers[name] = 0;
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function escapeCssUrl(value) {
    return String(value ?? '').replaceAll('\\', '/').replaceAll('"', '\\"');
}

function totalAchievementCount() {
    return ACHIEVEMENTS.length;
}

function unlockedCountForChapter(chapterId) {
    return state.unlockedIds.filter(id => id.startsWith(`${chapterId}_`)).length;
}

function chapterForId(id) {
    if (typeof id !== 'string') {
        return null;
    }

    return CHAPTER_INDEX[id.slice(0, 2)] ?? null;
}

function getAchievementIdsForChapter(chapterId) {
    return CHAPTER_INDEX[chapterId]?.ids ?? [];
}

function getCurrentChapter() {
    return CHAPTERS[state.activeChapterIndex] ?? CHAPTERS[0];
}

function totalPagesForChapter(chapterId) {
    const total = getAchievementIdsForChapter(chapterId).length;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

function normalizeUnlockedIds(ids) {
    return [...new Set(
        (Array.isArray(ids) ? ids : [])
            .map(normalizeAchievementId)
            .filter(Boolean),
    )];
}

function createAchievementMeta(id) {
    const source = ACHIEVEMENT_INDEX[id] ?? {
        id,
        chapterId: id.slice(0, 2),
        chapterTitle: id.slice(0, 2),
        sequence: 0,
        name: id,
        desc: '',
        cond: '',
        keywords: '',
        assetKey: id,
    };
    const unlocked = state.unlockedIds.includes(id);
    const asset = unlocked ? getAchievementAsset(source.assetKey || id) : null;

    return {
        ...source,
        unlocked,
        asset,
        displayTitle: unlocked ? source.name : '未解锁成就',
        displayDesc: unlocked ? source.desc : '灰色相片位 · 等待收录',
        displayCond: unlocked ? source.cond : '触发条件隐藏',
    };
}

function getSpreadModel(chapterIndex, pageIndex) {
    const chapter = CHAPTERS[chapterIndex] ?? CHAPTERS[0];
    const ids = getAchievementIdsForChapter(chapter.id);
    const start = pageIndex * PAGE_SIZE;
    const items = ids.slice(start, start + PAGE_SIZE).map(createAchievementMeta);
    return {
        chapter,
        pageIndex,
        totalPages: totalPagesForChapter(chapter.id),
        items,
    };
}

function getPageItems() {
    return getSpreadModel(state.activeChapterIndex, state.activePage).items;
}

function resolveAdjacentSpread(direction) {
    let chapterIndex = state.activeChapterIndex;
    let pageIndex = state.activePage;

    if (direction > 0) {
        const currentChapter = CHAPTERS[chapterIndex];
        const currentTotalPages = totalPagesForChapter(currentChapter.id);

        if (pageIndex + 1 < currentTotalPages) {
            pageIndex += 1;
        } else if (chapterIndex < CHAPTERS.length - 1) {
            chapterIndex += 1;
            pageIndex = 0;
        }
    } else {
        if (pageIndex > 0) {
            pageIndex -= 1;
        } else if (chapterIndex > 0) {
            chapterIndex -= 1;
            pageIndex = totalPagesForChapter(CHAPTERS[chapterIndex].id) - 1;
        }
    }

    return {
        chapterIndex,
        pageIndex,
        spread: getSpreadModel(chapterIndex, pageIndex),
    };
}

function buildPhotoStyle(meta) {
    const asset = meta.asset;
    if (!asset?.thumb) {
        return '';
    }

    const fit = asset.fit === 'contain' ? 'contain' : 'cover';
    const imageUrl = escapeCssUrl(asset.thumb);
    return ` style="background-image: linear-gradient(135deg, rgba(16, 10, 6, 0.12), rgba(16, 10, 6, 0.22)), url('${imageUrl}'); background-size: ${fit}; background-position: center; background-repeat: no-repeat;"`;
}

function buildCardMarkup(meta, index, prefix = 'achievement') {
    const tiltSet = [-1.4, 1.2, -0.5, 1.7, -1.1, 0.8, -1.7, 1.1];
    const tilt = tiltSet[index % tiltSet.length];
    const fresh = meta.id === state.freshUnlockId ? ' is-fresh' : '';
    const lockedClass = meta.unlocked ? '' : ' is-locked';
    const assetClass = meta.asset?.thumb ? ' has-asset' : '';
    const title = escapeHtml(meta.displayTitle);
    const desc = escapeHtml(meta.displayDesc);
    const cond = escapeHtml(meta.displayCond);
    const id = escapeHtml(meta.id);
    const photoLabel = escapeHtml(meta.unlocked ? (meta.asset?.placeholder || '已收录') : '???');

    return `
        <article class="${prefix}-card${lockedClass}${prefix === 'achievement' ? fresh : ''}" data-achievement-id="${id}" style="--card-tilt:${tilt}deg">
            <div class="${prefix}-card__photo${assetClass}"${buildPhotoStyle(meta)}>${photoLabel}</div>
            <div class="${prefix}-card__title">${title}</div>
            <div class="${prefix}-card__desc">${desc}</div>
            <div class="${prefix}-card__meta">${cond}</div>
            <div class="${prefix}-card__id">${id}</div>
        </article>
    `;
}

function buildFlipContentMarkup(spread, label) {
    const unlocked = unlockedCountForChapter(spread.chapter.id);
    const cards = spread.items.map((meta, index) => buildCardMarkup(meta, index, 'flip')).join('');
    const subtitle = spread.chapter.subtitle ? ` · ${escapeHtml(spread.chapter.subtitle)}` : '';
    return `
        <header class="flip-header">
            <div class="flip-header__eyebrow">${escapeHtml(label)}</div>
            <h3 class="flip-header__title">${escapeHtml(spread.chapter.title)}</h3>
            <div class="flip-header__meta">${unlocked} / ${spread.chapter.total} · 第 ${spread.pageIndex + 1} 页${subtitle}</div>
        </header>
        <div class="flip-grid">
            ${cards}
        </div>
    `;
}

function syncShellClasses() {
    ui.shell.classList.toggle('is-opening', state.stageMode === 'opening');
    ui.shell.classList.toggle('is-open', state.stageMode === 'open' || state.stageMode === 'opening' || state.stageMode === 'closing');
    ui.shell.classList.toggle('is-closing', state.stageMode === 'closing');
}

function applyVisualState() {
    const current = state.visual.current;
    const style = document.documentElement.style;
    const openAmount = current.openAmount;
    const yaw = mix(CLOSED_POSE.yaw, OPEN_POSE.yaw, openAmount) + current.yawOffset;
    const pitch = mix(CLOSED_POSE.pitch, OPEN_POSE.pitch, openAmount) + current.pitchOffset;
    const scale = mix(CLOSED_POSE.scale, OPEN_POSE.scale, openAmount);
    const shiftY = mix(CLOSED_POSE.shiftY, OPEN_POSE.shiftY, openAmount) + current.shiftY;
    const shiftX = current.shiftX;
    const sceneGlow = clamp(mix(CLOSED_POSE.sceneGlow, OPEN_POSE.sceneGlow, openAmount) + current.sceneGlow, 0, 1);

    style.setProperty('--flip-progress', current.flipProgress.toFixed(4));
    style.setProperty('--flip-curl', current.flipCurl.toFixed(4));
    style.setProperty('--flip-lift', current.flipLift.toFixed(4));
    style.setProperty('--flip-shadow-strength', current.flipShadow.toFixed(4));
    style.setProperty('--close-progress', (1 - openAmount).toFixed(4));
    style.setProperty('--book-scale', scale.toFixed(4));
    style.setProperty('--book-yaw', `${yaw.toFixed(3)}deg`);
    style.setProperty('--book-pitch', `${pitch.toFixed(3)}deg`);
    style.setProperty('--book-shift-x', `${shiftX.toFixed(2)}px`);
    style.setProperty('--book-shift-y', `${shiftY.toFixed(2)}px`);
    style.setProperty('--scene-dim', openAmount.toFixed(4));
    style.setProperty('--scene-glow', sceneGlow.toFixed(4));
    style.setProperty('--page-left-tilt', `${current.pageLeftTilt.toFixed(3)}deg`);
    style.setProperty('--page-right-tilt', `${current.pageRightTilt.toFixed(3)}deg`);
    style.setProperty('--page-left-shift', `${current.pageLeftShift.toFixed(2)}px`);
    style.setProperty('--page-right-shift', `${current.pageRightShift.toFixed(2)}px`);
    style.setProperty('--unlock-flash', current.unlockFlash.toFixed(4));
}

function tick(timestamp) {
    const lastTime = state.visual.lastTime || timestamp;
    const deltaSeconds = Math.min((timestamp - lastTime) / 1000, 0.05);
    state.visual.lastTime = timestamp;

    const current = state.visual.current;
    const target = state.visual.target;

    current.openAmount = damp(current.openAmount, target.openAmount, 8.2, deltaSeconds);
    current.yawOffset = damp(current.yawOffset, target.yawOffset, 11, deltaSeconds);
    current.pitchOffset = damp(current.pitchOffset, target.pitchOffset, 11, deltaSeconds);
    current.shiftX = damp(current.shiftX, target.shiftX, 10, deltaSeconds);
    current.shiftY = damp(current.shiftY, target.shiftY, 9, deltaSeconds);
    current.flipProgress = damp(current.flipProgress, target.flipProgress, 17, deltaSeconds);
    current.flipCurl = damp(current.flipCurl, target.flipCurl, 18, deltaSeconds);
    current.flipLift = damp(current.flipLift, target.flipLift, 15, deltaSeconds);
    current.flipShadow = damp(current.flipShadow, target.flipShadow, 14, deltaSeconds);
    current.unlockFlash = damp(current.unlockFlash, target.unlockFlash, 5.5, deltaSeconds);
    current.pageLeftTilt = damp(current.pageLeftTilt, target.pageLeftTilt, 14, deltaSeconds);
    current.pageRightTilt = damp(current.pageRightTilt, target.pageRightTilt, 14, deltaSeconds);
    current.pageLeftShift = damp(current.pageLeftShift, target.pageLeftShift, 14, deltaSeconds);
    current.pageRightShift = damp(current.pageRightShift, target.pageRightShift, 14, deltaSeconds);
    current.sceneGlow = damp(current.sceneGlow, target.sceneGlow, 8, deltaSeconds);

    applyVisualState();
    state.visual.frame = requestAnimationFrame(tick);
}

function setIdleVisualTargets() {
    state.visual.target.yawOffset = 0;
    state.visual.target.pitchOffset = 0;
    state.visual.target.shiftX = 0;
    state.visual.target.shiftY = 0;
    state.visual.target.flipProgress = 0;
    state.visual.target.flipCurl = 0;
    state.visual.target.flipLift = 0;
    state.visual.target.flipShadow = 0;
    state.visual.target.pageLeftTilt = 0;
    state.visual.target.pageRightTilt = 0;
    state.visual.target.pageLeftShift = 0;
    state.visual.target.pageRightShift = 0;
}

function renderChapterList() {
    const html = CHAPTERS.map((chapter, index) => {
        const unlocked = unlockedCountForChapter(chapter.id);
        const isActive = index === state.activeChapterIndex;
        const subtitle = chapter.subtitle ? `<div class="chapter-item__subtitle">${escapeHtml(chapter.subtitle)}</div>` : '';

        return `
            <article class="chapter-item ${isActive ? 'is-active' : ''}" data-chapter-index="${index}">
                <div>
                    <div class="chapter-item__meta">${escapeHtml(chapter.id)}</div>
                    <div class="chapter-item__title">${escapeHtml(chapter.title)}</div>
                    ${subtitle}
                </div>
                <div class="chapter-item__count">${unlocked} / ${chapter.total}</div>
            </article>
        `;
    }).join('');

    ui.chapterList.innerHTML = html;

    ui.chapterList.querySelectorAll('[data-chapter-index]').forEach(element => {
        element.addEventListener('click', () => {
            state.activeChapterIndex = Number(element.dataset.chapterIndex);
            state.activePage = 0;
            render();
        });
    });
}

function renderAchievementGrid() {
    ui.achievementGrid.innerHTML = getPageItems()
        .map((meta, index) => buildCardMarkup(meta, index, 'achievement'))
        .join('');
}

function renderHeader() {
    const chapter = getCurrentChapter();
    const unlocked = unlockedCountForChapter(chapter.id);
    const totalPages = totalPagesForChapter(chapter.id);
    const subtitle = chapter.subtitle ? ` · ${chapter.subtitle}` : '';

    ui.bookTitle.textContent = state.characterName ? `${state.characterName} 的相册` : '成就典藏';
    ui.bookSubtitle.textContent = `桌面旗舰版 · ${state.profile}`;
    ui.globalUnlockCount.textContent = String(state.unlockedIds.length);
    ui.globalAchievementCount.textContent = String(totalAchievementCount());
    ui.chapterEyebrow.textContent = `章节 ${chapter.id}`;
    ui.chapterTitle.textContent = `${chapter.title}${subtitle}`;
    ui.chapterProgress.textContent = `${unlocked} / ${chapter.total} · 第 ${state.activePage + 1} / ${totalPages} 页`;
    ui.leftPageNumber.textContent = String(state.activePage * 2 + 1).padStart(3, '0');
    ui.rightPageNumber.textContent = String(state.activePage * 2 + 2).padStart(3, '0');

    ui.prevHotspot.style.pointerEvents = totalPages > 0 && (state.activePage > 0 || state.activeChapterIndex > 0) ? 'auto' : 'none';
    ui.nextHotspot.style.pointerEvents = (state.activePage + 1) < totalPages || state.activeChapterIndex < CHAPTERS.length - 1 ? 'auto' : 'none';
}

function render() {
    renderHeader();
    renderChapterList();
    renderAchievementGrid();
    syncShellClasses();
}

function setFlipSheetVisible(visible) {
    state.flip.visible = visible;
    ui.flipSheet.classList.toggle('is-visible', visible);
}

function prepareFlipSheet(direction) {
    const currentSpread = getSpreadModel(state.activeChapterIndex, state.activePage);
    const adjacent = resolveAdjacentSpread(direction);

    state.flip.direction = direction;
    state.flip.side = direction > 0 ? 'right' : 'left';
    ui.flipSheet.classList.toggle('is-right', direction > 0);
    ui.flipSheet.classList.toggle('is-left', direction < 0);

    if (direction > 0) {
        ui.flipFrontContent.innerHTML = buildFlipContentMarkup(currentSpread, '当前页');
        ui.flipBackContent.innerHTML = buildFlipContentMarkup(adjacent.spread, '下一页');
    } else {
        ui.flipFrontContent.innerHTML = buildFlipContentMarkup(adjacent.spread, '上一页');
        ui.flipBackContent.innerHTML = buildFlipContentMarkup(currentSpread, '当前页');
    }

    setFlipSheetVisible(true);
}

function hideFlipSheetAfter(delay = 220) {
    clearTimer('rollback');
    state.timers.rollback = window.setTimeout(() => {
        setFlipSheetVisible(false);
    }, delay);
}

function commitPageAdvance(direction) {
    const next = resolveAdjacentSpread(direction);
    state.activeChapterIndex = next.chapterIndex;
    state.activePage = next.pageIndex;
    render();
    emitHostEvent({
        type: 'page-changed',
        chapter: getCurrentChapter().id,
        page: state.activePage,
    });
}

function showUnlockToast(id) {
    if (typeof id !== 'string' || !id.trim()) {
        return;
    }

    const achievement = ACHIEVEMENT_INDEX[id];
    const chapter = chapterForId(id);
    ui.unlockToastTitle.textContent = achievement?.name || (chapter ? `${chapter.title} 收录了新记忆` : '新的记忆被收录');
    ui.unlockToastId.textContent = id;

    ui.unlockToast.classList.remove('is-visible');
    void ui.unlockToast.offsetWidth;
    ui.unlockToast.classList.add('is-visible');

    clearTimer('toast');
    state.visual.target.unlockFlash = 1;
    state.timers.toast = window.setTimeout(() => {
        ui.unlockToast.classList.remove('is-visible');
        state.visual.target.unlockFlash = 0;
    }, 1800);

    state.freshUnlockId = id;
    clearTimer('freshUnlock');
    state.timers.freshUnlock = window.setTimeout(() => {
        state.freshUnlockId = '';
        render();
    }, 1800);
}

function releaseDragListeners() {
    if (!state.drag) {
        return;
    }

    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerCancel);

    if (state.drag.element?.hasPointerCapture?.(state.drag.pointerId)) {
        state.drag.element.releasePointerCapture(state.drag.pointerId);
    }

    state.drag = null;
}

function handlePointerCancel() {
    if (!state.drag) {
        return;
    }

    releaseDragListeners();
    setIdleVisualTargets();
    hideFlipSheetAfter(120);
}

function handlePointerMove(event) {
    if (!state.drag) {
        return;
    }

    const { mode, startX, startY } = state.drag;

    if (mode === 'next') {
        const progress = clamp((startX - event.clientX) / (window.innerWidth * 0.22), 0, 1);
        state.drag.progress = progress;
        state.visual.target.flipProgress = progress;
        state.visual.target.flipCurl = clamp(progress * 1.08, 0, 0.92);
        state.visual.target.flipLift = clamp(progress * 0.58, 0, 0.6);
        state.visual.target.flipShadow = clamp(progress * 0.95, 0, 1);
        state.visual.target.yawOffset = mix(0, 3.4, progress);
        state.visual.target.pitchOffset = mix(0, -1.2, progress);
        state.visual.target.pageRightTilt = mix(0, -4.8, progress);
        state.visual.target.pageRightShift = mix(0, -14, progress);
    }

    if (mode === 'prev') {
        const progress = clamp((event.clientX - startX) / (window.innerWidth * 0.22), 0, 1);
        state.drag.progress = progress;
        state.visual.target.flipProgress = progress;
        state.visual.target.flipCurl = clamp(progress * 1.08, 0, 0.92);
        state.visual.target.flipLift = clamp(progress * 0.58, 0, 0.6);
        state.visual.target.flipShadow = clamp(progress * 0.95, 0, 1);
        state.visual.target.yawOffset = mix(0, -3.2, progress);
        state.visual.target.pitchOffset = mix(0, -1.2, progress);
        state.visual.target.pageLeftTilt = mix(0, 4.8, progress);
        state.visual.target.pageLeftShift = mix(0, 14, progress);
    }

    if (mode === 'close') {
        const progress = clamp(((startX - event.clientX) + (event.clientY - startY)) / 220, 0, 1);
        state.drag.progress = progress;
        state.visual.target.openAmount = 1 - progress;
        state.visual.target.yawOffset = mix(0, -5.5, progress);
        state.visual.target.pitchOffset = mix(0, 2.6, progress);
        state.visual.target.shiftX = mix(0, -24, progress);
        state.visual.target.shiftY = mix(0, 18, progress);
        state.visual.target.sceneGlow = mix(0.16, 0.02, progress);
    }
}

function animateFlipCommit(direction) {
    clearTimer('commit');
    state.visual.target.flipProgress = 1;
    state.visual.target.flipCurl = 0.48;
    state.visual.target.flipLift = 0.26;
    state.visual.target.flipShadow = 0.8;

    state.timers.commit = window.setTimeout(() => {
        commitPageAdvance(direction);
        setIdleVisualTargets();
        setFlipSheetVisible(false);
    }, 260);
}

function animateFlipRollback() {
    setIdleVisualTargets();
    hideFlipSheetAfter(220);
}

function finishCloseSequence(notifyParent = true) {
    clearTimer('close');
    state.stageMode = 'closing';
    syncShellClasses();
    state.visual.target.openAmount = 0;
    state.visual.target.yawOffset = -3.2;
    state.visual.target.pitchOffset = 1.2;
    state.visual.target.shiftY = 12;
    state.visual.target.sceneGlow = 0.02;

    state.timers.close = window.setTimeout(() => {
        state.stageMode = 'closed';
        syncShellClasses();
        setIdleVisualTargets();
        state.visual.target.openAmount = 0;
        state.visual.target.sceneGlow = CLOSED_POSE.sceneGlow;
        if (notifyParent) {
            emitHostEvent({ type: 'closed' });
        }
    }, 720);
}

function handlePointerUp() {
    if (!state.drag) {
        return;
    }

    const { mode, progress } = state.drag;
    releaseDragListeners();

    if (mode === 'next' || mode === 'prev') {
        if (progress > 0.42) {
            animateFlipCommit(mode === 'next' ? 1 : -1);
        } else {
            animateFlipRollback();
        }
    }

    if (mode === 'close') {
        if (progress > 0.38) {
            finishCloseSequence(true);
        } else {
            state.visual.target.openAmount = 1;
            state.visual.target.sceneGlow = OPEN_POSE.sceneGlow;
            setIdleVisualTargets();
        }
    }
}

function beginDrag(mode, event, element) {
    if (state.stageMode !== 'open') {
        return;
    }

    clearTimer('rollback');
    clearTimer('commit');

    state.drag = {
        mode,
        startX: event.clientX,
        startY: event.clientY,
        pointerId: event.pointerId,
        progress: 0,
        element,
    };

    if (element?.setPointerCapture) {
        element.setPointerCapture(event.pointerId);
    }

    if (mode === 'next') {
        prepareFlipSheet(1);
    }

    if (mode === 'prev') {
        prepareFlipSheet(-1);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
}

function bindHotspots() {
    ui.nextHotspot.addEventListener('pointerdown', event => beginDrag('next', event, ui.nextHotspot));
    ui.prevHotspot.addEventListener('pointerdown', event => beginDrag('prev', event, ui.prevHotspot));
    ui.closeHotspot.addEventListener('pointerdown', event => beginDrag('close', event, ui.closeHotspot));
}

function openBook() {
    if (state.stageMode === 'open' || state.stageMode === 'opening') {
        render();
        return;
    }

    clearTimer('close');
    clearTimer('open');
    state.stageMode = 'opening';
    syncShellClasses();
    state.visual.target.openAmount = 1;
    state.visual.target.sceneGlow = OPEN_POSE.sceneGlow;
    setIdleVisualTargets();

    state.timers.open = window.setTimeout(() => {
        state.stageMode = 'open';
        syncShellClasses();
        emitHostEvent({
            type: 'opened',
            chapter: getCurrentChapter().id,
            page: state.activePage,
        });
    }, 1100);

    render();
}

function closeBook(notifyParent = true) {
    if (state.stageMode === 'closed' || state.stageMode === 'closing') {
        return;
    }

    finishCloseSequence(notifyParent);
}

function openTo(id) {
    const normalizedId = normalizeAchievementId(id);
    const achievement = ACHIEVEMENT_INDEX[normalizedId];
    const chapter = chapterForId(normalizedId);
    if (achievement && chapter) {
        state.activeChapterIndex = CHAPTERS.findIndex(item => item.id === chapter.id);
        const chapterItems = ACHIEVEMENTS_BY_CHAPTER[chapter.id] ?? [];
        const indexInChapter = chapterItems.findIndex(item => item.id === normalizedId);
        state.activePage = Math.max(0, Math.floor(indexInChapter / PAGE_SIZE));
    }

    render();
    openBook();
}

function applyUnlockedState(nextIds, incomingUnlockId = '') {
    const previousIds = new Set(state.unlockedIds);
    const normalized = normalizeUnlockedIds(nextIds);
    state.unlockedIds = normalized;

    const unlockedId = normalizeAchievementId(incomingUnlockId) || normalized.find(id => !previousIds.has(id)) || '';
    if (unlockedId) {
        showUnlockToast(unlockedId);
    }
}

function applySession(payload = {}) {
    state.bindId = payload.bindId || state.bindId;
    state.characterName = payload.characterName || state.characterName;
    state.profile = payload.profile || state.profile;

    if (Array.isArray(payload.unlockedIds)) {
        state.unlockedIds = normalizeUnlockedIds(payload.unlockedIds);
    }

    render();

    if (payload.openToId) {
        openTo(payload.openToId);
    } else if (payload.isOpen) {
        openBook();
    }
}

function syncUnlocked(unlockedIds) {
    applyUnlockedState(unlockedIds, '');
    render();
}

function unlockAchievement(id, unlockedIds) {
    applyUnlockedState(unlockedIds, id);
    render();
}

function lockAchievement(id, unlockedIds) {
    state.unlockedIds = normalizeUnlockedIds(unlockedIds);
    if (state.freshUnlockId === id) {
        state.freshUnlockId = '';
    }
    render();
}

function hibernate() {
    closeBook(false);
}

function boot() {
    ui.flipSheet.classList.add('is-right');
    ui.globalAchievementCount.textContent = String(totalAchievementCount());
    bindHotspots();
    syncShellClasses();
    state.visual.frame = requestAnimationFrame(tick);
    render();

    window.AlbumFrame = {
        applySession,
        syncUnlocked,
        unlock: unlockAchievement,
        lock: lockAchievement,
        openBook,
        closeBook: () => closeBook(true),
        openTo,
        hibernate,
        getState: () => ({
            bindId: state.bindId,
            characterName: state.characterName,
            profile: state.profile,
            unlockedIds: [...state.unlockedIds],
            activeChapterIndex: state.activeChapterIndex,
            activePage: state.activePage,
            stageMode: state.stageMode,
        }),
    };
}

boot();
