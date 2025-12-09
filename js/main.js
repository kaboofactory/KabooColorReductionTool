document.addEventListener('DOMContentLoaded', () => {
    class App {
        constructor() {
            this.paletteManager = new CRT.ui.PaletteManager('palette-list', 'add-palette-btn', 'palette-input');
            // Updated constructor signature for AlgorithmSelector
            this.algoSelector = new CRT.ui.AlgorithmSelector('algo-type', 'algo-params');
            this.comparisonView = new CRT.ui.ComparisonView(
                'comparison-grid',
                (id) => this.handleItemSelect(id),
                (items) => this.handleComparisonUpdate(items)
            );
            this.detailView = new CRT.ui.DetailView();

            this.sourceImage = null;
            this.sourceImageData = null;
            // this.sourceEdges is no longer stored here; calculated dynamically in applyAlgorithm

            this.init();
        }

        init() {
            const loadBtn = document.getElementById('load-image-btn');
            const clearBtn = document.getElementById('clear-comparison-btn');
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
            clearBtn.addEventListener('click', () => this.comparisonView.clearProcessed());
            applyBtn.addEventListener('click', () => this.applyAlgorithm());

            // Dot Width Controls
            const dotSlider = document.getElementById('dot-width-slider');
            const dotVal = document.getElementById('dot-width-val');
            const dotAlgo = document.getElementById('downsample-algo');

            const handleDotChange = () => {
                const width = parseInt(dotSlider.value, 10);
                dotVal.textContent = width;
                this.updateSourceImage();
            };

            dotSlider.addEventListener('input', (e) => {
                dotVal.textContent = e.target.value;
            });
            dotSlider.addEventListener('change', handleDotChange);
            dotAlgo.addEventListener('change', handleDotChange);

            zoomSlider.addEventListener('input', (e) => {
                const val = e.target.value;
                zoomVal.textContent = `${val}%`;
                this.comparisonView.setZoom(val);
            });

            // Mouse Wheel Zoom
            const grid = document.getElementById('comparison-grid');
            grid.addEventListener('wheel', (e) => {
                e.preventDefault();
                let currentZoom = parseInt(zoomSlider.value, 10);
                let newZoom = currentZoom;

                if (e.deltaY < 0) {
                    // Zoom In
                    if (currentZoom < 200) {
                        newZoom += 10;
                    } else {
                        newZoom += 50;
                    }
                } else {
                    // Zoom Out
                    if (currentZoom <= 200) {
                        newZoom -= 10;
                    } else {
                        newZoom -= 50;
                    }
                }

                // Clamp
                newZoom = Math.max(parseInt(zoomSlider.min), Math.min(parseInt(zoomSlider.max), newZoom));

                if (newZoom !== currentZoom) {
                    zoomSlider.value = newZoom;
                    zoomVal.textContent = `${newZoom}%`;
                    this.comparisonView.setZoom(newZoom);
                }
            }, { passive: false });

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

            // Paste Support
            document.addEventListener('paste', (e) => {
                const items = (e.clipboardData || e.originalEvent.clipboardData).items;
                for (let index in items) {
                    const item = items[index];
                    if (item.kind === 'file' && item.type.indexOf('image/') !== -1) {
                        const blob = item.getAsFile();
                        this.loadSourceImage(blob);
                        // Prevent default paste behavior (optional, but good if we handled it)
                        e.preventDefault();
                        break; // Only load the first image found
                    }
                }
            });
        }

        async loadSourceImage(file) {
            if (!file) return;

            try {
                this.rawSourceImage = await CRT.core.loadImage(file);
                this.rawImageData = CRT.core.getImageData(this.rawSourceImage);
                // Reset controls
                // document.getElementById('dot-width-slider').value = 1; 
                // document.getElementById('dot-width-val').textContent = '1';

                this.updateSourceImage();
            } catch (err) {
                console.error('Failed to load source image:', err);
                alert('Failed to load source image.');
            }
        }

        updateSourceImage() {
            if (!this.rawImageData) return;

            const dotWidth = parseInt(document.getElementById('dot-width-slider').value, 10);
            const algo = document.getElementById('downsample-algo').value;

            document.body.style.cursor = 'wait';

            // Allow UI to update before processing
            setTimeout(() => {
                try {
                    this.sourceImageData = CRT.core.downsampleImage(this.rawImageData, dotWidth, algo);

                    this.comparisonView.clear();
                    // Add processed source to comparison
                    this.comparisonView.addItem(this.sourceImageData, null, 'Source');
                } catch (err) {
                    console.error('Downsampling failed:', err);
                } finally {
                    document.body.style.cursor = 'default';
                }
            }, 10);
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

                    // 1. Apply Pre-processing
                    if (config.preProcess && config.preProcess.enabled) {
                        CRT.core.applyPreProcessing(sourceCopy, config.preProcess);
                    }

                    // 2. Apply Edge Post-processing (before reduction)
                    // We calculate edges on the pre-processed image
                    let edges = null;
                    let edgeImageData = null;
                    if (config.edge && config.edge.enabled) {
                        if (config.edge.algorithmEnabled) {
                            edges = CRT.core.detectEdges(sourceCopy, config.edge.algorithm, (config.edge.huePriority || 0) / 100);
                        }
                        // Generate visualization BEFORE applying processing (so we see what was detected)
                        // Or AFTER? The detection is what matters.
                        edgeImageData = CRT.core.createEdgeVisualization(sourceCopy, edges, config.edge);

                        CRT.core.applyEdgeProcessing(sourceCopy, edges, config.edge);
                    }

                    // 3. Apply Color Reduction
                    // We pass edgeStrength: 0 because we handled edge processing manually above
                    const reducerOptions = {
                        ...config,
                        edgeStrength: 0
                    };

                    const resultData = CRT.core.reduceImage(sourceCopy, palette, edges, reducerOptions);
                    this.comparisonView.addItem(resultData, config, 'Reduced', edgeImageData);
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
                this.detailView.show(item.imageData, item.edgeImageData);
            }
        }

        handleComparisonUpdate(items) {
            const clearBtn = document.getElementById('clear-comparison-btn');
            // Enable if there are any items with config (processed images)
            const hasProcessed = items.some(item => item.config);
            clearBtn.disabled = !hasProcessed;
        }
    }

    // Start App
    new App();
});
