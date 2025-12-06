CRT.ui.PaletteManager = class {
    constructor(elementId, addBtnId, inputId) {
        this.container = document.getElementById(elementId);
        this.addBtn = document.getElementById(addBtnId);
        this.input = document.getElementById(inputId);
        // New buttons
        this.addRgb232Btn = document.getElementById('add-rgb232-btn');
        this.addRgb322Btn = document.getElementById('add-rgb322-btn');
        this.addRgb343Btn = document.getElementById('add-rgb343-btn');
        this.addRgb433Btn = document.getElementById('add-rgb433-btn');

        this.colorContainer = document.getElementById('palette-colors');
        this.saveBtn = document.getElementById('save-palette-btn');
        this.deleteCheckbox = document.getElementById('enable-palette-delete');
        this.palettes = []; // Array of { id, name, colors: [], img: HTMLImageElement, type: 'image'|'default' }

        this.init();
    }

    init() {
        this.addBtn.addEventListener('click', () => this.input.click());
        this.input.addEventListener('change', (e) => this.handleFiles(e.target.files));

        if (this.addRgb232Btn) {
            this.addRgb232Btn.addEventListener('click', () => this.addDefaultPalette(2, 3, 2, 'RGB232 Palette'));
        }
        if (this.addRgb322Btn) {
            this.addRgb322Btn.addEventListener('click', () => this.addDefaultPalette(3, 2, 2, 'RGB322 Palette'));
        }
        if (this.addRgb343Btn) {
            this.addRgb343Btn.addEventListener('click', () => this.addDefaultPalette(3, 4, 3, 'RGB343 Palette'));
        }
        if (this.addRgb433Btn) {
            this.addRgb433Btn.addEventListener('click', () => this.addDefaultPalette(4, 3, 3, 'RGB433 Palette'));
        }

        this.saveBtn.addEventListener('click', () => this.savePalette());
        this.deleteCheckbox.addEventListener('change', () => this.renderColors());

        // Drag and Drop for Palette Image
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.container.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            this.container.addEventListener(eventName, () => {
                this.container.classList.add('drag-over');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            this.container.addEventListener(eventName, () => {
                this.container.classList.remove('drag-over');
            }, false);
        });

        this.container.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            this.handleFiles(files);
        }, false);

        // Initialize visibility
        this.renderColors();
    }

    async handleFiles(files) {
        if (!files.length) return;

        // Clear existing palettes to enforce single palette rule
        this.palettes = [];

        // Only process the first file
        const file = files[0];

        try {
            const img = await CRT.core.loadImage(file);
            const colors = CRT.core.extractPalette(img);
            const palette = {
                id: Date.now() + Math.random().toString(36).substr(2, 9),
                name: file.name,
                img: img,
                colors: colors,
                type: 'image'
            };
            this.palettes.push(palette);
        } catch (err) {
            console.error('Failed to load palette:', file.name, err);
            alert(`Failed to load palette: ${file.name}`);
        }

        this.render();
        this.renderColors();
        this.input.value = ''; // Reset input
    }

    /**
     * Generates a standard RGB palette (plus transparent)
     * @param {number} rBits 
     * @param {number} gBits 
     * @param {number} bBits 
     * @param {string} name 
     */
    addDefaultPalette(rBits, gBits, bBits, name) {
        this.palettes = []; // Clear existing

        const rLevels = 1 << rBits;
        const gLevels = 1 << gBits;
        const bLevels = 1 << bBits;

        // Generate colors
        // Format: {r,g,b,a}
        // First color is transparent
        const colors = [];
        colors.push({ r: 0, g: 0, b: 0, a: 0 });

        // Iterate through R, G, B
        // Need to scale 0-(levels-1) to 0-255
        const scale = (val, levels) => {
            if (levels <= 1) return 0;
            return Math.round((val / (levels - 1)) * 255);
        };

        for (let r = 0; r < rLevels; r++) {
            for (let g = 0; g < gLevels; g++) {
                for (let b = 0; b < bLevels; b++) {
                    colors.push({
                        r: scale(r, rLevels),
                        g: scale(g, gLevels),
                        b: scale(b, bLevels),
                        a: 255
                    });
                }
            }
        }

        // Create a dummy canvas for the thumbnail
        const canvas = document.createElement('canvas');
        canvas.width = 40;
        canvas.height = 40;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, 40, 40);
        ctx.fillStyle = '#fff';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${rBits}${gBits}${bBits}`, 20, 20);

        const palette = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            name: name,
            img: canvas, // Use canvas as image source
            colors: colors,
            type: 'default'
        };

        this.palettes.push(palette);
        this.render();
        this.renderColors();
    }

    removePalette(id) {
        this.palettes = this.palettes.filter(p => p.id !== id);
        this.render();
        this.renderColors();
    }

    removeColor(index) {
        if (!this.deleteCheckbox.checked) return;
        if (this.palettes.length === 0) return;

        const palette = this.palettes[0];
        // If default palette, allow deletion? No, user requested disable.
        if (palette.type === 'default') return;

        if (palette.colors.length <= 2) {
            alert("Cannot reduce palette to less than 2 colors.");
            return;
        }

        palette.colors.splice(index, 1);
        this.renderColors();

        // Update the palette item info (color count)
        this.render();
    }

    render() {
        this.container.innerHTML = '';
        if (this.palettes.length === 0) {
            this.container.innerHTML = '<div class="empty-state">No palettes loaded (Please prepare a palette image(*.png, *.jpg) from LOSPEC etc.)</div>';
            return;
        }

        this.palettes.forEach(p => {
            const el = document.createElement('div');
            el.className = 'palette-item';
            el.style.display = 'flex';
            el.style.alignItems = 'center';
            el.style.gap = '10px';
            el.style.padding = '5px';
            el.style.backgroundColor = 'rgba(0,0,0,0.2)';
            el.style.borderRadius = '4px';
            el.style.marginBottom = '5px';

            const thumb = document.createElement('canvas');
            thumb.width = 40;
            thumb.height = 40;
            const ctx = thumb.getContext('2d');

            // p.img can be Image or Canvas
            ctx.drawImage(p.img, 0, 0, 40, 40);

            const info = document.createElement('div');
            info.style.flex = '1';
            info.innerHTML = `
                <div style="font-size:0.9rem; font-weight:500">${p.name}</div>
                <div style="font-size:0.8rem; color:#aaa">${p.colors.length} colors</div>
            `;

            const delBtn = document.createElement('button');
            delBtn.textContent = '×';
            delBtn.style.background = 'none';
            delBtn.style.border = 'none';
            delBtn.style.color = '#f38ba8';
            delBtn.style.fontSize = '1.2rem';
            delBtn.style.cursor = 'pointer';
            delBtn.onclick = () => this.removePalette(p.id);

            el.appendChild(thumb);
            el.appendChild(info);
            el.appendChild(delBtn);
            this.container.appendChild(el);
        });
    }

    renderColors() {
        this.colorContainer.innerHTML = '';

        if (this.palettes.length === 0) {
            this.saveBtn.style.display = 'none';
            if (this.deleteCheckbox && this.deleteCheckbox.parentElement) {
                this.deleteCheckbox.parentElement.style.display = 'none';
            }
            return;
        }

        const palette = this.palettes[0];
        const isDefault = palette.type === 'default';

        // Hide delete option for default palettes
        if (this.deleteCheckbox && this.deleteCheckbox.parentElement) {
            this.deleteCheckbox.parentElement.style.display = isDefault ? 'none' : 'flex';
        }

        // Do not render chips for default palettes
        if (isDefault) {
            this.colorContainer.innerHTML = '<div style="font-size:0.8rem; color:#888; padding:5px;">Color chips hidden for default palette</div>';
            this.saveBtn.style.display = 'block';
            return;
        }

        this.saveBtn.style.display = 'block';

        const colors = palette.colors;
        const canDelete = this.deleteCheckbox.checked;

        colors.forEach((c, index) => {
            const el = document.createElement('div');
            el.style.width = '16px';
            el.style.height = '16px';
            el.style.backgroundColor = `rgba(${c.r},${c.g},${c.b},${c.a / 255})`;
            el.style.border = '1px solid #555';
            el.style.cursor = canDelete ? 'pointer' : 'default';
            el.title = `R:${c.r} G:${c.g} B:${c.b} A:${c.a}`;

            if (c.a < 255) {
                el.style.backgroundImage = 'linear-gradient(45deg, #888 25%, transparent 25%), linear-gradient(-45deg, #888 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #888 75%), linear-gradient(-45deg, transparent 75%, #888 75%)';
                el.style.backgroundSize = '8px 8px';
                el.style.backgroundPosition = '0 0, 0 4px, 4px -4px, -4px 0px';
            }

            el.onclick = () => {
                if (canDelete) {
                    this.removeColor(index);
                }
            };

            this.colorContainer.appendChild(el);
        });
    }

    savePalette() {
        if (this.palettes.length === 0) return;
        const colors = this.palettes[0].colors;

        const canvas = document.createElement('canvas');
        canvas.width = colors.length * 8;
        canvas.height = 8;
        const ctx = canvas.getContext('2d');

        colors.forEach((c, i) => {
            ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${c.a / 255})`;
            ctx.clearRect(i * 8, 0, 8, 8); // Clear first to handle transparency
            ctx.fillRect(i * 8, 0, 8, 8);
        });

        const link = document.createElement('a');
        link.download = `palette_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }

    getAllPalettes() {
        const allColors = [];
        const seen = new Set();

        if (this.palettes.length > 0) {
            return this.palettes[0].colors;
        }

        return [];
    }
}
