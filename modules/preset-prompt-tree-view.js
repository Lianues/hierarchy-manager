import { CollapsibleTree } from './collapsible-tree.js';
import {
    FOLDER_PATHS_KEY,
    expandParentPaths,
    getEntryPath,
    normalizePathChain,
    setEntryPath,
    ensurePromptHierarchyData,
} from './path-schema.js';
import { getJQuerySafe } from './st-bridge.js';

export function createPresetPromptTreeView(ctx, { getSettings } = {}) {
    const listeners = [];

    const state = {
        started: false,
        observer: null,
        observerTarget: null,
        mountObserver: null,
        applyingLayout: false,
        scheduled: false,
        tree: null,
        lastDigest: '',
        dragSaving: false,
        pathInputDebounceMap: new Map(),
    };

    function getListElement() {
        const list = document.getElementById('completion_prompt_manager_list');
        return list instanceof HTMLElement ? list : null;
    }

    function isHierarchyEnabled() {
        return Boolean(getSettings?.()?.enableHierarchyView);
    }

    function showEmptyFolders() {
        return Boolean(getSettings?.()?.showEmptyFolders);
    }

    function getPresetManager() {
        return ctx?.getPresetManager?.('openai') ?? null;
    }

    function getCurrentPresetName() {
        const manager = getPresetManager();
        return String(manager?.getSelectedPresetName?.() || '');
    }

    function getPromptSettings() {
        const manager = getPresetManager();
        const presetList = manager?.getPresetList?.();
        const settings = presetList?.settings;

        return settings && typeof settings === 'object' ? settings : null;
    }

    function persistSettings() {
        try {
            ctx?.saveSettingsDebounced?.();
        } catch {
            // ignore
        }
    }

    function replacePathPrefix(pathValue, oldPrefix, newPrefix) {
        const path = normalizePathChain(pathValue);

        if (path === oldPrefix) {
            return newPrefix;
        }

        if (path.startsWith(`${oldPrefix}/`)) {
            const suffix = path.slice(oldPrefix.length + 1);
            return newPrefix ? `${newPrefix}/${suffix}` : suffix;
        }

        return path;
    }

    async function requestTextInput(title, message, defaultValue = '') {
        let popupInput = null;

        try {
            popupInput = await ctx?.Popup?.show?.input?.(title, message, defaultValue);
        } catch {
            popupInput = null;
        }

        if (popupInput === null || popupInput === undefined) {
            popupInput = window.prompt(message, defaultValue);
        }

        return popupInput;
    }

    async function requestConfirm(title, message) {
        try {
            const result = await ctx?.Popup?.show?.confirm?.(title, message);
            return Boolean(result);
        } catch {
            return window.confirm(message);
        }
    }

    function getNormalizedFolderPaths(settings) {
        const source = Array.isArray(settings?.[FOLDER_PATHS_KEY]) ? settings[FOLDER_PATHS_KEY] : [];
        const result = [];

        for (const path of source) {
            const normalized = normalizePathChain(path);
            if (normalized) {
                result.push(normalized);
            }
        }

        return result;
    }

    function getPromptByIdentifier(settings, identifier) {
        if (!settings || !Array.isArray(settings.prompts)) {
            return null;
        }

        return settings.prompts.find(prompt => (
            prompt
            && typeof prompt === 'object'
            && !Array.isArray(prompt)
            && String(prompt.identifier || '') === String(identifier || '')
        )) ?? null;
    }

    function getPromptIdentifierFromElement(promptElement) {
        if (!(promptElement instanceof HTMLElement)) {
            return '';
        }

        return String(promptElement.dataset?.pmIdentifier || promptElement.getAttribute('data-pm-identifier') || '');
    }

    function schedulePathSave(identifier, inputElement) {
        const key = String(identifier || '');
        if (!key) {
            return;
        }

        const previousTimer = state.pathInputDebounceMap.get(key);
        if (previousTimer) {
            clearTimeout(previousTimer);
        }

        const timer = setTimeout(() => {
            state.pathInputDebounceMap.delete(key);
            void savePromptPath(key, inputElement);
        }, 280);

        state.pathInputDebounceMap.set(key, timer);
    }

    async function savePromptPath(identifier, inputElement) {
        const settings = getPromptSettings();
        if (!settings) {
            return;
        }

        const prompt = getPromptByIdentifier(settings, identifier);
        if (!prompt) {
            return;
        }

        const nextPath = inputElement instanceof HTMLInputElement
            ? inputElement.value
            : '';

        const pathResult = setEntryPath(prompt, nextPath);
        const normalizeResult = ensurePromptHierarchyData(settings);

        if (!pathResult.changed && !normalizeResult.changed) {
            return;
        }

        persistSettings();
        state.lastDigest = '';
        refresh('preset-path-save');
    }

    function ensurePathInput(promptElement) {
        if (!(promptElement instanceof HTMLElement)) {
            return null;
        }

        const identifier = getPromptIdentifierFromElement(promptElement);
        if (!identifier) {
            return null;
        }

        const promptNameWrap = promptElement.querySelector('.completion_prompt_manager_prompt_name');
        if (!(promptNameWrap instanceof HTMLElement)) {
            return null;
        }

        const existingInput = promptNameWrap.querySelector('.wihm-prompt-path-input');
        if (existingInput instanceof HTMLInputElement) {
            return existingInput;
        }

        const row = document.createElement('div');
        row.className = 'wihm-prompt-path-row';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'text_pole wihm-prompt-path-input';
        input.placeholder = '路径（如：世界观/阵营）';

        input.addEventListener('input', () => {
            schedulePathSave(identifier, input);
        });

        input.addEventListener('change', () => {
            schedulePathSave(identifier, input);
        });

        row.appendChild(input);
        promptNameWrap.appendChild(row);

        return input;
    }

    async function addFolderPathByInput() {
        const settings = getPromptSettings();
        if (!settings) {
            toastr.warning('读取预设失败。');
            return;
        }

        const popupInput = await requestTextInput('新建文件夹', '请输入文件夹路径（使用 / 分隔）：', '');
        const normalizedPath = normalizePathChain(popupInput ?? '');

        if (!normalizedPath) {
            return;
        }

        settings[FOLDER_PATHS_KEY] = Array.isArray(settings[FOLDER_PATHS_KEY]) ? settings[FOLDER_PATHS_KEY] : [];
        const beforePaths = new Set(getNormalizedFolderPaths(settings));
        settings[FOLDER_PATHS_KEY].push(normalizedPath);

        const normalizeResult = ensurePromptHierarchyData(settings);
        if (!normalizeResult.changed && beforePaths.has(normalizedPath)) {
            toastr.info(`文件夹已存在：${normalizedPath}`);
            return;
        }

        persistSettings();
        state.lastDigest = '';
        refresh('preset-add-folder');

        toastr[beforePaths.has(normalizedPath) ? 'info' : 'success'](
            beforePaths.has(normalizedPath)
                ? `文件夹已存在：${normalizedPath}`
                : `已创建文件夹：${normalizedPath}`,
        );
    }

    function countPromptsInFolder(settings, targetPath) {
        if (!settings || !Array.isArray(settings.prompts) || !targetPath) {
            return 0;
        }

        let count = 0;

        for (const prompt of settings.prompts) {
            if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
                continue;
            }

            const path = getEntryPath(prompt);
            if (path === targetPath || path.startsWith(`${targetPath}/`)) {
                count++;
            }
        }

        return count;
    }

    async function renameFolderPath(oldPathRaw, { askOldPathIfMissing = false } = {}) {
        const settings = getPromptSettings();
        if (!settings) {
            toastr.warning('读取预设失败。');
            return;
        }

        ensurePromptHierarchyData(settings);

        let oldPath = normalizePathChain(oldPathRaw || '');
        const allFolderPaths = getNormalizedFolderPaths(settings);

        if (!oldPath && askOldPathIfMissing) {
            const suggested = allFolderPaths[0] || '';
            const oldPathInput = await requestTextInput('重命名文件夹', '请输入要重命名的文件夹路径：', suggested);
            oldPath = normalizePathChain(oldPathInput ?? '');
        }

        if (!oldPath) {
            return;
        }

        if (!allFolderPaths.includes(oldPath)) {
            toastr.warning(`未找到文件夹：${oldPath}`);
            return;
        }

        const newPathInput = await requestTextInput('重命名文件夹', '请输入新的文件夹路径：', oldPath);
        const newPath = normalizePathChain(newPathInput ?? '');

        if (!newPath || newPath === oldPath) {
            return;
        }

        let movedCount = 0;
        for (const prompt of settings.prompts || []) {
            if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
                continue;
            }

            const currentPath = getEntryPath(prompt);
            const replacedPath = replacePathPrefix(currentPath, oldPath, newPath);

            if (replacedPath !== currentPath) {
                setEntryPath(prompt, replacedPath);
                movedCount++;
            }
        }

        const folderPaths = Array.isArray(settings[FOLDER_PATHS_KEY]) ? settings[FOLDER_PATHS_KEY] : [];
        settings[FOLDER_PATHS_KEY] = folderPaths.map(path => replacePathPrefix(path, oldPath, newPath));

        ensurePromptHierarchyData(settings);
        persistSettings();

        state.lastDigest = '';
        refresh('preset-folder-rename');

        toastr.success(`已重命名文件夹：${oldPath} → ${newPath}（影响 ${movedCount} 条）`);
    }

    async function deleteEmptyFolderPath(folderPathRaw, { askPathIfMissing = false } = {}) {
        const settings = getPromptSettings();
        if (!settings) {
            toastr.warning('读取预设失败。');
            return;
        }

        ensurePromptHierarchyData(settings);

        let folderPath = normalizePathChain(folderPathRaw || '');
        const allFolderPaths = getNormalizedFolderPaths(settings);

        if (!folderPath && askPathIfMissing) {
            const suggested = allFolderPaths[0] || '';
            const pathInput = await requestTextInput('删除空文件夹', '请输入要删除的文件夹路径：', suggested);
            folderPath = normalizePathChain(pathInput ?? '');
        }

        if (!folderPath) {
            return;
        }

        if (!allFolderPaths.includes(folderPath)) {
            toastr.warning(`未找到文件夹：${folderPath}`);
            return;
        }

        const promptCount = countPromptsInFolder(settings, folderPath);
        if (promptCount > 0) {
            toastr.warning(`文件夹非空，无法删除：${folderPath}（包含 ${promptCount} 条）`);
            return;
        }

        const confirmed = await requestConfirm('删除空文件夹', `确定删除空文件夹“${folderPath}”及其空子文件夹吗？`);
        if (!confirmed) {
            return;
        }

        const before = getNormalizedFolderPaths(settings);
        settings[FOLDER_PATHS_KEY] = before.filter(path => path !== folderPath && !path.startsWith(`${folderPath}/`));

        ensurePromptHierarchyData(settings);
        persistSettings();

        state.lastDigest = '';
        refresh('preset-folder-delete-empty');

        toastr.success(`已删除空文件夹：${folderPath}`);
    }

    function ensurePresetToolbarButtons() {
        const headerAdvanced = document.querySelector('#completion_prompt_manager .completion_prompt_manager_header_advanced');
        if (!(headerAdvanced instanceof HTMLElement)) {
            return;
        }

        let tools = document.getElementById('wihm_preset_folder_tools');
        if (!(tools instanceof HTMLElement)) {
            tools = document.createElement('span');
            tools.id = 'wihm_preset_folder_tools';
            tools.className = 'wihm-preset-folder-tools';

            tools.innerHTML = `
                <div id="wihm_preset_add_folder_button" class="menu_button" title="添加空文件夹路径">新建文件夹</div>
                <div id="wihm_preset_rename_folder_button" class="menu_button" title="重命名文件夹路径">重命名文件夹</div>
                <div id="wihm_preset_delete_empty_folder_button" class="menu_button" title="删除空文件夹路径">删除空文件夹</div>
            `;

            headerAdvanced.appendChild(tools);

            tools.querySelector('#wihm_preset_add_folder_button')?.addEventListener('click', () => {
                void addFolderPathByInput();
            });
            tools.querySelector('#wihm_preset_rename_folder_button')?.addEventListener('click', () => {
                void renameFolderPath('', { askOldPathIfMissing: true });
            });
            tools.querySelector('#wihm_preset_delete_empty_folder_button')?.addEventListener('click', () => {
                void deleteEmptyFolderPath('', { askPathIfMissing: true });
            });
        }

        tools.classList.toggle('wihm-hidden', !isHierarchyEnabled());
    }

    function createFolderNode(path, name) {
        return {
            path,
            name,
            folders: new Map(),
            entries: [],
        };
    }

    function getLeafCountFromFolder(folderNode) {
        if (!folderNode || typeof folderNode !== 'object') {
            return 0;
        }

        let count = Array.isArray(folderNode.entries) ? folderNode.entries.length : 0;

        for (const child of folderNode.folders?.values?.() || []) {
            count += getLeafCountFromFolder(child);
        }

        return count;
    }

    function buildTreeNodes(entryRecords, folderPaths) {
        const root = createFolderNode('', '');

        const ensureFolder = (path) => {
            const normalized = normalizePathChain(path);
            if (!normalized) {
                return root;
            }

            const segments = normalized.split('/');
            let current = root;
            let currentPath = '';

            for (const segment of segments) {
                currentPath = currentPath ? `${currentPath}/${segment}` : segment;

                if (!current.folders.has(segment)) {
                    current.folders.set(segment, createFolderNode(currentPath, segment));
                }

                current = current.folders.get(segment);
            }

            return current;
        };

        for (const folderPath of folderPaths) {
            ensureFolder(folderPath);
        }

        for (const record of entryRecords) {
            const folder = ensureFolder(record.path);
            folder.entries.push(record);
        }

        const folderToTreeNode = (folderNode) => {
            const groupChildren = Array.from(folderNode.folders.values())
                .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))
                .map(folderToTreeNode);

            const leafChildren = folderNode.entries
                .sort((a, b) => a.order - b.order)
                .map(record => ({
                    kind: 'leaf',
                    id: `preset:${record.identifier}`,
                    label: record.name || record.identifier,
                    meta: {
                        element: record.element,
                    },
                }));

            const actions = folderNode.path
                ? [
                    {
                        id: `rename:${folderNode.path}`,
                        title: '重命名文件夹',
                        className: 'menu_button fa-pencil fa-solid interactable',
                        dataI18n: '[title]Rename World Info',
                        onClick: () => {
                            void renameFolderPath(folderNode.path);
                        },
                    },
                    {
                        id: `delete-empty:${folderNode.path}`,
                        title: '删除空文件夹',
                        className: 'menu_button fa-solid fa-trash-can redWarningBG interactable',
                        dataI18n: '[title]Delete World Info',
                        onClick: () => {
                            void deleteEmptyFolderPath(folderNode.path);
                        },
                    },
                ]
                : [];

            return {
                kind: 'group',
                id: `preset-folder:${folderNode.path || '__root__'}`,
                label: folderNode.name || '根目录',
                defaultExpanded: true,
                children: [...groupChildren, ...leafChildren],
                meta: {
                    leafCount: getLeafCountFromFolder(folderNode),
                    path: folderNode.path,
                    actions,
                },
            };
        };

        const rootNodes = [];

        const rootFolders = Array.from(root.folders.values())
            .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));

        for (const folderNode of rootFolders) {
            rootNodes.push(folderToTreeNode(folderNode));
        }

        if (root.entries.length > 0) {
            rootNodes.push({
                kind: 'group',
                id: 'preset-folder:__ungrouped__',
                label: '未分组',
                defaultExpanded: true,
                children: root.entries
                    .sort((a, b) => a.order - b.order)
                    .map(record => ({
                        kind: 'leaf',
                        id: `preset:${record.identifier}`,
                        label: record.name || record.identifier,
                        meta: {
                            element: record.element,
                        },
                    })),
                meta: {
                    leafCount: root.entries.length,
                    path: '',
                },
            });
        }

        return rootNodes;
    }

    function makeDigest(presetName, entryRecords, folderPaths) {
        const entriesDigest = entryRecords
            .map(record => `${record.identifier}:${record.path}:${record.order}`)
            .join('|');

        const foldersDigest = folderPaths.join('|');
        const settingsDigest = `${isHierarchyEnabled()}-${showEmptyFolders()}`;

        return `${presetName}::${settingsDigest}::${entriesDigest}::${foldersDigest}`;
    }

    function destroySortables(listElement = null) {
        const jq = getJQuerySafe();
        const host = listElement instanceof HTMLElement ? listElement : getListElement();

        if (!jq || !jq.fn?.sortable || !(host instanceof HTMLElement)) {
            return;
        }

        try {
            const list = jq(host);
            if (list.sortable('instance')) {
                list.sortable('destroy');
            }
        } catch {
            // ignore
        }

        const zones = Array.from(host.querySelectorAll('.wihm-folder-dropzone'));
        for (const zoneElement of zones) {
            try {
                const zone = jq(zoneElement);
                if (zone.sortable('instance')) {
                    zone.sortable('destroy');
                }
            } catch {
                // ignore
            }
        }
    }

    function pickPromptOrderBucket(settings, orderedIdentifiers) {
        settings.prompt_order = Array.isArray(settings.prompt_order)
            ? settings.prompt_order
            : [];

        if (settings.prompt_order.length === 0) {
            settings.prompt_order.push({
                character_id: 100001,
                order: [],
            });
        }

        const idSet = new Set(orderedIdentifiers);
        let target = null;
        let score = -1;

        for (const item of settings.prompt_order) {
            const order = Array.isArray(item?.order) ? item.order : [];
            let currentScore = 0;

            for (const entry of order) {
                const identifier = String(entry?.identifier || '');
                if (idSet.has(identifier)) {
                    currentScore++;
                }
            }

            if (currentScore > score) {
                score = currentScore;
                target = item;
            }
        }

        return target || settings.prompt_order[0];
    }

    function syncPromptOrder(settings, orderedIdentifiers) {
        const targetBucket = pickPromptOrderBucket(settings, orderedIdentifiers);
        if (!targetBucket) {
            return false;
        }

        const currentOrder = Array.isArray(targetBucket.order) ? targetBucket.order : [];
        const byId = new Map();

        for (const entry of currentOrder) {
            const identifier = String(entry?.identifier || '');
            if (!identifier) {
                continue;
            }

            byId.set(identifier, {
                identifier,
                enabled: entry?.enabled !== false,
            });
        }

        const nextOrder = [];
        for (const identifier of orderedIdentifiers) {
            const key = String(identifier || '');
            if (!key) {
                continue;
            }

            nextOrder.push(byId.get(key) || { identifier: key, enabled: true });
            byId.delete(key);
        }

        for (const leftover of byId.values()) {
            nextOrder.push(leftover);
        }

        let changed = currentOrder.length !== nextOrder.length;

        if (!changed) {
            for (let i = 0; i < currentOrder.length; i++) {
                const left = currentOrder[i];
                const right = nextOrder[i];

                if (String(left?.identifier || '') !== String(right?.identifier || '')) {
                    changed = true;
                    break;
                }

                if (Boolean(left?.enabled !== false) !== Boolean(right?.enabled !== false)) {
                    changed = true;
                    break;
                }
            }
        }

        if (changed) {
            targetBucket.order = nextOrder;
        }

        return changed;
    }

    async function persistDragChanges(listElement) {
        if (state.dragSaving) {
            return;
        }

        const settings = getPromptSettings();
        if (!settings) {
            return;
        }

        state.dragSaving = true;

        try {
            let changed = false;

            const zones = Array.from(listElement.querySelectorAll('.wihm-folder-dropzone'));
            for (const zone of zones) {
                if (!(zone instanceof HTMLElement)) {
                    continue;
                }

                const path = normalizePathChain(zone.dataset.folderPath || '');
                const slots = Array.from(zone.querySelectorAll(':scope > .wihm-entry-slot > .completion_prompt_manager_prompt'));

                for (const promptElement of slots) {
                    if (!(promptElement instanceof HTMLElement)) {
                        continue;
                    }

                    const identifier = getPromptIdentifierFromElement(promptElement);
                    if (!identifier) {
                        continue;
                    }

                    const prompt = getPromptByIdentifier(settings, identifier);
                    if (!prompt) {
                        continue;
                    }

                    const result = setEntryPath(prompt, path);
                    changed = changed || result.changed;
                }
            }

            const orderedIdentifiers = Array.from(listElement.querySelectorAll('.completion_prompt_manager_prompt[data-pm-identifier]'))
                .map(element => getPromptIdentifierFromElement(element))
                .filter(Boolean);

            changed = syncPromptOrder(settings, orderedIdentifiers) || changed;

            const normalizeResult = ensurePromptHierarchyData(settings);
            changed = changed || normalizeResult.changed;

            if (!changed) {
                return;
            }

            persistSettings();
            state.lastDigest = '';
            refresh('preset-drag-save');
        } finally {
            state.dragSaving = false;
        }
    }

    function setupFolderSortables(listElement) {
        destroySortables(listElement);

        const jq = getJQuerySafe();
        if (!jq || !jq.fn?.sortable) {
            return;
        }

        const zones = Array.from(listElement.querySelectorAll('.wihm-folder-dropzone'));
        if (zones.length === 0) {
            return;
        }

        jq(zones).sortable({
            items: '> .wihm-entry-slot',
            connectWith: '.wihm-folder-dropzone',
            handle: '.drag-handle',
            placeholder: 'wihm-sort-placeholder',
            tolerance: 'pointer',
            distance: 4,
            cancel: 'input,textarea,select,button,.menu_button,.wihm-tree-group-actions,.wihm-tree-group-actions *',
            stop: () => {
                void persistDragChanges(listElement);
            },
        });
    }

    async function applyHierarchyLayout() {
        const listElement = getListElement();
        if (!(listElement instanceof HTMLElement)) {
            return;
        }

        ensurePresetToolbarButtons();

        if (!isHierarchyEnabled()) {
            destroySortables(listElement);
            return;
        }

        const settings = getPromptSettings();
        if (!settings) {
            destroySortables(listElement);
            return;
        }

        const normalizeResult = ensurePromptHierarchyData(settings);
        if (normalizeResult.changed) {
            persistSettings();
        }

        const allPromptElements = Array.from(listElement.querySelectorAll('.completion_prompt_manager_prompt[data-pm-identifier]'));
        if (allPromptElements.length === 0) {
            destroySortables(listElement);
            state.lastDigest = '';
            return;
        }

        const entryRecords = [];

        for (let index = 0; index < allPromptElements.length; index++) {
            const element = allPromptElements[index];
            if (!(element instanceof HTMLElement)) {
                continue;
            }

            const identifier = getPromptIdentifierFromElement(element);
            if (!identifier) {
                continue;
            }

            const prompt = getPromptByIdentifier(settings, identifier);
            if (!prompt) {
                continue;
            }

            const path = getEntryPath(prompt);
            const inputElement = ensurePathInput(element);
            if (inputElement instanceof HTMLInputElement && document.activeElement !== inputElement) {
                inputElement.value = path;
            }

            const name = String(prompt.name || identifier);

            entryRecords.push({
                identifier,
                name,
                path,
                order: index,
                element,
            });
        }

        let folderPaths = Array.isArray(settings[FOLDER_PATHS_KEY])
            ? [...settings[FOLDER_PATHS_KEY]]
            : [];

        if (!showEmptyFolders()) {
            const keepSet = new Set();
            for (const record of entryRecords) {
                for (const folderPath of expandParentPaths(record.path)) {
                    keepSet.add(folderPath);
                }
            }

            folderPaths = folderPaths.filter(path => keepSet.has(path));
        }

        const presetName = getCurrentPresetName();
        const digest = makeDigest(presetName, entryRecords, folderPaths);
        if (digest === state.lastDigest) {
            return;
        }

        const staticRows = Array.from(listElement.querySelectorAll(':scope > li.completion_prompt_manager_list_head, :scope > li.completion_prompt_manager_list_separator'));
        const treeNodes = buildTreeNodes(entryRecords, folderPaths);

        state.applyingLayout = true;

        try {
            destroySortables(listElement);

            const host = document.createElement('div');
            host.className = 'wihm-tree-host wihm-preset-tree-host';

            state.tree?.destroy?.();
            state.tree = new CollapsibleTree({
                container: host,
                nodes: treeNodes,
                storageKey: `wihm-preset-expanded-${presetName || '__default__'}`,
                renderLeaf: (node) => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'wihm-entry-slot';

                    const element = node?.meta?.element;
                    if (element instanceof HTMLElement) {
                        wrapper.appendChild(element);
                    }

                    return wrapper;
                },
            });

            state.tree.render();

            listElement.innerHTML = '';
            for (const row of staticRows) {
                listElement.appendChild(row);
            }
            listElement.appendChild(host);

            setupFolderSortables(listElement);

            state.lastDigest = digest;
        } finally {
            state.applyingLayout = false;
        }
    }

    function refresh(reason = 'manual') {
        if (!state.started) {
            return;
        }

        if (state.scheduled) {
            return;
        }

        state.scheduled = true;

        requestAnimationFrame(() => {
            state.scheduled = false;

            if (state.applyingLayout) {
                return;
            }

            startObserver();
            void applyHierarchyLayout();
        });
    }

    function startObserver() {
        const listElement = getListElement();
        if (!(listElement instanceof HTMLElement)) {
            return;
        }

        if (state.observer && state.observerTarget === listElement && listElement.isConnected) {
            return;
        }

        if (state.observer) {
            state.observer.disconnect();
            state.observer = null;
            state.observerTarget = null;
        }

        state.observer = new MutationObserver(() => {
            if (state.applyingLayout || state.dragSaving) {
                return;
            }

            if (document.body?.classList?.contains('wihm-drag-active') || document.body?.classList?.contains('wihm-drag-committing')) {
                return;
            }

            refresh('prompt-list-mutation');
        });

        state.observer.observe(listElement, {
            childList: true,
            subtree: true,
        });

        state.observerTarget = listElement;
    }

    function startMountObserver() {
        if (state.mountObserver) {
            return;
        }

        const body = document.body;
        if (!(body instanceof HTMLBodyElement)) {
            return;
        }

        state.mountObserver = new MutationObserver(() => {
            const listElement = getListElement();
            if (!(listElement instanceof HTMLElement)) {
                return;
            }

            startObserver();
            refresh('prompt-list-mounted');
        });

        state.mountObserver.observe(body, {
            childList: true,
            subtree: true,
        });
    }

    function stopObserver() {
        if (state.observer) {
            state.observer.disconnect();
            state.observer = null;
            state.observerTarget = null;
        }

        if (state.mountObserver) {
            state.mountObserver.disconnect();
            state.mountObserver = null;
        }
    }

    function start() {
        if (state.started) {
            return;
        }

        state.started = true;
        startMountObserver();

        const eventSource = ctx?.eventSource;
        const eventTypes = ctx?.eventTypes;

        const bindEvent = (eventName, reason) => {
            if (!eventSource?.on || !eventName) {
                return;
            }

            const handler = () => {
                state.lastDigest = '';
                refresh(reason);
            };

            eventSource.on(eventName, handler);
            listeners.push({ eventSource, eventName, handler });
        };

        bindEvent(eventTypes?.OAI_PRESET_CHANGED_AFTER, 'oai-preset-changed');
        bindEvent(eventTypes?.SETTINGS_UPDATED, 'settings-updated');
        bindEvent(eventTypes?.APP_READY, 'app-ready');

        refresh('preset-tree-start');
    }

    function stop() {
        if (!state.started) {
            return;
        }

        stopObserver();

        for (const listener of listeners) {
            if (listener?.eventSource?.removeListener && listener?.eventName && listener?.handler) {
                listener.eventSource.removeListener(listener.eventName, listener.handler);
            }
        }

        listeners.length = 0;

        const listElement = getListElement();
        if (listElement instanceof HTMLElement) {
            destroySortables(listElement);
        }

        state.tree?.destroy?.();
        state.tree = null;

        for (const timer of state.pathInputDebounceMap.values()) {
            clearTimeout(timer);
        }
        state.pathInputDebounceMap.clear();

        state.started = false;
    }

    return {
        start,
        stop,
        refresh,
    };
}
