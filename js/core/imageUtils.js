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
        if (a === 0) {
            continue;
        }

        // If alpha > 0, treat as full opacity 255 for palette definition purposes 
        const key = `${r},${g},${b},255`;
        if (!uniqueColors.has(key)) {
            if (palette.length >= 1024) {
                alert('Palette color limit (1024) reached. Some colors may be missing.');
                break;
            }
            uniqueColors.add(key);
            palette.push({ r, g, b, a: 255 });
        }
    }

    return palette;
}

/**
 * Simple edge detection using Sobel operator approximation.
 * Returns a Float32Array of edge magnitudes (0-255 normalized).
 * @param {ImageData} imageData 
 * @returns {Float32Array}
 */
CRT.core.detectEdges = function (imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const edges = new Float32Array(width * height);

    const getGray = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return 0;
        const i = (y * width + x) * 4;
        // Simple luminance
        return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    };

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const gx = -getGray(x - 1, y - 1) - 2 * getGray(x - 1, y) - getGray(x - 1, y + 1) +
                getGray(x + 1, y - 1) + 2 * getGray(x + 1, y) + getGray(x + 1, y + 1);
            const gy = -getGray(x - 1, y - 1) - 2 * getGray(x, y - 1) - getGray(x + 1, y - 1) +
                getGray(x - 1, y + 1) + 2 * getGray(x, y + 1) + getGray(x + 1, y + 1);

            const magnitude = Math.sqrt(gx * gx + gy * gy);
            edges[y * width + x] = magnitude;
        }
    }
    return edges;
}

/**
 * Applies pre-processing (RGB adjustment, Brightness, Contrast) to image data.
 * @param {ImageData} imageData 
 * @param {Object} config { r: number, g: number, b: number, brightness: number, contrast: number }
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
        if (a === 0) {
            continue;
        }

        // If alpha > 0, treat as full opacity 255 for palette definition purposes 
        const key = `${r},${g},${b},255`;
        if (!uniqueColors.has(key)) {
            if (palette.length >= 1024) {
                alert('Palette color limit (1024) reached. Some colors may be missing.');
                break;
            }
            uniqueColors.add(key);
            palette.push({ r, g, b, a: 255 });
        }
    }

    return palette;
}

/**
 * Simple edge detection using Sobel operator approximation.
 * Returns a Float32Array of edge magnitudes (0-255 normalized).
 * @param {ImageData} imageData 
 * @returns {Float32Array}
 */
CRT.core.detectEdges = function (imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const edges = new Float32Array(width * height);

    const getGray = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return 0;
        const i = (y * width + x) * 4;
        // Simple luminance
        return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    };

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const gx = -getGray(x - 1, y - 1) - 2 * getGray(x - 1, y) - getGray(x - 1, y + 1) +
                getGray(x + 1, y - 1) + 2 * getGray(x + 1, y) + getGray(x + 1, y + 1);
            const gy = -getGray(x - 1, y - 1) - 2 * getGray(x, y - 1) - getGray(x + 1, y - 1) +
                getGray(x - 1, y + 1) + 2 * getGray(x, y + 1) + getGray(x + 1, y + 1);

            const magnitude = Math.sqrt(gx * gx + gy * gy);
            edges[y * width + x] = magnitude;
        }
    }
    return edges;
}

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
