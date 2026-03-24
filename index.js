function getContext() {
    return globalThis.SillyTavern?.getContext?.() ?? null;
}

const EXPECTED_BIND_ID = 'luochaoxi_private_album_v1';
const DEFAULT_PROFILE = 'pure-plugin-flagship';
const DEFAULT_VARIABLE_KEY = 'album_unlocked_ids';
const DEFAULT_VARIABLE_SCOPE = 'global';
const DEFAULT_TRIGGER_KEY = 'album_unlock_queue';
const DEFAULT_TRIGGER_SCOPE = 'global';
const DEFAULT_MVU_PATH = 'stat_data.成就';
const VARIABLE_POLL_MS = 1000;
const FRAME_URL = new URL('./album-frame.html', import.meta.url).href;

const state = {
    binding: null,
    unlockedIds: [],
    variableWatchTimer: null,
    lastObservedUnlockedValue: '',
    lastObservedTriggerValue: '',
    frameLoaded: false,
    pendingOpenToId: '',
    subscriptions: [],
    ui: {
        root: null,
        button: null,
        overlay: null,
        frame: null,
        backdrop: null,
        settings: null,
    },
};

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

function waitForElement(selector, timeout = 10000) {
    const existing = document.querySelector(selector);
    if (existing) {
        return Promise.resolve(existing);
    }

    return new Promise(resolve => {
        const timer = window.setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);

        const observer = new MutationObserver(() => {
            const node = document.querySelector(selector);
            if (!node) {
                return;
            }

            window.clearTimeout(timer);
            observer.disconnect();
            resolve(node);
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    });
}

function parseUnlockedIds(value) {
    if (Array.isArray(value)) {
        return uniqueIds(value);
    }

    if (typeof value !== 'string' || !value.trim()) {
        return [];
    }

    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
            return uniqueIds(parsed);
        }
    } catch {
    }

    return uniqueIds(
        value
            .split(',')
            .map(item => item.trim())
            .filter(Boolean),
    );
}

function parseAchievementIdsFromText(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return [];
    }

    const matches = value.match(/[A-Z]{2}_?[0-9]{3}/gi) || [];
    return uniqueIds(matches);
}

async function getCurrentCharacter(context) {
    if (context.characterId === undefined || context.characterId === null || context.characterId < 0) {
        return null;
    }

    let character = context.characters?.[context.characterId] ?? null;
    if (character?.data?.extensions?.album_book) {
        return character;
    }

    const avatarUrl = character?.avatar;
    if (avatarUrl && typeof context.getOneCharacter === 'function') {
        try {
            await context.getOneCharacter(avatarUrl);
            character = context.characters?.[context.characterId] ?? character;
        } catch (error) {
            console.warn('[Album Bridge Pure] Failed to hydrate character:', error);
        }
    }

    return character;
}

function getBindingFromCharacter(character) {
    const album = character?.data?.extensions?.album_book ?? {};
    const bindId = typeof album.bind_id === 'string' ? album.bind_id.trim() : '';

    return {
        bindId,
        matches: bindId === EXPECTED_BIND_ID,
        profile: album.profile || DEFAULT_PROFILE,
        version: Number(album.version || 1),
        variableKey: album.variable_key || DEFAULT_VARIABLE_KEY,
        variableScope: album.variable_scope || DEFAULT_VARIABLE_SCOPE,
        triggerKey: album.trigger_key || DEFAULT_TRIGGER_KEY,
        triggerScope: album.trigger_scope || DEFAULT_TRIGGER_SCOPE,
        clearTriggerOnRead: album.clear_trigger_on_read !== false,
        readMvuAchievements: album.read_mvu_achievements === true,
        mvuPath: typeof album.mvu_path === 'string' && album.mvu_path.trim()
            ? album.mvu_path.trim()
            : DEFAULT_MVU_PATH,
        characterName: character?.name || '',
    };
}

