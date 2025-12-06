/**
 * Loads an image from a File object or URL.
 * @param {File|string} source - The file object or URL to load.
 * @returns {Promise<HTMLImageElement>}
 */
CRT.core.loadImage = function (source) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        if (source instanceof File) {
            img.src = URL.createObjectURL(source);
        } else {
            img.src = source;
        }
    });
};

/**
 * Extracts pixel data from an image.
 * @param {HTMLImageElement} img 
 * @returns {ImageData}
 */
CRT.core.getImageData = function (img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height);
};

/**
 * Extracts unique colors from an image to create a palette.
 * Always includes transparent color (0,0,0,0).
 * @param {HTMLImageElement} img 
 * @returns {Array<{r:number, g:number, b:number, a:number}>} Array of RGBA objects
 */
CRT.core.extractPalette = function (img) {
    const imageData = CRT.core.getImageData(img);
    const data = imageData.data;
    const uniqueColors = new Set();
    const palette = [];

    // Add default transparent color
    const transparentKey = '0,0,0,0';
    uniqueColors.add(transparentKey);
    palette.push({ r: 0, g: 0, b: 0, a: 0 });

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        // Treat low alpha as transparent
        if (a < 32) {
            continue;
        }

        // If alpha > 0, treat as full opacity 255 for palette definition purposes 
        const key = `${r},${g},${b},255`;
        if (!uniqueColors.has(key)) {
            if (palette.length >= 1025) {
                alert('Palette color limit (1025) reached. Some colors may be missing.');
                break;
            }
            uniqueColors.add(key);
            palette.push({ r, g, b, a: 255 });
        }
    }

    return palette;
}

/**
 * Edge detection with multiple algorithms.
 * Returns a Float32Array of edge magnitudes (0-255 normalized).
 * @param {ImageData} imageData 
 * @param {string} algorithm 'sobel', 'prewitt', 'roberts', 'laplacian'
 * @returns {Float32Array}
 */
