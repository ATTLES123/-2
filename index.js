import { getContext } from '../../../st-context.js';

const EXPECTED_BIND_ID = 'luochaoxi_private_album_v1';
const DEFAULT_PROFILE = 'pure-plugin-flagship';
const DEFAULT_VARIABLE_KEY = 'album_unlocked_ids';
const DEFAULT_VARIABLE_SCOPE = 'global';
const DEFAULT_TRIGGER_KEY = 'album_unlock_queue';
const DEFAULT_TRIGGER_SCOPE = 'global';
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
    ui: {
        root: null,
        button: null,
        overlay: null,
        frame: null,
        backdrop: null,
    },
};

function uniqueIds(values) {
    return [...new Set(values.filter(value => typeof value === 'string' && value.trim()))];
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

    const matches = value.match(/[A-Z]{2}_[0-9]{3}/g) || [];
    return uniqueIds(matches);
}

function getCurrentCharacter(context) {
    if (context.characterId === undefined || context.characterId === null || context.characterId < 0) {
        return null;
    }

    return context.characters?.[context.characterId] ?? context.getOneCharacter?.(context.characterId) ?? null;
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
        characterName: character?.name || '',
    };
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
    const metadataIds = parseUnlockedIds(context.chatMetadata?.album_book?.unlocked_ids);
    const variableIds = parseUnlockedIds(readScopedVariable(context, binding.variableKey, binding.variableScope));
    return uniqueIds([...metadataIds, ...variableIds]);
}

function persistUnlockedIds(context, binding, unlockedIds) {
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
    state.ui.root.classList.toggle('is-hidden', !visible);
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
    });
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

    state.pendingOpenToId = typeof id === 'string' ? id.trim() : '';
    showOverlay();
    flushPendingOpen();
}

function requestCloseAlbum() {
    const api = getFrameApi();
    if (!api) {
        hideOverlay();
        return;
    }

    api.closeBook();
}

function createUi() {
    if (state.ui.root) {
        return;
    }

    const root = document.createElement('div');
    root.id = 'album-bridge-anchor';
    root.classList.add('is-hidden');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'album-bridge-book';
    button.setAttribute('aria-label', 'Open achievement album');
    button.innerHTML = `
        <span class="album-bridge-book__shadow"></span>
        <span class="album-bridge-book__body"></span>
        <span class="album-bridge-book__edge"></span>
        <span class="album-bridge-book__clasp"></span>
        <span class="album-bridge-book__shine"></span>
        <span class="album-bridge-book__label">Archive</span>
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

    if (unlockId) {
        api.unlock(unlockId, unlockedIds);
        return;
    }

    api.syncUnlocked(unlockedIds);
}

function pollExternalState() {
    if (!state.binding?.matches) {
        return;
    }

    const context = getContext();
    const unlockedRaw = readScopedVariable(context, state.binding.variableKey, state.binding.variableScope);
    const unlockedIds = parseUnlockedIds(unlockedRaw);
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

function refreshBinding() {
    const context = getContext();
    const character = getCurrentCharacter(context);
    const binding = getBindingFromCharacter(character);
    state.binding = binding;

    createUi();
    setButtonVisible(binding.matches);

    if (!binding.matches) {
        stopVariableWatch();
        getFrameApi()?.hibernate?.();
        hideOverlay();
        return;
    }

    state.unlockedIds = getUnlockedIds(context, binding);
    state.lastObservedUnlockedValue = JSON.stringify(state.unlockedIds);
    state.lastObservedTriggerValue = '';
    syncFrameSession();
    startVariableWatch();
}

function unlock(id) {
    if (!state.binding?.matches || typeof id !== 'string' || !id.trim()) {
        return;
    }

    const context = getContext();
    const trimmed = id.trim();
    const nextIds = uniqueIds([...state.unlockedIds, trimmed]);
    persistUnlockedIds(context, state.binding, nextIds);
    syncFrameUnlocked(nextIds, trimmed);
}

function lock(id) {
    if (!state.binding?.matches || typeof id !== 'string' || !id.trim()) {
        return;
    }

    const context = getContext();
    const trimmed = id.trim();
    const nextIds = state.unlockedIds.filter(item => item !== trimmed);
    persistUnlockedIds(context, state.binding, nextIds);
    getFrameApi()?.lock?.(trimmed, nextIds);
}

function syncUnlocked(ids) {
    if (!state.binding?.matches) {
        return;
    }

    const context = getContext();
    persistUnlockedIds(context, state.binding, uniqueIds(ids));
    syncFrameUnlocked(state.unlockedIds);
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
    const context = getContext();
    const refresh = () => refreshBinding();

    context.eventSource.on(context.eventTypes.APP_READY, refresh);
    context.eventSource.on(context.eventTypes.CHAT_CHANGED, refresh);
    context.eventSource.on(context.eventTypes.CHARACTER_PAGE_LOADED, refresh);
}

function boot() {
    createUi();
    bindRuntimeApi();
    bindContextEvents();
    refreshBinding();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}
