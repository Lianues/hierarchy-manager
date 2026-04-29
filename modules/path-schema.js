export const ENTRY_PATH_KEY = 'path_chain';
export const FOLDER_PATHS_KEY = 'folder_paths';

function pathLocaleCompare(a, b) {
    const depthA = a ? a.split('/').length : 0;
    const depthB = b ? b.split('/').length : 0;

    if (depthA !== depthB) {
        return depthA - depthB;
    }

    return String(a).localeCompare(String(b), 'zh-Hans-CN');
}

function sameStringArray(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
        return false;
    }

    if (left.length !== right.length) {
        return false;
    }

    for (let i = 0; i < left.length; i++) {
        if (String(left[i]) !== String(right[i])) {
            return false;
        }
    }

    return true;
}

export function normalizePathChain(input) {
    const value = typeof input === 'string' ? input : String(input ?? '');

    return value
        .split('/')
        .map(x => x.trim())
        .filter(Boolean)
        .join('/');
}

export function splitPathChain(pathChain) {
    const normalized = normalizePathChain(pathChain);

    if (!normalized) {
        return [];
    }

    return normalized.split('/').filter(Boolean);
}

export function expandParentPaths(pathChain) {
    const segments = splitPathChain(pathChain);
    const paths = [];

    for (let i = 1; i <= segments.length; i++) {
        paths.push(segments.slice(0, i).join('/'));
    }

    return paths;
}

export function normalizeFolderPaths(folderPaths) {
    const folderSet = new Set();

    if (Array.isArray(folderPaths)) {
        for (const rawPath of folderPaths) {
            const normalized = normalizePathChain(rawPath);
            if (!normalized) {
                continue;
            }

            for (const parentPath of expandParentPaths(normalized)) {
                folderSet.add(parentPath);
            }
        }
    }

    return Array.from(folderSet).sort(pathLocaleCompare);
}

export function getEntryPath(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return '';
    }

    // 优先读顶层 path_chain；缺失时回退到 extensions.path_chain。
    // 后者是 elegant-character-card / 其他工具为穿透 SillyTavern 的 character_book→world_info
    // 导入流程而采用的承载位置（顶层非 spec 字段会被静默丢弃，extensions 会原样保留）。
    const topLevel = entry[ENTRY_PATH_KEY];
    if (typeof topLevel === 'string' && topLevel.trim()) {
        return normalizePathChain(topLevel);
    }

    const ext = entry.extensions;
    if (ext && typeof ext === 'object' && !Array.isArray(ext)) {
        const fromExt = ext[ENTRY_PATH_KEY];
        if (typeof fromExt === 'string') {
            return normalizePathChain(fromExt);
        }
    }

    return normalizePathChain(topLevel ?? '');
}

export function setEntryPath(entry, pathChain) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return { changed: false, normalizedPath: '' };
    }

    const normalizedPath = normalizePathChain(pathChain);
    const previousPath = normalizePathChain(entry[ENTRY_PATH_KEY] ?? '');

    const changed = normalizedPath !== previousPath || entry[ENTRY_PATH_KEY] === undefined;

    if (changed) {
        entry[ENTRY_PATH_KEY] = normalizedPath;
    }

    return { changed, normalizedPath };
}

export function ensureWorldHierarchyData(worldData) {
    let changed = false;

    if (!worldData || typeof worldData !== 'object' || Array.isArray(worldData)) {
        return { changed: false, worldData };
    }

    if (!worldData.entries || typeof worldData.entries !== 'object' || Array.isArray(worldData.entries)) {
        worldData.entries = {};
        changed = true;
    }

    const entryPaths = [];

    for (const entry of Object.values(worldData.entries)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            continue;
        }

        const previousPath = entry[ENTRY_PATH_KEY];
        // 顶层缺失时回退 extensions.path_chain（兼容由 character_book 导入而来的世界书）
        let sourcePath = previousPath;
        if ((typeof sourcePath !== 'string' || !sourcePath.trim())
            && entry.extensions && typeof entry.extensions === 'object' && !Array.isArray(entry.extensions)
            && typeof entry.extensions[ENTRY_PATH_KEY] === 'string') {
            sourcePath = entry.extensions[ENTRY_PATH_KEY];
        }
        const normalizedPath = normalizePathChain(sourcePath ?? '');

        if (previousPath !== normalizedPath) {
            entry[ENTRY_PATH_KEY] = normalizedPath;
            changed = true;
        }

        if (normalizedPath) {
            entryPaths.push(normalizedPath);
        }
    }

    // 顶层 folder_paths 缺失时回退 extensions.folder_paths（同上理由）
    let sourceFolderPaths = Array.isArray(worldData[FOLDER_PATHS_KEY])
        ? worldData[FOLDER_PATHS_KEY]
        : null;
    if (!sourceFolderPaths
        && worldData.extensions && typeof worldData.extensions === 'object' && !Array.isArray(worldData.extensions)
        && Array.isArray(worldData.extensions[FOLDER_PATHS_KEY])) {
        sourceFolderPaths = worldData.extensions[FOLDER_PATHS_KEY];
    }

    const desiredFolderPaths = normalizeFolderPaths([
        ...(Array.isArray(sourceFolderPaths) ? sourceFolderPaths : []),
        ...entryPaths,
    ]);

    const currentFolderPaths = Array.isArray(worldData[FOLDER_PATHS_KEY]) ? worldData[FOLDER_PATHS_KEY] : [];

    if (!sameStringArray(currentFolderPaths, desiredFolderPaths)) {
        worldData[FOLDER_PATHS_KEY] = desiredFolderPaths;
        changed = true;
    }

    return { changed, worldData };
}

export function ensurePromptHierarchyData(promptSettings) {
    let changed = false;

    if (!promptSettings || typeof promptSettings !== 'object' || Array.isArray(promptSettings)) {
        return { changed: false, promptSettings };
    }

    if (!Array.isArray(promptSettings.prompts)) {
        promptSettings.prompts = [];
        changed = true;
    }

    const entryPaths = [];

    for (const prompt of promptSettings.prompts) {
        if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
            continue;
        }

        const previousPath = prompt[ENTRY_PATH_KEY];
        const normalizedPath = normalizePathChain(previousPath ?? '');

        if (previousPath !== normalizedPath) {
            prompt[ENTRY_PATH_KEY] = normalizedPath;
            changed = true;
        }

        if (normalizedPath) {
            entryPaths.push(normalizedPath);
        }
    }

    const desiredFolderPaths = normalizeFolderPaths([
        ...(Array.isArray(promptSettings[FOLDER_PATHS_KEY]) ? promptSettings[FOLDER_PATHS_KEY] : []),
        ...entryPaths,
    ]);

    const currentFolderPaths = Array.isArray(promptSettings[FOLDER_PATHS_KEY]) ? promptSettings[FOLDER_PATHS_KEY] : [];

    if (!sameStringArray(currentFolderPaths, desiredFolderPaths)) {
        promptSettings[FOLDER_PATHS_KEY] = desiredFolderPaths;
        changed = true;
    }

    return { changed, promptSettings };
}