CRT.core.detectEdges = function (imageData, algorithm = 'sobel', hueWeight = 0) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const edges = new Float32Array(width * height);

    // Helper to get Luma, Sin(H), Cos(H)
    // Returns [L, SinH, CosH]
    // L is 0-255
    // SinH, CosH are -1 to 1, scaled to 0-255 range for kernel application?
    // Actually, we can apply kernels directly to normalized values, but let's keep 0-255 scale for consistency.
    // So SinH * 255, CosH * 255.
    const getPixelValues = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return [0, 0, 0];
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Luma
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;

        if (hueWeight === 0) {
            return [luma, 0, 0];
        }

        // Hue Calculation
        const rNorm = r / 255, gNorm = g / 255, bNorm = b / 255;
        const max = Math.max(rNorm, gNorm, bNorm), min = Math.min(rNorm, gNorm, bNorm);
        const d = max - min;

        let h = 0;
        if (d === 0) {
            h = 0; // Achromatic
        } else {
            switch (max) {
                case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
                case gNorm: h = (bNorm - rNorm) / d + 2; break;
                case bNorm: h = (rNorm - gNorm) / d + 4; break;
            }
            h /= 6;
        }
        // h is 0-1. Convert to radians 0-2PI
        const hRad = h * Math.PI * 2;

        // Scale to 0-255 for consistent magnitude with Luma
        // Note: Sin/Cos range is -1 to 1. 
        // If we want the "difference" to be comparable to Luma difference (0-255),
        // we should scale the unit circle to radius 255? Or 127.5?
        // Let's use 255. A full opposite hue change (red to cyan) is distance 2 in unit circle.
        // In Luma, black to white is 255.
        // If we map unit circle radius to 127.5, diameter is 255.
        const radius = 127.5;
        return [luma, Math.sin(hRad) * radius, Math.cos(hRad) * radius];
    };

    // Kernels
    let kx, ky;
    let isLaplacian = false;

    switch (algorithm) {
        case 'prewitt':
            kx = [[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]];
            ky = [[-1, -1, -1], [0, 0, 0], [1, 1, 1]];
            break;
        case 'scharr':
            kx = [[-3, 0, 3], [-10, 0, 10], [-3, 0, 3]];
            ky = [[-3, -10, -3], [0, 0, 0], [3, 10, 3]];
            break;
        case 'roberts':
            break;
        case 'morphological':
            break;
        case 'laplacian':
            isLaplacian = true;
            break;
        case 'sobel':
        default:
            kx = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
            ky = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];
            break;
    }

    const wL = 1 - hueWeight;
    const wH = hueWeight;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const a = data[idx + 3];

            if (a < 10) continue;

            let magL = 0;
            let magH = 0;

            if (algorithm === 'roberts') {
                const p00 = getPixelValues(x, y);
                const p11 = getPixelValues(x + 1, y + 1);
                const p01 = getPixelValues(x, y + 1);
                const p10 = getPixelValues(x + 1, y);

                // Luma
                const gxL = p00[0] - p11[0];
                const gyL = p01[0] - p10[0];
                magL = Math.sqrt(gxL * gxL + gyL * gyL);

                // Hue
                if (wH > 0) {
                    const gxS = p00[1] - p11[1];
                    const gyS = p01[1] - p10[1];
                    const gxC = p00[2] - p11[2];
                    const gyC = p01[2] - p10[2];

                    // Normalize Roberts: divide by sqrt(2)
                    // Max gradient is 255. Max mag is 255*sqrt(2).
                    // We want max to be 255.
                    const norm = 1 / 1.4142; // 1/sqrt(2)

                    const magS = Math.sqrt(gxS * gxS + gyS * gyS) * norm;
                    const magC = Math.sqrt(gxC * gxC + gyC * gyC) * norm;
                    magH = Math.sqrt(magS * magS + magC * magC);
                    // magH can theoretically exceed 255 if both components are maxed? 
                    // No, vector addition of hue components is complex but let's stick to per-channel normalization logic 
                    // or just clamp at the end. 
                    // Actually, reusing the same normalization factor for the Combined Hue Magnitude is a reasonable approximation.
                }

                // Normalize Luma Roberts
                // Max Gx=255, Gy=255 -> Mag=255*sqrt(2).
                magL = magL / 1.4142;

            } else if (algorithm === 'morphological') {
                // Luma
                let minL = 255, maxL = 0;
                // Hue (using vector distance max)
                // This is complex for morphological. 
                // Simplified: Max distance from center pixel? Or max pairwise distance in kernel?
                // Standard Morph Gradient is Dilation - Erosion.
                // For vectors, we can define "min" and "max" based on some ordering, but vectors don't have natural order.
                // Alternative: Max Euclidean distance between any two pixels in the window.
                let maxDistH = 0;
                const windowPixels = [];

                for (let ky_i = -1; ky_i <= 1; ky_i++) {
                    for (let kx_i = -1; kx_i <= 1; kx_i++) {
                        const vals = getPixelValues(x + kx_i, y + ky_i);

                        // Luma
                        if (vals[0] < minL) minL = vals[0];
                        if (vals[0] > maxL) maxL = vals[0];

                        if (wH > 0) {
                            windowPixels.push({ s: vals[1], c: vals[2] });
                        }
                    }
                }
                magL = maxL - minL;

                if (wH > 0) {
                    // Find max distance between any pair in window
                    for (let i = 0; i < windowPixels.length; i++) {
                        for (let j = i + 1; j < windowPixels.length; j++) {
                            const p1 = windowPixels[i];
                            const p2 = windowPixels[j];
                            const ds = p1.s - p2.s;
                            const dc = p1.c - p2.c;
                            const dist = Math.sqrt(ds * ds + dc * dc);
                            if (dist > maxDistH) maxDistH = dist;
                        }
                    }
                    magH = maxDistH;
                }

            } else if (isLaplacian) {
                // Laplacian is 2nd derivative.
                // Luma
                const valL =
                    getPixelValues(x, y - 1)[0] +
                    getPixelValues(x - 1, y)[0] - 4 * getPixelValues(x, y)[0] + getPixelValues(x + 1, y)[0] +
                    getPixelValues(x, y + 1)[0];

                // Laplacian max is 4*255. Normalize by 4.
                magL = Math.abs(valL) / 4;

                if (wH > 0) {
                    const valS =
                        getPixelValues(x, y - 1)[1] +
                        getPixelValues(x - 1, y)[1] - 4 * getPixelValues(x, y)[1] + getPixelValues(x + 1, y)[1] +
                        getPixelValues(x, y + 1)[1];
                    const valC =
                        getPixelValues(x, y - 1)[2] +
                        getPixelValues(x - 1, y)[2] - 4 * getPixelValues(x, y)[2] + getPixelValues(x + 1, y)[2] +
                        getPixelValues(x, y + 1)[2];

                    // Normalize Laplacian Hue
                    const magS = Math.abs(valS) / 4;
                    const magC = Math.abs(valC) / 4;
                    magH = Math.sqrt(magS * magS + magC * magC);
                }

            } else {
                // Sobel, Prewitt, Scharr
                let gxL = 0, gyL = 0;
                let gxS = 0, gyS = 0;
                let gxC = 0, gyC = 0;

                for (let ky_i = -1; ky_i <= 1; ky_i++) {
                    for (let kx_i = -1; kx_i <= 1; kx_i++) {
                        const vals = getPixelValues(x + kx_i, y + ky_i);
                        const kValX = kx[ky_i + 1][kx_i + 1];
                        const kValY = ky[ky_i + 1][kx_i + 1];

                        gxL += vals[0] * kValX;
                        gyL += vals[0] * kValY;

                        if (wH > 0) {
                            gxS += vals[1] * kValX;
                            gyS += vals[1] * kValY;
                            gxC += vals[2] * kValX;
                            gyC += vals[2] * kValY;
                        }
                    }
                }

                magL = Math.sqrt(gxL * gxL + gyL * gyL);

                if (wH > 0) {
                    const magS = Math.sqrt(gxS * gxS + gyS * gyS);
                    const magC = Math.sqrt(gxC * gxC + gyC * gyC);
                    magH = Math.sqrt(magS * magS + magC * magC);
                }

                // Normalization
                let div = 1;
                if (algorithm === 'sobel') div = 4 * 1.4142; // 5.657
                else if (algorithm === 'prewitt') div = 3 * 1.4142; // 4.242
                else if (algorithm === 'scharr') div = 16 * 1.4142; // 22.627

                magL /= div;
                if (wH > 0) magH /= div;
            }

            edges[y * width + x] = magL * wL + magH * wH;
        }
    }
    return edges;
}

