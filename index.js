import { getContextSafe } from './modules/st-bridge.js';
import { createWorldInfoDataSync } from './modules/worldinfo-data-sync.js';
import { createCharacterBookSync } from './modules/characterbook-sync.js';
import { createWorldInfoTreeView } from './modules/worldinfo-tree-view.js';
// 暂时停用预设层级视图（按需恢复）
// import { createPresetPromptTreeView } from './modules/preset-prompt-tree-view.js';

const EXTENSION_NAME = 'hierarchy-manager';

const DEFAULT_SETTINGS = Object.freeze({
    enableHierarchyView: true,
    showEmptyFolders: true,
    autoSyncCharacterBook: true,
    debugLog: false,
});

const STATE = {
    initialized: false,
    ctx: null,
    settings: null,
    worldInfoDataSync: null,
    characterBookSync: null,
    worldInfoTreeView: null,
    presetPromptTreeView: null,
};

function ensureSettings(ctx) {
    const root = ctx?.extensionSettings;

    if (!root) {
        return null;
    }

    root[EXTENSION_NAME] = root[EXTENSION_NAME] || {};
    const settings = root[EXTENSION_NAME];

    for (const [key, defaultValue] of Object.entries(DEFAULT_SETTINGS)) {
        if (settings[key] === undefined) {
            settings[key] = defaultValue;
        }
    }

    settings.enableHierarchyView = Boolean(settings.enableHierarchyView);
    settings.showEmptyFolders = Boolean(settings.showEmptyFolders);
    settings.autoSyncCharacterBook = Boolean(settings.autoSyncCharacterBook);
    settings.debugLog = Boolean(settings.debugLog);

    return settings;
}

function saveSettings() {
    try {
        STATE.ctx?.saveSettingsDebounced?.();
    } catch (error) {
        console.warn(`[${EXTENSION_NAME}] 保存设置失败`, error);
    }
}

function getSettings() {
    return STATE.settings;
}

function getSettingsHost() {
    return document.getElementById('extensions_settings2') || document.getElementById('extensions_settings') || null;
}

function ensureSettingsPanel() {
    const host = getSettingsHost();
    if (!(host instanceof HTMLElement)) {
        return;
    }

    const existing = document.getElementById('wihm_settings_drawer');
    if (existing instanceof HTMLElement) {
        syncSettingsPanelValues();
        return;
    }

    const drawer = document.createElement('div');
    drawer.id = 'wihm_settings_drawer';
    drawer.className = 'inline-drawer';
    drawer.innerHTML = `
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>层级管理器</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div class="wihm-settings-grid">
                <label class="checkbox_label">
                    <input id="wihm_enable_hierarchy" type="checkbox">
                    <small>启用层级折叠视图（世界书 / 预设）</small>
                </label>
                <label class="checkbox_label">
                    <input id="wihm_show_empty_folders" type="checkbox">
                    <small>显示空文件夹（来自 folder_paths）</small>
                </label>
                <label class="checkbox_label">
                    <input id="wihm_auto_sync_charbook" type="checkbox">
                    <small>自动同步到角色卡 character_book</small>
                </label>
                <label class="checkbox_label">
                    <input id="wihm_debug_log" type="checkbox">
                    <small>打印调试日志</small>
                </label>
            </div>
            <small class="wihm-settings-note">
                已新增字段：entries[*].path_chain / prompts[*].path_chain / folder_paths / character_book.entries[*].path_chain。
            </small>
        </div>
    `;

    host.appendChild(drawer);

    const bindToggle = (selector, key, afterChange) => {
        const input = drawer.querySelector(selector);
        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        input.addEventListener('input', () => {
            STATE.settings[key] = input.checked;
            saveSettings();
            if (typeof afterChange === 'function') {
                afterChange();
            }
        });
    };

    bindToggle('#wihm_enable_hierarchy', 'enableHierarchyView', () => {
        STATE.worldInfoTreeView?.refresh?.('settings-toggle-hierarchy');
        // STATE.presetPromptTreeView?.refresh?.('settings-toggle-hierarchy');
    });

    bindToggle('#wihm_show_empty_folders', 'showEmptyFolders', () => {
        STATE.worldInfoTreeView?.refresh?.('settings-toggle-empty-folders');
        // STATE.presetPromptTreeView?.refresh?.('settings-toggle-empty-folders');
    });

    bindToggle('#wihm_auto_sync_charbook', 'autoSyncCharacterBook');
    bindToggle('#wihm_debug_log', 'debugLog');

    syncSettingsPanelValues();
}

function syncSettingsPanelValues() {
    const setChecked = (selector, value) => {
        const element = document.querySelector(selector);
        if (element instanceof HTMLInputElement) {
            element.checked = Boolean(value);
        }
    };

    setChecked('#wihm_enable_hierarchy', STATE.settings?.enableHierarchyView);
    setChecked('#wihm_show_empty_folders', STATE.settings?.showEmptyFolders);
    setChecked('#wihm_auto_sync_charbook', STATE.settings?.autoSyncCharacterBook);
    setChecked('#wihm_debug_log', STATE.settings?.debugLog);
}

function init() {
    if (STATE.initialized || globalThis.__wihmLoaded) {
        return;
    }

    STATE.ctx = getContextSafe();

    if (!STATE.ctx) {
        console.warn(`[${EXTENSION_NAME}] 无法获取 SillyTavern 上下文，插件未启动`);
        return;
    }

    STATE.settings = ensureSettings(STATE.ctx);

    if (!STATE.settings) {
        console.warn(`[${EXTENSION_NAME}] extensionSettings 不可用，插件未启动`);
        return;
    }

    STATE.worldInfoDataSync = createWorldInfoDataSync(STATE.ctx, {
        getSettings,
        extensionName: EXTENSION_NAME,
    });

    STATE.characterBookSync = createCharacterBookSync(STATE.ctx, {
        getSettings,
        extensionName: EXTENSION_NAME,
    });

    STATE.worldInfoTreeView = createWorldInfoTreeView(STATE.ctx, {
        getSettings,
        dataSync: STATE.worldInfoDataSync,
        extensionName: EXTENSION_NAME,
    });

    // STATE.presetPromptTreeView = createPresetPromptTreeView(STATE.ctx, {
    //     getSettings,
    //     extensionName: EXTENSION_NAME,
    // });

    STATE.worldInfoDataSync.start();
    STATE.characterBookSync.start();
    STATE.worldInfoTreeView.start();
    // STATE.presetPromptTreeView.start();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureSettingsPanel, { once: true });
    } else {
        ensureSettingsPanel();
    }

    STATE.ctx?.eventSource?.on?.(STATE.ctx?.eventTypes?.SETTINGS_LOADED, () => {
        STATE.settings = ensureSettings(STATE.ctx);
        syncSettingsPanelValues();
        ensureSettingsPanel();
        STATE.worldInfoTreeView?.refresh?.('settings-loaded');
        // STATE.presetPromptTreeView?.refresh?.('settings-loaded');
    });

    STATE.ctx?.eventSource?.on?.(STATE.ctx?.eventTypes?.APP_READY, () => {
        ensureSettingsPanel();
        STATE.worldInfoTreeView?.refresh?.('app-ready');
        // STATE.presetPromptTreeView?.refresh?.('app-ready');
    });

    STATE.initialized = true;
    globalThis.__wihmLoaded = true;
    console.info(`[${EXTENSION_NAME}] 插件已加载`);
}

init();