function readNestedValue(source, path) {
    if (!source || typeof source !== 'object' || typeof path !== 'string' || !path.trim()) {
        return null;
    }

    return path
        .split('.')
        .map(segment => segment.trim())
        .filter(Boolean)
        .reduce((current, segment) => {
            if (current && typeof current === 'object' && segment in current) {
                return current[segment];
            }

            return null;
        }, source);
}

function readMvuAchievementIds(binding) {
    if (!binding?.readMvuAchievements) {
        return [];
    }

    const mvu = window.Mvu ?? window.parent?.Mvu;
    if (!mvu?.getMvuData) {
        return [];
    }

    try {
        const payload = mvu.getMvuData({ type: 'message', message_id: -1 });
        const achievements = readNestedValue(payload, binding.mvuPath);
        if (!achievements || typeof achievements !== 'object' || Array.isArray(achievements)) {
            return [];
        }

        return uniqueIds(Object.keys(achievements));
    } catch {
        return [];
    }
}

function getVariableBag(context, scope) {
    if (scope === 'local') {
        return context.variables?.local ?? null;
    }

    if (scope === 'global') {
        return context.variables?.global ?? null;
    }

    if (scope === 'both') {
        return {
            get: key => context.variables?.local?.get?.(key) ?? context.variables?.global?.get?.(key),
            set: (key, value) => {
                context.variables?.local?.set?.(key, value);
                context.variables?.global?.set?.(key, value);
            },
        };
    }

    return context.variables?.global ?? null;
}

function readScopedVariable(context, key, scope) {
    return getVariableBag(context, scope)?.get?.(key);
}

function writeScopedVariable(context, key, scope, value) {
    getVariableBag(context, scope)?.set?.(key, value);
}

function getUnlockedIds(context, binding) {
    if (!context || !binding) {
        return [];
    }

    const metadataIds = parseUnlockedIds(context.chatMetadata?.album_book?.unlocked_ids);
    const variableIds = parseUnlockedIds(readScopedVariable(context, binding.variableKey, binding.variableScope));
    const mvuIds = readMvuAchievementIds(binding);
    return uniqueIds([...metadataIds, ...variableIds, ...mvuIds]);
}

function persistUnlockedIds(context, binding, unlockedIds) {
    if (!context || !binding) {
        return;
    }

    const ids = uniqueIds(unlockedIds);

    if (!context.chatMetadata) {
        context.chatMetadata = {};
    }

    if (!context.chatMetadata.album_book) {
        context.chatMetadata.album_book = {};
    }

    context.chatMetadata.album_book.unlocked_ids = ids;
    context.saveMetadataDebounced?.();

    writeScopedVariable(context, binding.variableKey, binding.variableScope, JSON.stringify(ids));
    state.unlockedIds = ids;
}

function getFrameApi() {
    if (!state.frameLoaded || !state.ui.frame?.contentWindow) {
        return null;
    }

    return state.ui.frame.contentWindow.AlbumFrame ?? null;
}

function setButtonVisible(visible) {
    createUi();
    if (!state.ui.root) {
        return;
    }

    state.ui.root.classList.toggle('is-hidden', !visible);
    renderSettingsState();
}

function setButtonActive(active) {
    if (!state.ui.button) {
        return;
    }

    state.ui.button.classList.toggle('is-active', active);
}

function showOverlay() {
    createUi();
    state.ui.overlay.classList.add('is-visible');
    document.body.classList.add('album-bridge-modal-open');
    setButtonActive(true);
}

function hideOverlay() {
    state.ui.overlay?.classList.remove('is-visible');
    document.body.classList.remove('album-bridge-modal-open');
    setButtonActive(false);
    renderSettingsState();
}

function syncFrameSession() {
    if (!state.binding?.matches) {
        return;
    }

    const api = getFrameApi();
    if (!api) {
        return;
    }

    api.applySession({
        bindId: state.binding.bindId,
        profile: state.binding.profile,
        version: state.binding.version,
        characterName: state.binding.characterName,
        unlockedIds: state.unlockedIds,
        launcherRect: getLauncherRect(),
    });
}