/**
 * Applies edge post-processing (darkening, etc.) to the image data.
 * @param {ImageData} imageData The image to modify
 * @param {Float32Array} edgeMap The edge magnitudes
 * @param {Object} config The edge configuration { forceEdge: {enabled, threshold}, threshold, adjustments: {brightness, contrast, saturation, hue} }
 */
CRT.core.applyEdgeProcessing = function (imageData, edgeMap, config) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    const forceEnabled = config.forceEdge.enabled;
    const forceThrMin = config.forceEdge.thresholdMin || 32;
    const forceThrMax = config.forceEdge.thresholdMax || 254;
    const algoEnabled = config.algorithmEnabled !== false; // Default to true if undefined for backward compatibility
    const algoThr = config.threshold;

    // Pre-calc adjustments
    const adj = config.adjustments;
    const useAdj = adj.brightness !== 0 || adj.contrast !== 0 || adj.saturation !== 0 || adj.hue !== 0;

    if (!useAdj) return; // Nothing to do if no adjustments

    const contrastFactor = (259 * (adj.contrast + 255)) / (255 * (259 - adj.contrast));
    const satMult = 1 + (adj.saturation / 100);
    const hueShift = adj.hue; // -180 to 180

    for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        const a = data[idx + 3];

        // Determine if this pixel is an "edge"
        // Check if either Force Edge (Range) or Outline is enabled
        let isEdge = false;
        const forceRangeEnabled = config.forceEdge.enabled;
        const outlineConfig = config.forceEdge.outline;
        const outlineEnabled = outlineConfig && outlineConfig.enabled;

        if (forceRangeEnabled || outlineEnabled) {
            // 1. Standard Force Edge (Alpha Range)
            if (forceRangeEnabled) {
                if (a >= forceThrMin && a <= forceThrMax) {
                    isEdge = true;
                }
            }

            // 2. Outline Detection (Check adjacent transparency)
            if (!isEdge && outlineEnabled) {
                const outline = outlineConfig;
                // Target pixel must meet the Opacity Threshold
                if (a >= outline.opacityMin) {
                    const nMax = outline.neighborMax;
                    const pxX = i % width;
                    const pxY = Math.floor(i / width);

                    // Neighbors: Up, Down, Left, Right
                    const offsets = [[0, -1], [0, 1], [-1, 0], [1, 0]];

                    for (const [dx, dy] of offsets) {
                        const nx = pxX + dx;
                        const ny = pxY + dy;
                        let nA = 0; // Assume transparent if out of bounds (edge of canvas)

                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nIdx = (ny * width + nx) * 4;
                            nA = data[nIdx + 3];
                        }

                        // If any neighbor is "transparent enough", mark as edge
                        if (nA <= nMax) {
                            isEdge = true;
                            break;
                        }
                    }
                }
            }
        }

        if (!isEdge && algoEnabled && edgeMap && edgeMap[i] > algoThr) {
            isEdge = true;
        }

        if (!isEdge) continue;

        // Apply adjustments to R, G, B
        let r = data[idx];
        let g = data[idx + 1];
        let b = data[idx + 2];

        // 1. Brightness
        if (adj.brightness !== 0) {
            r += adj.brightness; g += adj.brightness; b += adj.brightness;
        }

        // 2. Contrast
        if (adj.contrast !== 0) {
            r = contrastFactor * (r - 128) + 128;
            g = contrastFactor * (g - 128) + 128;
            b = contrastFactor * (b - 128) + 128;
        }

        // Clamp
        r = Math.min(255, Math.max(0, r));
        g = Math.min(255, Math.max(0, g));
        b = Math.min(255, Math.max(0, b));

        // 3. Saturation & Hue (HSV conversion needed)
        if (adj.saturation !== 0 || adj.hue !== 0) {
            // RGB to HSV
            const rNorm = r / 255, gNorm = g / 255, bNorm = b / 255;
            const max = Math.max(rNorm, gNorm, bNorm), min = Math.min(rNorm, gNorm, bNorm);
            let h, s, v = max;
            const d = max - min;
            s = max === 0 ? 0 : d / max;

            if (max === min) {
                h = 0;
            } else {
                switch (max) {
                    case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
                    case gNorm: h = (bNorm - rNorm) / d + 2; break;
                    case bNorm: h = (rNorm - gNorm) / d + 4; break;
                }
                h /= 6;
            }

            // Apply Saturation
            if (adj.saturation !== 0) {
                s = Math.min(1, Math.max(0, s * satMult));
            }

            // Apply Hue
            if (adj.hue !== 0) {
                h = (h + (hueShift / 360));
                if (h < 0) h += 1;
                if (h > 1) h -= 1;
            }

            // HSV to RGB
            const iH = Math.floor(h * 6);
            const f = h * 6 - iH;
            const p = v * (1 - s);
            const q = v * (1 - f * s);
            const t = v * (1 - (1 - f) * s);

            switch (iH % 6) {
                case 0: r = v; g = t; b = p; break;
                case 1: r = q; g = v; b = p; break;
                case 2: r = p; g = v; b = t; break;
                case 3: r = p; g = q; b = v; break;
                case 4: r = t; g = p; b = v; break;
                case 5: r = v; g = p; b = q; break;
            }
            r *= 255; g *= 255; b *= 255;
        }

        data[idx] = Math.min(255, Math.max(0, r));
        data[idx + 1] = Math.min(255, Math.max(0, g));
        data[idx + 2] = Math.min(255, Math.max(0, b));
    }
};

