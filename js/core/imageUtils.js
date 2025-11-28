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
