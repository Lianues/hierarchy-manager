import { CollapsibleTree } from './collapsible-tree.js';
import { createWorldInfoDragBridge } from './worldinfo-drag-bridge.js';
import { debounceAsync, getCurrentWorldName, getJQuerySafe } from './st-bridge.js';
import {
    FOLDER_PATHS_KEY,
    ensureWorldHierarchyData,
    expandParentPaths,
    getEntryPath,
    normalizePathChain,
    setEntryPath,
} from './path-schema.js';

function getLeafCountFromFolder(folderNode) {
    let count = Array.isArray(folderNode.entries) ? folderNode.entries.length : 0;

    for (const childFolder of folderNode.folders.values()) {
        count += getLeafCountFromFolder(childFolder);
    }

    return count;
}

function createFolderNode(path, name) {
    return {
        path,
        name,
        folders: new Map(),
        entries: [],
    };
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

export function createWorldInfoTreeView(ctx, { getSettings, dataSync, extensionName = 'hierarchy-manager' } = {}) {
    const listeners = [];

    const state = {
        started: false,
        observer: null,
        applyingLayout: false,
        scheduled: false,
        tree: null,
        lastDigest: '',
        restoringNative: false
    };

    function logDebug(...args) {
        if (!getSettings?.()?.debugLog) {
            return;
        }

        console.debug(`[${extensionName}:tree-view]`, ...args);
    }

    function getListElement() {
        const list = document.getElementById('world_popup_entries_list');
        return list instanceof HTMLElement ? list : null;
    }

    function getToolbarRow() {
        const refreshButton = document.getElementById('world_refresh');
        if (refreshButton?.parentElement instanceof HTMLElement) {
            return refreshButton.parentElement;
        }

        return null;
    }

    function isHierarchyEnabled() {
        return Boolean(getSettings?.()?.enableHierarchyView);
    }

    function showEmptyFolders() {
        return Boolean(getSettings?.()?.showEmptyFolders);
    }

    function isCustomSortMode() {
        const sortSelect = document.getElementById('world_info_sort_order');
        if (!(sortSelect instanceof HTMLSelectElement)) {
            return false;
        }

        const selectedOption = sortSelect.options[sortSelect.selectedIndex];
        if (!(selectedOption instanceof HTMLOptionElement)) {
            return false;
        }

        const sortRule = String(selectedOption.dataset?.rule || selectedOption.getAttribute('data-rule') || '').trim();
        return sortRule === 'custom';
    }

    const dragBridge = createWorldInfoDragBridge({
        ctx,
        dataSync,
        normalizePathChain,
        ensureWorldHierarchyData,
        setEntryPath,
        getJQuerySafe,
        getListElement,
        getCurrentWorldName,
        isHierarchyEnabled,
        isCustomSortMode,
        invalidateDigest: () => {
            state.lastDigest = '';
        },
        refresh: (reason) => {
            refresh(reason);
        },
    });

    function destroyFolderSortables(listElement = null) {
        dragBridge.destroy(listElement);
    }

    function setupFolderSortables(worldName, listElement) {
        dragBridge.setup(worldName, listElement);
    }



    function setToggleButtonVisual() {
        const toggle = document.getElementById('wihm_toggle_hierarchy_button');
        if (!(toggle instanceof HTMLElement)) {
            return;
        }

        const enabled = isHierarchyEnabled();
        toggle.classList.toggle('toggleEnabled', enabled);
        toggle.title = enabled ? '层级视图：开' : '层级视图：关';
        toggle.textContent = enabled ? '层级✓' : '层级';
    }

    function ensureToolbarButtons() {
        const row = getToolbarRow();
        if (!(row instanceof HTMLElement)) {
            return;
        }

        let toggleButton = document.getElementById('wihm_toggle_hierarchy_button');
        if (!(toggleButton instanceof HTMLElement)) {
            toggleButton = document.createElement('div');
            toggleButton.id = 'wihm_toggle_hierarchy_button';
            toggleButton.className = 'menu_button';
            toggleButton.textContent = '层级';
            toggleButton.title = '切换层级视图';
            row.insertBefore(toggleButton, document.getElementById('world_refresh'));

            toggleButton.addEventListener('click', () => {
                const settings = getSettings?.();
                if (!settings) {
                    return;
                }

                settings.enableHierarchyView = !settings.enableHierarchyView;
                ctx?.saveSettingsDebounced?.();
                setToggleButtonVisual();

                if (!settings.enableHierarchyView) {
                    restoreNativeView();
                }

                refresh('toolbar-toggle-hierarchy');
            });
        }

        let addFolderButton = document.getElementById('wihm_add_folder_button');
        if (!(addFolderButton instanceof HTMLElement)) {
            addFolderButton = document.createElement('div');
            addFolderButton.id = 'wihm_add_folder_button';
            addFolderButton.className = 'menu_button';
            addFolderButton.textContent = '新建文件夹';
            addFolderButton.title = '添加空文件夹路径';
            row.insertBefore(addFolderButton, document.getElementById('world_refresh'));

            addFolderButton.addEventListener('click', async () => {
                const worldName = getCurrentWorldName();
                if (!worldName) {
                    toastr.info('请先选择一个世界书。');
                    return;
                }

                let popupInput = null;
                try {
                    popupInput = await ctx?.Popup?.show?.input?.(
                        '新建文件夹',
                        '请输入文件夹路径（使用 / 分隔）：',
                        '',
                    );
                } catch {
                    popupInput = null;
                }

                if (popupInput === null || popupInput === undefined) {
                    popupInput = window.prompt('请输入文件夹路径（使用 / 分隔）：', '');
                }

                const normalizedPath = normalizePathChain(popupInput ?? '');
                if (!normalizedPath) {
                    return;
                }

                const worldData = await ctx?.loadWorldInfo?.(worldName);
                if (!worldData || typeof worldData !== 'object') {
                    toastr.warning('读取世界书失败。');
                    return;
                }

                worldData[FOLDER_PATHS_KEY] = Array.isArray(worldData[FOLDER_PATHS_KEY]) ? worldData[FOLDER_PATHS_KEY] : [];
                const beforePaths = new Set(worldData[FOLDER_PATHS_KEY]);
                worldData[FOLDER_PATHS_KEY].push(normalizedPath);

                ensureWorldHierarchyData(worldData);
                const afterPaths = Array.isArray(worldData[FOLDER_PATHS_KEY]) ? worldData[FOLDER_PATHS_KEY] : [];

                if (!afterPaths.includes(normalizedPath)) {
                    toastr.warning('文件夹路径创建失败，请检查路径格式。');
                    return;
                }

                const isNewFolder = !beforePaths.has(normalizedPath);
                await dataSync?.ensureNormalized?.(worldName, worldData, { saveIfChanged: true, forceSave: true });

                state.lastDigest = '';
                refresh('add-folder');

                if (typeof ctx?.reloadWorldInfoEditor === 'function') {
                    ctx.reloadWorldInfoEditor(worldName, true);
                }

                toastr[isNewFolder ? 'success' : 'info'](isNewFolder ? `已创建文件夹：${normalizedPath}` : `文件夹已存在：${normalizedPath}`);
            });
        }

        setToggleButtonVisual();
    }

    function disableSortableIfNeeded(listElement, disable) {
        const jq = getJQuerySafe();
        if (!jq || !jq.fn?.sortable) {
            return;
        }

        const $list = jq(listElement);
        let instance = null;

        try {
            instance = $list.sortable('instance');
        } catch {
            instance = null;
        }

        if (!instance) {
            return;
        }

        try {
            if (disable) {
                $list.sortable('disable');
            } else {
                $list.sortable('enable');
            }
        } catch {
            // ignore
        }
    }

    async function saveEntryPath(worldName, uid, inputElement) {
        const worldData = await ctx?.loadWorldInfo?.(worldName);
        if (!worldData || !worldData.entries || !worldData.entries[uid]) {
            return;
        }

        const entry = worldData.entries[uid];
        const { changed, normalizedPath } = setEntryPath(entry, inputElement.value);
        const normalizedResult = ensureWorldHierarchyData(worldData);

        inputElement.value = normalizedPath;

        if (!changed && !normalizedResult.changed) {
            return;
        }

        await dataSync?.ensureNormalized?.(worldName, worldData, { saveIfChanged: true, forceSave: true });
        refresh('entry-path-change');
    }

    async function confirmFolderDelete(folderPath, affectedEntriesCount) {
        const title = '删除文件夹';
        const text = `将删除文件夹“${folderPath}”及其子文件夹路径，\n并把其中 ${affectedEntriesCount} 条条目的路径移动到根目录。\n\n确定继续吗？`;

        try {
            const result = await ctx?.Popup?.show?.confirm?.(title, text);
            return Boolean(result);
        } catch {
            return window.confirm(text);
        }
    }

    async function renameFolderPath(worldName, folderPath) {
        const oldPath = normalizePathChain(folderPath);
        if (!oldPath) {
            return;
        }

        const worldData = await ctx?.loadWorldInfo?.(worldName);
        if (!worldData || typeof worldData !== 'object') {
            toastr.warning('读取世界书失败。');
            return;
        }

        ensureWorldHierarchyData(worldData);

        let inputPath = null;
        try {
            inputPath = await ctx?.Popup?.show?.input?.('重命名文件夹', '请输入新的文件夹路径：', oldPath);
        } catch {
            inputPath = null;
        }

        if (inputPath === null || inputPath === undefined) {
            inputPath = window.prompt('请输入新的文件夹路径：', oldPath);
        }

        const newPath = normalizePathChain(inputPath ?? '');
        if (!newPath || newPath === oldPath) {
            return;
        }

        let movedEntries = 0;
        for (const entry of Object.values(worldData.entries || {})) {
            const currentPath = getEntryPath(entry);
            const replacedPath = replacePathPrefix(currentPath, oldPath, newPath);
            if (replacedPath !== currentPath) {
                setEntryPath(entry, replacedPath);
                movedEntries++;
            }
        }

        const folderPaths = Array.isArray(worldData[FOLDER_PATHS_KEY]) ? worldData[FOLDER_PATHS_KEY] : [];
        worldData[FOLDER_PATHS_KEY] = folderPaths.map(path => replacePathPrefix(path, oldPath, newPath));

        ensureWorldHierarchyData(worldData);
        await dataSync?.ensureNormalized?.(worldName, worldData, { saveIfChanged: true, forceSave: true });

        state.lastDigest = '';
        refresh('folder-rename');
        if (typeof ctx?.reloadWorldInfoEditor === 'function') {
            ctx.reloadWorldInfoEditor(worldName, true);
        }

        toastr.success(`已重命名文件夹：${oldPath} → ${newPath}（影响 ${movedEntries} 条）`);
    }

    async function deleteFolderPath(worldName, folderPath) {
        const targetPath = normalizePathChain(folderPath);
        if (!targetPath) {
            return;
        }

        const worldData = await ctx?.loadWorldInfo?.(worldName);
        if (!worldData || typeof worldData !== 'object') {
            toastr.warning('读取世界书失败。');
            return;
        }

        ensureWorldHierarchyData(worldData);

        const affectedEntries = Object.values(worldData.entries || {}).filter(entry => {
            const path = getEntryPath(entry);
            return path === targetPath || path.startsWith(`${targetPath}/`);
        });

        const confirmed = await confirmFolderDelete(targetPath, affectedEntries.length);
        if (!confirmed) {
            return;
        }

        for (const entry of affectedEntries) {
            setEntryPath(entry, '');
        }

        const folderPaths = Array.isArray(worldData[FOLDER_PATHS_KEY]) ? worldData[FOLDER_PATHS_KEY] : [];
        worldData[FOLDER_PATHS_KEY] = folderPaths.filter(path => {
            const normalized = normalizePathChain(path);
            return normalized !== targetPath && !normalized.startsWith(`${targetPath}/`);
        });

        ensureWorldHierarchyData(worldData);
        await dataSync?.ensureNormalized?.(worldName, worldData, { saveIfChanged: true, forceSave: true });

        state.lastDigest = '';
        refresh('folder-delete');
        if (typeof ctx?.reloadWorldInfoEditor === 'function') {
            ctx.reloadWorldInfoEditor(worldName, true);
        }

        toastr.success(`已删除文件夹：${targetPath}（移动 ${affectedEntries.length} 条到根目录）`);
    }

    function ensureEntryPathInput(entryElement, worldName) {
        const uidRaw = entryElement.getAttribute('uid') ?? entryElement.dataset?.uid;
        const uid = Number(uidRaw);

        if (!Number.isFinite(uid)) {
            return;
        }

        const controls = entryElement.querySelector('.WIEnteryHeaderControls');
        if (!(controls instanceof HTMLElement)) {
            return;
        }

        let wrapper = entryElement.querySelector('.wihm-path-control');
        if (!(wrapper instanceof HTMLElement)) {
            wrapper = document.createElement('div');
            wrapper.className = 'world_entry_form_control wi-enter-footer-text flex-container flexNoGap wihm-path-control';
            wrapper.innerHTML = `
                <label class="WIEntryHeaderTitleMobile">路径：</label>
                <input class="text_pole margin0 wihm-path-input" type="text" placeholder="路径，如 设定/组织" title="条目层级路径">
            `;
            controls.appendChild(wrapper);
        }

        const input = wrapper.querySelector('.wihm-path-input');
        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        input.dataset.uid = String(uid);

        if (input.dataset.wihmBound !== '1') {
            const debouncedSave = debounceAsync(async () => {
                await saveEntryPath(worldName, uid, input);
            }, 350);

            input.addEventListener('change', () => {
                void debouncedSave();
            });

            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    void debouncedSave();
                }
            });

            input.dataset.wihmBound = '1';
        }
    }

    function buildTreeNodes(worldName, entryRecords, folderPaths) {
        const root = createFolderNode('', '');

        const ensureFolder = (folderPath) => {
            const normalizedPath = normalizePathChain(folderPath);
            if (!normalizedPath) {
                return root;
            }

            const segments = normalizedPath.split('/');
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
                    id: `entry:${record.uid}`,
                    label: `条目 ${record.uid}`,
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
                            void renameFolderPath(worldName, folderNode.path);
                        },
                    },
                    {
                        id: `delete:${folderNode.path}`,
                        title: '删除文件夹',
                        className: 'menu_button fa-solid fa-trash-can redWarningBG interactable',
                        dataI18n: '[title]Delete World Info',
                        onClick: () => {
                            void deleteFolderPath(worldName, folderNode.path);
                        },
                    },
                ]
                : [];

            return {
                kind: 'group',
                id: `folder:${folderNode.path || '__root__'}`,
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
                id: 'folder:__ungrouped__',
                label: '未分组',
                defaultExpanded: true,
                children: root.entries
                    .sort((a, b) => a.order - b.order)
                    .map(record => ({
                        kind: 'leaf',
                        id: `entry:${record.uid}`,
                        label: `条目 ${record.uid}`,
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

    function makeDigest(worldName, entryRecords, folderPaths) {
        const entriesDigest = entryRecords.map(record => `${record.uid}:${record.path}:${record.order}`).join('|');
        const foldersDigest = folderPaths.join('|');
        const settingsDigest = `${isHierarchyEnabled()}-${showEmptyFolders()}-${isCustomSortMode()}`;
        return `${worldName}::${settingsDigest}::${entriesDigest}::${foldersDigest}`;
    }

    async function applyHierarchyLayout() {
        const listElement = getListElement();
        if (!(listElement instanceof HTMLElement)) {
            return;
        }

        ensureToolbarButtons();

        const worldName = getCurrentWorldName();
        if (!worldName) {
            destroyFolderSortables(listElement);
            return;
        }

        if (!isHierarchyEnabled()) {
            disableSortableIfNeeded(listElement, false);
            destroyFolderSortables(listElement);
            return;
        }

        const worldData = await ctx?.loadWorldInfo?.(worldName);
        if (!worldData || typeof worldData !== 'object' || !worldData.entries) {
            destroyFolderSortables(listElement);
            return;
        }

        const normalizationResult = ensureWorldHierarchyData(worldData);
        if (normalizationResult.changed) {
            await dataSync?.ensureNormalized?.(worldName, worldData, { saveIfChanged: true, forceSave: true });
        }

        const allEntryElements = Array.from(listElement.querySelectorAll('.world_entry'));
        if (allEntryElements.length === 0) {
            state.lastDigest = '';
            destroyFolderSortables(listElement);
            return;
        }

        const entryRecords = [];

        for (let i = 0; i < allEntryElements.length; i++) {
            const entryElement = allEntryElements[i];
            const uidRaw = entryElement.getAttribute('uid') ?? entryElement.dataset?.uid;
            const uid = Number(uidRaw);

            if (!Number.isFinite(uid) || !worldData.entries[uid]) {
                continue;
            }

            ensureEntryPathInput(entryElement, worldName);

            const entryData = worldData.entries[uid];
            const entryPath = getEntryPath(entryData);

            const pathInput = entryElement.querySelector('.wihm-path-input');
            if (pathInput instanceof HTMLInputElement) {
                pathInput.value = entryPath;
            }

            entryRecords.push({
                uid,
                path: entryPath,
                order: i,
                element: entryElement,
            });
        }

        let folderPaths = Array.isArray(worldData[FOLDER_PATHS_KEY]) ? [...worldData[FOLDER_PATHS_KEY]] : [];

        if (!showEmptyFolders()) {
            const keepSet = new Set();
            for (const record of entryRecords) {
                for (const folderPath of expandParentPaths(record.path)) {
                    keepSet.add(folderPath);
                }
            }

            folderPaths = folderPaths.filter(path => keepSet.has(path));
        }

        const digest = makeDigest(worldName, entryRecords, folderPaths);
        if (digest === state.lastDigest) {
            return;
        }

        const header = listElement.querySelector('#WIEntryHeaderTitlesPC');
        const treeNodes = buildTreeNodes(worldName, entryRecords, folderPaths);

        state.applyingLayout = true;

        try {
            disableSortableIfNeeded(listElement, true);

            const host = document.createElement('div');
            host.className = 'wihm-tree-host';

            state.tree?.destroy?.();
            state.tree = new CollapsibleTree({
                container: host,
                nodes: treeNodes,
                storageKey: `wihm-expanded-${worldName}`,
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

            if (header instanceof HTMLElement) {
                listElement.appendChild(header);
            }

            listElement.appendChild(host);
            state.lastDigest = digest;

            setupFolderSortables(worldName, listElement);
        } finally {
            state.applyingLayout = false;
        }
    }

    function restoreNativeView() {
        if (state.restoringNative) {
            return;
        }

        const worldName = getCurrentWorldName();
        if (!worldName) {
            return;
        }

        if (typeof ctx?.reloadWorldInfoEditor !== 'function') {
            return;
        }
        destroyFolderSortables();

        state.restoringNative = true;

        Promise.resolve()
            .then(() => ctx.reloadWorldInfoEditor(worldName, true))
            .finally(() => {
                state.restoringNative = false;
                state.lastDigest = '';
            });
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

            if (!isHierarchyEnabled()) {
                return;
            }

            void applyHierarchyLayout();
        });

        logDebug('refresh', reason);
    }

    function startObserver() {
        if (state.observer) {
            return;
        }

        const listElement = getListElement();
        if (!(listElement instanceof HTMLElement)) {
            return;
        }

        state.observer = new MutationObserver(() => {
            if (state.applyingLayout) {
                return;
            }

            // During indicator-drag takeover we commit DOM first then persist world data.
            // Ignore intermediate DOM mutations to prevent the layout from snapping back.
            if (document.body?.classList?.contains('wihm-drag-active') || document.body?.classList?.contains('wihm-drag-committing')) {
                return;
            }

            refresh('mutation');
        });

        state.observer.observe(listElement, {
            childList: true,
            subtree: true,
        });
    }

    function stopObserver() {
        if (state.observer) {
            state.observer.disconnect();
            state.observer = null;
        }
    }

    function addTrackedListener(target, type, handler, options = false) {
        if (!target?.addEventListener || typeof handler !== 'function') {
            return;
        }

        target.addEventListener(type, handler, options);
        listeners.push({ target, type, handler, options });
    }

    function handleWorldInfoUpdated(worldName) {
        const currentWorldName = getCurrentWorldName();
        if (!currentWorldName || currentWorldName !== worldName) {
            return;
        }

        state.lastDigest = '';
        refresh('worldinfo-updated');
    }

    function start() {
        if (state.started) {
            return;
        }

        ensureToolbarButtons();
        startObserver();

        const worldSelector = document.getElementById('world_editor_select');
        if (worldSelector instanceof HTMLSelectElement) {
            const handler = () => {
                state.lastDigest = '';
                refresh('world-changed');
            };
            addTrackedListener(worldSelector, 'change', handler);
        }

        const sortSelector = document.getElementById('world_info_sort_order');
        if (sortSelector instanceof HTMLSelectElement) {
            const handler = () => {
                state.lastDigest = '';
                refresh('sort-rule-changed');
            };
            addTrackedListener(sortSelector, 'change', handler);
        }

        dragBridge.bindGlobalListeners(addTrackedListener);

        if (ctx?.eventSource?.on && ctx?.eventTypes?.WORLDINFO_UPDATED) {
            ctx.eventSource.on(ctx.eventTypes.WORLDINFO_UPDATED, handleWorldInfoUpdated);
            listeners.push({
                eventSource: ctx.eventSource,
                eventName: ctx.eventTypes.WORLDINFO_UPDATED,
                handler: handleWorldInfoUpdated,
            });
        }

        state.started = true;
        refresh('start');
    }

    function stop() {
        if (!state.started) {
            return;
        }

        stopObserver();

        for (const listener of listeners) {
            if (listener?.target && listener?.type && listener?.handler) {
                listener.target.removeEventListener(listener.type, listener.handler, listener.options ?? false);
                continue;
            }

            if (listener?.eventSource?.removeListener && listener?.eventName && listener?.handler) {
                listener.eventSource.removeListener(listener.eventName, listener.handler);
                continue;
            }
        }

        listeners.length = 0;

        destroyFolderSortables();
        state.tree?.destroy?.();
        state.tree = null;

        state.started = false;
    }

    return {
        start,
        stop,
        refresh,
    };
}
