CRT.ui.DetailView = class {
    constructor() {
        this.modal = null;
        this.currentImageData = null;
        this.createModal();

        window.addEventListener('resize', () => {
            if (this.modal.style.display === 'flex') {
                this.updateScale();
            }
        });
    }

    createModal() {
        this.modal = document.createElement('div');
        this.modal.style.position = 'fixed';
        this.modal.style.top = '0';
        this.modal.style.left = '0';
        this.modal.style.width = '100%';
        this.modal.style.height = '100%';
        this.modal.style.backgroundColor = 'rgba(0,0,0,0.85)';
        this.modal.style.display = 'none';
        this.modal.style.zIndex = '1000';
        this.modal.style.flexDirection = 'column';
        this.modal.style.alignItems = 'center';
        this.modal.style.justifyContent = 'center';
        this.modal.style.padding = '20px';

        this.modal.innerHTML = `
            <div style="position:absolute; top:20px; right:20px; display:flex; gap:10px">
                <select id="save-format" style="padding: 0.6rem; border-radius: 6px; border: none; background: var(--panel-bg); color: var(--text-color);">
                    <option value="png">PNG</option>
                    <option value="webp">WebP</option>
                </select>
                <button id="save-btn" class="btn primary">Save Image</button>
                <button id="close-modal-btn" class="btn secondary">Close</button>
            </div>
            <div style="overflow:auto; max-width:100%; max-height:100%; border:1px solid #555; border-radius:4px;">
                <canvas id="detail-canvas" style="display:block; image-rendering:pixelated"></canvas>
            </div>
        `;

        document.body.appendChild(this.modal);

        document.getElementById('close-modal-btn').onclick = () => this.hide();
        document.getElementById('save-btn').onclick = () => this.save();

        // Close on click outside
        this.modal.onclick = (e) => {
            if (e.target === this.modal) this.hide();
        };
    }

    show(imageData) {
        this.currentImageData = imageData;
        const canvas = document.getElementById('detail-canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);

        this.updateScale();
        this.modal.style.display = 'flex';
    }

    updateScale() {
        if (!this.currentImageData) return;
        const canvas = document.getElementById('detail-canvas');

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const targetW = vw * 0.7;
        const targetH = vh * 0.7;

        const scale = Math.min(targetW / this.currentImageData.width, targetH / this.currentImageData.height);
        const finalScale = Math.max(1, scale);

        canvas.style.width = `${this.currentImageData.width * finalScale}px`;
        canvas.style.height = `${this.currentImageData.height * finalScale}px`;
    }

    hide() {
        this.modal.style.display = 'none';
    }

    save() {
        if (!this.currentImageData) return;

        const canvas = document.createElement('canvas');
        canvas.width = this.currentImageData.width;
        canvas.height = this.currentImageData.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(this.currentImageData, 0, 0);

        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const timestamp = `${yyyy}${mm}${dd}${hh}${min}${ss}`;

        const formatSelect = document.getElementById('save-format');
        const format = formatSelect ? formatSelect.value : 'png';
        const mimeType = format === 'webp' ? 'image/webp' : 'image/png';
        const ext = format === 'webp' ? 'webp' : 'png';

        const link = document.createElement('a');
        link.download = `reduced-image_${timestamp}.${ext}`;
        link.href = canvas.toDataURL(mimeType);
        link.click();
    }
};