function getLauncherRect() {
    if (!state.ui.button?.isConnected) {
        return null;
    }

    const rect = state.ui.button.getBoundingClientRect();
    return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
    };
}

function flushPendingOpen() {
    if (!state.binding?.matches) {
        return;
    }

    const api = getFrameApi();
    if (!api) {
        return;
    }

    syncFrameSession();

    if (state.pendingOpenToId) {
        api.openTo(state.pendingOpenToId);
        state.pendingOpenToId = '';
        return;
    }

    api.openBook();
}

function requestOpenAlbum(id = '') {
    if (!state.binding?.matches) {
        return;
    }

    state.pendingOpenToId = normalizeAchievementId(id);
    showOverlay();
    flushPendingOpen();
    renderSettingsState();
}

function requestCloseAlbum() {
    const api = getFrameApi();
    if (!api) {
        hideOverlay();
        return;
    }

    api.closeBook();
    renderSettingsState();
}

async function createSettingsPanel() {
    if (state.ui.settings?.isConnected) {
        return;
    }

    state.ui.settings = null;
    document.getElementById('album-bridge-status')?.remove();

    const container = document.getElementById('extensions_settings2')
        ?? document.getElementById('extensions_settings')
        ?? await waitForElement('#extensions_settings2')
        ?? await waitForElement('#extensions_settings');

    if (!container) {
        return;
    }

    const root = document.createElement('div');
    root.id = 'album-bridge-status';
    root.innerHTML = `
        <div class="album-bridge-status__title">Album Bridge Pure</div>
        <div class="album-bridge-status__badge" data-album-badge>未识别</div>
        <div class="album-bridge-status__text" data-album-status>
            当前未识别到绑定角色卡。
        </div>
    `;

    container.appendChild(root);
    state.ui.settings = root;
    renderSettingsState();
}

function renderSettingsState() {
    const root = state.ui.settings;
    if (!root?.isConnected) {
        return;
    }

    const binding = state.binding;
    const matches = Boolean(binding?.matches);
    const badgeEl = root.querySelector('[data-album-badge]');
    const statusEl = root.querySelector('[data-album-status]');

    badgeEl.textContent = matches ? '已识别' : '未识别';
    badgeEl.classList.toggle('is-success', matches);
    badgeEl.classList.toggle('is-warning', !matches);

    if (matches) {
        statusEl.textContent = `已识别到绑定角色卡：${binding.characterName || '未命名角色'}。`;
    } else if (binding?.bindId) {
        statusEl.textContent = `当前角色卡 bind_id 为 ${binding.bindId}，与要求的 ${EXPECTED_BIND_ID} 不匹配。`;
    } else {
        statusEl.textContent = '当前未识别到绑定角色卡。';
    }
}

function createUi() {
    if (state.ui.root?.isConnected && state.ui.overlay?.isConnected) {
        return;
    }

    document.getElementById('album-bridge-anchor')?.remove();
    document.getElementById('album-bridge-overlay')?.remove();

    state.ui.root = null;
    state.ui.button = null;
    state.ui.overlay = null;
    state.ui.frame = null;
    state.ui.backdrop = null;
    state.frameLoaded = false;

    const root = document.createElement('div');
    root.id = 'album-bridge-anchor';
    root.classList.add('is-hidden');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'album-bridge-book';
    button.setAttribute('aria-label', 'Open achievement album');
    button.innerHTML = `
        <span class="album-bridge-book__drop"></span>
        <span class="album-bridge-book__spine"></span>
        <span class="album-bridge-book__cover"></span>
        <span class="album-bridge-book__paper"></span>
        <span class="album-bridge-book__strap"></span>
        <span class="album-bridge-book__foil">CHRONICLE</span>
        <span class="album-bridge-book__gloss"></span>
    `;

    button.addEventListener('click', () => {
        if (!state.binding?.matches) {
            return;
        }

        if (state.ui.overlay?.classList.contains('is-visible')) {
            requestCloseAlbum();
            return;
        }

        requestOpenAlbum();
    });

    const overlay = document.createElement('div');
    overlay.id = 'album-bridge-overlay';
    overlay.innerHTML = `
        <div class="album-bridge-overlay__backdrop"></div>
        <div class="album-bridge-overlay__shell">
            <iframe class="album-bridge-overlay__frame" title="Achievement Album"></iframe>
        </div>
    `;

    const backdrop = overlay.querySelector('.album-bridge-overlay__backdrop');
    const frame = overlay.querySelector('.album-bridge-overlay__frame');

    backdrop.addEventListener('click', () => requestCloseAlbum());

    frame.src = FRAME_URL;
    frame.addEventListener('load', () => {
        state.frameLoaded = true;
        syncFrameSession();
        flushPendingOpen();
    });

    root.appendChild(button);
    document.body.appendChild(root);
    document.body.appendChild(overlay);

    state.ui.root = root;
    state.ui.button = button;
    state.ui.overlay = overlay;
    state.ui.frame = frame;
    state.ui.backdrop = backdrop;
}

