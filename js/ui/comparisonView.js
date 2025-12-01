CRT.ui.ComparisonView = class {
    constructor(containerId, onSelect) {
        this.container = document.getElementById(containerId);
        this.onSelect = onSelect; // Callback when an item is clicked (for detail view or save)
        this.items = []; // { id, canvas, config, imageData, label }
        this.zoom = 100; // Percentage
    }

    clear() {
        this.items = [];
        this.container.innerHTML = '<div class="empty-state">Load an image and apply an algorithm to start</div>';
    }

    addItem(imageData, config, label) {
        // Remove empty state if present
        if (this.items.length === 0) {
            this.container.innerHTML = '';
        }

        const id = Date.now() + Math.random().toString(36).substr(2, 9);
        const item = { id, imageData, config, label };
        this.items.push(item);
        this.renderItem(item);
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
        if (config.edgeStrength !== 0) {
            text += `<br>Edge: ${config.edgeStrength > 0 ? '+' : ''}${config.edgeStrength}%`;
        }

        // Pre-processing display
        if (config.preProcess) {
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
        return this.items.some(item => {
            if (!item.config) return false; // Skip original image which has null config

            if (item.config.type !== newConfig.type) return false;
            if (item.config.edgeEnabled !== newConfig.edgeEnabled) return false;
            if (item.config.edgeStrength !== newConfig.edgeStrength) return false;

            if (newConfig.type === 'weighted') {
                const w1 = item.config.weights;
                const w2 = newConfig.weights;
                if (w1.h !== w2.h || w1.s !== w2.s || w1.v !== w2.v) return false;
            }

            // Check pre-processing
            const p1 = item.config.preProcess || { r: 0, g: 0, b: 0, brightness: 0, contrast: 0, saturation: 0, gamma: 1.0 };
            const p2 = newConfig.preProcess || { r: 0, g: 0, b: 0, brightness: 0, contrast: 0, saturation: 0, gamma: 1.0 };

            if (p1.r !== p2.r) return false;
            if (p1.g !== p2.g) return false;
            if (p1.b !== p2.b) return false;
            if (p1.brightness !== p2.brightness) return false;
            if (p1.contrast !== p2.contrast) return false;
            if ((p1.saturation || 0) !== (p2.saturation || 0)) return false;
            if ((p1.gamma || 1.0) !== (p2.gamma || 1.0)) return false;

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