/**
 * Applies pre-processing (RGB adjustment, Brightness, Contrast) to image data.
 * @param {ImageData} imageData 
 * @param {Object} config { r: number, g: number, b: number, brightness: number, contrast: number }
 */
CRT.core.applyPreProcessing = function (imageData, config) {
    const data = imageData.data;
    const len = data.length;

    let contrastFactor = 1;
    if (config.contrast !== 0) {
        contrastFactor = (259 * (config.contrast + 255)) / (255 * (259 - config.contrast));
    }

    const sat = config.saturation || 0; // -100 to 100
    const satMult = 1 + (sat / 100); // 0 to 2

    const gamma = config.gamma || 1.0;
    const gammaInv = 1 / gamma;

    // Pre-calculate gamma table for performance if gamma is not 1
    let gammaTable = null;
    if (gamma !== 1.0) {
        gammaTable = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            gammaTable[i] = Math.min(255, Math.max(0, Math.pow(i / 255, gammaInv) * 255));
        }
    }

    for (let i = 0; i < len; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        // 1. RGB Adjustment
        r += config.r; g += config.g; b += config.b;

        // 2. Brightness
        if (config.brightness !== 0) {
            r += config.brightness; g += config.brightness; b += config.brightness;
        }

        // 3. Contrast
        if (config.contrast !== 0) {
            r = contrastFactor * (r - 128) + 128;
            g = contrastFactor * (g - 128) + 128;
            b = contrastFactor * (b - 128) + 128;
        }

        // Clamp after basic adjustments
        r = Math.min(255, Math.max(0, r));
        g = Math.min(255, Math.max(0, g));
        b = Math.min(255, Math.max(0, b));

        // 4. Saturation
        if (sat !== 0) {
            const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            r = lum + (r - lum) * satMult;
            g = lum + (g - lum) * satMult;
            b = lum + (b - lum) * satMult;

            // Clamp again
            r = Math.min(255, Math.max(0, r));
            g = Math.min(255, Math.max(0, g));
            b = Math.min(255, Math.max(0, b));
        }

        // 5. Gamma
        if (gammaTable) {
            r = gammaTable[Math.round(r)];
            g = gammaTable[Math.round(g)];
            b = gammaTable[Math.round(b)];
        }

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
    }
};

