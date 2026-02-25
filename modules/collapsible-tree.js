function safeText(input) {
    return String(input ?? '').trim();
}

function getLeafCount(node) {
    if (!node || typeof node !== 'object') {
        return 0;
    }

    if (node.kind === 'leaf') {
        return 1;
    }

    if (!Array.isArray(node.children)) {
        return 0;
    }

    let count = 0;
    for (const child of node.children) {
        count += getLeafCount(child);
    }

    return count;
}

export class CollapsibleTree {
    /**
     * @param {object} options
     * @param {HTMLElement} options.container
     * @param {any[]} options.nodes
     * @param {string} options.storageKey
     * @param {(node: any) => HTMLElement} [options.renderLeaf]
     */
    constructor(options) {
        this.container = options.container;
        this.nodes = Array.isArray(options.nodes) ? options.nodes : [];
        this.storageKey = safeText(options.storageKey) || 'wihm-tree-expanded';
        this.renderLeaf = typeof options.renderLeaf === 'function' ? options.renderLeaf : null;

        this._expanded = this._readExpandedSet();
        this._destroyed = false;
    }

    setNodes(nodes) {
        this.nodes = Array.isArray(nodes) ? nodes : [];
    }

    destroy() {
        this._destroyed = true;

        if (this.container instanceof HTMLElement) {
            this.container.innerHTML = '';
        }
    }

    render() {
        if (this._destroyed || !(this.container instanceof HTMLElement)) {
            return;
        }

        this.container.innerHTML = '';

        for (const node of this.nodes) {
            const rendered = this._renderNode(node);
            if (rendered instanceof HTMLElement) {
                this.container.appendChild(rendered);
            }
        }
    }

    _readExpandedSet() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            const parsed = JSON.parse(raw || '[]');
            const list = Array.isArray(parsed) ? parsed : [];
            return new Set(list.map(x => String(x)));
        } catch {
            return new Set();
        }
    }

    _writeExpandedSet() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(Array.from(this._expanded.values())));
        } catch {
            // ignore
        }
    }

    _isExpanded(nodeId) {
        return this._expanded.has(String(nodeId));
    }

    _setExpanded(nodeId, expanded) {
        const key = String(nodeId);

        if (expanded) {
            this._expanded.add(key);
        } else {
            this._expanded.delete(key);
        }

        this._writeExpandedSet();
    }

    _renderNode(node) {
        if (!node || typeof node !== 'object') {
            return null;
        }

        if (node.kind === 'leaf') {
            return this._renderLeafNode(node);
        }

        if (node.kind === 'group') {
            return this._renderGroupNode(node);
        }

        return null;
    }

    _renderLeafNode(node) {
        if (this.renderLeaf) {
            const custom = this.renderLeaf(node);
            if (custom instanceof HTMLElement) {
                return custom;
            }
        }

        const leaf = document.createElement('div');
        leaf.className = 'wihm-tree-leaf';
        leaf.textContent = safeText(node.label || node.id || 'Leaf');
        return leaf;
    }

    _renderGroupNode(node) {
        const nodeId = String(node.id || node.label || Math.random());
        const expanded = this._isExpanded(nodeId) || Boolean(node.defaultExpanded);
        const leafCount = Number.isFinite(Number(node?.meta?.leafCount))
            ? Math.max(0, Number(node.meta.leafCount))
            : getLeafCount(node);

        const group = document.createElement('section');
        group.className = 'wihm-tree-group';
        group.dataset.nodeId = nodeId;

        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'wihm-tree-group-header';
        header.setAttribute('aria-expanded', expanded ? 'true' : 'false');

        const left = document.createElement('span');
        left.className = 'wihm-tree-group-left';

        const caret = document.createElement('span');
        caret.className = 'wihm-tree-group-caret';
        caret.textContent = expanded ? '▾' : '▸';

        const label = document.createElement('span');
        label.className = 'wihm-tree-group-label';
        label.textContent = safeText(node.label || node.id || 'Folder');

        left.append(caret, label);

        const actions = Array.isArray(node?.meta?.actions) ? node.meta.actions : [];

        const right = document.createElement('span');
        right.className = 'wihm-tree-group-right';

        const count = document.createElement('span');
        count.className = 'wihm-tree-group-count';
        count.textContent = leafCount > 0 ? String(leafCount) : '';
        right.appendChild(count);

        if (actions.length > 0) {
            const actionWrap = document.createElement('span');
            actionWrap.className = 'wihm-tree-group-actions';

            for (const action of actions) {
                if (!action || typeof action !== 'object') {
                    continue;
                }

                const actionButton = document.createElement('div');
                actionButton.className = safeText(action.className) || 'menu_button interactable';
                actionButton.title = safeText(action.title);
                actionButton.setAttribute('role', 'button');
                actionButton.setAttribute('aria-label', safeText(action.title));
                if (safeText(action.dataI18n)) {
                    actionButton.setAttribute('data-i18n', safeText(action.dataI18n));
                }

                actionButton.tabIndex = 0;

                const clickHandler = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (typeof action.onClick === 'function') {
                        action.onClick(node);
                    }
                };

                actionButton.addEventListener('click', clickHandler);
                actionButton.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        clickHandler(event);
                    }
                });

                actionWrap.appendChild(actionButton);
            }

            right.appendChild(actionWrap);
        }

        header.append(left, right);

        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'wihm-tree-group-children';
        childrenContainer.classList.add('wihm-folder-dropzone');
        childrenContainer.dataset.folderPath = safeText(node?.meta?.path);
        childrenContainer.style.display = expanded ? '' : 'none';

        for (const child of Array.isArray(node.children) ? node.children : []) {
            const rendered = this._renderNode(child);
            if (rendered instanceof HTMLElement) {
                childrenContainer.appendChild(rendered);
            }
        }

        header.addEventListener('click', () => {
            const currentExpanded = header.getAttribute('aria-expanded') === 'true';
            const nextExpanded = !currentExpanded;

            header.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
            caret.textContent = nextExpanded ? '▾' : '▸';
            childrenContainer.style.display = nextExpanded ? '' : 'none';

            this._setExpanded(nodeId, nextExpanded);
        });

        group.append(header, childrenContainer);
        return group;
    }
}
