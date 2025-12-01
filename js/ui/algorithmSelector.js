CRT.ui.AlgorithmSelector = class {
    constructor(typeSelectId, paramsContainerId, edgeEnableId, edgeStrengthId, edgeValId, edgeGroupId) {
        this.typeSelect = document.getElementById(typeSelectId);
        this.paramsContainer = document.getElementById(paramsContainerId);
        this.edgeEnable = document.getElementById(edgeEnableId);
        this.edgeStrength = document.getElementById(edgeStrengthId);
        this.edgeVal = document.getElementById(edgeValId);
        this.edgeGroup = document.getElementById(edgeGroupId);

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

        this.init();
    }

    init() {
        this.typeSelect.addEventListener('change', () => this.renderParams());
        this.edgeEnable.addEventListener('change', (e) => {
            this.edgeStrength.disabled = !e.target.checked;
            // Do not reset value to 0, preserve user setting
            if (!e.target.checked) {
                this.edgeVal.style.opacity = '0.5';
            } else {
                this.edgeVal.style.opacity = '1';
            }
        });
        this.edgeStrength.addEventListener('input', (e) => {
            this.edgeVal.textContent = `${e.target.value}%`;
        });

        // Pre-processing listeners
        const linkSlider = (input, valSpan) => {
            input.addEventListener('input', (e) => valSpan.textContent = e.target.value);
        };
        linkSlider(this.preR, this.preRVal);
        linkSlider(this.preG, this.preGVal);
        linkSlider(this.preB, this.preBVal);
        linkSlider(this.preBrightness, this.preBrightnessVal);
        linkSlider(this.preContrast, this.preContrastVal);
        linkSlider(this.preSaturation, this.preSaturationVal);

        // Gamma needs special handling for display (div by 100)
        this.preGamma.addEventListener('input', (e) => {
            this.preGammaVal.textContent = (e.target.value / 100).toFixed(1);
        });

        this.preResetBtn.addEventListener('click', () => {
            this.preR.value = 0; this.preRVal.textContent = '0';
            this.preG.value = 0; this.preGVal.textContent = '0';
            this.preB.value = 0; this.preBVal.textContent = '0';
            this.preBrightness.value = 0; this.preBrightnessVal.textContent = '0';
            this.preContrast.value = 0; this.preContrastVal.textContent = '0';
            this.preSaturation.value = 0; this.preSaturationVal.textContent = '0';
            this.preGamma.value = 100; this.preGammaVal.textContent = '1.0';
        });

        this.renderParams(); // Initial render
    }

    renderParams() {
        const type = this.typeSelect.value;
        this.paramsContainer.innerHTML = '';

        // Show/Hide Edge Adjustment based on type
        // Assuming only 'weighted' needs options for now, as per user request
        if (type === 'weighted') {
            this.edgeGroup.style.display = 'flex';
            this.createSlider('Hue', 'w-h', 100);
            this.createSlider('Saturation', 'w-s', 100);
            this.createSlider('Value', 'w-v', 100);
        } else {
            this.edgeGroup.style.display = 'none';
        }
    }

    createSlider(label, id, defaultVal) {
        const div = document.createElement('div');
        div.className = 'control-group';
        div.innerHTML = `
            <label>${label} Weight</label>
            <div style="display:flex; gap:10px; align-items:center;">
                <input type="range" id="${id}" min="0" max="100" value="${defaultVal}" style="flex:1">
                <span id="${id}-val" style="font-size:0.8rem; width:30px">${defaultVal}%</span>
            </div>
        `;
        this.paramsContainer.appendChild(div);

        const input = div.querySelector('input');
        const val = div.querySelector('span');
        input.addEventListener('input', (e) => val.textContent = `${e.target.value}%`);
    }

    getConfig() {
        const type = this.typeSelect.value;
        const config = {
            type: type,
            edgeEnabled: this.edgeEnable.checked,
            edgeStrength: this.edgeEnable.checked ? parseInt(this.edgeStrength.value, 10) : 0,
            weights: { h: 0, s: 0, v: 0 },
            preProcess: {
                r: parseInt(this.preR.value, 10) || 0,
                g: parseInt(this.preG.value, 10) || 0,
                b: parseInt(this.preB.value, 10) || 0,
                brightness: parseInt(this.preBrightness.value, 10) || 0,
                contrast: parseInt(this.preContrast.value, 10) || 0,
                saturation: parseInt(this.preSaturation.value, 10) || 0,
                gamma: (parseInt(this.preGamma.value, 10) || 100) / 100
            }
        };

        if (type === 'weighted') {
            config.weights.h = parseInt(document.getElementById('w-h').value, 10);
            config.weights.s = parseInt(document.getElementById('w-s').value, 10);
            config.weights.v = parseInt(document.getElementById('w-v').value, 10);
        }

        return config;
    }
}
