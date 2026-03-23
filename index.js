import { getContext } from '../../../st-context.js';

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
    const metadataIds = parseUnlockedIds(context.chatMetadata?.album_book?.unlocked_ids);
    const variableIds = parseUnlockedIds(readScopedVariable(context, binding.variableKey, binding.variableScope));
    const mvuIds = readMvuAchievementIds(binding);
    return uniqueIds([...metadataIds, ...variableIds, ...mvuIds]);
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

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function setButtonVisible(visible) {
    createUi();
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

function toggleSettingsDrawer(expand) {
    const root = state.ui.settings;
    if (!root) {
        return;
    }

    const icon = root.querySelector('.inline-drawer-icon');
    const content = root.querySelector('.inline-drawer-content');
    const nextExpanded = typeof expand === 'boolean' ? expand : content.style.display === 'none';

    content.style.display = nextExpanded ? 'block' : 'none';
    icon.classList.toggle('up', nextExpanded);
    icon.classList.toggle('fa-circle-chevron-up', nextExpanded);
    icon.classList.toggle('down', !nextExpanded);
    icon.classList.toggle('fa-circle-chevron-down', !nextExpanded);
}

function createSettingsPanel() {
    if (state.ui.settings) {
        return;
    }

    const container = document.getElementById('extensions_settings2');
    if (!container) {
        return;
    }

    const root = document.createElement('div');
    root.id = 'album-bridge-settings';
    root.className = 'inline-drawer';
    root.innerHTML = `
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Album Bridge Pure</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="display: none;">
            <div class="album-bridge-settings__grid">
                <div class="album-bridge-settings__card">
                    <div class="album-bridge-settings__label">当前状态</div>
                    <div class="album-bridge-settings__value" data-album-status>未检测</div>
                </div>
                <div class="album-bridge-settings__card">
                    <div class="album-bridge-settings__label">当前角色</div>
                    <div class="album-bridge-settings__value" data-album-character>未选择</div>
                </div>
                <div class="album-bridge-settings__card">
                    <div class="album-bridge-settings__label">角色卡 bind_id</div>
                    <div class="album-bridge-settings__value album-bridge-settings__mono" data-album-bind>未设置</div>
                </div>
                <div class="album-bridge-settings__card">
                    <div class="album-bridge-settings__label">要求 bind_id</div>
                    <div class="album-bridge-settings__value album-bridge-settings__mono">${EXPECTED_BIND_ID}</div>
                </div>
                <div class="album-bridge-settings__card">
                    <div class="album-bridge-settings__label">已解锁数量</div>
                    <div class="album-bridge-settings__value" data-album-count>0</div>
                </div>
                <div class="album-bridge-settings__card">
                    <div class="album-bridge-settings__label">相册窗口</div>
                    <div class="album-bridge-settings__value" data-album-overlay>未打开</div>
                </div>
            </div>
            <div class="album-bridge-settings__section">
                <div class="album-bridge-settings__row">
                    <div class="album-bridge-settings__label">解锁列表变量</div>
                    <div class="album-bridge-settings__value album-bridge-settings__mono" data-album-variable>${DEFAULT_VARIABLE_KEY}</div>
                </div>
                <div class="album-bridge-settings__row">
                    <div class="album-bridge-settings__label">触发队列变量</div>
                    <div class="album-bridge-settings__value album-bridge-settings__mono" data-album-trigger>${DEFAULT_TRIGGER_KEY}</div>
                </div>
                <div class="album-bridge-settings__row">
                    <div class="album-bridge-settings__label">MVU 成就源</div>
                    <div class="album-bridge-settings__value album-bridge-settings__mono" data-album-mvu>未启用</div>
                </div>
            </div>
            <div class="album-bridge-settings__actions">
                <button type="button" class="menu_button" data-album-action="refresh">刷新识别</button>
                <button type="button" class="menu_button" data-album-action="open">测试打开相册</button>
                <button type="button" class="menu_button" data-album-action="copy">复制角色卡字段</button>
            </div>
            <div class="album-bridge-settings__hint">
                下方是完整 Tavern Card V2 路径示例；关键位置是 `data.extensions.album_book`。
            </div>
            <textarea class="text_pole autoSetHeight album-bridge-settings__json" rows="9" readonly data-album-json></textarea>
        </div>
    `;

    root.querySelector('.inline-drawer-toggle').addEventListener('click', () => toggleSettingsDrawer());
    root.querySelector('[data-album-action="refresh"]').addEventListener('click', () => refreshBinding());
    root.querySelector('[data-album-action="open"]').addEventListener('click', () => requestOpenAlbum());
    root.querySelector('[data-album-action="copy"]').addEventListener('click', async () => {
        const textarea = root.querySelector('[data-album-json]');
        const text = textarea?.value || '';
        if (!text) {
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
        } catch {
            textarea.select();
            document.execCommand('copy');
        }
    });

    container.appendChild(root);
    state.ui.settings = root;
    renderSettingsState();
}

function renderSettingsState() {
    const root = state.ui.settings;
    if (!root) {
        return;
    }

    const binding = state.binding;
    const matches = Boolean(binding?.matches);
    const isOpen = Boolean(state.ui.overlay?.classList.contains('is-visible'));
    const status = !binding
        ? '未检测'
        : matches
            ? '已识别到绑定角色卡'
            : '未匹配到绑定角色卡';

    const statusEl = root.querySelector('[data-album-status]');
    const characterEl = root.querySelector('[data-album-character]');
    const bindEl = root.querySelector('[data-album-bind]');
    const countEl = root.querySelector('[data-album-count]');
    const overlayEl = root.querySelector('[data-album-overlay]');
    const variableEl = root.querySelector('[data-album-variable]');
    const triggerEl = root.querySelector('[data-album-trigger]');
    const mvuEl = root.querySelector('[data-album-mvu]');
    const jsonEl = root.querySelector('[data-album-json]');
    const openButton = root.querySelector('[data-album-action="open"]');

    statusEl.textContent = status;
    statusEl.classList.toggle('success', matches);
    statusEl.classList.toggle('warning', Boolean(binding && !matches));
    characterEl.textContent = binding?.characterName || '未选择';
    bindEl.textContent = binding?.bindId || '未设置';
    countEl.textContent = String(state.unlockedIds.length);
    overlayEl.textContent = isOpen ? '已打开' : '未打开';
    variableEl.textContent = binding?.variableKey || DEFAULT_VARIABLE_KEY;
    triggerEl.textContent = binding?.triggerKey || DEFAULT_TRIGGER_KEY;
    mvuEl.textContent = binding?.readMvuAchievements ? binding.mvuPath : '未启用';
    openButton.disabled = !matches;

    const json = {
        data: {
            extensions: {
                album_book: {
                    bind_id: EXPECTED_BIND_ID,
                    profile: DEFAULT_PROFILE,
                    version: 1,
                    variable_key: binding?.variableKey || DEFAULT_VARIABLE_KEY,
                    variable_scope: binding?.variableScope || DEFAULT_VARIABLE_SCOPE,
                    trigger_key: binding?.triggerKey || DEFAULT_TRIGGER_KEY,
                    trigger_scope: binding?.triggerScope || DEFAULT_TRIGGER_SCOPE,
                    clear_trigger_on_read: binding?.clearTriggerOnRead ?? true,
                    read_mvu_achievements: binding?.readMvuAchievements ?? true,
                    mvu_path: binding?.mvuPath || DEFAULT_MVU_PATH,
                },
            },
        },
    };

    jsonEl.value = JSON.stringify(json, null, 2);
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

function refreshBinding() {
    createSettingsPanel();
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
    const nextIds = state.unlockedIds.filter(item => item !== normalizedId);
    persistUnlockedIds(context, state.binding, nextIds);
    getFrameApi()?.lock?.(normalizedId, nextIds);
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
    createSettingsPanel();
    bindRuntimeApi();
    bindContextEvents();
    refreshBinding();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}