function stopVariableWatch() {
    if (!state.variableWatchTimer) {
        return;
    }

    window.clearInterval(state.variableWatchTimer);
    state.variableWatchTimer = null;
}

function syncFrameUnlocked(unlockedIds, unlockId = '') {
    const api = getFrameApi();
    if (!api) {
        return;
    }

    const normalizedIds = uniqueIds(unlockedIds);
    const normalizedUnlockId = normalizeAchievementId(unlockId);

    if (normalizedUnlockId) {
        api.unlock(normalizedUnlockId, normalizedIds);
        return;
    }

    api.syncUnlocked(normalizedIds);
}

function pollExternalState() {
    if (!state.binding?.matches) {
        return;
    }

    const context = getContext();
    if (!context) {
        return;
    }

    const unlockedIds = getUnlockedIds(context, state.binding);
    const unlockedSignature = JSON.stringify(unlockedIds);

    if (unlockedSignature !== state.lastObservedUnlockedValue) {
        state.lastObservedUnlockedValue = unlockedSignature;
        if (unlockedSignature !== JSON.stringify(state.unlockedIds)) {
            persistUnlockedIds(context, state.binding, unlockedIds);
            syncFrameUnlocked(state.unlockedIds);
        }
    }

    const triggerRaw = readScopedVariable(context, state.binding.triggerKey, state.binding.triggerScope);
    const triggerText = typeof triggerRaw === 'string' ? triggerRaw : '';

    if (triggerText === state.lastObservedTriggerValue) {
        return;
    }

    state.lastObservedTriggerValue = triggerText;
    const triggerIds = parseAchievementIdsFromText(triggerText);

    if (!triggerIds.length) {
        return;
    }

    let nextIds = [...state.unlockedIds];
    for (const id of triggerIds) {
        if (!nextIds.includes(id)) {
            nextIds.push(id);
            nextIds = uniqueIds(nextIds);
            syncFrameUnlocked(nextIds, id);
        }
    }

    persistUnlockedIds(context, state.binding, nextIds);

    if (state.binding.clearTriggerOnRead) {
        writeScopedVariable(context, state.binding.triggerKey, state.binding.triggerScope, '');
        state.lastObservedTriggerValue = '';
    }
}

function startVariableWatch() {
    stopVariableWatch();
    pollExternalState();
    state.variableWatchTimer = window.setInterval(pollExternalState, VARIABLE_POLL_MS);
}

async function refreshBinding() {
    createSettingsPanel();
    const context = getContext();
    if (!context) {
        state.binding = getBindingFromCharacter(null);
        state.unlockedIds = [];
        stopVariableWatch();
        setButtonVisible(false);
        hideOverlay();
        renderSettingsState();
        return;
    }
    const character = await getCurrentCharacter(context);
    const binding = getBindingFromCharacter(character);
    state.binding = binding;

    createUi();
    setButtonVisible(binding.matches);

    if (!binding.matches) {
        stopVariableWatch();
        getFrameApi()?.hibernate?.();
        hideOverlay();
        renderSettingsState();
        return;
    }

    state.unlockedIds = getUnlockedIds(context, binding);
    state.lastObservedUnlockedValue = JSON.stringify(state.unlockedIds);
    state.lastObservedTriggerValue = '';
    syncFrameSession();
    startVariableWatch();
    renderSettingsState();
}

