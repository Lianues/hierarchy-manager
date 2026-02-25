export function createWorldInfoDragBridge({
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
    invalidateDigest,
    refresh,
} = {}) {
    const state = {
        dragSortSaving: false,
        dragHoverExpandTimer: null,
        dragHoverExpandNodeId: '',
        dragHoverExpandHeader: null,
        indicatorDragActive: false,
        indicatorDragUid: null,
        indicatorDragWorldName: '',
        indicatorDragTargetPath: null,
        hoverHeaderDropEl: null,
        hoverDropzoneEl: null,
        activeIndicatorDrag: null,
        dragSessionId: 0,
    };

    function getEntryUidFromElement(entryElement) {
        if (!(entryElement instanceof HTMLElement)) {
            return null;
        }

        const uidRaw = entryElement.getAttribute('uid') ?? entryElement.dataset?.uid;
        const uid = Number(uidRaw);
        return Number.isFinite(uid) ? uid : null;
    }

    function stopEvent(event) {
        try { event?.preventDefault?.(); } catch { /* ignore */ }
        try { event?.stopImmediatePropagation?.(); } catch { /* ignore */ }
        try { event?.stopPropagation?.(); } catch { /* ignore */ }
    }

    function setDragCommitLock(active) {
        const body = document.body;
        if (!(body instanceof HTMLBodyElement)) {
            return;
        }

        body.classList.toggle('wihm-drag-committing', Boolean(active));
    }

    function pickEntryTitle(worldEntryEl) {
        if (!(worldEntryEl instanceof Element)) {
            return '';
        }

        const ta = worldEntryEl.querySelector('textarea[name="comment"]');
        const v = (ta && 'value' in ta) ? String(ta.value || '').trim() : '';
        if (v) {
            return v;
        }

        const keyText = String(worldEntryEl.querySelector('.key_info')?.textContent || '').trim();
        if (keyText) {
            return keyText.slice(0, 80);
        }

        const uid = worldEntryEl.getAttribute('uid') || worldEntryEl.getAttribute('data-uid') || worldEntryEl.dataset?.uid;
        if (uid) {
            return `UID ${uid}`;
        }

        return 'WorldInfo 条目';
    }

    function createGhost(worldEntryEl, rect) {
        const ghost = document.createElement('div');
        ghost.className = 'wihm-drag-ghost';
        ghost.textContent = pickEntryTitle(worldEntryEl);
        ghost.style.width = `${Math.round(rect.width)}px`;
        ghost.style.transform = `translate3d(${Math.round(rect.left)}px, ${Math.round(rect.top)}px, 0)`;
        return ghost;
    }

    function createIndicator() {
        const el = document.createElement('div');
        el.className = 'wihm-drop-indicator';
        return el;
    }

    function setIndicatorGeometry(indicatorEl, zoneElement, topPx) {
        if (!(indicatorEl instanceof HTMLElement) || !(zoneElement instanceof HTMLElement)) {
            return;
        }

        applyHoverDropzoneGeometry(zoneElement);
        const zoneRect = zoneElement.getBoundingClientRect();
        const insetLeft = Number.parseFloat(zoneElement.style.getPropertyValue('--wihm-drop-line-left') || '0') || 0;
        const insetRight = Number.parseFloat(zoneElement.style.getPropertyValue('--wihm-drop-line-right') || '0') || 0;

        const left = zoneRect.left + insetLeft;
        const width = Math.max(0, zoneRect.width - insetLeft - insetRight);

        indicatorEl.style.left = `${Math.round(left)}px`;
        indicatorEl.style.top = `${Math.round(topPx)}px`;
        indicatorEl.style.width = `${Math.round(width)}px`;
    }

    function getDraggedSlotFromHandle(handleElement) {
        if (!(handleElement instanceof Element)) {
            return null;
        }

        const entry = handleElement.closest('.world_entry');
        if (!(entry instanceof HTMLElement)) {
            return null;
        }

        // In hierarchy view we wrap entries into slots.
        const slot = entry.closest('.wihm-entry-slot');
        return slot instanceof HTMLElement ? slot : entry;
    }

    function getEntryElementFromSlot(slotElement) {
        if (!(slotElement instanceof HTMLElement)) {
            return null;
        }

        if (slotElement.classList.contains('world_entry')) {
            return slotElement;
        }

        const entry = slotElement.querySelector(':scope > .world_entry') || slotElement.querySelector('.world_entry');
        return entry instanceof HTMLElement ? entry : null;
    }

    function getSlotFromEntry(entryElement) {
        if (!(entryElement instanceof HTMLElement)) {
            return null;
        }
        const slot = entryElement.closest('.wihm-entry-slot');
        return slot instanceof HTMLElement ? slot : entryElement;
    }

    function getSlotsInZone(zoneElement) {
        if (!(zoneElement instanceof HTMLElement)) {
            return [];
        }

        const directSlots = Array.from(zoneElement.querySelectorAll(':scope > .wihm-entry-slot'));
        if (directSlots.length) {
            return directSlots.filter(x => x instanceof HTMLElement);
        }

        // Fallback if slots are not used.
        return Array.from(zoneElement.querySelectorAll(':scope > .world_entry')).filter(x => x instanceof HTMLElement);
    }

    function findRootDropzoneByY(listElement, clientY) {
        if (!(listElement instanceof HTMLElement) || !Number.isFinite(clientY)) {
            return null;
        }

        const host = listElement.querySelector('.wihm-tree-host');
        if (!(host instanceof HTMLElement)) {
            return null;
        }

        const rootZones = Array.from(host.querySelectorAll(':scope > .wihm-root-dropzone'))
            .filter(el => el instanceof HTMLElement);

        if (rootZones.length === 0) {
            return null;
        }

        const groups = Array.from(host.querySelectorAll(':scope > .wihm-tree-group'))
            .filter(el => el instanceof HTMLElement);

        // If pointer is inside any group box, treat it as non-root area.
        for (const group of groups) {
            const r = group.getBoundingClientRect();
            if (clientY >= r.top && clientY <= r.bottom) {
                return null;
            }
        }

        const hostRect = host.getBoundingClientRect();
        if (clientY < hostRect.top) {
            return rootZones[0];
        }
        if (clientY > hostRect.bottom) {
            return rootZones[rootZones.length - 1];
        }

        if (groups.length === 0) {
            return rootZones[0];
        }

        const firstRect = groups[0].getBoundingClientRect();
        if (clientY < firstRect.top) {
            return rootZones[0];
        }

        for (let i = 0; i < groups.length; i++) {
            const r = groups[i].getBoundingClientRect();
            const nextRect = i + 1 < groups.length ? groups[i + 1].getBoundingClientRect() : null;
            const bandTop = r.bottom;
            const bandBottom = nextRect ? nextRect.top : hostRect.bottom;
            if (clientY >= bandTop && clientY <= bandBottom) {
                return rootZones[Math.min(i + 1, rootZones.length - 1)];
            }
        }

        return rootZones[rootZones.length - 1];
    }

    function computeDropPosition({ listElement, draggedSlot, draggedEntry, clientX, clientY }) {
        const rootZone = findRootDropzoneByY(listElement, clientY);
        const zone = (rootZone instanceof HTMLElement)
            ? rootZone
            : getDropzoneFromPoint(listElement, clientX, clientY);

        if (!(zone instanceof HTMLElement)) {
            return null;
        }

        const hovered = document.elementFromPoint(clientX, clientY);
        const hitEntry = hovered?.closest?.('.world_entry');
        const hitEntryEl = hitEntry instanceof HTMLElement ? hitEntry : null;

        if (hitEntryEl && hitEntryEl !== draggedEntry && zone.contains(hitEntryEl)) {
            const refSlot = getSlotFromEntry(hitEntryEl);
            if (!(refSlot instanceof HTMLElement) || refSlot === draggedSlot) {
                return { zone, refSlot: null, insertBefore: true, indicatorTop: zone.getBoundingClientRect().top + zone.getBoundingClientRect().height / 2 };
            }

            const r = hitEntryEl.getBoundingClientRect();
            const before = clientY < (r.top + r.height / 2);
            const indicatorTop = before ? r.top : r.bottom;
            return { zone, refSlot, insertBefore: before, indicatorTop };
        }

        const slots = getSlotsInZone(zone).filter(s => s !== draggedSlot);
        if (!slots.length) {
            const zr = zone.getBoundingClientRect();
            return { zone, refSlot: null, insertBefore: true, indicatorTop: zr.top + zr.height / 2 };
        }

        const first = slots[0];
        const last = slots[slots.length - 1];
        const firstRect = first.getBoundingClientRect();
        const lastRect = last.getBoundingClientRect();

        if (clientY < firstRect.top) {
            return { zone, refSlot: first, insertBefore: true, indicatorTop: firstRect.top };
        }

        if (clientY > lastRect.bottom) {
            return { zone, refSlot: last, insertBefore: false, indicatorTop: lastRect.bottom };
        }

        // In the whitespace inside zone: keep center indicator.
        const zr = zone.getBoundingClientRect();
        return { zone, refSlot: null, insertBefore: true, indicatorTop: zr.top + zr.height / 2 };
    }

    async function persistIndicatorDrag(worldName, listElement) {
        if (state.dragSortSaving) {
            return;
        }

        state.dragSortSaving = true;
        setDragCommitLock(true);
        try {
            const worldData = await ctx?.loadWorldInfo?.(worldName);
            if (!worldData || typeof worldData !== 'object' || !worldData.entries) {
                return;
            }

            // Sync paths based on current DOM.
            const entryElements = Array.from(listElement.querySelectorAll('.world_entry'));
            for (const entryEl of entryElements) {
                const uid = getEntryUidFromElement(entryEl);
                if (!Number.isFinite(uid) || !worldData.entries[uid]) {
                    continue;
                }

                const zone = entryEl.closest('.wihm-folder-dropzone');
                const path = zone instanceof HTMLElement ? normalizePathChain(zone.dataset.folderPath || '') : '';
                setEntryPath(worldData.entries[uid], path);
            }

            // Sync displayIndex based on current DOM order.
            if (isCustomSortMode?.()) {
                const firstUid = getEntryUidFromElement(entryElements[0]);
                const minDisplayIndex = Number.isFinite(firstUid)
                    ? Number(worldData.entries[firstUid]?.displayIndex ?? 0)
                    : 0;

                for (let index = 0; index < entryElements.length; index++) {
                    const uid = getEntryUidFromElement(entryElements[index]);
                    if (!Number.isFinite(uid) || !worldData.entries[uid]) {
                        continue;
                    }

                    const item = worldData.entries[uid];
                    const nextDisplayIndex = minDisplayIndex + index;
                    item.displayIndex = nextDisplayIndex;
                    item.extensions = item.extensions && typeof item.extensions === 'object' && !Array.isArray(item.extensions)
                        ? item.extensions
                        : {};
                    item.extensions.display_index = nextDisplayIndex;
                }
            }

            ensureWorldHierarchyData(worldData);
            await dataSync?.ensureNormalized?.(worldName, worldData, { saveIfChanged: true, forceSave: true });
            invalidateDigest?.();
            refresh?.('indicator-drag-save');

        } finally {
            state.dragSortSaving = false;
            setDragCommitLock(false);
        }
    }

    function getClientPointFromEvent(event) {
        const sourceEvent = event?.originalEvent || event;
        const touchPoint = sourceEvent?.touches?.[0] || sourceEvent?.changedTouches?.[0] || null;

        const rawClientX = touchPoint
            ? touchPoint.clientX
            : (Number.isFinite(sourceEvent?.clientX) ? sourceEvent.clientX : (Number.isFinite(sourceEvent?.pageX) ? sourceEvent.pageX - window.scrollX : NaN));

        const rawClientY = touchPoint
            ? touchPoint.clientY
            : (Number.isFinite(sourceEvent?.clientY) ? sourceEvent.clientY : (Number.isFinite(sourceEvent?.pageY) ? sourceEvent.pageY - window.scrollY : NaN));

        const x = Number(rawClientX);
        const y = Number(rawClientY);

        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return null;
        }

        return { x, y };
    }

    function getDirectDropzoneFromGroup(groupElement) {
        if (!(groupElement instanceof HTMLElement)) {
            return null;
        }

        for (const child of Array.from(groupElement.children)) {
            if (child instanceof HTMLElement && child.classList.contains('wihm-folder-dropzone')) {
                return child;
            }
        }

        return null;
    }

    function clearDragHoverExpandTimer() {
        if (state.dragHoverExpandTimer) {
            clearTimeout(state.dragHoverExpandTimer);
            state.dragHoverExpandTimer = null;
        }

        if (state.dragHoverExpandHeader instanceof HTMLElement) {
            state.dragHoverExpandHeader.classList.remove('wihm-hover-expand-pending');
        }

        state.dragHoverExpandHeader = null;
        state.dragHoverExpandNodeId = '';
    }

    function scheduleDragHoverExpand(headerElement) {
        if (!(headerElement instanceof HTMLElement)) {
            clearDragHoverExpandTimer();
            return;
        }

        if (headerElement.getAttribute('aria-expanded') === 'true') {
            clearDragHoverExpandTimer();
            return;
        }

        const groupElement = headerElement.closest('.wihm-tree-group');
        const nodeId = String(groupElement?.dataset?.nodeId || '');

        if (!nodeId) {
            clearDragHoverExpandTimer();
            return;
        }

        if (state.dragHoverExpandNodeId === nodeId && state.dragHoverExpandTimer) {
            return;
        }

        clearDragHoverExpandTimer();

        state.dragHoverExpandNodeId = nodeId;
        state.dragHoverExpandHeader = headerElement;
        headerElement.classList.add('wihm-hover-expand-pending');

        state.dragHoverExpandTimer = setTimeout(() => {
            const pendingHeader = state.dragHoverExpandHeader;
            clearDragHoverExpandTimer();

            if (!(pendingHeader instanceof HTMLElement) || !pendingHeader.isConnected) {
                return;
            }

            if (pendingHeader.getAttribute('aria-expanded') === 'true') {
                return;
            }

            pendingHeader.click();
        }, 500);
    }

    function hasDirectEntrySlot(zoneElement) {
        if (!(zoneElement instanceof HTMLElement)) {
            return false;
        }

        const directSlots = Array.from(zoneElement.children).filter(child => (
            child instanceof HTMLElement
            && child.classList.contains('wihm-entry-slot')
            && child.querySelector('.world_entry')
        ));

        return directSlots.length > 0;
    }

    function clearGlobalIndicatorGeometry() {
        const body = document.body;
        if (!(body instanceof HTMLBodyElement)) {
            return;
        }

        body.classList.remove('wihm-align-global-drop-indicator');
        body.style.removeProperty('--wihm-global-drop-left');
        body.style.removeProperty('--wihm-global-drop-width');
    }

    function setDragVisualActive(active) {
        const body = document.body;
        if (!(body instanceof HTMLBodyElement)) {
            return;
        }

        body.classList.toggle('wihm-drag-active', Boolean(active));
    }

    function applyGlobalIndicatorGeometry(zoneElement) {
        const body = document.body;
        if (!(body instanceof HTMLBodyElement) || !(zoneElement instanceof HTMLElement)) {
            return;
        }

        const zoneRect = zoneElement.getBoundingClientRect();
        const insetLeft = Number.parseFloat(zoneElement.style.getPropertyValue('--wihm-drop-line-left') || '0') || 0;
        const insetRight = Number.parseFloat(zoneElement.style.getPropertyValue('--wihm-drop-line-right') || '0') || 0;
        const lineLeft = zoneRect.left + insetLeft;
        const lineWidth = Math.max(0, zoneRect.width - insetLeft - insetRight);

        body.style.setProperty('--wihm-global-drop-left', `${Math.round(lineLeft)}px`);
        body.style.setProperty('--wihm-global-drop-width', `${Math.round(lineWidth)}px`);
        body.classList.add('wihm-align-global-drop-indicator');
    }

    function clearHoverDropzone() {
        if (state.hoverDropzoneEl instanceof HTMLElement) {
            state.hoverDropzoneEl.classList.remove('wihm-dropzone-hover');
        }

        if (state.hoverHeaderDropEl instanceof HTMLElement) {
            state.hoverHeaderDropEl.classList.remove('wihm-drop-target-header');
        }

        state.hoverDropzoneEl = null;
        state.hoverHeaderDropEl = null;
        document.body.classList.remove('wihm-hide-global-drop-indicator');
        clearGlobalIndicatorGeometry();
        setDragVisualActive(false);
    }

    function setHoverHeaderDropTarget(headerElement) {
        const nextHeader = headerElement instanceof HTMLElement ? headerElement : null;

        if (state.hoverHeaderDropEl instanceof HTMLElement && state.hoverHeaderDropEl !== nextHeader) {
            state.hoverHeaderDropEl.classList.remove('wihm-drop-target-header');
        }

        state.hoverHeaderDropEl = nextHeader;
        if (state.hoverHeaderDropEl) {
            state.hoverHeaderDropEl.classList.add('wihm-drop-target-header');
        }
    }

    function applyHoverDropzoneGeometry(zoneElement) {
        if (!(zoneElement instanceof HTMLElement)) {
            return;
        }

        let insetLeft = 0;
        let insetRight = 0;

        const zoneRect = zoneElement.getBoundingClientRect();
        const group = zoneElement.closest('.wihm-tree-group');
        const header = group?.querySelector(':scope > .wihm-tree-group-header');

        if (header instanceof HTMLElement) {
            const headerRect = header.getBoundingClientRect();
            insetLeft = Math.max(0, Math.round(headerRect.left - zoneRect.left));
            insetRight = Math.max(0, Math.round(zoneRect.right - headerRect.right));
        }

        zoneElement.style.setProperty('--wihm-drop-line-left', `${insetLeft}px`);
        zoneElement.style.setProperty('--wihm-drop-line-right', `${insetRight}px`);
    }


    function setHoverDropzone(zoneElement, {
        showLine = true,
        forceCenteredLine = false,
        hideGlobalIndicator = false,
        allowGlobalIndicator = true,
    } = {}) {
        const nextZone = zoneElement instanceof HTMLElement ? zoneElement : null;

        if (state.hoverDropzoneEl instanceof HTMLElement && state.hoverDropzoneEl !== nextZone) {
            state.hoverDropzoneEl.classList.remove('wihm-dropzone-hover');
        }

        state.hoverDropzoneEl = nextZone;
        if (state.hoverDropzoneEl) {
            const canShowLine = Boolean(showLine);
            const hasEntries = hasDirectEntrySlot(state.hoverDropzoneEl);
            const useCenteredLine = canShowLine && (forceCenteredLine || !hasEntries);
            const useGlobalIndicator = canShowLine && !forceCenteredLine && !hideGlobalIndicator && allowGlobalIndicator && hasEntries;
            const shouldHideGlobalIndicator = hideGlobalIndicator || !useGlobalIndicator;

            applyHoverDropzoneGeometry(state.hoverDropzoneEl);
            state.hoverDropzoneEl.classList.toggle('wihm-dropzone-hover', useCenteredLine);
            document.body.classList.toggle('wihm-hide-global-drop-indicator', shouldHideGlobalIndicator);

            if (useGlobalIndicator) {
                applyGlobalIndicatorGeometry(state.hoverDropzoneEl);
            } else {
                clearGlobalIndicatorGeometry();
            }

            return;
        }

        document.body.classList.remove('wihm-hide-global-drop-indicator');
        clearGlobalIndicatorGeometry();
    }

    function getDropzoneFromPoint(listElement, x, y) {
        if (!(listElement instanceof HTMLElement)) {
            return null;
        }

        const hovered = document.elementFromPoint(x, y);
        if (!(hovered instanceof Element) || !listElement.contains(hovered)) {
            return null;
        }

        const header = hovered.closest('.wihm-tree-group-header');
        if (header instanceof HTMLElement && listElement.contains(header)) {
            const group = header.closest('.wihm-tree-group');
            const dropzone = getDirectDropzoneFromGroup(group);
            if (dropzone instanceof HTMLElement) {
                // 优先把“悬停在文件夹标题”解释成“拖入该文件夹内部”
                return dropzone;
            }
        }

        const zone = hovered.closest('.wihm-folder-dropzone');
        if (zone instanceof HTMLElement && listElement.contains(zone)) {
            return zone;
        }

        const group = hovered.closest('.wihm-tree-group');
        const dropzone = getDirectDropzoneFromGroup(group);
        if (dropzone instanceof HTMLElement && listElement.contains(dropzone)) {
            return dropzone;
        }

        return null;
    }

    function getFolderPathFromPoint(listElement, x, y) {
        const zone = getDropzoneFromPoint(listElement, x, y);
        if (!(zone instanceof HTMLElement)) {
            return null;
        }

        return normalizePathChain(zone.dataset.folderPath || '');
    }

    function getDragHoverSnapshot(event, listElement) {
        if (!(listElement instanceof HTMLElement)) {
            return { header: null, path: null, zone: null };
        }

        const point = getClientPointFromEvent(event);
        if (!point) {
            return { header: null, path: null, zone: null };
        }

        const hovered = document.elementFromPoint(point.x, point.y);
        const header = hovered?.closest?.('.wihm-tree-group-header');
        const safeHeader = header instanceof HTMLElement && listElement.contains(header) ? header : null;

        return {
            header: safeHeader,
            path: getFolderPathFromPoint(listElement, point.x, point.y),
            zone: getDropzoneFromPoint(listElement, point.x, point.y),
        };
    }

    function handleDragHoverUI(event, listElement) {
        const snapshot = getDragHoverSnapshot(event, listElement);

        const isHeaderTarget = Boolean(snapshot.header);

        // 统一策略：
        // - 悬停标题：显示标题落点线，隐藏其他线
        // - 悬停内容区：有条目优先显示条目间线；无条目显示居中线
        setHoverDropzone(snapshot.zone, {
            showLine: !isHeaderTarget,
            forceCenteredLine: false,
            hideGlobalIndicator: isHeaderTarget,
            allowGlobalIndicator: !isHeaderTarget,
        });

        setHoverHeaderDropTarget(snapshot.header);

        if (snapshot.header) {
            scheduleDragHoverExpand(snapshot.header);
        } else {
            clearDragHoverExpandTimer();
        }

        return snapshot.path;
    }

    function isIndicatorEngineActive() {
        const body = document.body;
        if (!(body instanceof HTMLBodyElement)) {
            return false;
        }

        if (body.classList.contains('st-wido-enabled') && body.classList.contains('st-wido-engine-indicator')) {
            return true;
        }

        return document.querySelector('.st-wio-drag-ghost') instanceof HTMLElement;
    }

    function getDomOrderedUids(listElement) {
        if (!(listElement instanceof HTMLElement)) {
            return [];
        }

        return Array.from(listElement.querySelectorAll('.world_entry'))
            .map(getEntryUidFromElement)
            .filter(uid => Number.isFinite(uid));
    }

    function resetIndicatorDragState() {
        state.indicatorDragActive = false;
        state.indicatorDragUid = null;
        state.indicatorDragWorldName = '';
        state.indicatorDragTargetPath = null;
        state.activeIndicatorDrag = null;
        state.dragSessionId = 0;

        setDragVisualActive(false);
        // Commit lock is managed by persistIndicatorDrag(); do not clear it here.
    }

    function endActiveIndicatorDrag({ commit, event = null } = {}) {
        const d = state.activeIndicatorDrag;
        state.activeIndicatorDrag = null;

        if (!d) {
            clearDragHoverExpandTimer();
            clearHoverDropzone();
            resetIndicatorDragState();
            return;
        }

        if (event) {
            stopEvent(event);
        }

        try { d.ghostEl?.remove?.(); } catch { /* ignore */ }
        try { d.indicatorEl?.remove?.(); } catch { /* ignore */ }

        clearDragHoverExpandTimer();
        clearHoverDropzone();

        const listElement = d.listElement;

        if (commit && listElement instanceof HTMLElement) {
            const point = event ? getClientPointFromEvent(event) : { x: d.lastX, y: d.lastY };
            const drop = point
                ? computeDropPosition({ listElement, draggedSlot: d.draggedSlot, draggedEntry: d.draggedEntry, clientX: point.x, clientY: point.y })
                : null;

            if (drop?.zone instanceof HTMLElement) {
                try {
                    if (drop.refSlot instanceof HTMLElement) {
                        if (drop.insertBefore) {
                            drop.zone.insertBefore(d.draggedSlot, drop.refSlot);
                        } else {
                            drop.zone.insertBefore(d.draggedSlot, drop.refSlot.nextSibling);
                        }
                    } else {
                        drop.zone.appendChild(d.draggedSlot);
                    }
                } catch {
                    // ignore
                }

                const worldName = d.worldName || getCurrentWorldName?.() || '';
                if (worldName) {
                    void persistIndicatorDrag(worldName, listElement);
                }
            }
        }

        setDragVisualActive(false);
        resetIndicatorDragState();
    }

    function onPointerDown(event) {
        if (!isHierarchyEnabled?.() || !isCustomSortMode?.() || !isIndicatorEngineActive()) {
            return;
        }

        const listElement = getListElement?.();
        if (!(listElement instanceof HTMLElement)) {
            return;
        }

        const target = event?.target;
        if (!(target instanceof Element) || !listElement.contains(target)) {
            return;
        }

        const handle = target.closest('.drag-handle');
        if (!(handle instanceof Element)) {
            return;
        }

        const sourceEvent = event?.originalEvent || event;
        if (typeof sourceEvent?.button === 'number' && sourceEvent.button !== 0) {
            return;
        }

        // Take over and stop other drag engines (core sortable / cocktail indicator)
        stopEvent(event);

        // Cancel any previous drag session (in case pointerup was swallowed)
        endActiveIndicatorDrag({ commit: false });

        const draggedSlot = getDraggedSlotFromHandle(handle);
        const draggedEntry = getEntryElementFromSlot(draggedSlot);

        if (!(draggedSlot instanceof HTMLElement) || !(draggedEntry instanceof HTMLElement)) {
            return;
        }

        const uid = getEntryUidFromElement(draggedEntry);
        if (!Number.isFinite(uid)) {
            return;
        }

        const rect = draggedEntry.getBoundingClientRect();
        const p = getClientPointFromEvent(event) || { x: rect.left, y: rect.top };
        const offsetX = Math.max(0, Math.min(rect.width, p.x - rect.left));
        const offsetY = Math.max(0, Math.min(rect.height, p.y - rect.top));

        const ghostEl = createGhost(draggedEntry, rect);
        const indicatorEl = createIndicator();

        document.body.appendChild(ghostEl);
        document.body.appendChild(indicatorEl);

        state.dragSessionId = Date.now();
        state.indicatorDragActive = true;
        state.indicatorDragUid = uid;
        state.indicatorDragWorldName = getCurrentWorldName?.() || '';
        state.indicatorDragTargetPath = null;
        setDragVisualActive(true);

        state.activeIndicatorDrag = {
            sessionId: state.dragSessionId,
            worldName: state.indicatorDragWorldName,
            listElement,
            draggedSlot,
            draggedEntry,
            uid,
            offsetX,
            offsetY,
            ghostEl,
            indicatorEl,
            lastX: p.x,
            lastY: p.y,
        };

        const drop = computeDropPosition({ listElement, draggedSlot, draggedEntry, clientX: p.x, clientY: p.y });
        if (drop?.zone instanceof HTMLElement) {
            setIndicatorGeometry(indicatorEl, drop.zone, drop.indicatorTop);
        }

    }

    function onPointerMove(event) {
        const d = state.activeIndicatorDrag;
        if (!d || !state.indicatorDragActive) {
            return;
        }

        // For touch, prevent page scroll while dragging.
        if (event && typeof event === 'object' && String(event.type || '').startsWith('touch')) {
            try { event.preventDefault?.(); } catch { /* ignore */ }
        }

        const listElement = getListElement?.();
        if (!(listElement instanceof HTMLElement)) {
            return;
        }

        const p = getClientPointFromEvent(event);
        if (!p) {
            return;
        }

        d.lastX = p.x;
        d.lastY = p.y;

        const gx = p.x - d.offsetX;
        const gy = p.y - d.offsetY;
        d.ghostEl.style.transform = `translate3d(${Math.round(gx)}px, ${Math.round(gy)}px, 0)`;

        // Hover expand / header target UI
        const snapshot = getDragHoverSnapshot(event, listElement);
        setHoverHeaderDropTarget(snapshot.header);
        if (snapshot.header) {
            d.indicatorEl.style.opacity = '0';
            scheduleDragHoverExpand(snapshot.header);
            return;
        }

        d.indicatorEl.style.opacity = '1';
        clearDragHoverExpandTimer();

        const drop = computeDropPosition({ listElement, draggedSlot: d.draggedSlot, draggedEntry: d.draggedEntry, clientX: p.x, clientY: p.y });
        if (drop?.zone instanceof HTMLElement) {
            setIndicatorGeometry(d.indicatorEl, drop.zone, drop.indicatorTop);
        }
    }

    function onPointerUp(event) {
        if (!state.activeIndicatorDrag) {
            return;
        }

        endActiveIndicatorDrag({ commit: true, event });
    }

    function cleanupRootDropzones(hostElement) {
        if (!(hostElement instanceof HTMLElement)) {
            return;
        }

        const rootZones = Array.from(hostElement.querySelectorAll(':scope > .wihm-root-dropzone'));
        for (const zone of rootZones) {
            if (!(zone instanceof HTMLElement)) {
                continue;
            }

            const slots = Array.from(zone.querySelectorAll(':scope > .wihm-entry-slot'));
            for (const slot of slots) {
                hostElement.appendChild(slot);
            }

            zone.remove();
        }
    }

    function ensureRootDropzones(listElement) {
        if (!(listElement instanceof HTMLElement)) {
            return;
        }

        const hostElement = listElement.querySelector('.wihm-tree-host');
        if (!(hostElement instanceof HTMLElement)) {
            return;
        }

        cleanupRootDropzones(hostElement);

        const groups = Array.from(hostElement.querySelectorAll(':scope > .wihm-tree-group'));
        const makeRootZone = (index) => {
            const zone = document.createElement('div');
            zone.className = 'wihm-folder-dropzone wihm-root-dropzone';
            zone.dataset.folderPath = '';
            zone.dataset.rootDropzoneIndex = String(index);
            return zone;
        };

        let index = 0;
        const firstZone = makeRootZone(index++);
        hostElement.insertBefore(firstZone, groups[0] ?? null);

        for (const group of groups) {
            group.after(makeRootZone(index++));
        }
    }

    async function persistDragSortChanges(worldName, listElement) {
        if (state.dragSortSaving) {
            return;
        }

        state.dragSortSaving = true;

        try {
            const worldData = await ctx?.loadWorldInfo?.(worldName);
            if (!worldData || typeof worldData !== 'object' || !worldData.entries) {
                return;
            }

            ensureWorldHierarchyData(worldData);

            let changed = false;

            const folderZones = Array.from(listElement.querySelectorAll('.wihm-folder-dropzone'));
            for (const zone of folderZones) {
                if (!(zone instanceof HTMLElement)) {
                    continue;
                }

                const folderPath = normalizePathChain(zone.dataset.folderPath || '');
                const slotEntries = Array.from(zone.querySelectorAll(':scope > .wihm-entry-slot > .world_entry'));

                for (const entryElement of slotEntries) {
                    const uid = getEntryUidFromElement(entryElement);
                    if (!Number.isFinite(uid) || !worldData.entries[uid]) {
                        continue;
                    }

                    const result = setEntryPath(worldData.entries[uid], folderPath);
                    changed = changed || result.changed;
                }
            }

            if (isCustomSortMode?.()) {
                const orderedEntries = Array.from(listElement.querySelectorAll('.world_entry'));
                const firstUid = getEntryUidFromElement(orderedEntries[0]);
                const minDisplayIndex = Number.isFinite(firstUid)
                    ? Number(worldData.entries[firstUid]?.displayIndex ?? 0)
                    : 0;

                for (let index = 0; index < orderedEntries.length; index++) {
                    const uid = getEntryUidFromElement(orderedEntries[index]);
                    if (!Number.isFinite(uid) || !worldData.entries[uid]) {
                        continue;
                    }

                    const entry = worldData.entries[uid];
                    const nextDisplayIndex = minDisplayIndex + index;

                    if (Number(entry.displayIndex) !== nextDisplayIndex) {
                        entry.displayIndex = nextDisplayIndex;
                        entry.extensions = entry.extensions && typeof entry.extensions === 'object' && !Array.isArray(entry.extensions)
                            ? entry.extensions
                            : {};
                        entry.extensions.display_index = nextDisplayIndex;
                        changed = true;
                    }
                }
            }

            if (!changed) {
                return;
            }

            await dataSync?.ensureNormalized?.(worldName, worldData, { saveIfChanged: true, forceSave: true });
            invalidateDigest?.();
            refresh?.('drag-cross-folder-save');

        } finally {
            state.dragSortSaving = false;
        }
    }

    function destroy(listElement = null) {
        clearDragHoverExpandTimer();
        resetIndicatorDragState();
        clearHoverDropzone();

        const jq = getJQuerySafe?.();
        if (!jq || !jq.fn?.sortable) {
            return;
        }

        const hostElement = listElement instanceof HTMLElement ? listElement : getListElement?.();
        if (!(hostElement instanceof HTMLElement)) {
            return;
        }

        const $zones = jq(hostElement).find('.wihm-folder-dropzone');
        $zones.each(function () {
            const zone = jq(this);
            try {
                if (zone.sortable('instance')) {
                    zone.sortable('destroy');
                }
            } catch {
                // ignore
            }
        });

        cleanupRootDropzones(hostElement);
    }

    function forceDropIntoHoverZone(ui, listElement) {
        const hoverZone = state.hoverDropzoneEl;
        const itemEl = ui?.item?.[0];

        if (!(hoverZone instanceof HTMLElement) || !(itemEl instanceof HTMLElement)) {
            return;
        }

        if (!(listElement instanceof HTMLElement) || !listElement.contains(hoverZone) || !listElement.contains(itemEl)) {
            return;
        }

        const currentZone = itemEl.parentElement;
        if (!(currentZone instanceof HTMLElement) || currentZone === hoverZone) {
            return;
        }

        hoverZone.appendChild(itemEl);
    }

    function setup(worldName, listElement) {
        const jq = getJQuerySafe?.();
        if (!jq || !jq.fn?.sortable) {
            return;
        }

        destroy(listElement);

        if (!isCustomSortMode?.()) {
            return;
        }

        ensureRootDropzones(listElement);

        if (isIndicatorEngineActive()) {
            // 指示线引擎下由全局 pointer 兼容逻辑接管，不启用嵌套 sortable，避免冲突误拖。
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
            cancel: 'input,textarea,select,button,.menu_button,.inline-drawer-toggle,.wihm-tree-group-actions,.wihm-tree-group-actions *',
            stop: (_event, ui) => {
                ui?.item?.removeClass?.('wihm-dragging-slot');
                clearDragHoverExpandTimer();
                forceDropIntoHoverZone(ui, listElement);
                clearHoverDropzone();
                setDragVisualActive(false);
                void persistDragSortChanges(worldName, listElement);
            },
            start: (_event, ui) => {
                ui?.item?.addClass?.('wihm-dragging-slot');
                clearDragHoverExpandTimer();
                clearHoverDropzone();
                setDragVisualActive(true);
            },
            sort: (event) => handleDragHoverUI(event, listElement),
        });
    }

    function bindGlobalListeners(addTrackedListener) {
        if (typeof addTrackedListener !== 'function') {
            return;
        }

        const onGlobalDragPointerDown = (event) => onPointerDown(event);
        const onGlobalDragPointerMove = (event) => onPointerMove(event);
        const onGlobalDragPointerUp = (event) => onPointerUp(event);

        const dragEventBindings = [
            ['pointerdown', onGlobalDragPointerDown],
            ['mousedown', onGlobalDragPointerDown],
            ['touchstart', onGlobalDragPointerDown],
            ['pointermove', onGlobalDragPointerMove],
            ['mousemove', onGlobalDragPointerMove],
            ['touchmove', onGlobalDragPointerMove],
            ['pointerup', onGlobalDragPointerUp],
            ['mouseup', onGlobalDragPointerUp],
            ['pointercancel', onGlobalDragPointerUp],
            ['touchend', onGlobalDragPointerUp],
            ['touchcancel', onGlobalDragPointerUp],
        ];

        for (const [type, handler] of dragEventBindings) {
            addTrackedListener(window, type, handler, true);
        }
    }

    return {
        destroy,
        setup,
        bindGlobalListeners,
        onPointerDown,
        onPointerMove,
        onPointerUp,
    };
}
