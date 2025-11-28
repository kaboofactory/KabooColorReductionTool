CRT.ui.PaletteManager = class {
    constructor(elementId, addBtnId, inputId) {
        this.container = document.getElementById(elementId);
        this.addBtn = document.getElementById(addBtnId);
        this.input = document.getElementById(inputId);
        this.palettes = []; // Array of { id, name, colors: [], img: HTMLImageElement }

        this.init();
    }

    init() {
        this.addBtn.addEventListener('click', () => this.input.click());
        this.input.addEventListener('change', (e) => this.handleFiles(e.target.files));

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
                colors: colors
            };
            this.palettes.push(palette);
        } catch (err) {
            console.error('Failed to load palette:', file.name, err);
            alert(`Failed to load palette: ${file.name}`);
        }

        this.render();
        this.input.value = ''; // Reset input
    }

    removePalette(id) {
        this.palettes = this.palettes.filter(p => p.id !== id);
        this.render();
    }

    render() {
        this.container.innerHTML = '';
        if (this.palettes.length === 0) {
            this.container.innerHTML = '<div class="empty-state">No palettes loaded</div>';
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

    getAllPalettes() {
        const allColors = [];
        const seen = new Set();

        const transparentKey = '0,0,0,0';
        seen.add(transparentKey);
        allColors.push({ r: 0, g: 0, b: 0, a: 0 });

        this.palettes.forEach(p => {
            p.colors.forEach(c => {
                const key = `${c.r},${c.g},${c.b},${c.a}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    allColors.push(c);
                }
            });
        });

        return allColors;
    }
}