/**
 * Creates a visualization of the detected edges.
 * @param {ImageData} sourceData Original image data (for alpha reference)
 * @param {Float32Array} edgeMap Edge magnitudes
 * @param {Object} config Edge configuration
 * @returns {ImageData}
 */
CRT.core.createEdgeVisualization = function (sourceData, edgeMap, config) {
    const width = sourceData.width;
    const height = sourceData.height;
    const output = new ImageData(width, height);
    const sData = sourceData.data;
    const dData = output.data;

    const forceEnabled = config.forceEdge.enabled;
    const forceThrMin = config.forceEdge.thresholdMin || 32;
    const forceThrMax = config.forceEdge.thresholdMax || 254;
    const algoEnabled = config.algorithmEnabled !== false;
    const algoThr = config.threshold;

    for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        const a = sData[idx + 3];

        let isForceEdge = false;
        let isAlgoEdge = false;

        const forceRangeEnabled = config.forceEdge.enabled;
        const outlineConfig = config.forceEdge.outline;
        const outlineEnabled = outlineConfig && outlineConfig.enabled;

        if (forceRangeEnabled || outlineEnabled) {
            if (forceRangeEnabled && a >= forceThrMin && a <= forceThrMax) {
                isForceEdge = true;
            }

            // Outline Detection Visualization
            if (!isForceEdge && outlineEnabled) {
                const outline = outlineConfig;
                if (a >= outline.opacityMin) {
                    const nMax = outline.neighborMax;
                    const pxX = i % width;
                    const pxY = Math.floor(i / width);
                    const offsets = [[0, -1], [0, 1], [-1, 0], [1, 0]];

                    for (const [dx, dy] of offsets) {
                        const nx = pxX + dx;
                        const ny = pxY + dy;
                        let nA = 0;

                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nIdx = (ny * width + nx) * 4;
                            nA = sData[nIdx + 3];
                        }

                        if (nA <= nMax) {
                            isForceEdge = true;
                            break;
                        }
                    }
                }
            }
        }

        if (algoEnabled && edgeMap && edgeMap[i] > algoThr) {
            isAlgoEdge = true;
        }

        // Visualization Logic:
        // Background: Black (or transparent?) -> Let's use Black for contrast
        // Force Edge: Blue
        // Algo Edge: Red
        // Both: Magenta (or White)

        dData[idx + 3] = 255; // Opaque background

        if (isForceEdge && isAlgoEdge) {
            dData[idx] = 255;     // R
            dData[idx + 1] = 0;   // G
            dData[idx + 2] = 255; // B (Magenta)
        } else if (isForceEdge) {
            dData[idx] = 0;
            dData[idx + 1] = 0;
            dData[idx + 2] = 255; // Blue
        } else if (isAlgoEdge) {
            dData[idx] = 255;
            dData[idx + 1] = 0;
            dData[idx + 2] = 0;   // Red
        } else {
            dData[idx] = 0;
            dData[idx + 1] = 0;
            dData[idx + 2] = 0;   // Black
        }
    }
    return output;
};
