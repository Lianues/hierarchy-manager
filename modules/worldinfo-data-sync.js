import { ensureWorldHierarchyData } from './path-schema.js';

export function createWorldInfoDataSync(ctx, { getSettings, extensionName = 'hierarchy-manager' } = {}) {
    const internalSavingWorlds = new Set();
    const listeners = [];
    let started = false;

    function logDebug(...args) {
        if (!getSettings?.()?.debugLog) {
            return;
        }

        console.debug(`[${extensionName}:data-sync]`, ...args);
    }

    function isInternalSave(worldName) {
        return internalSavingWorlds.has(String(worldName || ''));
    }

    async function ensureNormalized(worldName, worldData, { saveIfChanged = true, forceSave = false } = {}) {
        if (!worldName || !worldData) {
            return { changed: false, saved: false };
        }

        const { changed } = ensureWorldHierarchyData(worldData);
        const shouldSave = forceSave || changed;

        if (!shouldSave || !saveIfChanged) {
            return { changed: shouldSave, saved: false };
        }

        if (isInternalSave(worldName)) {
            return { changed: shouldSave, saved: false };
        }

        if (typeof ctx?.saveWorldInfo !== 'function') {
            return { changed: shouldSave, saved: false };
        }

        internalSavingWorlds.add(String(worldName));

        try {
            logDebug('保存规范化世界书字段', worldName);
            await ctx.saveWorldInfo(worldName, worldData, true);
            return { changed: shouldSave, saved: true };
        } catch (error) {
            console.warn(`[${extensionName}:data-sync] 规范化保存失败`, worldName, error);
            return { changed: true, saved: false, error };
        } finally {
            internalSavingWorlds.delete(String(worldName));
        }
    }

    async function handleWorldInfoUpdated(worldName, worldData) {
        if (!worldName || !worldData) {
            return;
        }

        await ensureNormalized(worldName, worldData, { saveIfChanged: true });
    }

    function start() {
        if (started) {
            return;
        }

        const eventSource = ctx?.eventSource;
        const eventTypes = ctx?.eventTypes;

        if (!eventSource?.on || !eventTypes?.WORLDINFO_UPDATED) {
            console.warn(`[${extensionName}:data-sync] WORLDINFO_UPDATED 事件不可用，自动规范化停用`);
            return;
        }

        eventSource.on(eventTypes.WORLDINFO_UPDATED, handleWorldInfoUpdated);
        listeners.push({ eventName: eventTypes.WORLDINFO_UPDATED, handler: handleWorldInfoUpdated });

        started = true;
        logDebug('started');
    }

    function stop() {
        if (!started) {
            return;
        }

        const eventSource = ctx?.eventSource;
        if (eventSource?.removeListener) {
            for (const item of listeners) {
                eventSource.removeListener(item.eventName, item.handler);
            }
        }

        listeners.length = 0;
        started = false;
        logDebug('stopped');
    }

    return {
        start,
        stop,
        ensureNormalized,
        isInternalSave,
    };
}
