CRT.ui.AlgorithmSelector = class {
    constructor(typeSelectId, paramsContainerId, edgeEnableId, edgeStrengthId, edgeValId, edgeGroupId) {
        this.typeSelect = document.getElementById(typeSelectId);
        this.paramsContainer = document.getElementById(paramsContainerId);
        this.edgeEnable = document.getElementById(edgeEnableId);
        this.edgeStrength = document.getElementById(edgeStrengthId);
        this.edgeVal = document.getElementById(edgeValId);
        this.edgeGroup = document.getElementById(edgeGroupId);

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
            weights: { h: 0, s: 0, v: 0 }
        };

        if (type === 'weighted') {
            config.weights.h = parseInt(document.getElementById('w-h').value, 10);
            config.weights.s = parseInt(document.getElementById('w-s').value, 10);
            config.weights.v = parseInt(document.getElementById('w-v').value, 10);
        }

        return config;
    }
}
