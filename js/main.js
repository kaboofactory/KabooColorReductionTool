document.addEventListener('DOMContentLoaded', () => {
    class App {
        constructor() {
            this.paletteManager = new CRT.ui.PaletteManager('palette-list', 'add-palette-btn', 'palette-input');
            this.algoSelector = new CRT.ui.AlgorithmSelector('algo-type', 'algo-params', 'edge-adjust-enable', 'edge-strength', 'edge-strength-val', 'edge-adjust-group');
            this.comparisonView = new CRT.ui.ComparisonView('comparison-grid', (id) => this.handleItemSelect(id));
            this.detailView = new CRT.ui.DetailView();

            this.sourceImage = null;
            this.sourceImageData = null;
            this.sourceEdges = null;

            this.init();
        }

        init() {
            const loadBtn = document.getElementById('load-image-btn');
            const input = document.getElementById('source-image-input');
            const applyBtn = document.getElementById('apply-algo-btn');
            const zoomSlider = document.getElementById('zoom-slider');
            const zoomVal = document.getElementById('zoom-val');
            const contentArea = document.querySelector('.content-area');

            loadBtn.addEventListener('click', () => input.click());
            input.addEventListener('change', (e) => {
                this.loadSourceImage(e.target.files[0]);
                e.target.value = '';
            });
            applyBtn.addEventListener('click', () => this.applyAlgorithm());

            zoomSlider.addEventListener('input', (e) => {
                const val = e.target.value;
                zoomVal.textContent = `${val}%`;
                this.comparisonView.setZoom(val);
            });

            // Drag and Drop for Source Image
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                contentArea.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                }, false);
            });

            ['dragenter', 'dragover'].forEach(eventName => {
                contentArea.addEventListener(eventName, () => {
                    contentArea.classList.add('drag-over');
                }, false);
            });

            ['dragleave', 'drop'].forEach(eventName => {
                contentArea.addEventListener(eventName, () => {
                    contentArea.classList.remove('drag-over');
                }, false);
            });

            contentArea.addEventListener('drop', (e) => {
                const dt = e.dataTransfer;
                const files = dt.files;
                if (files.length > 0) {
                    this.loadSourceImage(files[0]);
                }
            }, false);
        }

        async loadSourceImage(file) {
            if (!file) return;

            try {
                this.sourceImage = await CRT.core.loadImage(file);
                this.sourceImageData = CRT.core.getImageData(this.sourceImage);
                this.sourceEdges = CRT.core.detectEdges(this.sourceImageData);

                this.comparisonView.clear();
                // Add original to comparison
                this.comparisonView.addItem(this.sourceImageData, null, 'Original');
            } catch (err) {
                console.error('Failed to load source image:', err);
                alert('Failed to load source image.');
            }
        }

        applyAlgorithm() {
            if (!this.sourceImageData) {
                alert('Please load a source image first.');
                return;
            }

            const palette = this.paletteManager.getAllPalettes();
            if (palette.length <= 1) { // Only transparent color
                alert('Please add at least one palette image.');
                return;
            }

            const config = this.algoSelector.getConfig();

            if (this.comparisonView.hasDuplicate(config)) {
                alert('This algorithm configuration is already in the comparison list.');
                return;
            }

            document.body.style.cursor = 'wait';
            setTimeout(() => {
                try {
                    const sourceCopy = new ImageData(
                        new Uint8ClampedArray(this.sourceImageData.data),
                        this.sourceImageData.width,
                        this.sourceImageData.height
                    );

                    const resultData = CRT.core.reduceImage(sourceCopy, palette, this.sourceEdges, config);
                    this.comparisonView.addItem(resultData, config, 'Reduced');
                } catch (err) {
                    console.error('Reduction failed:', err);
                    alert('Reduction failed: ' + err.message);
                } finally {
                    document.body.style.cursor = 'default';
                }
            }, 50);
        }

        handleItemSelect(id) {
            const item = this.comparisonView.getItem(id);
            if (item) {
                this.detailView.show(item.imageData);
            }
        }
    }

    // Start App
    new App();
});
