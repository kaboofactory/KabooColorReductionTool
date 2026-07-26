/**
 * Convert to Pixel Art v0.11
 * Two-dimensional adaptive lattice reconstruction for AI-generated pseudo pixel art.
 *
 * Independent from Pseudo Dot Width / Smart downsampling.
 */
(function () {
    'use strict';

    if (!window.CRT || !CRT.core || CRT.core.__pixelArtConversionInstalled) return;

    const VERSION = '0.11.0';
    const DEFAULTS = Object.freeze({
        maxColors: 48,
        detailPreservation: 0.60,
        minCellSize: 3,
        maxCellSize: 12,
        alphaThreshold: 48,
        bandCellSpan: 10,
        bandOverlap: 0.50,
        localWarpRadius: 0.85,
        microstructureSensitivity: 0.72,
        structureProtection: 0.90,
        binaryRegionProtection: 0.88,
        rectilinearProtection: 0.88,
        silhouetteEdgeProtection: 0.88,
        axisSeamProtection: 0.82
    });

    const SRGB_TO_LINEAR = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
        const c = i / 255;
        SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function numberOrDefault(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function rgbToOklab(r8, g8, b8) {
        const r = SRGB_TO_LINEAR[r8], g = SRGB_TO_LINEAR[g8], b = SRGB_TO_LINEAR[b8];
        const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
        const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
        const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
        const lr = Math.cbrt(Math.max(0, l));
        const mr = Math.cbrt(Math.max(0, m));
        const sr = Math.cbrt(Math.max(0, s));
        return [
            0.2104542553 * lr + 0.7936177850 * mr - 0.0040720468 * sr,
            1.9779984951 * lr - 2.4285922050 * mr + 0.4505937099 * sr,
            0.0259040371 * lr + 0.7827717662 * mr - 0.8086757660 * sr
        ];
    }

    function distSq(a, b) {
        const dL = (a.L - b.L) * 1.2;
        const dA = a.A - b.A;
        const dB = a.B - b.B;
        return dL * dL + dA * dA + dB * dB;
    }
    function nearestPaletteLabel(color, palette) {
        let best = 0, bd = Infinity;
        for (let k = 0; k < palette.length; k++) {
            const d = distSq(color, palette[k]);
            if (d < bd) { bd = d; best = k; }
        }
        return best;
    }


    function analyze(imageData) {
        const { width, height, data } = imageData;
        const n = width * height;
        const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
        const alpha = new Uint8Array(n), gradient = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const p = i * 4;
            const lab = rgbToOklab(data[p], data[p + 1], data[p + 2]);
            L[i] = lab[0]; A[i] = lab[1]; B[i] = lab[2]; alpha[i] = data[p + 3];
        }
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * width + x;
                let g = 0;
                if (x > 0) {
                    const j = i - 1;
                    g = Math.max(g, Math.hypot((L[i] - L[j]) * 1.2, A[i] - A[j], B[i] - B[j]));
                }
                if (x + 1 < width) {
                    const j = i + 1;
                    g = Math.max(g, Math.hypot((L[i] - L[j]) * 1.2, A[i] - A[j], B[i] - B[j]));
                }
                if (y > 0) {
                    const j = i - width;
                    g = Math.max(g, Math.hypot((L[i] - L[j]) * 1.2, A[i] - A[j], B[i] - B[j]));
                }
                if (y + 1 < height) {
                    const j = i + width;
                    g = Math.max(g, Math.hypot((L[i] - L[j]) * 1.2, A[i] - A[j], B[i] - B[j]));
                }
                gradient[i] = clamp(g / 0.28, 0, 1);
            }
        }
        return { width, height, data, L, A, B, alpha, gradient };
    }

    function buildAxisEdgeProfile(source, horizontalAxis, crossStart, crossEnd) {
        const length = horizontalAxis ? source.width : source.height;
        const crossLength = horizontalAxis ? source.height : source.width;
        const q0 = clamp(Math.floor(crossStart == null ? 0 : crossStart), 0, crossLength);
        const q1 = clamp(Math.ceil(crossEnd == null ? crossLength : crossEnd), q0 + 1, crossLength);
        const profile = new Float32Array(length);
        for (let pos = 1; pos < length; pos++) {
            let sum = 0;
            for (let q = q0; q < q1; q++) {
                const i0 = horizontalAxis ? q * source.width + pos - 1 : (pos - 1) * source.width + q;
                const i1 = horizontalAxis ? i0 + 1 : i0 + source.width;
                const alphaDiff = Math.abs(source.alpha[i0] - source.alpha[i1]) / 255;
                const color = Math.hypot(
                    (source.L[i0] - source.L[i1]) * 1.2,
                    source.A[i0] - source.A[i1],
                    source.B[i0] - source.B[i1]
                );
                sum += clamp(color / 0.24 + alphaDiff * 0.65, 0, 1.5);
            }
            profile[pos] = sum / Math.max(1, q1 - q0);
        }
        const smooth = new Float32Array(length);
        for (let i = 0; i < length; i++) {
            let s = 0, w = 0;
            for (let d = -1; d <= 1; d++) {
                const j = i + d;
                if (j >= 0 && j < length) {
                    const ww = d === 0 ? 2 : 1;
                    s += profile[j] * ww; w += ww;
                }
            }
            smooth[i] = s / Math.max(1, w);
        }
        return smooth;
    }

    function sampleProfile(profile, position) {
        const i = Math.floor(position);
        const t = position - i;
        if (i < 0 || i >= profile.length - 1) return 0;
        return profile[i] * (1 - t) + profile[i + 1] * t;
    }

    function estimateBasePeriod(profile, minSize, maxSize) {
        let bestSize = minSize;
        let bestScore = -Infinity;
        for (let size = minSize; size <= maxSize + 1e-6; size += 0.25) {
            let corr = 0, norm = 0;
            const first = Math.ceil(size);
            for (let i = first; i < profile.length; i++) {
                const shifted = sampleProfile(profile, i - size);
                corr += profile[i] * shifted;
                norm += profile[i] * profile[i] + shifted * shifted;
            }
            corr = norm > 0 ? (2 * corr / norm) : 0;
            let phaseBest = 0;
            for (let phase = 0; phase < size; phase += 0.5) {
                let s = 0, c = 0;
                for (let p = phase; p < profile.length; p += size) {
                    s += sampleProfile(profile, p); c++;
                }
                if (c) phaseBest = Math.max(phaseBest, s / c);
            }
            const score = corr * 0.74 + phaseBest * 0.26 - size * 0.0015;
            if (score > bestScore) { bestScore = score; bestSize = size; }
        }
        return bestSize;
    }

    function solveAdaptiveBoundaries(profile, baseSize, detail) {
        const length = profile.length;
        const minStep = Math.max(2, Math.floor(baseSize * 0.58));
        const maxStep = Math.max(minStep + 1, Math.ceil(baseSize * 1.55));
        const dp = new Float64Array(length + 1);
        const prev = new Int32Array(length + 1);
        dp.fill(-Infinity); prev.fill(-1); dp[0] = 0;

        for (let x = 1; x <= length; x++) {
            for (let step = minStep; step <= maxStep; step++) {
                const p = x - step;
                if (p < 0 || !Number.isFinite(dp[p])) continue;
                const spacingPenalty = Math.pow((step - baseSize) / Math.max(1, baseSize), 2);
                const boundaryReward = x < length ? profile[x] : 0.25;
                const score = dp[p] + boundaryReward * (0.78 + detail * 0.52) - spacingPenalty * 0.42;
                if (score > dp[x]) { dp[x] = score; prev[x] = p; }
            }
        }

        let end = length;
        if (prev[end] < 0) {
            let best = -Infinity;
            for (let x = Math.max(1, length - maxStep); x <= length; x++) {
                const tail = length - x;
                const score = dp[x] - tail * 0.04;
                if (score > best) { best = score; end = x; }
            }
        }

        const rev = [length];
        let x = end;
        if (x !== length) rev.push(x);
        while (x > 0 && prev[x] >= 0) { x = prev[x]; rev.push(x); }
        if (rev[rev.length - 1] !== 0) rev.push(0);
        rev.sort((a, b) => a - b);

        const out = [0];
        for (let i = 1; i < rev.length; i++) {
            const value = rev[i];
            if (value === length || value - out[out.length - 1] >= minStep) out.push(value);
        }
        if (out[out.length - 1] !== length) out.push(length);
        return out;
    }

    function profileConfidence(profile) {
        let sum = 0, max = 0;
        for (let i = 0; i < profile.length; i++) {
            sum += profile[i];
            if (profile[i] > max) max = profile[i];
        }
        const mean = sum / Math.max(1, profile.length);
        return clamp((max - mean) / 0.24, 0.18, 1);
    }

    function solveLocalBoundaries(profile, globalBounds, baseSize, detail, warpRadius) {
        const boundaryCount = globalBounds.length;
        const radius = Math.max(2, Math.round(baseSize * warpRadius));
        const minStep = Math.max(2, Math.floor(baseSize * 0.42));
        const maxStep = Math.max(minStep + 1, Math.ceil(baseSize * 1.85));
        const candidates = new Array(boundaryCount);

        candidates[0] = [0];
        candidates[boundaryCount - 1] = [profile.length];
        for (let j = 1; j + 1 < boundaryCount; j++) {
            const center = globalBounds[j];
            const lo = Math.max(1, Math.round(center - radius));
            const hi = Math.min(profile.length - 1, Math.round(center + radius));
            const list = [];
            for (let p = lo; p <= hi; p++) list.push(p);
            candidates[j] = list;
        }

        const scores = new Array(boundaryCount);
        const back = new Array(boundaryCount);
        scores[0] = new Float64Array([0]);
        back[0] = new Int16Array([-1]);

        for (let j = 1; j < boundaryCount; j++) {
            const curr = candidates[j];
            const prev = candidates[j - 1];
            const currScores = new Float64Array(curr.length);
            const currBack = new Int16Array(curr.length);
            currScores.fill(-Infinity); currBack.fill(-1);
            const expectedStep = globalBounds[j] - globalBounds[j - 1];

            for (let a = 0; a < curr.length; a++) {
                const pos = curr[a];
                const shift = pos - globalBounds[j];
                const edgeReward = j + 1 === boundaryCount ? 0.25 : profile[pos];
                for (let b = 0; b < prev.length; b++) {
                    if (!Number.isFinite(scores[j - 1][b])) continue;
                    const previousPos = prev[b];
                    const step = pos - previousPos;
                    if (step < minStep || step > maxStep) continue;
                    const previousShift = previousPos - globalBounds[j - 1];
                    const spacingPenalty = Math.pow((step - expectedStep) / Math.max(1, baseSize), 2);
                    const bendPenalty = Math.pow((shift - previousShift) / Math.max(1, baseSize), 2);
                    const absolutePenalty = Math.pow(shift / Math.max(1, radius), 2);
                    const score = scores[j - 1][b] +
                        edgeReward * (0.95 + detail * 0.50) -
                        spacingPenalty * 0.36 -
                        bendPenalty * 0.14 -
                        absolutePenalty * 0.035;
                    if (score > currScores[a]) {
                        currScores[a] = score;
                        currBack[a] = b;
                    }
                }
            }
            scores[j] = currScores;
            back[j] = currBack;
        }

        const lastScores = scores[boundaryCount - 1];
        let bestIndex = 0;
        let bestScore = lastScores[0];
        for (let i = 1; i < lastScores.length; i++) {
            if (lastScores[i] > bestScore) { bestScore = lastScores[i]; bestIndex = i; }
        }
        if (!Number.isFinite(bestScore)) return globalBounds.slice();

        const result = new Array(boundaryCount);
        let index = bestIndex;
        for (let j = boundaryCount - 1; j >= 0; j--) {
            result[j] = candidates[j][index];
            index = back[j][index];
            if (j > 0 && index < 0) return globalBounds.slice();
        }

        const confidence = profileConfidence(profile);
        const blend = 0.30 + 0.70 * confidence;
        result[0] = 0;
        result[boundaryCount - 1] = profile.length;
        for (let j = 1; j + 1 < boundaryCount; j++) {
            result[j] = globalBounds[j] * (1 - blend) + result[j] * blend;
        }
        return result;
    }

    function enforceMonotonic(boundaries, length, minGap) {
        boundaries[0] = 0;
        boundaries[boundaries.length - 1] = length;
        for (let i = 1; i < boundaries.length; i++) {
            boundaries[i] = Math.max(boundaries[i], boundaries[i - 1] + minGap);
        }
        boundaries[boundaries.length - 1] = length;
        for (let i = boundaries.length - 2; i >= 0; i--) {
            boundaries[i] = Math.min(boundaries[i], boundaries[i + 1] - minGap);
        }
        boundaries[0] = 0;
        return boundaries;
    }

    function buildBoundaryField(source, horizontalAxis, globalBounds, baseAlong, baseCross, options) {
        const crossLength = horizontalAxis ? source.height : source.width;
        const span = clamp(Math.round(baseCross * options.bandCellSpan), 32, 96);
        const stride = Math.max(12, Math.round(span * (1 - options.bandOverlap)));
        const centers = [];
        const rows = [];

        for (let start = 0; start < crossLength; start += stride) {
            const end = Math.min(crossLength, start + span);
            const actualStart = Math.max(0, end - span);
            const center = (actualStart + end) * 0.5;
            if (centers.length && Math.abs(center - centers[centers.length - 1]) < 1) continue;
            const profile = buildAxisEdgeProfile(source, horizontalAxis, actualStart, end);
            const local = solveLocalBoundaries(
                profile, globalBounds, baseAlong, options.detailPreservation, options.localWarpRadius
            );
            centers.push(center);
            rows.push(local);
            if (end === crossLength) break;
        }

        if (centers.length === 1) {
            centers.unshift(0);
            rows.unshift(rows[0].slice());
            centers.push(crossLength);
            rows.push(rows[rows.length - 1].slice());
        }

        // Smooth the displacement field between neighboring bands without
        // collapsing legitimate local phase changes.
        for (let pass = 0; pass < 2; pass++) {
            const copy = rows.map(row => row.slice());
            for (let r = 1; r + 1 < rows.length; r++) {
                for (let j = 1; j + 1 < rows[r].length; j++) {
                    rows[r][j] = copy[r][j] * 0.62 + (copy[r - 1][j] + copy[r + 1][j]) * 0.19;
                }
                enforceMonotonic(rows[r], horizontalAxis ? source.width : source.height, 1);
            }
        }

        return { centers, rows, length: horizontalAxis ? source.width : source.height };
    }

    function interpolateFieldBoundary(field, boundaryIndex, crossPosition) {
        const centers = field.centers;
        if (crossPosition <= centers[0]) return field.rows[0][boundaryIndex];
        const last = centers.length - 1;
        if (crossPosition >= centers[last]) return field.rows[last][boundaryIndex];
        let lo = 0, hi = last;
        while (lo + 1 < hi) {
            const mid = (lo + hi) >> 1;
            if (centers[mid] <= crossPosition) lo = mid;
            else hi = mid;
        }
        const denom = Math.max(1e-6, centers[hi] - centers[lo]);
        const t = (crossPosition - centers[lo]) / denom;
        return field.rows[lo][boundaryIndex] * (1 - t) + field.rows[hi][boundaryIndex] * t;
    }

    function buildMesh(xField, yField, globalX, globalY, sourceWidth, sourceHeight) {
        const cols = globalX.length - 1;
        const rows = globalY.length - 1;
        const meshWidth = cols + 1;
        const meshHeight = rows + 1;
        const points = new Float32Array(meshWidth * meshHeight * 2);

        for (let v = 0; v <= rows; v++) {
            for (let u = 0; u <= cols; u++) {
                let x = globalX[u];
                let y = globalY[v];
                for (let iteration = 0; iteration < 4; iteration++) {
                    x = interpolateFieldBoundary(xField, u, y);
                    y = interpolateFieldBoundary(yField, v, x);
                }
                const p = (v * meshWidth + u) * 2;
                points[p] = clamp(x, 0, sourceWidth);
                points[p + 1] = clamp(y, 0, sourceHeight);
            }
        }

        // Prevent mesh foldovers. Preserve the local warp while keeping every
        // quadrilateral at least one source pixel wide and high.
        for (let v = 0; v <= rows; v++) {
            for (let u = 1; u <= cols; u++) {
                const p = (v * meshWidth + u) * 2;
                const q = p - 2;
                if (points[p] < points[q] + 1) points[p] = points[q] + 1;
            }
            for (let u = cols - 1; u >= 0; u--) {
                const p = (v * meshWidth + u) * 2;
                const q = p + 2;
                if (points[p] > points[q] - 1) points[p] = points[q] - 1;
            }
        }
        for (let u = 0; u <= cols; u++) {
            for (let v = 1; v <= rows; v++) {
                const p = (v * meshWidth + u) * 2 + 1;
                const q = p - meshWidth * 2;
                if (points[p] < points[q] + 1) points[p] = points[q] + 1;
            }
            for (let v = rows - 1; v >= 0; v--) {
                const p = (v * meshWidth + u) * 2 + 1;
                const q = p + meshWidth * 2;
                if (points[p] > points[q] - 1) points[p] = points[q] - 1;
            }
        }

        return { points, width: meshWidth, height: meshHeight, cols, rows };
    }

    function meshPoint(mesh, x, y) {
        const p = (y * mesh.width + x) * 2;
        return { x: mesh.points[p], y: mesh.points[p + 1] };
    }

    function cross(ax, ay, bx, by) { return ax * by - ay * bx; }

    function pointInQuad(px, py, a, b, c, d) {
        const c1 = cross(b.x - a.x, b.y - a.y, px - a.x, py - a.y);
        const c2 = cross(c.x - b.x, c.y - b.y, px - b.x, py - b.y);
        const c3 = cross(d.x - c.x, d.y - c.y, px - c.x, py - c.y);
        const c4 = cross(a.x - d.x, a.y - d.y, px - d.x, py - d.y);
        const hasNeg = c1 < -0.05 || c2 < -0.05 || c3 < -0.05 || c4 < -0.05;
        const hasPos = c1 > 0.05 || c2 > 0.05 || c3 > 0.05 || c4 > 0.05;
        return !(hasNeg && hasPos);
    }




    function colorDistance(a, b) { return Math.sqrt(distSq(a, b)); }

    function projectToBinaryAxis(color, dark, light) {
        const ax = dark.L * 1.2, ay = dark.A, az = dark.B;
        const bx = light.L * 1.2, by = light.A, bz = light.B;
        const px = color.L * 1.2, py = color.A, pz = color.B;
        const dx = bx - ax, dy = by - ay, dz = bz - az;
        const denom = dx * dx + dy * dy + dz * dz;
        if (denom < 1e-8) return { t: 0.5, orth: colorDistance(color, dark) };
        const ux = px - ax, uy = py - ay, uz = pz - az;
        const t = (ux * dx + uy * dy + uz * dz) / denom;
        const rx = ux - dx * t, ry = uy - dy * t, rz = uz - dz * t;
        return { t, orth: Math.hypot(rx, ry, rz) };
    }

    function orderBinaryAnchors(a, b) {
        return a.L <= b.L ? { dark: a, light: b } : { dark: b, light: a };
    }

    function createColorAccumulator() {
        return { r: 0, g: 0, b: 0, L: 0, A: 0, B: 0, weight: 0 };
    }

    function accumulateColor(acc, color, weight) {
        if (!color || !(weight > 0)) return;
        acc.r += color.r * weight;
        acc.g += color.g * weight;
        acc.b += color.b * weight;
        acc.L += color.L * weight;
        acc.A += color.A * weight;
        acc.B += color.B * weight;
        acc.weight += weight;
    }

    function finalizeAccumulatedColor(acc, fallback) {
        if (!acc || !(acc.weight > 1e-8)) return fallback;
        const inv = 1 / acc.weight;
        return {
            r: Math.round(acc.r * inv),
            g: Math.round(acc.g * inv),
            b: Math.round(acc.b * inv),
            L: acc.L * inv,
            A: acc.A * inv,
            B: acc.B * inv,
            weight: acc.weight
        };
    }

    function binaryPairDistance(aDark, aLight, bDark, bLight) {
        const direct = colorDistance(aDark, bDark) + colorDistance(aLight, bLight);
        const swapped = colorDistance(aDark, bLight) + colorDistance(aLight, bDark);
        return Math.min(direct, swapped);
    }

    function representativeForQuad(source, a, b, c, d, detail) {
        const bins = new Map();
        const coreBins = new Map();
        const minX = clamp(Math.floor(Math.min(a.x, b.x, c.x, d.x)), 0, source.width - 1);
        const maxX = clamp(Math.ceil(Math.max(a.x, b.x, c.x, d.x)), minX + 1, source.width);
        const minY = clamp(Math.floor(Math.min(a.y, b.y, c.y, d.y)), 0, source.height - 1);
        const maxY = clamp(Math.ceil(Math.max(a.y, b.y, c.y, d.y)), minY + 1, source.height);
        const cx = (a.x + b.x + c.x + d.x) * 0.25;
        const cy = (a.y + b.y + c.y + d.y) * 0.25;
        const normalizer = Math.max(1, Math.hypot(maxX - minX, maxY - minY) * 0.5);
        let opaqueWeight = 0, totalWeight = 0, coreWeight = 0;
        let weightedL = 0, weightedChroma = 0, minL = Infinity, maxL = -Infinity;
        let centerPixel = null, centerDist = Infinity;
        let brightest = null, darkest = null;

        function addBin(map, key, r, g, bb, weight, peak, i) {
            let bin = map.get(key);
            if (!bin) {
                bin = { r, g, b: bb, weight: 0, peak: 0, L: source.L[i], A: source.A[i], B: source.B[i] };
                map.set(key, bin);
            }
            bin.weight += weight;
            if (peak > bin.peak) {
                bin.peak = peak;
                bin.r = r; bin.g = g; bin.b = bb;
                bin.L = source.L[i]; bin.A = source.A[i]; bin.B = source.B[i];
            }
        }

        for (let y = minY; y < maxY; y++) {
            for (let x = minX; x < maxX; x++) {
                const px = x + 0.5, py = y + 0.5;
                if (!pointInQuad(px, py, a, b, c, d)) continue;
                const i = y * source.width + x;
                const centerDistance = Math.hypot(px - cx, py - cy) / normalizer;
                const centerWeight = 0.72 + 0.28 * clamp(1 - centerDistance, 0, 1);
                const edgeWeight = 0.90 + detail * source.gradient[i] * 0.25;
                const weight = centerWeight * edgeWeight;
                totalWeight += weight;
                const chroma = Math.hypot(source.A[i], source.B[i]);
                weightedL += source.L[i] * weight;
                weightedChroma += chroma * weight;
                if (source.L[i] < minL) minL = source.L[i];
                if (source.L[i] > maxL) maxL = source.L[i];
                if (centerDistance < centerDist) {
                    centerDist = centerDistance;
                    const p = i * 4;
                    centerPixel = {
                        r: source.data[p], g: source.data[p + 1], b: source.data[p + 2],
                        L: source.L[i], A: source.A[i], B: source.B[i], alpha: source.alpha[i]
                    };
                }
                if (!brightest || source.L[i] > brightest.L) {
                    const p = i * 4;
                    brightest = { r: source.data[p], g: source.data[p + 1], b: source.data[p + 2], L: source.L[i], A: source.A[i], B: source.B[i] };
                }
                if (!darkest || source.L[i] < darkest.L) {
                    const p = i * 4;
                    darkest = { r: source.data[p], g: source.data[p + 1], b: source.data[p + 2], L: source.L[i], A: source.A[i], B: source.B[i] };
                }
                if (source.alpha[i] < 48) continue;
                opaqueWeight += weight;
                const p = i * 4;
                const r = source.data[p], g = source.data[p + 1], bb = source.data[p + 2];
                const key = `${r >> 3},${g >> 3},${bb >> 3}`;
                const peak = weight * (0.78 + 0.22 * source.gradient[i]);
                addBin(bins, key, r, g, bb, weight, peak, i);

                // The central core is deliberately much smaller than the full
                // quadrilateral. A one-source-pixel stroke can be a minority in
                // the cell while still occupying its intended lattice center.
                const coreFalloff = clamp((0.58 - centerDistance) / 0.42, 0, 1);
                if (coreFalloff > 0) {
                    const coreContribution = weight * (0.45 + coreFalloff * 1.75);
                    coreWeight += coreContribution;
                    addBin(coreBins, key, r, g, bb, coreContribution,
                        coreContribution * (0.78 + 0.22 * source.gradient[i]), i);
                }
            }
        }

        const meanL = totalWeight > 0 ? weightedL / totalWeight : 0;
        const meanChroma = totalWeight > 0 ? weightedChroma / totalWeight : 0;
        const contrast = Number.isFinite(minL) && Number.isFinite(maxL) ? (maxL - minL) : 0;
        const lowChromaScore = clamp((0.11 - meanChroma) / 0.11, 0, 1);
        const centerContrast = centerPixel ? Math.abs(centerPixel.L - meanL) : 0;
        const microScore = contrast * (0.55 + 0.45 * lowChromaScore) * (0.70 + 0.30 * clamp(centerContrast / 0.18, 0, 1));

        let microMode = null;
        let microPreferredColor = null;
        if (centerPixel && contrast >= 0.18 && lowChromaScore >= 0.35) {
            const brightThreshold = minL + contrast * 0.62;
            const darkThreshold = minL + contrast * 0.38;
            if (centerPixel.L >= brightThreshold && brightest) {
                microMode = 'bright';
                microPreferredColor = brightest;
            } else if (centerPixel.L <= darkThreshold && darkest) {
                microMode = 'dark';
                microPreferredColor = darkest;
            }
        }

        if (bins.size === 0 || opaqueWeight < totalWeight * 0.28) {
            return {
                transparent: true,
                weight: totalWeight,
                confidence: 1,
                microScore,
                microMode,
                microPreferredColor,
                structureScore: 0,
                structurePreferredColor: null,
                corePurity: 0,
                coreFullShare: 0,
                binaryScore: 0,
                binaryDarkColor: null,
                binaryLightColor: null,
                binaryResidualShare: 1,
                binaryBalance: 0,
                meanL,
                contrast,
                lowChromaScore
            };
        }

        const sorted = Array.from(bins.values()).sort((x, y) => y.weight - x.weight);
        let best = sorted[0];
        let bestScore = -Infinity;
        for (const bin of sorted) {
            const score = bin.weight + bin.peak * detail * 0.35;
            if (score > bestScore) { bestScore = score; best = bin; }
        }
        const second = sorted.length > 1 ? sorted[1].weight : 0;
        const confidence = clamp((best.weight - second) / Math.max(1e-6, best.weight), 0, 1);

        let structurePreferredColor = null;
        let structureScore = 0;
        let corePurity = 0;
        let coreFullShare = 0;
        if (coreBins.size && coreWeight > 0) {
            const coreSorted = Array.from(coreBins.values()).sort((x, y) => y.weight - x.weight);
            const coreBest = coreSorted[0];
            corePurity = clamp(coreBest.weight / Math.max(1e-6, coreWeight), 0, 1);
            const key = `${coreBest.r >> 3},${coreBest.g >> 3},${coreBest.b >> 3}`;
            const matchingFull = bins.get(key);
            coreFullShare = matchingFull ? clamp(matchingFull.weight / Math.max(1e-6, opaqueWeight), 0, 1) : 0;
            const centerAgreement = centerPixel
                ? clamp(1 - Math.sqrt(distSq(centerPixel, coreBest)) / 0.16, 0, 1)
                : 0;
            const colorSeparation = Math.sqrt(distSq(coreBest, best));
            const purityTerm = clamp((corePurity - 0.38) / 0.50, 0, 1);
            const contrastTerm = clamp(Math.max(contrast / 0.20, colorSeparation / 0.12), 0, 1);
            const minorityTerm = 0.68 + 0.32 * clamp((0.72 - coreFullShare) / 0.50, 0, 1);
            structureScore = purityTerm * contrastTerm * minorityTerm * (0.72 + 0.28 * centerAgreement);
            structurePreferredColor = coreBest;
        }

        let binaryScore = 0;
        let binaryDarkColor = null;
        let binaryLightColor = null;
        let binaryResidualShare = 1;
        let binaryBalance = 0;
        if (sorted.length >= 2) {
            const candidates = sorted.slice(0, Math.min(5, sorted.length));
            let bestBinaryScore = -Infinity;
            for (let i = 0; i < candidates.length; i++) {
                for (let j = i + 1; j < candidates.length; j++) {
                    const ordered = orderBinaryAnchors(candidates[i], candidates[j]);
                    const dark = ordered.dark, light = ordered.light;
                    const separation = colorDistance(dark, light);
                    if (separation < 0.055) continue;

                    let modeled = 0, residual = 0, endpoint = 0, centerAxis = 0;
                    for (const bin of sorted) {
                        const proj = projectToBinaryAxis(bin, dark, light);
                        const nearAxis = proj.orth <= 0.020 + separation * 0.22;
                        const nearRange = proj.t >= -0.22 && proj.t <= 1.22;
                        if (nearAxis && nearRange) {
                            modeled += bin.weight;
                            if (proj.t <= 0.18 || proj.t >= 0.82) endpoint += bin.weight;
                            else centerAxis += bin.weight;
                        } else {
                            residual += bin.weight;
                        }
                    }

                    const coverage = modeled / Math.max(1e-6, opaqueWeight);
                    const endpointShare = endpoint / Math.max(1e-6, opaqueWeight);
                    const residualShare = residual / Math.max(1e-6, opaqueWeight);
                    const middleShare = centerAxis / Math.max(1e-6, opaqueWeight);
                    const balance = Math.min(dark.weight, light.weight) / Math.max(1e-6, dark.weight + light.weight);
                    const sepTerm = clamp((separation - 0.06) / 0.16, 0, 1);
                    const coverageTerm = clamp((coverage - 0.56) / 0.34, 0, 1);
                    const residualTerm = clamp((0.30 - residualShare) / 0.30, 0, 1);
                    const endpointTerm = clamp((endpointShare - 0.34) / 0.40, 0, 1);
                    const balanceTerm = clamp((balance - 0.10) / 0.28, 0, 1);
                    const bridgeTerm = clamp((middleShare - 0.03) / 0.18, 0, 1);
                    const centerSupport = centerPixel
                        ? clamp(1 - Math.min(
                            colorDistance(centerPixel, dark),
                            colorDistance(centerPixel, light)
                        ) / 0.16, 0, 1)
                        : 0;
                    const score =
                        sepTerm *
                        (0.32 + 0.30 * coverageTerm + 0.18 * endpointTerm + 0.12 * residualTerm + 0.08 * bridgeTerm) *
                        (0.56 + 0.44 * balanceTerm) *
                        (0.78 + 0.22 * centerSupport);
                    if (score > bestBinaryScore) {
                        bestBinaryScore = score;
                        binaryScore = score;
                        binaryDarkColor = dark;
                        binaryLightColor = light;
                        binaryResidualShare = residualShare;
                        binaryBalance = balance;
                    }
                }
            }
        }

        return {
            ...best,
            transparent: false,
            weight: opaqueWeight,
            confidence,
            microScore,
            microMode,
            microPreferredColor,
            structureScore,
            structurePreferredColor,
            corePurity,
            coreFullShare,
            binaryScore,
            binaryDarkColor,
            binaryLightColor,
            binaryResidualShare,
            binaryBalance,
            meanL,
            contrast,
            lowChromaScore
        };
    }

    function buildCellRepresentatives(source, mesh, options) {
        const cells = new Array(mesh.cols * mesh.rows);
        for (let y = 0; y < mesh.rows; y++) {
            for (let x = 0; x < mesh.cols; x++) {
                const a = meshPoint(mesh, x, y);
                const b = meshPoint(mesh, x + 1, y);
                const c = meshPoint(mesh, x + 1, y + 1);
                const d = meshPoint(mesh, x, y + 1);
                cells[y * mesh.cols + x] = representativeForQuad(
                    source, a, b, c, d, options.detailPreservation
                );
            }
        }
        return { cells, width: mesh.cols, height: mesh.rows };
    }


    function detectBinaryRegions(cellGrid, options) {
        const { width, height, cells } = cellGrid;
        const protection = clamp(numberOrDefault(options.binaryRegionProtection, DEFAULTS.binaryRegionProtection), 0, 1);
        const strongThreshold = 0.42 + (1 - protection) * 0.14;
        const weakThreshold = Math.max(0.24, strongThreshold - 0.12);
        const pairTolerance = 0.10 + (1 - protection) * 0.06;
        const cellRegionIds = new Int16Array(width * height);
        cellRegionIds.fill(-1);
        const visited = new Uint8Array(width * height);
        const regions = [];

        for (let start = 0; start < cells.length; start++) {
            const seed = cells[start];
            if (visited[start] || seed.transparent || seed.binaryScore < strongThreshold || !seed.binaryDarkColor || !seed.binaryLightColor) {
                continue;
            }
            const queue = [start];
            visited[start] = 1;
            const members = [];
            let totalWeight = 0, totalScore = 0;
            const darkAcc = createColorAccumulator();
            const lightAcc = createColorAccumulator();

            while (queue.length) {
                const i = queue.pop();
                const cell = cells[i];
                members.push(i);
                const w = Math.max(0.2, cell.weight * (0.35 + cell.binaryScore));
                totalWeight += cell.weight;
                totalScore += cell.binaryScore;
                accumulateColor(darkAcc, cell.binaryDarkColor, w);
                accumulateColor(lightAcc, cell.binaryLightColor, w);

                const x = i % width;
                const y = (i / width) | 0;
                const neighbors = [];
                if (x > 0) neighbors.push(i - 1);
                if (x + 1 < width) neighbors.push(i + 1);
                if (y > 0) neighbors.push(i - width);
                if (y + 1 < height) neighbors.push(i + width);
                for (const j of neighbors) {
                    if (visited[j]) continue;
                    const other = cells[j];
                    if (other.transparent || other.binaryScore < weakThreshold || !other.binaryDarkColor || !other.binaryLightColor) continue;
                    const pairDist = binaryPairDistance(seed.binaryDarkColor, seed.binaryLightColor, other.binaryDarkColor, other.binaryLightColor);
                    if (pairDist > pairTolerance) continue;
                    visited[j] = 1;
                    queue.push(j);
                }
            }

            const regionSize = members.length;
            const avgScore = totalScore / Math.max(1, regionSize);
            if (regionSize < 3 || avgScore < weakThreshold) continue;
            const darkColor = finalizeAccumulatedColor(darkAcc, seed.binaryDarkColor);
            const lightColor = finalizeAccumulatedColor(lightAcc, seed.binaryLightColor);
            const ordered = orderBinaryAnchors(darkColor, lightColor);
            const regionId = regions.length;
            const strength = clamp(avgScore * (0.72 + 0.28 * clamp((regionSize - 1) / 4, 0, 1)), 0, 1);
            regions.push({
                id: regionId,
                members,
                size: regionSize,
                totalWeight,
                strength,
                darkColor: ordered.dark,
                lightColor: ordered.light,
                darkLabel: -1,
                lightLabel: -1
            });
            for (const i of members) cellRegionIds[i] = regionId;
        }

        let protectedCells = 0;
        for (let i = 0; i < cellRegionIds.length; i++) if (cellRegionIds[i] >= 0) protectedCells++;
        return { cellRegionIds, regions, protectedCells };
    }

    function extractPalette(cellGrid, maxColors, binaryInfo) {
        const bins = [];
        const regionIds = binaryInfo && binaryInfo.cellRegionIds ? binaryInfo.cellRegionIds : null;
        const regions = binaryInfo && binaryInfo.regions ? binaryInfo.regions : [];

        for (let i = 0; i < cellGrid.cells.length; i++) {
            const c = cellGrid.cells[i];
            if (!c.transparent) {
                let weight = c.weight;
                const regionId = regionIds ? regionIds[i] : -1;
                if (regionId >= 0) {
                    const region = regions[regionId];
                    const proj = projectToBinaryAxis(c, region.darkColor, region.lightColor);
                    const dDark = colorDistance(c, region.darkColor);
                    const dLight = colorDistance(c, region.lightColor);
                    const nearEndpoint = Math.min(dDark, dLight) <= 0.050;
                    const midAxis = proj.t > 0.20 && proj.t < 0.80 && proj.orth <= 0.040;
                    if (midAxis && !nearEndpoint) weight *= 0.16;
                    else if (!nearEndpoint) weight *= 0.45;
                    else weight *= 0.60;
                }
                bins.push({ r: c.r, g: c.g, b: c.b, L: c.L, A: c.A, B: c.B, weight });
            }
            if (c.microPreferredColor && c.microScore > 0.16) {
                bins.push({
                    r: c.microPreferredColor.r,
                    g: c.microPreferredColor.g,
                    b: c.microPreferredColor.b,
                    L: c.microPreferredColor.L,
                    A: c.microPreferredColor.A,
                    B: c.microPreferredColor.B,
                    weight: Math.max(0.25, c.weight * 0.22 * c.microScore * 4.0)
                });
            }
        }

        for (const region of regions) {
            const regionWeight = Math.max(0.5, region.totalWeight * (0.65 + region.strength * 1.35));
            bins.push({ ...region.darkColor, weight: regionWeight });
            bins.push({ ...region.lightColor, weight: regionWeight });
        }

        if (!bins.length) return [{ r: 0, g: 0, b: 0, L: 0, A: 0, B: 0, weight: 1 }];
        bins.sort((a, b) => b.weight - a.weight);
        const selected = [bins[0]];
        const selectedSet = new Set(selected);
        while (selected.length < maxColors && selected.length < bins.length) {
            let best = null, bestScore = -Infinity;
            for (const c of bins) {
                if (selectedSet.has(c)) continue;
                let d = Infinity;
                for (const s of selected) d = Math.min(d, distSq(c, s));
                const score = Math.sqrt(d) * Math.pow(Math.max(c.weight, 1e-6), 0.28);
                if (score > bestScore) { bestScore = score; best = c; }
            }
            if (!best) break;
            selected.push(best); selectedSet.add(best);
        }
        return selected.map(c => ({ r: c.r, g: c.g, b: c.b, L: c.L, A: c.A, B: c.B, weight: c.weight }));
    }



    function mapAndPolish(cellGrid, palette, options, binaryInfo) {
        const { width, height, cells } = cellGrid;
        const transparent = palette.length;
        const labels = new Uint16Array(width * height);
        const microMask = new Uint8Array(width * height);
        const structureMask = new Uint8Array(width * height);
        const preferred = new Int16Array(width * height);
        const structurePreferred = new Int16Array(width * height);
        const binaryMask = new Uint8Array(width * height);
        const binaryRegionIds = binaryInfo && binaryInfo.cellRegionIds ? binaryInfo.cellRegionIds : null;
        const binaryT = new Float32Array(width * height);
        preferred.fill(-1);
        structurePreferred.fill(-1);
        binaryT.fill(0.5);
        const detail = options.detailPreservation;
        const microSensitivity = clamp(numberOrDefault(options.microstructureSensitivity, DEFAULTS.microstructureSensitivity), 0, 1);
        const structureProtection = clamp(numberOrDefault(options.structureProtection, DEFAULTS.structureProtection), 0, 1);
        const binaryProtection = clamp(numberOrDefault(options.binaryRegionProtection, DEFAULTS.binaryRegionProtection), 0, 1);
        const microThreshold = 0.105 + (1 - microSensitivity) * 0.07;
        const structureThreshold = 0.30 + (1 - structureProtection) * 0.24;
        const binaryRegions = binaryInfo && binaryInfo.regions ? binaryInfo.regions : [];

        for (const region of binaryRegions) {
            region.darkLabel = nearestPaletteLabel(region.darkColor, palette);
            region.lightLabel = nearestPaletteLabel(region.lightColor, palette);
            region.active = region.darkLabel !== region.lightLabel;
        }

        function classifyBinaryCell(cell, region) {
            const probes = [];
            if (cell.structurePreferredColor && cell.structureScore >= structureThreshold - 0.04) probes.push({ color: cell.structurePreferredColor, weight: 1.50 });
            if (cell.microPreferredColor && cell.microScore >= microThreshold - 0.02) probes.push({ color: cell.microPreferredColor, weight: 1.20 });
            probes.push({ color: cell, weight: 1.0 });
            let tSum = 0, weightSum = 0;
            for (const probe of probes) {
                const pr = projectToBinaryAxis(probe.color, region.darkColor, region.lightColor);
                tSum += clamp(pr.t, -0.25, 1.25) * probe.weight;
                weightSum += probe.weight;
            }
            const t = weightSum > 0 ? tSum / weightSum : 0.5;
            const centerHalfWidth = 0.10 - binaryProtection * 0.03;
            const lo = 0.5 - centerHalfWidth;
            const hi = 0.5 + centerHalfWidth;
            if (t <= lo) return { label: region.darkLabel, t, decisive: true };
            if (t >= hi) return { label: region.lightLabel, t, decisive: true };
            const dDark = colorDistance(cell, region.darkColor);
            const dLight = colorDistance(cell, region.lightColor);
            return { label: dDark <= dLight ? region.darkLabel : region.lightLabel, t, decisive: false };
        }

        for (let i = 0; i < cells.length; i++) {
            const c = cells[i];
            if (c.transparent) { labels[i] = transparent; continue; }

            const regionId = binaryRegionIds ? binaryRegionIds[i] : -1;
            if (regionId >= 0) {
                const region = binaryRegions[regionId];
                if (region && region.active) {
                    const binaryChoice = classifyBinaryCell(c, region);
                    labels[i] = binaryChoice.label;
                    binaryMask[i] = 1;
                    binaryT[i] = binaryChoice.t;
                    continue;
                }
            }

            const normal = nearestPaletteLabel(c, palette);
            labels[i] = normal;
            if (c.microPreferredColor && c.microScore >= microThreshold && c.contrast >= 0.17) {
                microMask[i] = 1;
                preferred[i] = nearestPaletteLabel(c.microPreferredColor, palette);
            }
            if (c.structurePreferredColor && c.structureScore >= structureThreshold) {
                const want = nearestPaletteLabel(c.structurePreferredColor, palette);
                structureMask[i] = 1;
                structurePreferred[i] = want;
                if (want !== normal) {
                    const separation = Math.sqrt(distSq(palette[want], palette[normal]));
                    const decisiveCore = c.corePurity >= 0.70 && c.structureScore >= structureThreshold + 0.08;
                    const strongMinority = c.coreFullShare <= 0.54 && c.structureScore >= structureThreshold + 0.16;
                    if (separation >= 0.045 && (decisiveCore || strongMinority)) labels[i] = want;
                }
            }
        }

        const out = new Uint16Array(labels);
        const confidenceLimit = 0.12 + (1 - detail) * 0.10;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * width + x;
                const label = labels[i];
                if (label === transparent || cells[i].confidence >= confidenceLimit || microMask[i] || structureMask[i] || binaryMask[i]) continue;
                const ns = [];
                if (x > 0) ns.push(labels[i - 1]);
                if (x + 1 < width) ns.push(labels[i + 1]);
                if (y > 0) ns.push(labels[i - width]);
                if (y + 1 < height) ns.push(labels[i + width]);
                if (ns.length < 4) continue;
                let majority = label, count = 0;
                for (const a of ns) {
                    let c = 0;
                    for (const b of ns) if (a === b) c++;
                    if (c > count) { count = c; majority = a; }
                }
                if (count !== 4 || majority === transparent || majority === label) continue;
                const colorDistance = Math.sqrt(distSq(palette[label], palette[majority]));
                if (colorDistance < 0.055) out[i] = majority;
            }
        }

        function neighborSupport(base, i, x, y, want) {
            const left = x > 0 ? base[i - 1] : transparent;
            const right = x + 1 < width ? base[i + 1] : transparent;
            const up = y > 0 ? base[i - width] : transparent;
            const down = y + 1 < height ? base[i + width] : transparent;
            let support = 0;
            if (left === want) support++;
            if (right === want) support++;
            if (up === want) support++;
            if (down === want) support++;
            const bridge = (left === want && right === want) || (up === want && down === want);
            let diagonal = 0;
            if (x > 0 && y > 0 && base[i - width - 1] === want) diagonal++;
            if (x + 1 < width && y > 0 && base[i - width + 1] === want) diagonal++;
            if (x > 0 && y + 1 < height && base[i + width - 1] === want) diagonal++;
            if (x + 1 < width && y + 1 < height && base[i + width + 1] === want) diagonal++;
            return { support, bridge, diagonal };
        }

        for (let pass = 0; pass < 2; pass++) {
            const base = new Uint16Array(out);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const i = y * width + x;
                    if (!binaryMask[i]) continue;
                    const regionId = binaryRegionIds ? binaryRegionIds[i] : -1;
                    if (regionId < 0) continue;
                    const region = binaryRegions[regionId];
                    if (!region || !region.active) continue;
                    const dark = region.darkLabel, light = region.lightLabel;
                    const current = base[i];
                    const relationDark = neighborSupport(base, i, x, y, dark);
                    const relationLight = neighborSupport(base, i, x, y, light);
                    const t = binaryT[i];
                    const nearCenter = Math.abs(t - 0.5) <= 0.14;
                    if (nearCenter) {
                        const darkVotes = relationDark.support + (relationDark.bridge ? 2 : 0) + relationDark.diagonal * 0.5;
                        const lightVotes = relationLight.support + (relationLight.bridge ? 2 : 0) + relationLight.diagonal * 0.5;
                        if (darkVotes > lightVotes + 0.75) out[i] = dark;
                        else if (lightVotes > darkVotes + 0.75) out[i] = light;
                    } else {
                        const want = t < 0.5 ? dark : light;
                        const relation = want === dark ? relationDark : relationLight;
                        if (current !== want && (relation.bridge || relation.support >= 2 || relation.diagonal >= 2)) out[i] = want;
                    }
                }
            }
        }

        for (let pass = 0; pass < 2; pass++) {
            const base = new Uint16Array(out);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const i = y * width + x;
                    if (!structureMask[i] || structurePreferred[i] < 0 || binaryMask[i]) continue;
                    const want = structurePreferred[i];
                    const current = base[i];
                    if (current === transparent || want === current) continue;
                    const cell = cells[i];
                    const relation = neighborSupport(base, i, x, y, want);
                    const separation = Math.sqrt(distSq(palette[want], palette[current]));
                    const endpoint = relation.support >= 1 && cell.corePurity >= 0.60;
                    const sourceDecisive = cell.structureScore >= structureThreshold + 0.24 && cell.corePurity >= 0.68;
                    const canReplace = separation >= 0.04 && (
                        relation.bridge || relation.support >= 2 || relation.diagonal >= 2 || endpoint || sourceDecisive
                    );
                    if (canReplace) out[i] = want;
                }
            }
        }

        for (let pass = 0; pass < 2; pass++) {
            const base = new Uint16Array(out);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const i = y * width + x;
                    if (!microMask[i] || preferred[i] < 0 || binaryMask[i]) continue;
                    const want = preferred[i];
                    const current = base[i];
                    if (current === transparent || want === current) continue;
                    const cell = cells[i];
                    const wantL = palette[want].L;
                    const currentL = palette[current].L;
                    const wantsBright = cell.microMode === 'bright';
                    if ((wantsBright && wantL <= currentL + 0.02) || (!wantsBright && wantL >= currentL - 0.02)) continue;
                    const relation = neighborSupport(base, i, x, y, want);
                    const sourceStrength = cell.microScore * (0.80 + 0.20 * (1 - cell.confidence));
                    const canReplace = relation.bridge || relation.support >= 2 || relation.diagonal >= 2 || sourceStrength > 0.26;
                    if (canReplace) out[i] = want;
                }
            }
        }

        for (let y = 1; y + 1 < height; y++) {
            for (let x = 1; x + 1 < width; x++) {
                const i = y * width + x;
                if (binaryMask[i]) {
                    const regionId = binaryRegionIds ? binaryRegionIds[i] : -1;
                    if (regionId >= 0) {
                        const region = binaryRegions[regionId];
                        if (region && region.active) {
                            const neighbors = [i - 1, i + 1, i - width, i + width];
                            const ring = out[neighbors[0]];
                            if (ring !== transparent && neighbors.every(j => out[j] === ring)) {
                                const opposite = ring === region.darkLabel ? region.lightLabel : region.darkLabel;
                                if ((ring === region.darkLabel && binaryT[i] >= 0.62) || (ring === region.lightLabel && binaryT[i] <= 0.38)) out[i] = opposite;
                            }
                        }
                    }
                    continue;
                }

                const neighbors = [i - 1, i + 1, i - width, i + width];
                const ring = out[neighbors[0]];
                if (ring === transparent || !neighbors.every(j => out[j] === ring)) continue;

                let want = -1;
                let strength = 0;
                if (structureMask[i] && structurePreferred[i] >= 0) {
                    want = structurePreferred[i];
                    strength = cells[i].structureScore;
                }
                if (microMask[i] && preferred[i] >= 0 && cells[i].microScore > strength) {
                    want = preferred[i];
                    strength = cells[i].microScore;
                }
                if (want >= 0 && want !== ring && strength >= Math.min(microThreshold + 0.03, structureThreshold + 0.08)) {
                    out[i] = want;
                }
            }
        }

        return { labels: out, transparent };
    }

    function protectRectilinearFrames(mapped, palette, width, height, options) {
        const protection = clamp(numberOrDefault(options.rectilinearProtection, DEFAULTS.rectilinearProtection), 0, 1);
        if (protection <= 0 || width < 8 || height < 8 || palette.length < 2) {
            return { mapped, frameCount: 0, snappedCells: 0 };
        }

        const labels = new Uint16Array(mapped.labels);
        const original = new Uint16Array(mapped.labels);
        const transparent = mapped.transparent;
        const familyThreshold = 0.140 + (1 - protection) * 0.040;
        const parent = new Int16Array(palette.length);
        for (let i = 0; i < parent.length; i++) parent[i] = i;
        function findRoot(x) {
            while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
            return x;
        }
        function union(a, b) {
            a = findRoot(a); b = findRoot(b);
            if (a !== b) parent[b] = a;
        }
        function sameColorFamily(a, b) {
            const ca = Math.hypot(a.A, a.B);
            const cb = Math.hypot(b.A, b.B);
            const distance = Math.sqrt(distSq(a, b));
            if (distance > familyThreshold) return false;
            const maxChroma = Math.max(ca, cb);
            if (maxChroma < 0.035) return true;
            const minChroma = Math.min(ca, cb);
            if (minChroma / Math.max(1e-6, maxChroma) < 0.34) return false;
            const hueAgreement = (a.A * b.A + a.B * b.B) / Math.max(1e-6, ca * cb);
            return hueAgreement >= 0.72;
        }
        for (let a = 0; a < palette.length; a++) {
            for (let b = a + 1; b < palette.length; b++) {
                if (sameColorFamily(palette[a], palette[b])) union(a, b);
            }
        }

        const familyMembers = new Map();
        for (let i = 0; i < palette.length; i++) {
            const root = findRoot(i);
            let list = familyMembers.get(root);
            if (!list) { list = []; familyMembers.set(root, list); }
            list.push(i);
        }
        const labelFamily = new Int16Array(palette.length);
        let nextFamily = 0;
        const familyLists = [];
        for (const list of familyMembers.values()) {
            const familyId = nextFamily++;
            familyLists.push(list);
            for (const label of list) labelFamily[label] = familyId;
        }

        function isFamilyLabel(label, familyId) {
            return label !== transparent && label < palette.length && labelFamily[label] === familyId;
        }

        function longestRunInRow(mask, y, minX, maxX) {
            let bestStart = -1, bestEnd = -1, bestLength = 0;
            let start = -1, gap = 0, lastSolid = -1;
            for (let x = minX; x <= maxX; x++) {
                const solid = mask[y * width + x] !== 0;
                if (solid) {
                    if (start < 0) start = x;
                    lastSolid = x;
                    gap = 0;
                } else if (start >= 0 && gap < 1) {
                    gap++;
                } else if (start >= 0) {
                    const length = lastSolid - start + 1;
                    if (length > bestLength) { bestLength = length; bestStart = start; bestEnd = lastSolid; }
                    start = -1; gap = 0; lastSolid = -1;
                }
            }
            if (start >= 0) {
                const length = lastSolid - start + 1;
                if (length > bestLength) { bestLength = length; bestStart = start; bestEnd = lastSolid; }
            }
            return { start: bestStart, end: bestEnd, length: bestLength };
        }

        function sideSupport(mask, horizontal, fixed, start, end) {
            let hits = 0, residual = 0, count = 0;
            for (let p = start; p <= end; p++) {
                let best = Infinity;
                for (let d = -1; d <= 1; d++) {
                    const x = horizontal ? p : fixed + d;
                    const y = horizontal ? fixed + d : p;
                    if (x < 0 || x >= width || y < 0 || y >= height) continue;
                    if (mask[y * width + x]) best = Math.min(best, Math.abs(d));
                }
                count++;
                if (best < Infinity) { hits++; residual += best; }
            }
            return {
                coverage: hits / Math.max(1, count),
                meanResidual: hits ? residual / hits : 1.5
            };
        }

        function componentInteriorRatio(mask, x0, y0, x1, y1, inset) {
            const ax = x0 + inset + 1, bx = x1 - inset - 1;
            const ay = y0 + inset + 1, by = y1 - inset - 1;
            if (ax > bx || ay > by) return 0;
            let total = 0, occupied = 0;
            for (let y = ay; y <= by; y++) {
                for (let x = ax; x <= bx; x++) {
                    total++;
                    if (mask[y * width + x]) occupied++;
                }
            }
            return occupied / Math.max(1, total);
        }

        function dominantNearbyLabel(familyId, horizontal, fixed, start, end) {
            const counts = new Map();
            for (let p = start; p <= end; p++) {
                for (let d = -1; d <= 1; d++) {
                    const x = horizontal ? p : fixed + d;
                    const y = horizontal ? fixed + d : p;
                    if (x < 0 || x >= width || y < 0 || y >= height) continue;
                    const label = original[y * width + x];
                    if (!isFamilyLabel(label, familyId)) continue;
                    counts.set(label, (counts.get(label) || 0) + (d === 0 ? 2 : 1));
                }
            }
            let best = familyLists[familyId][0], bestCount = -1;
            for (const [label, count] of counts) {
                if (count > bestCount) { best = label; bestCount = count; }
            }
            return best;
        }

        function nearbyFamilyLabel(familyId, x, y, fallback) {
            let bestLabel = fallback, bestDistance = Infinity, bestColorDistance = Infinity;
            const anchor = palette[fallback];
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx, yy = y + dy;
                    if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
                    const label = original[yy * width + xx];
                    if (!isFamilyLabel(label, familyId)) continue;
                    const spatial = Math.abs(dx) + Math.abs(dy);
                    const cd = Math.sqrt(distSq(palette[label], anchor));
                    if (spatial < bestDistance || (spatial === bestDistance && cd < bestColorDistance)) {
                        bestDistance = spatial; bestColorDistance = cd; bestLabel = label;
                    }
                }
            }
            return { label: bestLabel, supported: bestDistance < Infinity };
        }

        function chooseReplacement(index, familyId, targetMask) {
            const x = index % width, y = (index / width) | 0;
            const counts = new Map();
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const xx = x + dx, yy = y + dy;
                    if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
                    const j = yy * width + xx;
                    if (targetMask[j]) continue;
                    const label = original[j];
                    if (label === transparent || isFamilyLabel(label, familyId)) continue;
                    counts.set(label, (counts.get(label) || 0) + (Math.abs(dx) + Math.abs(dy) === 1 ? 2 : 1));
                }
            }
            let best = original[index], bestCount = -1;
            for (const [label, count] of counts) {
                if (count > bestCount) { best = label; bestCount = count; }
            }
            return best;
        }

        const candidates = [];
        for (let familyId = 0; familyId < familyLists.length; familyId++) {
            const mask = new Uint8Array(width * height);
            let familyPixelCount = 0;
            for (let i = 0; i < original.length; i++) {
                if (isFamilyLabel(original[i], familyId)) { mask[i] = 1; familyPixelCount++; }
            }
            if (familyPixelCount < 12) continue;

            const visited = new Uint8Array(width * height);
            for (let start = 0; start < mask.length; start++) {
                if (!mask[start] || visited[start]) continue;
                const queue = [start]; visited[start] = 1;
                const members = [];
                let minX = width, maxX = -1, minY = height, maxY = -1;
                while (queue.length) {
                    const i = queue.pop(); members.push(i);
                    const x = i % width, y = (i / width) | 0;
                    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const xx = x + dx, yy = y + dy;
                            if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
                            const j = yy * width + xx;
                            if (mask[j] && !visited[j]) { visited[j] = 1; queue.push(j); }
                        }
                    }
                }

                const boxWidth = maxX - minX + 1, boxHeight = maxY - minY + 1;
                if (members.length < 12 || boxWidth < 6 || boxHeight < 6 || boxWidth > 96 || boxHeight > 96) continue;
                const density = members.length / (boxWidth * boxHeight);
                if (density > 0.48 || density < 0.06) continue;

                const topLimit = Math.min(maxY, minY + Math.max(2, Math.floor(boxHeight * 0.30)));
                const bottomLimit = Math.max(minY, maxY - Math.max(2, Math.floor(boxHeight * 0.30)));
                let top = null, bottom = null;
                for (let y = minY; y <= topLimit; y++) {
                    const run = longestRunInRow(mask, y, minX, maxX);
                    const score = run.length - (y - minY) * 0.20;
                    if (!top || score > top.score) top = { y, ...run, score };
                }
                for (let y = bottomLimit; y <= maxY; y++) {
                    const run = longestRunInRow(mask, y, minX, maxX);
                    const score = run.length - (maxY - y) * 0.20;
                    if (!bottom || score > bottom.score) bottom = { y, ...run, score };
                }
                if (!top || !bottom || top.length < 5 || bottom.length < 5 || bottom.y - top.y < 5) continue;
                const averageRun = (top.length + bottom.length) * 0.5;
                if (averageRun < boxWidth * 0.56) continue;
                if (Math.abs(top.start - bottom.start) > 2 || Math.abs(top.end - bottom.end) > 2) continue;

                const runStart = Math.round((top.start + bottom.start) * 0.5);
                const runEnd = Math.round((top.end + bottom.end) * 0.5);
                let bestGeometry = null;
                for (let inset = 0; inset <= 2; inset++) {
                    const xLeft = runStart - inset;
                    const xRight = runEnd + inset;
                    const yTop = top.y;
                    const yBottom = bottom.y;
                    if (xLeft < 0 || xRight >= width || yTop < 0 || yBottom >= height || xRight - xLeft < 5) continue;
                    const verticalStart = yTop + inset;
                    const verticalEnd = yBottom - inset;
                    if (verticalStart > verticalEnd) continue;
                    const left = sideSupport(mask, false, xLeft, verticalStart, verticalEnd);
                    const right = sideSupport(mask, false, xRight, verticalStart, verticalEnd);
                    const topSupport = sideSupport(mask, true, yTop, runStart, runEnd);
                    const bottomSupport = sideSupport(mask, true, yBottom, runStart, runEnd);
                    const interior = componentInteriorRatio(mask, xLeft, yTop, xRight, yBottom, inset);
                    const symmetry = 1 - clamp((Math.abs(top.start - bottom.start) + Math.abs(top.end - bottom.end)) / 6, 0, 1);
                    const coverage = (left.coverage + right.coverage + topSupport.coverage + bottomSupport.coverage) * 0.25;
                    const residual = (left.meanResidual + right.meanResidual + topSupport.meanResidual + bottomSupport.meanResidual) * 0.25;
                    const insetPenalty = inset * 0.075;
                    const score = coverage * 0.62 + symmetry * 0.18 + (1 - clamp(interior / 0.30, 0, 1)) * 0.20 - residual * 0.06 - insetPenalty;
                    if (!bestGeometry || score > bestGeometry.score) {
                        bestGeometry = { xLeft, xRight, yTop, yBottom, inset, runStart, runEnd, score, coverage, interior };
                    }
                }
                const threshold = 0.69 + (1 - protection) * 0.08;
                if (!bestGeometry || bestGeometry.score < threshold || bestGeometry.coverage < 0.72 || bestGeometry.interior > 0.32) continue;
                candidates.push({ familyId, mask, members, ...bestGeometry });
            }
        }

        candidates.sort((a, b) => b.score - a.score);
        const accepted = [];
        function overlapRatio(a, b) {
            const x0 = Math.max(a.xLeft, b.xLeft), y0 = Math.max(a.yTop, b.yTop);
            const x1 = Math.min(a.xRight, b.xRight), y1 = Math.min(a.yBottom, b.yBottom);
            if (x1 < x0 || y1 < y0) return 0;
            const intersection = (x1 - x0 + 1) * (y1 - y0 + 1);
            const areaA = (a.xRight - a.xLeft + 1) * (a.yBottom - a.yTop + 1);
            const areaB = (b.xRight - b.xLeft + 1) * (b.yBottom - b.yTop + 1);
            return intersection / Math.min(areaA, areaB);
        }
        for (const candidate of candidates) {
            if (accepted.some(other => overlapRatio(candidate, other) > 0.72)) continue;
            accepted.push(candidate);
            if (accepted.length >= 24) break;
        }

        let snappedCells = 0;
        for (const frame of accepted) {
            const targetMask = new Uint8Array(width * height);
            const targetLabel = new Int16Array(width * height);
            targetLabel.fill(-1);
            const topLabel = dominantNearbyLabel(frame.familyId, true, frame.yTop, frame.runStart, frame.runEnd);
            const bottomLabel = dominantNearbyLabel(frame.familyId, true, frame.yBottom, frame.runStart, frame.runEnd);
            const leftLabel = dominantNearbyLabel(frame.familyId, false, frame.xLeft, frame.yTop + frame.inset, frame.yBottom - frame.inset);
            const rightLabel = dominantNearbyLabel(frame.familyId, false, frame.xRight, frame.yTop + frame.inset, frame.yBottom - frame.inset);

            function markTarget(x, y, fallback) {
                if (x < 0 || x >= width || y < 0 || y >= height) return;
                const i = y * width + x;
                const near = nearbyFamilyLabel(frame.familyId, x, y, fallback);
                targetMask[i] = 1;
                targetLabel[i] = near.label;
            }
            for (let x = frame.runStart; x <= frame.runEnd; x++) {
                markTarget(x, frame.yTop, topLabel);
                markTarget(x, frame.yBottom, bottomLabel);
            }
            for (let y = frame.yTop + frame.inset; y <= frame.yBottom - frame.inset; y++) {
                markTarget(frame.xLeft, y, leftLabel);
                markTarget(frame.xRight, y, rightLabel);
            }

            // Remove nearby displaced family pixels before drawing the fitted frame.
            for (let y = Math.max(0, frame.yTop - 1); y <= Math.min(height - 1, frame.yBottom + 1); y++) {
                for (let x = Math.max(0, frame.xLeft - 1); x <= Math.min(width - 1, frame.xRight + 1); x++) {
                    const i = y * width + x;
                    if (!isFamilyLabel(original[i], frame.familyId) || targetMask[i]) continue;
                    let closeToSide = false;
                    if (y >= frame.yTop + frame.inset && y <= frame.yBottom - frame.inset && (Math.abs(x - frame.xLeft) <= 1 || Math.abs(x - frame.xRight) <= 1)) closeToSide = true;
                    if (x >= frame.runStart && x <= frame.runEnd && (Math.abs(y - frame.yTop) <= 1 || Math.abs(y - frame.yBottom) <= 1)) closeToSide = true;
                    if (!closeToSide) continue;
                    const replacement = chooseReplacement(i, frame.familyId, targetMask);
                    if (replacement !== labels[i]) { labels[i] = replacement; snappedCells++; }
                }
            }

            for (let i = 0; i < targetMask.length; i++) {
                if (!targetMask[i]) continue;
                const label = targetLabel[i] >= 0 ? targetLabel[i] : familyLists[frame.familyId][0];
                if (labels[i] !== label) { labels[i] = label; snappedCells++; }
            }
        }

        return {
            mapped: { labels, transparent },
            frameCount: accepted.length,
            snappedCells
        };
    }

    function protectIsolatedSilhouetteEdges(mapped, palette, width, height, options) {
        const protection = clamp(numberOrDefault(
            options.silhouetteEdgeProtection, DEFAULTS.silhouetteEdgeProtection
        ), 0, 1);
        if (protection <= 0 || width < 12 || height < 8 || palette.length < 3) {
            return { mapped, componentCount: 0, snappedCells: 0 };
        }

        const labels = mapped.labels;
        const out = new Uint16Array(labels);
        const transparent = mapped.transparent;
        const total = width * height;
        const labelCounts = new Uint32Array(palette.length);
        for (let i = 0; i < labels.length; i++) {
            const label = labels[i];
            if (label !== transparent && label < palette.length) labelCounts[label]++;
        }

        const backgrounds = [];
        for (let label = 0; label < palette.length; label++) {
            if (labelCounts[label] >= total * 0.035) backgrounds.push(label);
        }
        backgrounds.sort((a, b) => labelCounts[b] - labelCounts[a]);
        backgrounds.length = Math.min(backgrounds.length, 4);

        const darkThreshold = 0.29 + (1 - protection) * 0.05;
        const axisTolerance = 0.030 + (1 - protection) * 0.018;
        const snapLow = 0.47 - protection * 0.03;
        const snapHigh = 0.56 + (1 - protection) * 0.04;
        let componentCount = 0;
        let snappedCells = 0;

        function paletteChroma(label) {
            const c = palette[label];
            return Math.hypot(c.A, c.B);
        }

        function isDark(label) {
            return label !== transparent && label < palette.length && palette[label].L <= darkThreshold;
        }

        for (const backgroundLabel of backgrounds) {
            const visited = new Uint8Array(total);

            for (let start = 0; start < total; start++) {
                if (visited[start] || labels[start] === backgroundLabel || labels[start] === transparent) continue;

                const queue = [start];
                visited[start] = 1;
                const members = [];
                let minX = width, minY = height, maxX = -1, maxY = -1;
                let touchesEdge = false;
                const componentLabelCounts = new Map();

                while (queue.length) {
                    const i = queue.pop();
                    const x = i % width;
                    const y = (i / width) | 0;
                    members.push(i);
                    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
                    if (x === 0 || y === 0 || x + 1 === width || y + 1 === height) touchesEdge = true;
                    const label = labels[i];
                    componentLabelCounts.set(label, (componentLabelCounts.get(label) || 0) + 1);

                    if (x > 0) {
                        const j = i - 1;
                        if (!visited[j] && labels[j] !== backgroundLabel && labels[j] !== transparent) {
                            visited[j] = 1; queue.push(j);
                        }
                    }
                    if (x + 1 < width) {
                        const j = i + 1;
                        if (!visited[j] && labels[j] !== backgroundLabel && labels[j] !== transparent) {
                            visited[j] = 1; queue.push(j);
                        }
                    }
                    if (y > 0) {
                        const j = i - width;
                        if (!visited[j] && labels[j] !== backgroundLabel && labels[j] !== transparent) {
                            visited[j] = 1; queue.push(j);
                        }
                    }
                    if (y + 1 < height) {
                        const j = i + width;
                        if (!visited[j] && labels[j] !== backgroundLabel && labels[j] !== transparent) {
                            visited[j] = 1; queue.push(j);
                        }
                    }
                }

                const boxWidth = maxX - minX + 1;
                const boxHeight = maxY - minY + 1;
                const aspect = boxWidth / Math.max(1, boxHeight);
                if (touchesEdge || members.length < 24 || members.length > total * 0.035 ||
                    boxWidth < 10 || boxHeight < 4 || aspect < 2.05 || aspect > 8.5) continue;

                // The component must actually float inside one mostly uniform
                // background. This excludes ground, HUD bands, and large scenery.
                let ringTotal = 0, ringBackground = 0;
                for (let x = Math.max(0, minX - 1); x <= Math.min(width - 1, maxX + 1); x++) {
                    for (const y of [Math.max(0, minY - 1), Math.min(height - 1, maxY + 1)]) {
                        ringTotal++;
                        if (labels[y * width + x] === backgroundLabel) ringBackground++;
                    }
                }
                for (let y = minY; y <= maxY; y++) {
                    for (const x of [Math.max(0, minX - 1), Math.min(width - 1, maxX + 1)]) {
                        ringTotal++;
                        if (labels[y * width + x] === backgroundLabel) ringBackground++;
                    }
                }
                if (ringBackground / Math.max(1, ringTotal) < 0.72) continue;

                let outlineLabel = -1, outlineCount = 0;
                const chromaticLabels = [];
                for (const [label, count] of componentLabelCounts.entries()) {
                    if (isDark(label) && count > outlineCount) {
                        outlineLabel = label;
                        outlineCount = count;
                    }
                    const c = palette[label];
                    const chroma = paletteChroma(label);
                    if (chroma >= 0.055 && c.L >= 0.16 && c.L <= 0.82 && count >= 2) {
                        chromaticLabels.push(label);
                    }
                }
                if (outlineLabel < 0 || outlineCount < 4 || chromaticLabels.length < 2) continue;

                let hasSeparatedFillColors = false;
                for (let a = 0; a < chromaticLabels.length && !hasSeparatedFillColors; a++) {
                    for (let b = a + 1; b < chromaticLabels.length; b++) {
                        if (colorDistance(palette[chromaticLabels[a]], palette[chromaticLabels[b]]) >= 0.105) {
                            hasSeparatedFillColors = true;
                            break;
                        }
                    }
                }
                if (!hasSeparatedFillColors) continue;

                const backgroundColor = palette[backgroundLabel];
                const outlineColor = palette[outlineLabel];
                if (colorDistance(backgroundColor, outlineColor) < 0.16) continue;

                const topBandEnd = Math.min(maxY, minY + Math.max(2, Math.round(boxHeight * 0.34)));
                let localChanges = 0;

                // Snap antialiased colors lying on the background↔outline axis
                // to one of the two endpoints. Only the upper silhouette band is
                // touched, so internal texture and lower shadows remain intact.
                for (let y = minY; y <= topBandEnd; y++) {
                    for (let x = minX; x <= maxX; x++) {
                        const i = y * width + x;
                        const label = out[i];
                        if (label === transparent || label === backgroundLabel || label === outlineLabel) continue;

                        let touchesBackground = false;
                        if (x > 0 && out[i - 1] === backgroundLabel) touchesBackground = true;
                        if (x + 1 < width && out[i + 1] === backgroundLabel) touchesBackground = true;
                        if (y > 0 && out[i - width] === backgroundLabel) touchesBackground = true;
                        if (y + 1 < height && out[i + width] === backgroundLabel) touchesBackground = true;
                        if (!touchesBackground) continue;

                        const projection = projectToBinaryAxis(palette[label], outlineColor, backgroundColor);
                        if (projection.orth > axisTolerance || projection.t < -0.18 || projection.t > 1.18) continue;

                        let nextLabel = label;
                        if (projection.t <= snapLow) nextLabel = outlineLabel;
                        else if (projection.t >= snapHigh) nextLabel = backgroundLabel;
                        else {
                            let outlineSupport = 0, backgroundSupport = 0;
                            const neighbors = [];
                            if (x > 0) neighbors.push(i - 1);
                            if (x + 1 < width) neighbors.push(i + 1);
                            if (y > 0) neighbors.push(i - width);
                            if (y + 1 < height) neighbors.push(i + width);
                            for (const j of neighbors) {
                                if (out[j] === outlineLabel) outlineSupport++;
                                if (out[j] === backgroundLabel) backgroundSupport++;
                            }
                            nextLabel = outlineSupport >= backgroundSupport ? outlineLabel : backgroundLabel;
                        }

                        if (nextLabel !== label) {
                            out[i] = nextLabel;
                            localChanges++;
                        }
                    }
                }

                // Bridge only one-cell holes in an otherwise supported dark cap.
                // This straightens a line without inventing a broad new outline.
                for (let y = minY; y <= topBandEnd; y++) {
                    for (let x = minX + 1; x < maxX; x++) {
                        const i = y * width + x;
                        if (out[i] !== backgroundLabel) continue;
                        if (out[i - 1] !== outlineLabel || out[i + 1] !== outlineLabel) continue;
                        if (y + 1 >= height || out[i + width] === backgroundLabel || out[i + width] === transparent) continue;
                        if (y > 0 && out[i - width] !== backgroundLabel) continue;
                        out[i] = outlineLabel;
                        localChanges++;
                    }
                }

                if (localChanges > 0) {
                    componentCount++;
                    snappedCells += localChanges;
                }
            }
        }

        return {
            mapped: { labels: out, transparent },
            componentCount,
            snappedCells
        };
    }

    function protectAxisAlignedSeams(mapped, palette, width, height, options) {
        const protection = clamp(numberOrDefault(options.axisSeamProtection, DEFAULTS.axisSeamProtection), 0, 1);
        if (protection <= 0 || width < 12 || height < 12 || palette.length < 2) {
            return { mapped, seamCount: 0, snappedCells: 0, horizontalSeams: 0, verticalSeams: 0 };
        }

        const transparent = mapped.transparent;
        const familyThreshold = 0.060 + (1 - protection) * 0.030;
        const axisThreshold = 0.022 + (1 - protection) * 0.020;
        const pairDistanceThreshold = 0.140 + (1 - protection) * 0.050;
        const dominanceThreshold = 0.42 - protection * 0.06;

        function labelDistance(a, b) {
            return colorDistance(palette[a], palette[b]);
        }

        function sideStrength(label, want, other) {
            if (label === transparent || label >= palette.length) return 0;
            const c = palette[label];
            const dw = colorDistance(c, palette[want]);
            const doo = colorDistance(c, palette[other]);
            const projection = projectToBinaryAxis(c, palette[want], palette[other]);
            let score = 0;
            if (dw <= familyThreshold) score = Math.max(score, 1.0 - dw / Math.max(1e-6, familyThreshold));
            if (dw < doo && dw <= pairDistanceThreshold * 0.70) score = Math.max(score, 0.45);
            if (projection.orth <= axisThreshold && projection.t >= -0.12 && projection.t <= 0.62) score = Math.max(score, 0.38);
            return score;
        }

        function oppositeStrength(label, want, other) {
            return sideStrength(label, other, want);
        }

        function labelsOnAxis(label, a, b) {
            if (label === transparent || label >= palette.length) return false;
            const p = projectToBinaryAxis(palette[label], palette[a], palette[b]);
            return p.orth <= axisThreshold && p.t >= -0.15 && p.t <= 1.15;
        }

        function applyOrientation(inputLabels, horizontal) {
            const primary = horizontal ? width : height;
            const secondary = horizontal ? height : width;
            const labels = new Uint16Array(inputLabels);
            let seamCount = 0;
            let snappedCells = 0;
            const minRun = Math.max(10, Math.round(primary * (0.18 - protection * 0.04)));

            function index(p, s) {
                const x = horizontal ? p : s;
                const y = horizontal ? s : p;
                return y * width + x;
            }

            for (let s = 1; s < secondary - 2; s++) {
                const topCounts = new Map();
                const bottomCounts = new Map();
                let topTotal = 0, bottomTotal = 0;
                for (let p = 0; p < primary; p++) {
                    for (const tt of [s - 1, s]) {
                        const label = labels[index(p, tt)];
                        if (label !== transparent) {
                            topCounts.set(label, (topCounts.get(label) || 0) + 1);
                            topTotal++;
                        }
                    }
                    for (const bb of [s + 1, s + 2]) {
                        const label = labels[index(p, bb)];
                        if (label !== transparent) {
                            bottomCounts.set(label, (bottomCounts.get(label) || 0) + 1);
                            bottomTotal++;
                        }
                    }
                }
                if (topTotal < primary || bottomTotal < primary) continue;

                let topLabel = -1, topCount = 0;
                for (const [label, count] of topCounts.entries()) { if (count > topCount) { topCount = count; topLabel = label; } }
                let bottomLabel = -1, bottomCount = 0;
                for (const [label, count] of bottomCounts.entries()) { if (count > bottomCount) { bottomCount = count; bottomLabel = label; } }
                if (topLabel < 0 || bottomLabel < 0 || topLabel === bottomLabel) continue;
                if (labelDistance(topLabel, bottomLabel) < pairDistanceThreshold) continue;
                if (topCount / Math.max(1, topTotal) < dominanceThreshold || bottomCount / Math.max(1, bottomTotal) < dominanceThreshold) continue;

                const support = new Uint8Array(primary);
                for (let p = 0; p < primary; p++) {
                    const t0 = labels[index(p, s - 1)], t1 = labels[index(p, s)];
                    const b0 = labels[index(p, s + 1)], b1 = labels[index(p, s + 2)];
                    const topGood = Math.max(sideStrength(t0, topLabel, bottomLabel), sideStrength(t1, topLabel, bottomLabel)) >= 0.38;
                    const bottomGood = Math.max(sideStrength(b0, bottomLabel, topLabel), sideStrength(b1, bottomLabel, topLabel)) >= 0.38;
                    const topBad = Math.max(oppositeStrength(t0, topLabel, bottomLabel), oppositeStrength(t1, topLabel, bottomLabel));
                    const bottomBad = Math.max(oppositeStrength(b0, bottomLabel, topLabel), oppositeStrength(b1, bottomLabel, topLabel));
                    if (topGood && bottomGood && topBad <= 0.92 && bottomBad <= 0.92) support[p] = 1;
                }

                let p = 0;
                while (p < primary) {
                    while (p < primary && !support[p]) p++;
                    if (p >= primary) break;
                    let start = p, end = p;
                    let gaps = 0;
                    p++;
                    while (p < primary) {
                        if (support[p]) { end = p; gaps = 0; p++; continue; }
                        if (gaps < 1 && p + 1 < primary && support[p + 1]) { gaps++; p++; continue; }
                        break;
                    }
                    const runLength = end - start + 1;
                    if (runLength < minRun) continue;

                    let localChanges = 0;
                    for (let q = start; q <= end; q++) {
                        const topIdx = index(q, s);
                        const bottomIdx = index(q, s + 1);
                        const topAboveIdx = index(q, s - 1);
                        const bottomBelowIdx = index(q, s + 2);
                        const curTop = labels[topIdx];
                        const curBottom = labels[bottomIdx];

                        const aboveSupport = sideStrength(labels[topAboveIdx], topLabel, bottomLabel) >= 0.38;
                        const belowSupport = sideStrength(labels[bottomBelowIdx], bottomLabel, topLabel) >= 0.38;
                        if (!(aboveSupport && belowSupport)) continue;

                        if (sideStrength(curTop, topLabel, bottomLabel) < 0.38) {
                            const opposite = oppositeStrength(curTop, topLabel, bottomLabel) >= 0.38;
                            const axisish = labelsOnAxis(curTop, topLabel, bottomLabel);
                            let leftTop = q > start ? sideStrength(labels[index(q - 1, s)], topLabel, bottomLabel) >= 0.38 : false;
                            let rightTop = q < end ? sideStrength(labels[index(q + 1, s)], topLabel, bottomLabel) >= 0.38 : false;
                            if ((opposite || axisish) && (leftTop || rightTop)) {
                                labels[topIdx] = topLabel;
                                localChanges++;
                            }
                        }

                        if (sideStrength(curBottom, bottomLabel, topLabel) < 0.38) {
                            const opposite = oppositeStrength(curBottom, bottomLabel, topLabel) >= 0.38;
                            const axisish = labelsOnAxis(curBottom, bottomLabel, topLabel);
                            let leftBottom = q > start ? sideStrength(labels[index(q - 1, s + 1)], bottomLabel, topLabel) >= 0.38 : false;
                            let rightBottom = q < end ? sideStrength(labels[index(q + 1, s + 1)], bottomLabel, topLabel) >= 0.38 : false;
                            if ((opposite || axisish) && (leftBottom || rightBottom)) {
                                labels[bottomIdx] = bottomLabel;
                                localChanges++;
                            }
                        }
                    }

                    // Second pass: remove one-cell teeth along the seam while preserving nearby objects.
                    for (let q = start + 1; q < end; q++) {
                        const topIdx = index(q, s);
                        const bottomIdx = index(q, s + 1);
                        if (labels[topIdx] !== topLabel &&
                            labels[index(q - 1, s)] === topLabel && labels[index(q + 1, s)] === topLabel &&
                            sideStrength(labels[topIdx], bottomLabel, topLabel) >= 0.38 &&
                            sideStrength(labels[bottomIdx], bottomLabel, topLabel) >= 0.38) {
                            labels[topIdx] = topLabel;
                            localChanges++;
                        }
                        if (labels[bottomIdx] !== bottomLabel &&
                            labels[index(q - 1, s + 1)] === bottomLabel && labels[index(q + 1, s + 1)] === bottomLabel &&
                            sideStrength(labels[bottomIdx], topLabel, bottomLabel) >= 0.38 &&
                            sideStrength(labels[topIdx], topLabel, bottomLabel) >= 0.38) {
                            labels[bottomIdx] = bottomLabel;
                            localChanges++;
                        }
                    }

                    if (localChanges > 0) {
                        seamCount++;
                        snappedCells += localChanges;
                    }
                }
            }

            return { labels, seamCount, snappedCells };
        }

        const horizontal = applyOrientation(mapped.labels, true);
        const vertical = applyOrientation(horizontal.labels, false);
        return {
            mapped: { labels: vertical.labels, transparent },
            seamCount: horizontal.seamCount + vertical.seamCount,
            snappedCells: horizontal.snappedCells + vertical.snappedCells,
            horizontalSeams: horizontal.seamCount,
            verticalSeams: vertical.seamCount
        };
    }

    function estimateRegularGridPeriod(source, horizontalAxis, minPeriod, maxPeriod) {
        const length = horizontalAxis ? source.width : source.height;
        const lineCount = horizontalAxis ? source.height : source.width;
        const stride = Math.max(1, Math.floor(lineCount / 360));
        const histogram = new Float64Array(maxPeriod + 2);
        const edgeCenters = [];
        const edgeWeights = [];
        const edgeThreshold = 0.075;
        let totalGaps = 0;

        function edgeDistance(i0, i1) {
            return Math.hypot(
                (source.L[i0] - source.L[i1]) * 1.2,
                source.A[i0] - source.A[i1],
                source.B[i0] - source.B[i1]
            );
        }

        for (let q = 0; q < lineCount; q += stride) {
            let clusterWeighted = 0;
            let clusterWeight = 0;
            let clusterLast = -100;
            let previousCenter = -1;

            function finishCluster() {
                if (!(clusterWeight > 0)) return;
                const center = clusterWeighted / clusterWeight;
                edgeCenters.push(center);
                edgeWeights.push(Math.min(clusterWeight, 0.8));
                if (previousCenter >= 0) {
                    const gap = center - previousCenter;
                    const rounded = Math.round(gap);
                    if (rounded >= minPeriod && rounded <= maxPeriod) {
                        histogram[rounded] += 1;
                        totalGaps++;
                    }
                }
                previousCenter = center;
                clusterWeighted = 0;
                clusterWeight = 0;
            }

            for (let pos = 1; pos < length; pos++) {
                const i0 = horizontalAxis
                    ? q * source.width + pos - 1
                    : (pos - 1) * source.width + q;
                const i1 = horizontalAxis ? i0 + 1 : i0 + source.width;
                const edge = edgeDistance(i0, i1);
                if (edge < edgeThreshold) continue;

                if (pos - clusterLast > 2 && clusterWeight > 0) finishCluster();
                clusterWeighted += pos * edge;
                clusterWeight += edge;
                clusterLast = pos;
            }
            finishCluster();
        }

        let gapResult = null;
        if (totalGaps >= 24) {
            let bestPeriod = -1;
            let bestScore = -Infinity;
            for (let period = minPeriod + 1; period < maxPeriod; period++) {
                const score = histogram[period] + 0.15 * (histogram[period - 1] + histogram[period + 1]);
                if (score > bestScore) {
                    bestScore = score;
                    bestPeriod = period;
                }
            }
            if (bestPeriod >= 0) {
                const neighborhood = histogram[bestPeriod - 1] + histogram[bestPeriod] + histogram[bestPeriod + 1];
                const concentration = neighborhood / Math.max(1, totalGaps);
                if (neighborhood >= 20 && concentration >= 0.12) {
                    const weightedPeriod = (
                        histogram[bestPeriod - 1] * (bestPeriod - 1) +
                        histogram[bestPeriod] * bestPeriod +
                        histogram[bestPeriod + 1] * (bestPeriod + 1)
                    ) / Math.max(1e-6, neighborhood);
                    gapResult = {
                        period: weightedPeriod,
                        peak: bestPeriod,
                        confidence: clamp(concentration / 0.38, 0, 1),
                        concentration,
                        support: neighborhood,
                        method: 'gap'
                    };
                }
            }
        }

        // Sparse sprites may not contain enough adjacent edge pairs for a gap
        // histogram, but their edge coordinates still share one grid phase.
        // Circular phase coherence detects that case without assuming the image
        // is filled with texture.
        let phaseResult = null;
        if (edgeCenters.length >= 36) {
            let totalWeight = 0;
            for (const weight of edgeWeights) totalWeight += weight;
            let bestConcentration = 0;
            let bestPeriod = 0;
            for (let period = minPeriod; period <= maxPeriod + 1e-6; period += 0.25) {
                let real = 0, imaginary = 0;
                const scale = Math.PI * 2 / period;
                for (let i = 0; i < edgeCenters.length; i++) {
                    const angle = edgeCenters[i] * scale;
                    const weight = edgeWeights[i];
                    real += Math.cos(angle) * weight;
                    imaginary += Math.sin(angle) * weight;
                }
                const concentration = Math.hypot(real, imaginary) / Math.max(1e-6, totalWeight);
                if (concentration > bestConcentration) {
                    bestConcentration = concentration;
                    bestPeriod = period;
                }
            }
            if (bestConcentration >= 0.42) {
                phaseResult = {
                    period: bestPeriod,
                    peak: bestPeriod,
                    confidence: clamp((bestConcentration - 0.25) / 0.70, 0, 1),
                    concentration: bestConcentration,
                    support: edgeCenters.length,
                    method: 'phase'
                };
            }
        }

        if (!gapResult) return phaseResult;
        if (!phaseResult) return gapResult;
        if (phaseResult.concentration >= 0.75) return phaseResult;
        return phaseResult.confidence > gapResult.confidence + 0.12 ? phaseResult : gapResult;
    }

    function regularGridFlatCellShare(source, columns, rows) {
        const stepX = Math.max(1, Math.ceil(columns / 42));
        const stepY = Math.max(1, Math.ceil(rows / 42));
        const probes = [
            [0.50, 0.50], [0.25, 0.25], [0.75, 0.25],
            [0.25, 0.75], [0.75, 0.75]
        ];
        let flat = 0, total = 0;

        for (let y = 0; y < rows; y += stepY) {
            for (let x = 0; x < columns; x += stepX) {
                const colors = [];
                for (const probe of probes) {
                    const sx = clamp(Math.floor((x + probe[0]) * source.width / columns), 0, source.width - 1);
                    const sy = clamp(Math.floor((y + probe[1]) * source.height / rows), 0, source.height - 1);
                    const i = sy * source.width + sx;
                    colors.push({ L: source.L[i], A: source.A[i], B: source.B[i] });
                }
                let maxDistance = 0;
                for (let a = 1; a < colors.length; a++) {
                    maxDistance = Math.max(maxDistance, Math.sqrt(distSq(colors[0], colors[a])));
                }
                if (maxDistance <= 0.090) flat++;
                total++;
            }
        }
        return total ? flat / total : 0;
    }

    function detectRegularPixelGrid(source, options) {
        const minPeriod = Math.max(13, Math.ceil(options.maxCellSize + 1));
        const maxPeriod = Math.min(96, Math.floor(Math.min(source.width, source.height) / 6));
        if (maxPeriod <= minPeriod + 2) return null;

        const x = estimateRegularGridPeriod(source, true, minPeriod, maxPeriod);
        const y = estimateRegularGridPeriod(source, false, minPeriod, maxPeriod);
        if (!x || !y) return null;

        const aspectRatio = Math.max(x.period, y.period) / Math.max(1e-6, Math.min(x.period, y.period));
        if (aspectRatio > 1.24) return null;

        const columns = Math.round(source.width / x.period);
        const rows = Math.round(source.height / y.period);
        if (columns < 8 || rows < 8 || columns > 256 || rows > 256) return null;

        const baseCellWidth = source.width / columns;
        const baseCellHeight = source.height / rows;
        if (baseCellWidth < minPeriod * 0.82 || baseCellHeight < minPeriod * 0.82) return null;

        const flatCellShare = regularGridFlatCellShare(source, columns, rows);
        const confidence = Math.min(x.confidence, y.confidence) * clamp((flatCellShare - 0.50) / 0.35, 0, 1);
        if (flatCellShare < 0.68 || confidence < 0.20) return null;

        const xProfile = buildAxisEdgeProfile(source, true, 0, source.height);
        const yProfile = buildAxisEdgeProfile(source, false, 0, source.width);
        const xPhase = estimateRegularGridPhase(xProfile, x.period);
        const yPhase = estimateRegularGridPhase(yProfile, y.period);

        return {
            columns,
            rows,
            periodX: x.period,
            periodY: y.period,
            baseCellWidth,
            baseCellHeight,
            flatCellShare,
            confidence,
            xConfidence: x.confidence,
            yConfidence: y.confidence,
            offsetX: xPhase.phase,
            offsetY: yPhase.phase,
            phaseScoreX: xPhase.score,
            phaseScoreY: yPhase.score
        };
    }

    function estimateRegularGridPhase(profile, period) {
        let bestPhase = 0;
        let bestScore = -Infinity;
        for (let phase = 0; phase < period; phase += 0.25) {
            let boundary = 0, interior = 0, boundaryCount = 0, interiorCount = 0;
            for (let p = phase; p < profile.length; p += period) {
                boundary += sampleProfile(profile, p);
                boundaryCount++;
            }
            for (let p = phase + period * 0.5; p < profile.length; p += period) {
                interior += sampleProfile(profile, p);
                interiorCount++;
            }
            const boundaryMean = boundaryCount ? boundary / boundaryCount : 0;
            const interiorMean = interiorCount ? interior / interiorCount : 0;
            const score = boundaryMean * 1.08 - interiorMean * 0.78;
            if (score > bestScore) {
                bestScore = score;
                bestPhase = phase;
            }
        }
        return { phase: bestPhase, score: bestScore };
    }

    function buildOffsetUniformMesh(sourceWidth, sourceHeight, columns, rows, offsetX, offsetY, periodX, periodY) {
        const meshWidth = columns + 1;
        const meshHeight = rows + 1;
        const points = new Float32Array(meshWidth * meshHeight * 2);
        for (let y = 0; y <= rows; y++) {
            let py = offsetY + y * periodY;
            if (y === 0) py = 0;
            else if (y === rows) py = sourceHeight;
            else py = clamp(py, 0, sourceHeight);
            for (let x = 0; x <= columns; x++) {
                let px = offsetX + x * periodX;
                if (x === 0) px = 0;
                else if (x === columns) px = sourceWidth;
                else px = clamp(px, 0, sourceWidth);
                const p = (y * meshWidth + x) * 2;
                points[p] = px;
                points[p + 1] = py;
            }
        }
        return { points, width: meshWidth, height: meshHeight, cols: columns, rows };
    }

    function renderRepresentativeCells(cellGrid, options) {
        const { width, height, cells } = cellGrid;
        const data = new Uint8ClampedArray(width * height * 4);
        const structureProtection = clamp(numberOrDefault(options.structureProtection, DEFAULTS.structureProtection), 0, 1);
        const microSensitivity = clamp(numberOrDefault(options.microstructureSensitivity, DEFAULTS.microstructureSensitivity), 0, 1);
        const detail = clamp(numberOrDefault(options.detailPreservation, DEFAULTS.detailPreservation), 0, 1);
        const structureThreshold = 0.38 + (1 - structureProtection) * 0.18;
        const microThreshold = 0.12 + (1 - microSensitivity) * 0.06;
        let uniqueColors = new Set();
        for (let i = 0; i < cells.length; i++) {
            const c = cells[i];
            if (!c || c.transparent) continue;
            let color = c;
            if (c.structurePreferredColor && c.structureScore >= structureThreshold && c.corePurity >= 0.52) {
                color = c.structurePreferredColor;
            } else if (c.microPreferredColor && c.microScore >= microThreshold && c.contrast >= 0.16 && c.lowChromaScore >= 0.25) {
                color = c.microPreferredColor;
            }
            const p = i * 4;
            data[p] = color.r; data[p + 1] = color.g; data[p + 2] = color.b; data[p + 3] = c.alpha !== undefined ? c.alpha : 255;
            uniqueColors.add(`${data[p]},${data[p+1]},${data[p+2]},${data[p+3]}`);
        }
        const image = new ImageData(data, width, height);
        image.__regularGridDirectInfo = { uniqueColors: uniqueColors.size, detailPreservation: detail };
        return image;
    }

    function buildUniformMesh(sourceWidth, sourceHeight, columns, rows) {
        const meshWidth = columns + 1;
        const meshHeight = rows + 1;
        const points = new Float32Array(meshWidth * meshHeight * 2);
        for (let y = 0; y <= rows; y++) {
            const py = y * sourceHeight / rows;
            for (let x = 0; x <= columns; x++) {
                const p = (y * meshWidth + x) * 2;
                points[p] = x * sourceWidth / columns;
                points[p + 1] = py;
            }
        }
        return { points, width: meshWidth, height: meshHeight, cols: columns, rows };
    }

    function render(mapped, palette, width, height) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            const p = i * 4, label = mapped.labels[i];
            if (label === mapped.transparent) continue;
            const c = palette[label];
            data[p] = c.r; data[p + 1] = c.g; data[p + 2] = c.b; data[p + 3] = 255;
        }
        return new ImageData(data, width, height);
    }

    function fieldDisplacementStats(field, globalBounds) {
        let max = 0, sum = 0, count = 0;
        for (const row of field.rows) {
            for (let j = 1; j + 1 < row.length; j++) {
                const d = Math.abs(row[j] - globalBounds[j]);
                max = Math.max(max, d); sum += d; count++;
            }
        }
        return { mean: count ? sum / count : 0, max };
    }

    CRT.core.convertToPixelArt = function (imageData, customOptions) {
        const options = Object.assign({}, DEFAULTS, customOptions || {});
        options.maxColors = clamp(Math.round(numberOrDefault(options.maxColors, DEFAULTS.maxColors)), 2, 256);
        options.detailPreservation = clamp(numberOrDefault(options.detailPreservation, DEFAULTS.detailPreservation), 0, 1);
        options.bandCellSpan = clamp(numberOrDefault(options.bandCellSpan, DEFAULTS.bandCellSpan), 6, 18);
        options.bandOverlap = clamp(numberOrDefault(options.bandOverlap, DEFAULTS.bandOverlap), 0, 0.75);
        options.localWarpRadius = clamp(numberOrDefault(options.localWarpRadius, DEFAULTS.localWarpRadius), 0.25, 1.5);
        options.microstructureSensitivity = clamp(numberOrDefault(options.microstructureSensitivity, DEFAULTS.microstructureSensitivity), 0, 1);
        options.structureProtection = clamp(numberOrDefault(options.structureProtection, DEFAULTS.structureProtection), 0, 1);
        options.binaryRegionProtection = clamp(numberOrDefault(options.binaryRegionProtection, DEFAULTS.binaryRegionProtection), 0, 1);
        options.rectilinearProtection = clamp(numberOrDefault(options.rectilinearProtection, DEFAULTS.rectilinearProtection), 0, 1);
        options.silhouetteEdgeProtection = clamp(numberOrDefault(options.silhouetteEdgeProtection, DEFAULTS.silhouetteEdgeProtection), 0, 1);
        options.axisSeamProtection = clamp(numberOrDefault(options.axisSeamProtection, DEFAULTS.axisSeamProtection), 0, 1);

        const source = analyze(imageData);
        const regularGrid = detectRegularPixelGrid(source, options);
        let estimatedX, estimatedY, baseX, baseY, mesh;
        let horizontalBands = 0, verticalBands = 0;
        let xStats = { mean: 0, max: 0 }, yStats = { mean: 0, max: 0 };

        if (regularGrid) {
            estimatedX = regularGrid.periodX;
            estimatedY = regularGrid.periodY;
            baseX = regularGrid.baseCellWidth;
            baseY = regularGrid.baseCellHeight;
            mesh = buildOffsetUniformMesh(
                source.width, source.height,
                regularGrid.columns, regularGrid.rows,
                regularGrid.offsetX || 0,
                regularGrid.offsetY || 0,
                regularGrid.periodX,
                regularGrid.periodY
            );
        } else {
            const xProfile = buildAxisEdgeProfile(source, true, 0, source.height);
            const yProfile = buildAxisEdgeProfile(source, false, 0, source.width);
            estimatedX = estimateBasePeriod(xProfile, options.minCellSize, options.maxCellSize);
            estimatedY = estimateBasePeriod(yProfile, options.minCellSize, options.maxCellSize);
            const globalX = solveAdaptiveBoundaries(xProfile, estimatedX, options.detailPreservation);
            const globalY = solveAdaptiveBoundaries(yProfile, estimatedY, options.detailPreservation);
            baseX = source.width / Math.max(1, globalX.length - 1);
            baseY = source.height / Math.max(1, globalY.length - 1);
            const xField = buildBoundaryField(source, true, globalX, baseX, baseY, options);
            const yField = buildBoundaryField(source, false, globalY, baseY, baseX, options);
            mesh = buildMesh(xField, yField, globalX, globalY, source.width, source.height);
            horizontalBands = xField.rows.length;
            verticalBands = yField.rows.length;
            xStats = fieldDisplacementStats(xField, globalX);
            yStats = fieldDisplacementStats(yField, globalY);
        }

        const cellGrid = buildCellRepresentatives(source, mesh, options);
        let image;
        let binaryInfo = { regions: [], protectedCells: 0 };
        let rectilinear = { frameCount: 0, snappedCells: 0 };
        let silhouetteEdges = { componentCount: 0, snappedCells: 0 };
        let seams = { seamCount: 0, snappedCells: 0, horizontalSeams: 0, verticalSeams: 0 };

        if (regularGrid) {
            image = renderRepresentativeCells(cellGrid, options);
        } else {
            binaryInfo = detectBinaryRegions(cellGrid, options);
            const palette = extractPalette(cellGrid, options.maxColors, binaryInfo);
            const mapped = mapAndPolish(cellGrid, palette, options, binaryInfo);
            rectilinear = protectRectilinearFrames(mapped, palette, cellGrid.width, cellGrid.height, options);
            silhouetteEdges = protectIsolatedSilhouetteEdges(rectilinear.mapped, palette, cellGrid.width, cellGrid.height, options);
            seams = protectAxisAlignedSeams(silhouetteEdges.mapped, palette, cellGrid.width, cellGrid.height, options);
            image = render(seams.mapped, palette, cellGrid.width, cellGrid.height);
        }

        image.__pixelArtConversionInfo = {
            conversionMode: regularGrid ? 'regular-grid-conservative' : 'adaptive-mesh',
            estimatedCellWidth: estimatedX,
            estimatedCellHeight: estimatedY,
            baseCellWidth: baseX,
            baseCellHeight: baseY,
            outputWidth: image.width,
            outputHeight: image.height,
            horizontalBands,
            verticalBands,
            meanWarpX: xStats.mean,
            maxWarpX: xStats.max,
            meanWarpY: yStats.mean,
            maxWarpY: yStats.max,
            regularGridConfidence: regularGrid ? regularGrid.confidence : 0,
            regularGridFlatCellShare: regularGrid ? regularGrid.flatCellShare : 0,
            regularGridOffsetX: regularGrid ? regularGrid.offsetX : 0,
            regularGridOffsetY: regularGrid ? regularGrid.offsetY : 0,
            regularGridPhaseScoreX: regularGrid ? regularGrid.phaseScoreX : 0,
            regularGridPhaseScoreY: regularGrid ? regularGrid.phaseScoreY : 0,
            regularGridDirectUniqueColors: image.__regularGridDirectInfo ? image.__regularGridDirectInfo.uniqueColors : 0,
            structureProtection: options.structureProtection,
            binaryRegionProtection: options.binaryRegionProtection,
            binaryRegionCount: binaryInfo.regions.length,
            binaryProtectedCells: binaryInfo.protectedCells,
            rectilinearProtection: options.rectilinearProtection,
            rectilinearFrameCount: rectilinear.frameCount,
            rectilinearSnappedCells: rectilinear.snappedCells,
            silhouetteEdgeProtection: options.silhouetteEdgeProtection,
            silhouetteComponentCount: silhouetteEdges.componentCount,
            silhouetteSnappedCells: silhouetteEdges.snappedCells,
            axisSeamProtection: options.axisSeamProtection,
            seamCount: seams.seamCount,
            seamSnappedCells: seams.snappedCells,
            horizontalSeams: seams.horizontalSeams,
            verticalSeams: seams.verticalSeams
        };
        return image;
    };

    // Capture the raw input supplied by App.updateSourceImage and allow a one-shot
    // converted result to be displayed through the existing Source comparison path.
    const originalDownsample = CRT.core.downsampleImage;
    let latestRaw = null;
    let pendingResult = null;
    CRT.core.downsampleImage = function (imageData, dotWidth, algorithm) {
        latestRaw = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
        if (pendingResult) {
            const result = pendingResult;
            pendingResult = null;
            return result;
        }
        return originalDownsample(imageData, dotWidth, algorithm);
    };

    function normalizedControlText(element) {
        return String(
            element.textContent || element.value || element.getAttribute('aria-label') ||
            element.getAttribute('title') || ''
        ).replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function findLoadSourceControl() {
        const selectors = [
            '#load-source-image-btn', '#load-source-btn', '#load-image-btn',
            '#source-image-btn', '[data-action="load-source-image"]',
            'label[for*="source"][for*="image"]', 'label[for*="load"]'
        ];
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) return element;
        }
        const candidates = document.querySelectorAll(
            'button, label, input[type="button"], input[type="submit"]'
        );
        for (const element of candidates) {
            const text = normalizedControlText(element);
            if (text === 'load source image' || text.includes('load source image')) return element;
        }
        return null;
    }

    function styleDetailsPopup(details, panel, widthPx) {
        if (!details || !panel) return;
        details.style.position = 'relative';
        details.style.display = 'inline-block';
        details.style.verticalAlign = 'middle';
        details.classList.add('crt-floating-options');
        panel.style.position = 'absolute';
        panel.style.zIndex = '60';
        panel.style.top = 'calc(100% + 5px)';
        panel.style.left = '0';
        panel.style.right = 'auto';
        panel.style.width = `${widthPx || 268}px`;
        panel.style.maxWidth = 'calc(100vw - 32px)';
        panel.style.maxHeight = 'min(70vh, 540px)';
        panel.style.overflowY = 'auto';
        panel.style.padding = '10px';
        panel.style.margin = '0';
        panel.style.background = '#242424';
        panel.style.border = '1px solid #555';
        panel.style.borderRadius = '6px';
        panel.style.boxShadow = '0 5px 18px rgba(0,0,0,.45)';
        panel.style.boxSizing = 'border-box';
    }

    function decorateHighlightRecoveryPopup() {
        const detailsList = document.querySelectorAll('details');
        for (const details of detailsList) {
            if (details.dataset.crtHighlightPopup === '1') continue;
            const summary = Array.from(details.children).find(child => child.tagName === 'SUMMARY');
            if (!summary || summary.textContent.trim() !== 'Highlight Recovery') continue;
            const panel = Array.from(details.children).find(child => child !== summary);
            if (!panel) continue;
            details.dataset.crtHighlightPopup = '1';
            summary.style.cursor = 'pointer';
            summary.style.userSelect = 'none';
            styleDetailsPopup(details, panel, 276);
        }
    }

    function installPopupObserver() {
        decorateHighlightRecoveryPopup();
        if (!document.body || document.body.dataset.crtPopupObserver === '1') return;
        document.body.dataset.crtPopupObserver = '1';
        const observer = new MutationObserver(() => decorateHighlightRecoveryPopup());
        observer.observe(document.body, { childList: true, subtree: true });

        document.addEventListener('pointerdown', event => {
            for (const details of document.querySelectorAll('details.crt-floating-options[open]')) {
                if (!details.contains(event.target)) details.open = false;
            }
        });
    }

    function installUI() {
        installPopupObserver();
        if (document.getElementById('convert-to-pixel-art-btn')) return;
        const dotAlgo = document.getElementById('downsample-algo');
        if (!dotAlgo || !dotAlgo.parentElement) return;
        const loadSourceControl = findLoadSourceControl();

        const wrap = document.createElement('span');
        wrap.id = 'convert-to-pixel-art-controls';
        wrap.style.display = 'inline-flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '6px';
        wrap.style.marginLeft = '6px';
        wrap.style.verticalAlign = 'middle';

        const button = document.createElement('button');
        button.id = 'convert-to-pixel-art-btn';
        button.className = 'btn primary small';
        button.textContent = 'Convert to Pixel Art';

        const details = document.createElement('details');
        details.style.position = 'relative';
        const summary = document.createElement('summary');
        summary.textContent = 'Options';
        summary.style.fontSize = '0.75rem';
        summary.style.cursor = 'pointer';
        details.appendChild(summary);

        const panel = document.createElement('div');
        styleDetailsPopup(details, panel, 262);

        panel.innerHTML = `
            <label style="display:flex;justify-content:space-between;align-items:center;font-size:.75rem;margin-bottom:8px">Palette Colors
                <select id="pixel-art-colors" style="width:72px">
                    <option>16</option><option>24</option><option>32</option><option selected>48</option>
                    <option>64</option><option>128</option><option>256</option>
                </select>
            </label>
            <label style="display:block;font-size:.75rem">Detail Preservation <span id="pixel-art-detail-val">0.60</span></label>
            <input id="pixel-art-detail" type="range" min="0" max="1" step="0.05" value="0.60" style="width:100%">
            <label style="display:block;font-size:.75rem;margin-top:7px">Structure Protection <span id="pixel-art-structure-val">0.90</span></label>
            <input id="pixel-art-structure" type="range" min="0" max="1" step="0.05" value="0.90" style="width:100%">
            <label style="display:block;font-size:.75rem;margin-top:7px">Binary Region Protection <span id="pixel-art-binary-val">0.88</span></label>
            <input id="pixel-art-binary" type="range" min="0" max="1" step="0.05" value="0.88" style="width:100%">
            <label style="display:block;font-size:.75rem;margin-top:7px">Rectilinear Protection <span id="pixel-art-rect-val">0.88</span></label>
            <input id="pixel-art-rect" type="range" min="0" max="1" step="0.05" value="0.88" style="width:100%">
            <label style="display:block;font-size:.75rem;margin-top:7px">Silhouette Edge Protection <span id="pixel-art-silhouette-val">0.88</span></label>
            <input id="pixel-art-silhouette" type="range" min="0" max="1" step="0.05" value="0.88" style="width:100%">
            <label style="display:block;font-size:.75rem;margin-top:7px">Axis Seam Protection <span id="pixel-art-seam-val">0.82</span></label>
            <input id="pixel-art-seam" type="range" min="0" max="1" step="0.05" value="0.82" style="width:100%">
            <div style="font-size:.68rem;color:#999;margin-top:7px;line-height:1.35">
                Automatically detects already-enlarged regular pixel art and restores its native grid; otherwise uses the adaptive mesh and protection passes. Pseudo Dot Width is not used.
            </div>
            <div style="display:flex;justify-content:flex-end;margin-top:9px">
                <button id="pixel-art-reset" type="button" class="btn small" style="min-width:68px">Reset</button>
            </div>
            <div id="pixel-art-info" style="font-size:.68rem;color:#aaa;margin-top:8px;line-height:1.35">Waiting for conversion</div>`;
        details.appendChild(panel);

        const detail = panel.querySelector('#pixel-art-detail');
        const detailVal = panel.querySelector('#pixel-art-detail-val');
        const structure = panel.querySelector('#pixel-art-structure');
        const structureVal = panel.querySelector('#pixel-art-structure-val');
        const binary = panel.querySelector('#pixel-art-binary');
        const binaryVal = panel.querySelector('#pixel-art-binary-val');
        const rect = panel.querySelector('#pixel-art-rect');
        const rectVal = panel.querySelector('#pixel-art-rect-val');
        const silhouette = panel.querySelector('#pixel-art-silhouette');
        const silhouetteVal = panel.querySelector('#pixel-art-silhouette-val');
        const seam = panel.querySelector('#pixel-art-seam');
        const seamVal = panel.querySelector('#pixel-art-seam-val');
        const reset = panel.querySelector('#pixel-art-reset');
        detail.addEventListener('input', () => { detailVal.textContent = Number(detail.value).toFixed(2); });
        structure.addEventListener('input', () => { structureVal.textContent = Number(structure.value).toFixed(2); });
        binary.addEventListener('input', () => { binaryVal.textContent = Number(binary.value).toFixed(2); });
        rect.addEventListener('input', () => { rectVal.textContent = Number(rect.value).toFixed(2); });
        silhouette.addEventListener('input', () => { silhouetteVal.textContent = Number(silhouette.value).toFixed(2); });
        seam.addEventListener('input', () => { seamVal.textContent = Number(seam.value).toFixed(2); });

        reset.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            panel.querySelector('#pixel-art-colors').value = String(DEFAULTS.maxColors);
            detail.value = String(DEFAULTS.detailPreservation);
            structure.value = String(DEFAULTS.structureProtection);
            binary.value = String(DEFAULTS.binaryRegionProtection);
            rect.value = String(DEFAULTS.rectilinearProtection);
            silhouette.value = String(DEFAULTS.silhouetteEdgeProtection);
            seam.value = String(DEFAULTS.axisSeamProtection);
            detailVal.textContent = Number(DEFAULTS.detailPreservation).toFixed(2);
            structureVal.textContent = Number(DEFAULTS.structureProtection).toFixed(2);
            binaryVal.textContent = Number(DEFAULTS.binaryRegionProtection).toFixed(2);
            rectVal.textContent = Number(DEFAULTS.rectilinearProtection).toFixed(2);
            silhouetteVal.textContent = Number(DEFAULTS.silhouetteEdgeProtection).toFixed(2);
            seamVal.textContent = Number(DEFAULTS.axisSeamProtection).toFixed(2);
        });

        button.addEventListener('click', () => {
            if (!latestRaw) {
                alert('Please load a source image first.');
                return;
            }
            button.disabled = true;
            const oldText = button.textContent;
            button.textContent = 'Converting...';
            document.body.style.cursor = 'wait';
            setTimeout(() => {
                try {
                    const result = CRT.core.convertToPixelArt(latestRaw, {
                        maxColors: Number(panel.querySelector('#pixel-art-colors').value),
                        detailPreservation: Number(detail.value),
                        structureProtection: Number(structure.value),
                        binaryRegionProtection: Number(binary.value),
                        rectilinearProtection: Number(rect.value),
                        silhouetteEdgeProtection: Number(silhouette.value),
                        axisSeamProtection: Number(seam.value)
                    });
                    pendingResult = result;
                    const dotSlider = document.getElementById('dot-width-slider');
                    const dotVal = document.getElementById('dot-width-val');
                    dotSlider.value = '1'; dotVal.textContent = '1';
                    const info = result.__pixelArtConversionInfo;
                    const modeText = info.conversionMode === 'regular-grid'
                        ? `regular grid ${(info.regularGridConfidence * 100).toFixed(0)}%`
                        : `adaptive mesh ${info.horizontalBands}×${info.verticalBands} bands`;
                    panel.querySelector('#pixel-art-info').textContent =
                        `${modeText}; estimated cell ${info.estimatedCellWidth.toFixed(2)}×${info.estimatedCellHeight.toFixed(2)}px; ` +
                        `output ${info.outputWidth}×${info.outputHeight}; ` +
                        `binary ${info.binaryRegionCount} regions / ${info.binaryProtectedCells} cells; ` +
                        `frames ${info.rectilinearFrameCount} / snap ${info.rectilinearSnappedCells}; ` +
                        `silhouettes ${info.silhouetteComponentCount} / snap ${info.silhouetteSnappedCells}; ` +
                        `seams H${info.horizontalSeams}/V${info.verticalSeams} snap ${info.seamSnappedCells}; ` +
                        `warp avg ${info.meanWarpX.toFixed(2)},${info.meanWarpY.toFixed(2)}px`;
                    dotAlgo.dispatchEvent(new Event('change', { bubbles: true }));
                } catch (error) {
                    console.error('Convert to Pixel Art failed:', error);
                    alert('Convert to Pixel Art failed: ' + error.message);
                } finally {
                    document.body.style.cursor = 'default';
                    button.disabled = false;
                    button.textContent = oldText;
                }
            }, 20);
        });

        wrap.appendChild(button);
        wrap.appendChild(details);
        if (loadSourceControl && loadSourceControl.parentNode) {
            loadSourceControl.insertAdjacentElement('afterend', wrap);
        } else {
            dotAlgo.parentElement.insertAdjacentElement('afterend', wrap);
        }
        decorateHighlightRecoveryPopup();
    }

    CRT.core.__pixelArtConversionInstalled = true;
    CRT.core.__pixelArtConversionVersion = VERSION;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installUI, { once: true });
    else installUI();
})();
