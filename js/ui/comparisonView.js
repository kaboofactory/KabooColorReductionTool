CRT.ui.ComparisonView = class {
    constructor(containerId, onSelect, onUpdate) {
        this.container = document.getElementById(containerId);
        this.onSelect = onSelect; // Callback when an item is clicked (for detail view or save)
        this.onUpdate = onUpdate; // Callback when items list changes
        this.items = []; // { id, canvas, config, imageData, label }
        this.zoom = 100; // Percentage
    }

    clear() {
        this.items = [];
        this.container.innerHTML = '<div class="empty-state">Load an image and apply an algorithm to start</div>';
        if (this.onUpdate) this.onUpdate(this.items);
    }

    clearProcessed() {
        // Keep only items without config (Original)
        this.items = this.items.filter(item => !item.config);
        this.container.innerHTML = '';

        if (this.items.length === 0) {
            this.container.innerHTML = '<div class="empty-state">Load an image and apply an algorithm to start</div>';
        } else {
            this.items.forEach(item => {
                this.renderItem(item);
            });
        }
        if (this.onUpdate) this.onUpdate(this.items);
    }

    addItem(imageData, config, label, edgeImageData = null) {
        // Remove empty state if present
        if (this.items.length === 0) {
            this.container.innerHTML = '';
        }

        const id = Date.now() + Math.random().toString(36).substr(2, 9);
        const item = { id, imageData, config, label, edgeImageData };
        this.items.push(item);
        this.renderItem(item);
        if (this.onUpdate) this.onUpdate(this.items);
    }

    removeItem(id) {
        this.items = this.items.filter(i => i.id !== id);
        this.container.innerHTML = '';

        if (this.items.length === 0) {
            this.container.innerHTML = '<div class="empty-state">Load an image and apply an algorithm to start</div>';
        } else {
            this.items.forEach(item => {
                this.renderItem(item);
            });
        }
        if (this.onUpdate) this.onUpdate(this.items);
    }

    renderItem(item) {
        const wrapper = document.createElement('div');
        wrapper.className = 'comparison-item';
        wrapper.style.backgroundColor = 'var(--panel-bg)';
        wrapper.style.border = '1px solid var(--border-color)';
        wrapper.style.borderRadius = '8px';
        wrapper.style.padding = '10px';
        wrapper.style.cursor = 'pointer';
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.gap = '10px';
        wrapper.style.transition = 'transform 0.2s';
        wrapper.style.position = 'relative';

        // Store element reference for updates
        item.element = wrapper;

        wrapper.onmouseenter = () => wrapper.style.borderColor = 'var(--accent-color)';
        wrapper.onmouseleave = () => wrapper.style.borderColor = 'var(--border-color)';
        wrapper.onclick = () => this.onSelect(item.id);

        const canvas = document.createElement('canvas');
        canvas.width = item.imageData.width;
        canvas.height = item.imageData.height;
        // Apply current zoom
        canvas.style.width = `${item.imageData.width * (this.zoom / 100)}px`;
        canvas.style.height = `${item.imageData.height * (this.zoom / 100)}px`;
        canvas.style.imageRendering = 'pixelated';
        canvas.style.borderRadius = '4px';

        const ctx = canvas.getContext('2d');
        ctx.putImageData(item.imageData, 0, 0);

        const info = document.createElement('div');
        info.innerHTML = `
            <div style="font-weight:600; font-size:0.9rem; margin-bottom:4px">${item.label || 'Image'}</div>
            <div style="font-size:0.8rem; color:#aaa; line-height:1.4">
                ${this.formatConfig(item.config)}
            </div>
        `;

        wrapper.appendChild(canvas);
        wrapper.appendChild(info);

        // Only allow deleting processed images, not the original
        if (item.config) {
            const delBtn = document.createElement('button');
            delBtn.textContent = '×';
            delBtn.style.position = 'absolute';
            delBtn.style.top = '5px';
            delBtn.style.right = '5px';
            delBtn.style.background = 'rgba(0,0,0,0.6)';
            delBtn.style.color = '#fff';
            delBtn.style.border = 'none';
            delBtn.style.borderRadius = '50%';
            delBtn.style.width = '24px';
            delBtn.style.height = '24px';
            delBtn.style.cursor = 'pointer';
            delBtn.style.display = 'flex';
            delBtn.style.alignItems = 'center';
            delBtn.style.justifyContent = 'center';
            delBtn.style.fontSize = '16px';
            delBtn.style.lineHeight = '1';

            delBtn.onclick = (e) => {
                e.stopPropagation();
                this.removeItem(item.id);
            };
            wrapper.appendChild(delBtn);
        }

        this.container.appendChild(wrapper);
    }

    formatConfig(config) {
        if (!config) return 'Original';
        let text = '';
        switch (config.type) {
            case 'nearest': text = 'Nearest Neighbor (RGB)'; break;
            case 'luma': text = 'Luma Weighted'; break;
            case 'cielab': text = 'Perceptual (CIELAB)'; break;
            case 'weighted': text = 'Weighted (HSV)'; break;
            default: text = config.type;
        }
        if (config.type === 'weighted') {
            text += `<br>H:${config.weights.h}% S:${config.weights.s}% V:${config.weights.v}%`;
        }
        if (config.edge && config.edge.enabled) {
            if (config.edge.algorithmEnabled) {
                text += `<br><span style="color:#f9e2af">Edge: ${config.edge.algorithm}</span>`;
                text += ` (${config.edge.threshold},${config.edge.huePriority})`;
            }
            if (config.edge.forceEdge && config.edge.forceEdge.enabled) {
                text += ` + Force(${config.edge.forceEdge.thresholdMin}-${config.edge.forceEdge.thresholdMax})`;
            }
            if (config.edge.forceEdge.outline && config.edge.forceEdge.outline.enabled) {
                text += ` + Outline(Op:${config.edge.forceEdge.outline.opacityMin}, Nb:${config.edge.forceEdge.outline.neighborMax})`;
            }

            const adj = config.edge.adjustments;
            if (adj.brightness !== 0) text += ` B:${adj.brightness}`;
            if (adj.contrast !== 0) text += ` C:${adj.contrast}`;
            if (adj.saturation !== 0) text += ` S:${adj.saturation}`;
            if (adj.hue !== 0) text += ` H:${adj.hue}`;
        }

        // Pre-processing display
        if (config.preProcess && config.preProcess.enabled) {
            const p = config.preProcess;
            const parts = [];
            if (p.r !== 0) parts.push(`R:${p.r > 0 ? '+' : ''}${p.r}`);
            if (p.g !== 0) parts.push(`G:${p.g > 0 ? '+' : ''}${p.g}`);
            if (p.b !== 0) parts.push(`B:${p.b > 0 ? '+' : ''}${p.b}`);
            if (p.brightness !== 0) parts.push(`Bright:${p.brightness > 0 ? '+' : ''}${p.brightness}`);
            if (p.contrast !== 0) parts.push(`Cont:${p.contrast > 0 ? '+' : ''}${p.contrast}`);
            if (p.saturation !== 0) parts.push(`Sat:${p.saturation > 0 ? '+' : ''}${p.saturation}`);
            if (p.gamma !== 1.0) parts.push(`Gam:${p.gamma}`);

            if (parts.length > 0) {
                text += `<br><span style="color:#89b4fa">Pre: ${parts.join(' ')}</span>`;
            }
        }
        return text;
    }

    getItem(id) {
        return this.items.find(i => i.id === id);
    }

    hasDuplicate(newConfig) {
        // Deep comparison of config objects
        return this.items.some(item => {
            const c = item.config;
            if (!c) return false; // Skip original

            // 1. Check Algorithm Type
            if (c.type !== newConfig.type) return false;

            // 2. Check Pre-processing
            const p1 = c.preProcess;
            const p2 = newConfig.preProcess;

            // Check enabled state
            if (p1.enabled !== p2.enabled) return false;

            // If both are enabled, check values
            if (p1.enabled) {
                if (p1.r !== p2.r || p1.g !== p2.g || p1.b !== p2.b ||
                    p1.brightness !== p2.brightness || p1.contrast !== p2.contrast ||
                    p1.saturation !== p2.saturation || p1.gamma !== p2.gamma) {
                    return false;
                }
            }

            // 3. Check Algorithm Params
            if (c.type === 'weighted') {
                if (c.weights.h !== newConfig.weights.h ||
                    c.weights.s !== newConfig.weights.s ||
                    c.weights.v !== newConfig.weights.v) {
                    return false;
                }
            }

            // 4. Check Edge Post-processing
            const e1 = c.edge;
            const e2 = newConfig.edge;

            if (e1.enabled !== e2.enabled) return false;
            if (e1.enabled) {
                if (e1.forceEdge.enabled !== e2.forceEdge.enabled) return false;
                if (e1.forceEdge.enabled) {
                    if (e1.forceEdge.thresholdMin !== e2.forceEdge.thresholdMin) return false;
                    if (e1.forceEdge.thresholdMax !== e2.forceEdge.thresholdMax) return false;
                }

                const o1 = e1.forceEdge.outline;
                const o2 = e2.forceEdge.outline;
                const o1En = o1 ? o1.enabled : false;
                const o2En = o2 ? o2.enabled : false;
                if (o1En !== o2En) return false;
                if (o1En) {
                    if (o1.opacityMin !== o2.opacityMin) return false;
                    if (o1.neighborMax !== o2.neighborMax) return false;
                }

                if (e1.algorithmEnabled !== e2.algorithmEnabled) return false;
                if (e1.algorithmEnabled) {
                    if (e1.algorithm !== e2.algorithm) return false;
                    if (e1.threshold !== e2.threshold) return false;
                    if (e1.huePriority !== e2.huePriority) return false;
                }

                const a1 = e1.adjustments;
                const a2 = e2.adjustments;
                if (a1.brightness !== a2.brightness || a1.contrast !== a2.contrast ||
                    a1.saturation !== a2.saturation || a1.hue !== a2.hue) {
                    return false;
                }
            }

            return true;
        });
    }

    setZoom(zoom) {
        this.zoom = zoom;
        this.items.forEach(item => {
            const canvas = item.element.querySelector('canvas');
            if (canvas) {
                canvas.style.width = `${item.imageData.width * (this.zoom / 100)}px`;
                canvas.style.height = `${item.imageData.height * (this.zoom / 100)}px`;
            }
        });
    }
};
