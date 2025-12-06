CRT.ui.AlgorithmSelector = class {
    constructor(typeSelectId, paramsContainerId) {
        this.algoSelect = document.getElementById(typeSelectId);
        this.paramsContainer = document.getElementById(paramsContainerId);

        // Edge Post-processing inputs
        // Master switch removed

        this.forceEdgeEnable = document.getElementById('force-edge-enable');
        this.forceEdgeThreshold = document.getElementById('force-edge-threshold');
        this.forceEdgeThresholdVal = document.getElementById('force-edge-threshold-val');
        this.forceEdgeThresholdMax = document.getElementById('force-edge-threshold-max');
        this.forceEdgeThresholdMaxVal = document.getElementById('force-edge-threshold-max-val');

        this.outlineEnable = document.getElementById('outline-enable');
        this.outlineOpacityThr = document.getElementById('outline-opacity-thr');
        this.outlineOpacityThrVal = document.getElementById('outline-opacity-thr-val');
        this.outlineNeighborThr = document.getElementById('outline-neighbor-thr');
        this.outlineNeighborThrVal = document.getElementById('outline-neighbor-thr-val');



        this.edgeAlgoEnable = document.getElementById('edge-algo-enable');
        this.edgeAlgoType = document.getElementById('edge-algo-type');
        this.edgeAlgoThreshold = document.getElementById('edge-algo-threshold');
        this.edgeAlgoThresholdVal = document.getElementById('edge-algo-threshold-val');
        this.edgeAlgoHuePriority = document.getElementById('edge-algo-hue-priority');
        this.edgeAlgoHuePriorityVal = document.getElementById('edge-algo-hue-priority-val');

        this.edgeProcBrightness = document.getElementById('edge-proc-brightness');
        this.edgeProcBrightnessVal = document.getElementById('edge-proc-brightness-val');
        this.edgeProcContrast = document.getElementById('edge-proc-contrast');
        this.edgeProcContrastVal = document.getElementById('edge-proc-contrast-val');
        this.edgeProcSaturation = document.getElementById('edge-proc-saturation');
        this.edgeProcSaturationVal = document.getElementById('edge-proc-saturation-val');
        this.edgeProcHue = document.getElementById('edge-proc-hue');
        this.edgeProcHueVal = document.getElementById('edge-proc-hue-val');
        this.edgeProcResetBtn = document.getElementById('edge-proc-reset-btn');

        this.edgePostProcGroup = document.getElementById('edge-post-proc-group');

        // Pre-processing inputs
        this.preR = document.getElementById('pre-r');
        this.preG = document.getElementById('pre-g');
        this.preB = document.getElementById('pre-b');
        this.preBrightness = document.getElementById('pre-brightness');
        this.preContrast = document.getElementById('pre-contrast');
        this.preSaturation = document.getElementById('pre-saturation');
        this.preGamma = document.getElementById('pre-gamma');

        this.preRVal = document.getElementById('pre-r-val');
        this.preGVal = document.getElementById('pre-g-val');
        this.preBVal = document.getElementById('pre-b-val');
        this.preBrightnessVal = document.getElementById('pre-brightness-val');
        this.preContrastVal = document.getElementById('pre-contrast-val');
        this.preSaturationVal = document.getElementById('pre-saturation-val');
        this.preGammaVal = document.getElementById('pre-gamma-val');

        this.preResetBtn = document.getElementById('pre-reset-btn');
        this.preProcEnable = document.getElementById('pre-proc-enable');

        this.init();
    }

    init() {
        this.algoSelect.addEventListener('change', () => this.renderParams());
        this.renderParams(); // Initial render

        // Pre-processing listeners
        const preSliders = [
            { el: this.preR, val: this.preRVal },
            { el: this.preG, val: this.preGVal },
            { el: this.preB, val: this.preBVal },
            { el: this.preBrightness, val: this.preBrightnessVal },
            { el: this.preContrast, val: this.preContrastVal },
            { el: this.preSaturation, val: this.preSaturationVal },
            { el: this.preGamma, val: this.preGammaVal, isFloat: true }
        ];

        preSliders.forEach(item => {
            item.el.addEventListener('input', (e) => {
                item.val.textContent = item.isFloat ? (e.target.value / 100).toFixed(1) : e.target.value;
            });
        });

        this.preProcEnable.addEventListener('change', () => this.togglePreProcessingControls());

        this.preResetBtn.addEventListener('click', () => {
            this.preR.value = 0; this.preRVal.textContent = '0';
            this.preG.value = 0; this.preGVal.textContent = '0';
            this.preB.value = 0; this.preBVal.textContent = '0';
            this.preBrightness.value = 0; this.preBrightnessVal.textContent = '0';
            this.preContrast.value = 0; this.preContrastVal.textContent = '0';
            this.preSaturation.value = 0; this.preSaturationVal.textContent = '0';
            this.preGamma.value = 100; this.preGammaVal.textContent = '1.0';
        });

        // Edge Post-processing listeners
        this.forceEdgeEnable.addEventListener('change', () => this.toggleEdgeControls());
        this.edgeAlgoEnable.addEventListener('change', () => this.toggleEdgeControls());

        this.forceEdgeThreshold.addEventListener('input', (e) => {
            this.forceEdgeThresholdVal.textContent = e.target.value;
        });
        this.forceEdgeThresholdMax.addEventListener('input', (e) => {
            this.forceEdgeThresholdMaxVal.textContent = e.target.value;
        });

        this.outlineEnable.addEventListener('change', () => this.toggleEdgeControls());
        this.outlineOpacityThr.addEventListener('input', (e) => {
            this.outlineOpacityThrVal.textContent = e.target.value;
        });
        this.outlineNeighborThr.addEventListener('input', (e) => {
            this.outlineNeighborThrVal.textContent = e.target.value;
        });



        this.edgeAlgoThreshold.addEventListener('input', (e) => {
            this.edgeAlgoThresholdVal.textContent = e.target.value;
        });
        this.edgeAlgoHuePriority.addEventListener('input', (e) => {
            this.edgeAlgoHuePriorityVal.textContent = e.target.value + '%';
        });

        const edgeSliders = [
            { el: this.edgeProcBrightness, val: this.edgeProcBrightnessVal },
            { el: this.edgeProcContrast, val: this.edgeProcContrastVal },
            { el: this.edgeProcSaturation, val: this.edgeProcSaturationVal },
            { el: this.edgeProcHue, val: this.edgeProcHueVal }
        ];

        edgeSliders.forEach(item => {
            item.el.addEventListener('input', (e) => {
                item.val.textContent = e.target.value;
            });
        });

        this.edgeProcResetBtn.addEventListener('click', () => {
            this.edgeProcBrightness.value = -50; this.edgeProcBrightnessVal.textContent = '-50';
            this.edgeProcContrast.value = 0; this.edgeProcContrastVal.textContent = '0';
            this.edgeProcSaturation.value = 0; this.edgeProcSaturationVal.textContent = '0';
            this.edgeProcHue.value = 0; this.edgeProcHueVal.textContent = '0';
        });

        this.toggleEdgeControls();
        this.togglePreProcessingControls();
    }

    togglePreProcessingControls() {
        const enabled = this.preProcEnable.checked;

        this.preR.disabled = !enabled;
        this.preG.disabled = !enabled;
        this.preB.disabled = !enabled;
        this.preBrightness.disabled = !enabled;
        this.preContrast.disabled = !enabled;
        this.preSaturation.disabled = !enabled;
        this.preGamma.disabled = !enabled;
        this.preResetBtn.disabled = !enabled;
    }

    toggleEdgeControls() {
        const forceEnabled = this.forceEdgeEnable.checked;
        const algoEnabled = this.edgeAlgoEnable.checked;
        const outlineEnabled = this.outlineEnable.checked;
        const anyEdgeEnabled = forceEnabled || algoEnabled || outlineEnabled;

        // Force Edge Controls
        this.forceEdgeThreshold.disabled = !forceEnabled;
        this.forceEdgeThresholdMax.disabled = !forceEnabled;

        // Outline Controls
        this.outlineOpacityThr.disabled = !outlineEnabled;
        this.outlineNeighborThr.disabled = !outlineEnabled;

        // Algo Controls
        this.edgeAlgoType.disabled = !algoEnabled;
        this.edgeAlgoThreshold.disabled = !algoEnabled;
        this.edgeAlgoHuePriority.disabled = !algoEnabled;

        // Shared Adjustments (enabled if ANY edge detection is active)
        this.edgeProcBrightness.disabled = !anyEdgeEnabled;
        this.edgeProcContrast.disabled = !anyEdgeEnabled;
        this.edgeProcSaturation.disabled = !anyEdgeEnabled;
        this.edgeProcHue.disabled = !anyEdgeEnabled;
        this.edgeProcResetBtn.disabled = !anyEdgeEnabled;
    }

    renderParams() {
        const type = this.algoSelect.value;
        this.paramsContainer.innerHTML = '';

        if (type === 'weighted') {
            this.paramsContainer.innerHTML = `
                <div class="sub-group">
                    <label>HSV Weights</label>
                    <div class="slider-row">
                        <label>H</label>
                        <input type="range" id="weight-h" min="0" max="100" value="50">
                        <span id="weight-h-val">50%</span>
                    </div>
                    <div class="slider-row">
                        <label>S</label>
                        <input type="range" id="weight-s" min="0" max="100" value="30">
                        <span id="weight-s-val">30%</span>
                    </div>
                    <div class="slider-row">
                        <label>V</label>
                        <input type="range" id="weight-v" min="0" max="100" value="20">
                        <span id="weight-v-val">20%</span>
                    </div>
                </div>
            `;

            // Add listeners for dynamic elements
            const h = document.getElementById('weight-h');
            const s = document.getElementById('weight-s');
            const v = document.getElementById('weight-v');
            const hVal = document.getElementById('weight-h-val');
            const sVal = document.getElementById('weight-s-val');
            const vVal = document.getElementById('weight-v-val');

            [h, s, v].forEach(el => {
                el.addEventListener('input', () => {
                    hVal.textContent = h.value + '%';
                    sVal.textContent = s.value + '%';
                    vVal.textContent = v.value + '%';
                });
            });
        }
    }

    getConfig() {
        const type = this.algoSelect.value;
        const config = {
            type: type,
            // Pre-processing
            preProcess: {
                enabled: document.getElementById('pre-proc-enable').checked,
                r: parseInt(this.preR.value, 10),
                g: parseInt(this.preG.value, 10),
                b: parseInt(this.preB.value, 10),
                brightness: parseInt(this.preBrightness.value, 10),
                contrast: parseInt(this.preContrast.value, 10),
                saturation: parseInt(this.preSaturation.value, 10),
                gamma: parseFloat(this.preGamma.value) / 100
            },
            // Edge Post-processing
            edge: {
                enabled: this.forceEdgeEnable.checked || this.edgeAlgoEnable.checked || this.outlineEnable.checked,
                forceEdge: {
                    enabled: this.forceEdgeEnable.checked,
                    thresholdMin: parseInt(this.forceEdgeThreshold.value, 10) || 32,
                    thresholdMax: parseInt(this.forceEdgeThresholdMax.value, 10) || 254,
                    outline: {
                        enabled: this.outlineEnable.checked,
                        opacityMin: parseInt(this.outlineOpacityThr.value, 10) || 255,
                        neighborMax: parseInt(this.outlineNeighborThr.value, 10) || 0
                    }
                },
                algorithmEnabled: this.edgeAlgoEnable.checked,
                algorithm: this.edgeAlgoType.value,
                threshold: parseInt(this.edgeAlgoThreshold.value, 10) || 30,
                huePriority: parseInt(this.edgeAlgoHuePriority.value, 10) || 0,
                adjustments: {
                    brightness: parseInt(this.edgeProcBrightness.value, 10) || 0,
                    contrast: parseInt(this.edgeProcContrast.value, 10) || 0,
                    saturation: parseInt(this.edgeProcSaturation.value, 10) || 0,
                    hue: parseInt(this.edgeProcHue.value, 10) || 0
                }
            }
        };

        if (type === 'weighted') {
            config.weights = {
                h: parseInt(document.getElementById('weight-h').value, 10),
                s: parseInt(document.getElementById('weight-s').value, 10),
                v: parseInt(document.getElementById('weight-v').value, 10)
            };
        }

        return config;
    }
};
