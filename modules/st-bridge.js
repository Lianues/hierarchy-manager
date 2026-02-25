export function getContextSafe() {
    try {
        return globalThis.SillyTavern?.getContext?.() ?? null;
    } catch {
        return null;
    }
}

export function getJQuerySafe() {
    const jq = globalThis.jQuery;
    if (typeof jq === 'function') {
        return jq;
    }

    return null;
}

export function getCurrentWorldName() {
    const selector = document.getElementById('world_editor_select');

    if (!(selector instanceof HTMLSelectElement)) {
        return '';
    }

    const selectedOption = selector.options[selector.selectedIndex];
    if (!(selectedOption instanceof HTMLOptionElement)) {
        return '';
    }

    const rawText = String(selectedOption.textContent || '').trim();
    const rawValue = String(selectedOption.value || '').trim();

    if (!rawText || !rawValue) {
        return '';
    }

    if (rawText.startsWith('---')) {
        return '';
    }

    return rawText;
}

export function debounceAsync(asyncFn, delayMs = 200) {
    let timer = null;
    let lastPromiseResolve = null;

    return (...args) => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }

        if (typeof lastPromiseResolve === 'function') {
            lastPromiseResolve(false);
            lastPromiseResolve = null;
        }

        return new Promise((resolve) => {
            lastPromiseResolve = resolve;

            timer = setTimeout(async () => {
                timer = null;
                lastPromiseResolve = null;

                try {
                    await asyncFn(...args);
                    resolve(true);
                } catch (error) {
                    console.error(error);
                    resolve(false);
                }
            }, delayMs);
        });
    };
}
