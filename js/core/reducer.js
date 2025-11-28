/**
 * Converts RGB to HSV.
 * @param {number} r 0-255
 * @param {number} g 0-255
 * @param {number} b 0-255
 * @returns {{h:number, s:number, v:number}} h:0-360, s:0-100, v:0-100
 */
function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, v = max;

    const d = max - min;
    s = max === 0 ? 0 : d / max;

    if (max === min) {
        h = 0;
    } else {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }

    return { h: h * 360, s: s * 100, v: v * 100 };
}

/**
 * Converts RGB to CIELAB.
 * @param {number} r 0-255
 * @param {number} g 0-255
 * @param {number} b 0-255
 * @returns {{l:number, a:number, b:number}}
 */
function rgbToLab(r, g, b) {
    let R = r / 255, G = g / 255, B = b / 255;
    R = (R > 0.04045) ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92;
    G = (G > 0.04045) ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92;
    B = (B > 0.04045) ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92;

    let X = R * 0.4124 + G * 0.3576 + B * 0.1805;
    let Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    let Z = R * 0.0193 + G * 0.1192 + B * 0.9505;

    X /= 0.95047; Y /= 1.00000; Z /= 1.08883;
    X = (X > 0.008856) ? Math.pow(X, 1 / 3) : (7.787 * X) + 16 / 116;
    Y = (Y > 0.008856) ? Math.pow(Y, 1 / 3) : (7.787 * Y) + 16 / 116;
    Z = (Z > 0.008856) ? Math.pow(Z, 1 / 3) : (7.787 * Z) + 16 / 116;

    return { l: (116 * Y) - 16, a: 500 * (X - Y), b: 200 * (Y - Z) };
}

/**
 * Calculates Euclidean distance in CIELAB space.
 */
function calculateDistanceLab(c1, c2) {
    const lab1 = rgbToLab(c1.r, c1.g, c1.b);
    const lab2 = rgbToLab(c2.r, c2.g, c2.b);
    const dl = lab1.l - lab2.l;
    const da = lab1.a - lab2.a;
    const db = lab1.b - lab2.b;
    return dl * dl + da * da + db * db;
}

/**
 * Calculates Luma-weighted Euclidean distance.
 */
function calculateDistanceLuma(c1, c2) {
    const dr = c1.r - c2.r;
    const dg = c1.g - c2.g;
    const db = c1.b - c2.b;
    // Weights: R:0.3, G:0.59, B:0.11 approx
    return (dr * dr * 0.30) + (dg * dg * 0.59) + (db * db * 0.11);
}

/**
 * Calculates distance between two colors based on weights.
 * @param {Object} c1 Source color {r,g,b}
 * @param {Object} c2 Palette color {r,g,b}
 * @param {Object} weights {h, s, v} percentages (0-100)
 * @returns {number} Distance score
 */
function calculateDistance(c1, c2, weights) {
    const hsv1 = rgbToHsv(c1.r, c1.g, c1.b);
    const hsv2 = rgbToHsv(c2.r, c2.g, c2.b);

    let dh = Math.abs(hsv1.h - hsv2.h);
    if (dh > 180) dh = 360 - dh;

    const ndh = dh / 180;
    const nds = Math.abs(hsv1.s - hsv2.s) / 100;
    const ndv = Math.abs(hsv1.v - hsv2.v) / 100;

    const wH = weights.h / 100;
    const wS = weights.s / 100;
    const wV = weights.v / 100;

    return (ndh * wH) + (nds * wS) + (ndv * wV);
}

/**
 * Reduces an image using the specified palette and options.
 * @param {ImageData} sourceData 
 * @param {Array} palette 
 * @param {Float32Array} edges Edge magnitude map
 * @param {Object} options { type: 'nearest'|'weighted'|'cielab'|'luma', weights: {h,s,v}, edgeStrength: number (-100 to 100) }
 * @returns {ImageData}
 */
CRT.core.reduceImage = function (sourceData, palette, edges, options) {
    const width = sourceData.width;
    const height = sourceData.height;
    const output = new ImageData(width, height);
    const sData = sourceData.data;
    const dData = output.data;

    for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        const r = sData[idx];
        const g = sData[idx + 1];
        const b = sData[idx + 2];
        const a = sData[idx + 3];

        if (a === 0) {
            dData[idx] = 0;
            dData[idx + 1] = 0;
            dData[idx + 2] = 0;
            dData[idx + 3] = 0;
            continue;
        }

        let tr = r, tg = g, tb = b;
        if (options.edgeStrength !== 0 && edges) {
            const edgeVal = edges[i];
            if (edgeVal > 30) {
                const factor = 1 + (options.edgeStrength / 100);
                tr = Math.min(255, Math.max(0, tr * factor));
                tg = Math.min(255, Math.max(0, tg * factor));
                tb = Math.min(255, Math.max(0, tb * factor));
            }
        }

        let minDist = Infinity;
        let bestColor = palette[0];

        for (const pColor of palette) {
            if (pColor.a === 0) continue;

            let dist;
            if (options.type === 'weighted') {
                dist = calculateDistance({ r: tr, g: tg, b: tb }, pColor, options.weights);
            } else if (options.type === 'cielab') {
                dist = calculateDistanceLab({ r: tr, g: tg, b: tb }, pColor);
            } else if (options.type === 'luma') {
                dist = calculateDistanceLuma({ r: tr, g: tg, b: tb }, pColor);
            } else {
                const dr = tr - pColor.r;
                const dg = tg - pColor.g;
                const db = tb - pColor.b;
                dist = dr * dr + dg * dg + db * db;
            }

            if (dist < minDist) {
                minDist = dist;
                bestColor = pColor;
            }
        }

        dData[idx] = bestColor.r;
        dData[idx + 1] = bestColor.g;
        dData[idx + 2] = bestColor.b;
        dData[idx + 3] = 255;
    }

    return output;
};
