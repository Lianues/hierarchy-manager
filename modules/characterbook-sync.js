import { ENTRY_PATH_KEY, FOLDER_PATHS_KEY, ensureWorldHierarchyData, getEntryPath } from './path-schema.js';

function getCharacterBookExtensions(existingBook) {
    const value = existingBook?.extensions;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return structuredClone(value);
    }

    return {};
}

function sortWorldEntries(entriesMap) {
    return Object.values(entriesMap || {})
        .filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry))
        .sort((left, right) => {
            const leftDisplay = Number.isFinite(Number(left.displayIndex)) ? Number(left.displayIndex) : Number(left.uid ?? 0);
            const rightDisplay = Number.isFinite(Number(right.displayIndex)) ? Number(right.displayIndex) : Number(right.uid ?? 0);

            if (leftDisplay !== rightDisplay) {
                return leftDisplay - rightDisplay;
            }

            return Number(left.uid ?? 0) - Number(right.uid ?? 0);
        });
}

function convertWorldEntryToCharacterBookEntry(entry) {
    const uid = Number(entry.uid ?? 0);

    return {
        id: uid,
        keys: Array.isArray(entry.key) ? [...entry.key] : [],
        secondary_keys: Array.isArray(entry.keysecondary) ? [...entry.keysecondary] : [],
        comment: String(entry.comment || ''),
        content: String(entry.content || ''),
        constant: Boolean(entry.constant),
        selective: Boolean(entry.selective),
        insertion_order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : 0,
        enabled: !Boolean(entry.disable),
        position: Number(entry.position) === 0 ? 'before_char' : 'after_char',
        use_regex: true,
        [ENTRY_PATH_KEY]: getEntryPath(entry),
        extensions: {
            ...(entry.extensions && typeof entry.extensions === 'object' && !Array.isArray(entry.extensions)
                ? structuredClone(entry.extensions)
                : {}),
            position: Number.isFinite(Number(entry.position)) ? Number(entry.position) : 0,
            exclude_recursion: Boolean(entry.excludeRecursion),
            display_index: Number.isFinite(Number(entry.displayIndex)) ? Number(entry.displayIndex) : uid,
            probability: entry.probability ?? null,
            useProbability: entry.useProbability ?? false,
            depth: entry.depth ?? 4,
            selectiveLogic: entry.selectiveLogic ?? 0,
            outlet_name: entry.outletName ?? '',
            group: entry.group ?? '',
            group_override: entry.groupOverride ?? false,
            group_weight: entry.groupWeight ?? null,
            prevent_recursion: entry.preventRecursion ?? false,
            delay_until_recursion: entry.delayUntilRecursion ?? false,
            scan_depth: entry.scanDepth ?? null,
            match_whole_words: entry.matchWholeWords ?? null,
            use_group_scoring: entry.useGroupScoring ?? false,
            case_sensitive: entry.caseSensitive ?? null,
            automation_id: entry.automationId ?? '',
            role: entry.role ?? 0,
            vectorized: entry.vectorized ?? false,
            sticky: entry.sticky ?? null,
            cooldown: entry.cooldown ?? null,
            delay: entry.delay ?? null,
            match_persona_description: entry.matchPersonaDescription ?? false,
            match_character_description: entry.matchCharacterDescription ?? false,
            match_character_personality: entry.matchCharacterPersonality ?? false,
            match_character_depth_prompt: entry.matchCharacterDepthPrompt ?? false,
            match_scenario: entry.matchScenario ?? false,
            match_creator_notes: entry.matchCreatorNotes ?? false,
            triggers: Array.isArray(entry.triggers) ? [...entry.triggers] : [],
            ignore_budget: entry.ignoreBudget ?? false,
        },
    };
}

function buildCharacterBook(worldName, worldData, existingCharacterBook) {
    const normalizedWorldName = String(worldName || '').trim();
    const sortedEntries = sortWorldEntries(worldData.entries);

    return {
        name: existingCharacterBook?.name || normalizedWorldName,
        description: existingCharacterBook?.description || '',
        scan_depth: existingCharacterBook?.scan_depth,
        token_budget: existingCharacterBook?.token_budget,
        recursive_scanning: existingCharacterBook?.recursive_scanning,
        extensions: getCharacterBookExtensions(existingCharacterBook),
        [FOLDER_PATHS_KEY]: Array.isArray(worldData[FOLDER_PATHS_KEY])
            ? [...worldData[FOLDER_PATHS_KEY]]
            : [],
        entries: sortedEntries.map(convertWorldEntryToCharacterBookEntry),
    };
}

function updateCharacterLocalCache(character, characterBook) {
    if (!character || typeof character !== 'object') {
        return;
    }

    if (!character.data || typeof character.data !== 'object') {
        character.data = {};
    }

    character.data.character_book = structuredClone(characterBook);

    if (typeof character.json_data === 'string' && character.json_data.trim()) {
        try {
            const jsonData = JSON.parse(character.json_data);
            if (!jsonData.data || typeof jsonData.data !== 'object') {
                jsonData.data = {};
            }

            jsonData.data.character_book = structuredClone(characterBook);
            character.json_data = JSON.stringify(jsonData);
        } catch {
            // ignore broken json_data
        }
    }
}