function unlock(id) {
    const normalizedId = normalizeAchievementId(id);
    if (!state.binding?.matches || !normalizedId) {
        return;
    }

    const context = getContext();
    if (!context) {
        return;
    }

    const nextIds = uniqueIds([...state.unlockedIds, normalizedId]);
    persistUnlockedIds(context, state.binding, nextIds);
    syncFrameUnlocked(nextIds, normalizedId);
}

function lock(id) {
    const normalizedId = normalizeAchievementId(id);
    if (!state.binding?.matches || !normalizedId) {
        return;
    }

    const context = getContext();
    if (!context) {
        return;
    }

    const nextIds = state.unlockedIds.filter(item => item !== normalizedId);
    persistUnlockedIds(context, state.binding, nextIds);
    getFrameApi()?.lock?.(normalizedId, nextIds);
}

function syncUnlocked(ids) {
    if (!state.binding?.matches) {
        return;
    }

    const context = getContext();
    if (!context) {
        return;
    }

    persistUnlockedIds(context, state.binding, uniqueIds(ids));
    syncFrameUnlocked(state.unlockedIds);
}

function unbindContextEvents() {
    for (const subscription of state.subscriptions) {
        subscription.eventSource?.off?.(subscription.type, subscription.handler);
        subscription.eventSource?.removeListener?.(subscription.type, subscription.handler);
    }

    state.subscriptions = [];
}

function bindRuntimeApi() {
    window.AlbumBridge = {
        unlock,
        lock,
        syncUnlocked,
        openBook: () => requestOpenAlbum(),
        closeBook: () => requestCloseAlbum(),
        openTo: id => requestOpenAlbum(id),
        refresh: refreshBinding,
    };

    window.__albumBridgePluginHost = {
        handleFrameEvent(event) {
            if (!event || typeof event !== 'object') {
                return;
            }

            if (event.type === 'closed') {
                hideOverlay();
            }
        },
    };
}

function bindContextEvents() {
    unbindContextEvents();

    const context = getContext();
    if (!context?.eventSource || !context?.eventTypes) {
        return;
    }

    const refresh = () => void refreshBinding();
    const bindings = [
        context.eventTypes.APP_READY,
        context.eventTypes.CHAT_CHANGED,
        context.eventTypes.CHARACTER_PAGE_LOADED,
    ];

    for (const type of bindings) {
        context.eventSource.on(type, refresh);
        state.subscriptions.push({
            eventSource: context.eventSource,
            type,
            handler: refresh,
        });
    }
}

function destroy() {
    stopVariableWatch();
    unbindContextEvents();
    document.getElementById('album-bridge-anchor')?.remove();
    document.getElementById('album-bridge-overlay')?.remove();
    document.getElementById('album-bridge-status')?.remove();
    document.body?.classList?.remove('album-bridge-modal-open');

    delete window.AlbumBridge;
    delete window.__albumBridgePluginHost;
    delete window.__albumBridgePureInstance;

    state.binding = null;
    state.unlockedIds = [];
    state.frameLoaded = false;
    state.pendingOpenToId = '';
    state.ui = {
        root: null,
        button: null,
        overlay: null,
        frame: null,
        backdrop: null,
        settings: null,
    };
}

function boot() {
    try {
        window.__albumBridgePureInstance?.destroy?.();
        createUi();
        createSettingsPanel();
        bindRuntimeApi();
        bindContextEvents();
        window.__albumBridgePureInstance = { destroy };
        void refreshBinding();
    } catch (error) {
        console.error('[Album Bridge Pure] Boot failed:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}