export function createCharacterBookSync(ctx, { getSettings, extensionName = 'hierarchy-manager' } = {}) {
    const listeners = [];
    const pendingTimers = new Map();
    let started = false;

    function logDebug(...args) {
        if (!getSettings?.()?.debugLog) {
            return;
        }

        console.debug(`[${extensionName}:characterbook-sync]`, ...args);
    }

    function canSync() {
        return Boolean(getSettings?.()?.autoSyncCharacterBook);
    }

    async function syncWorldToCharacters(worldName, worldData = null) {
        if (!canSync()) {
            return;
        }

        const normalizedWorldName = String(worldName || '').trim();
        if (!normalizedWorldName) {
            return;
        }

        const activeWorldData = worldData || await ctx?.loadWorldInfo?.(normalizedWorldName);
        if (!activeWorldData || typeof activeWorldData !== 'object') {
            return;
        }

        ensureWorldHierarchyData(activeWorldData);

        const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
        const targets = characters.filter(character => {
            const linkedWorld = character?.data?.extensions?.world;
            return typeof linkedWorld === 'string' && linkedWorld === normalizedWorldName;
        });

        if (targets.length === 0) {
            return;
        }

        for (const targetCharacter of targets) {
            const avatar = targetCharacter?.avatar;
            if (!avatar) {
                continue;
            }

            const currentBook = targetCharacter?.data?.character_book;
            const nextBook = buildCharacterBook(normalizedWorldName, activeWorldData, currentBook);

            const requestBody = {
                avatar,
                data: {
                    character_book: nextBook,
                },
            };

            try {
                const response = await fetch('/api/characters/merge-attributes', {
                    method: 'POST',
                    headers: ctx?.getRequestHeaders?.() || {},
                    body: JSON.stringify(requestBody),
                });

                if (!response.ok) {
                    console.warn(`[${extensionName}:characterbook-sync] 同步角色失败`, avatar, response.statusText);
                    continue;
                }

                updateCharacterLocalCache(targetCharacter, nextBook);
                logDebug('同步角色成功', avatar, normalizedWorldName);
            } catch (error) {
                console.warn(`[${extensionName}:characterbook-sync] 同步角色异常`, avatar, error);
            }
        }
    }

    function queueWorldSync(worldName, worldData = null, delay = 500) {
        if (!canSync()) {
            return;
        }

        const normalizedWorldName = String(worldName || '').trim();
        if (!normalizedWorldName) {
            return;
        }

        if (pendingTimers.has(normalizedWorldName)) {
            clearTimeout(pendingTimers.get(normalizedWorldName));
            pendingTimers.delete(normalizedWorldName);
        }

        const timer = setTimeout(() => {
            pendingTimers.delete(normalizedWorldName);
            void syncWorldToCharacters(normalizedWorldName, worldData);
        }, delay);

        pendingTimers.set(normalizedWorldName, timer);
    }

    function handleWorldInfoUpdated(worldName, worldData) {
        queueWorldSync(worldName, worldData, 600);
    }

    function handleCharacterEdited(event) {
        const character = event?.detail?.character;
        const linkedWorld = character?.data?.extensions?.world;

        if (typeof linkedWorld === 'string' && linkedWorld.trim()) {
            queueWorldSync(linkedWorld, null, 700);
        }
    }

    function start() {
        if (started) {
            return;
        }

        const eventSource = ctx?.eventSource;
        const eventTypes = ctx?.eventTypes;

        if (!eventSource?.on || !eventTypes) {
            console.warn(`[${extensionName}:characterbook-sync] 事件系统不可用，自动同步停用`);
            return;
        }

        if (eventTypes.WORLDINFO_UPDATED) {
            eventSource.on(eventTypes.WORLDINFO_UPDATED, handleWorldInfoUpdated);
            listeners.push({ eventName: eventTypes.WORLDINFO_UPDATED, handler: handleWorldInfoUpdated });
        }

        if (eventTypes.CHARACTER_EDITED) {
            eventSource.on(eventTypes.CHARACTER_EDITED, handleCharacterEdited);
            listeners.push({ eventName: eventTypes.CHARACTER_EDITED, handler: handleCharacterEdited });
        }

        started = true;
        logDebug('started');
    }

    function stop() {
        if (!started) {
            return;
        }

        if (ctx?.eventSource?.removeListener) {
            for (const listener of listeners) {
                ctx.eventSource.removeListener(listener.eventName, listener.handler);
            }
        }

        listeners.length = 0;

        for (const timer of pendingTimers.values()) {
            clearTimeout(timer);
        }
        pendingTimers.clear();

        started = false;
        logDebug('stopped');
    }

    return {
        start,
        stop,
        queueWorldSync,
        syncWorldToCharacters,
    };
}
