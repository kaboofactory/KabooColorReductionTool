/**
 * Smart downsampling v3 for Kaboo Color Reduction Tool.
 *
 * Goal:
 *   Reconstruct a small, finite-palette pixel grid from AI-generated
 *   "fake pixel art". Unlike averaging/resampling filters, this module never
 *   emits averaged RGB values. Every opaque output pixel is one of the colors
 *   in an automatically extracted discrete palette (or an explicitly supplied
 *   palette).
 *
 * The existing Center and Avg implementations are left untouched.
 */
(function () {
    'use strict';

    if (!window.CRT || !CRT.core || typeof CRT.core.downsampleImage !== 'function') return;

    const VERSION = '4.5.0';
    const MAX_CANDIDATES = 5;
    const EPSILON = 1e-9;

    const DEFAULTS = Object.freeze({
        maxColors: 16,
        paletteBinBits: 5,
        paletteMergeDistance: 0.035,
        paletteDiversityExponent: 0.85,
        palettePopularityExponent: 0.35,
        candidateCount: 5,
        optimizationPasses: 5,
        centerBias: 1.35,
        flatnessWeight: 0.35,
        centerSupportWeight: 0.28,
        lineSupportWeight: 0.32,
        detailSupportWeight: 0.12,
        differentOnFlatPenalty: 0.16,
        sameAcrossEdgePenalty: 0.08,
        isolatedPixelPenalty: 0.075,
        lineContinuationBonus: 0.08,
        alphaThreshold: 96,
        opaqueAlphaThreshold: 32,
        cleanupConfidenceThreshold: 0.12,
        recoverSmallHighlights: false,
        highlightMinContrast: 0.12,
        highlightMinBrightness: 0.75,
        highlightRelocationStrength: 0.75,
        highlightMaxMove: 1,
        highlightMaxAreaRatio: 0.75,
        highlightMaxFeatures: 24
    });

    const SRGB_TO_LINEAR = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
        const c = i / 255;
        SRGB_TO_LINEAR[i] = c <= 0.04045
            ? c / 12.92
            : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function rgbToOklab(r8, g8, b8) {
        const r = SRGB_TO_LINEAR[r8];
        const g = SRGB_TO_LINEAR[g8];
        const b = SRGB_TO_LINEAR[b8];

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

    function perceptualDistanceSq(L1, A1, B1, L2, A2, B2) {
        // Pixel-art readability benefits from slightly stronger lightness
        // separation than raw Euclidean OKLab.
        const dL = (L1 - L2) * 1.2;
        const dA = A1 - A2;
        const dB = B1 - B2;
        return dL * dL + dA * dA + dB * dB;
    }

    function analyzeSource(imageData) {
        const width = imageData.width;
        const height = imageData.height;
        const count = width * height;
        const data = imageData.data;
        const L = new Float32Array(count);
        const A = new Float32Array(count);
        const B = new Float32Array(count);
        const alpha = new Uint8Array(count);
        const gradient = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const p = i * 4;
            const lab = rgbToOklab(data[p], data[p + 1], data[p + 2]);
            L[i] = lab[0];
            A[i] = lab[1];
            B[i] = lab[2];
            alpha[i] = data[p + 3];
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * width + x;
                let g = 0;

                if (x > 0) {
                    const j = i - 1;
                    g = Math.max(g, Math.sqrt(perceptualDistanceSq(
                        L[i], A[i], B[i], L[j], A[j], B[j]
                    )) + Math.abs(alpha[i] - alpha[j]) / 255 * 0.25);
                }
                if (x + 1 < width) {
                    const j = i + 1;
                    g = Math.max(g, Math.sqrt(perceptualDistanceSq(
                        L[i], A[i], B[i], L[j], A[j], B[j]
                    )) + Math.abs(alpha[i] - alpha[j]) / 255 * 0.25);
                }
                if (y > 0) {
                    const j = i - width;
                    g = Math.max(g, Math.sqrt(perceptualDistanceSq(
                        L[i], A[i], B[i], L[j], A[j], B[j]
                    )) + Math.abs(alpha[i] - alpha[j]) / 255 * 0.25);
                }
                if (y + 1 < height) {
                    const j = i + width;
                    g = Math.max(g, Math.sqrt(perceptualDistanceSq(
                        L[i], A[i], B[i], L[j], A[j], B[j]
                    )) + Math.abs(alpha[i] - alpha[j]) / 255 * 0.25);
                }

                gradient[i] = clamp(g / 0.25, 0, 1);
            }
        }

        return { width, height, data, L, A, B, alpha, gradient };
    }

    function normalizeExternalPalette(palette) {
        if (!Array.isArray(palette)) return null;
        const result = [];
        const seen = new Set();

        for (const entry of palette) {
            let r, g, b, a;
            if (Array.isArray(entry)) {
                [r, g, b, a = 255] = entry;
            } else if (entry && typeof entry === 'object') {
                ({ r, g, b, a = 255 } = entry);
            } else {
                continue;
            }

            r = clamp(Math.round(Number(r) || 0), 0, 255);
            g = clamp(Math.round(Number(g) || 0), 0, 255);
            b = clamp(Math.round(Number(b) || 0), 0, 255);
            a = clamp(Math.round(Number(a) || 0), 0, 255);
            if (a < 32) continue;

            const key = `${r},${g},${b}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const lab = rgbToOklab(r, g, b);
            result.push({ r, g, b, L: lab[0], A: lab[1], B: lab[2], weight: 1 });
        }

        return result.length ? result : null;
    }

    function extractDiscretePalette(source, options) {
        const external = normalizeExternalPalette(options.palette);
        if (external) return external;

        const bits = clamp(Math.floor(options.paletteBinBits), 3, 6);
        const shift = 8 - bits;
        const channelSize = 1 << bits;
        const binCount = channelSize * channelSize * channelSize;
        const binWeight = new Float32Array(binCount);
        const representativeScore = new Float32Array(binCount);
        const repR = new Uint8Array(binCount);
        const repG = new Uint8Array(binCount);
        const repB = new Uint8Array(binCount);
        const data = source.data;
        const count = source.width * source.height;

        for (let i = 0; i < count; i++) {
            const a = source.alpha[i];
            if (a < options.opaqueAlphaThreshold) continue;
            const p = i * 4;
            const r = data[p];
            const g = data[p + 1];
            const b = data[p + 2];
            const key = ((r >> shift) << (bits * 2)) |
                ((g >> shift) << bits) |
                (b >> shift);

            // Flat regions are stronger evidence of a latent palette color than
            // antialiasing ramps and generated texture noise.
            const flatness = 1 - source.gradient[i];
            const weight = 0.35 + 0.65 * flatness;
            binWeight[key] += weight;

            if (weight > representativeScore[key]) {
                representativeScore[key] = weight;
                repR[key] = r;
                repG[key] = g;
                repB[key] = b;
            }
        }

        const bins = [];
        for (let key = 0; key < binCount; key++) {
            if (binWeight[key] <= 0) continue;
            const r = repR[key];
            const g = repG[key];
            const b = repB[key];
            const lab = rgbToOklab(r, g, b);
            bins.push({
                r, g, b,
                L: lab[0], A: lab[1], B: lab[2],
                weight: binWeight[key]
            });
        }

        if (!bins.length) {
            const lab = rgbToOklab(0, 0, 0);
            return [{ r: 0, g: 0, b: 0, L: lab[0], A: lab[1], B: lab[2], weight: 1 }];
        }

        bins.sort((a, b) => b.weight - a.weight);

        // Non-maximum suppression in perceptual color space. This collapses
        // the many near-identical shades generated around one intended color.
        const peaks = [];
        const mergeDistanceSq = options.paletteMergeDistance * options.paletteMergeDistance;
        for (const bin of bins) {
            let nearest = -1;
            let nearestDistance = Infinity;
            for (let i = 0; i < peaks.length; i++) {
                const peak = peaks[i];
                const d = perceptualDistanceSq(
                    bin.L, bin.A, bin.B,
                    peak.L, peak.A, peak.B
                );
                if (d < nearestDistance) {
                    nearestDistance = d;
                    nearest = i;
                }
            }

            if (nearest >= 0 && nearestDistance < mergeDistanceSq) {
                peaks[nearest].weight += bin.weight;
            } else {
                peaks.push({ ...bin });
            }
        }

        peaks.sort((a, b) => b.weight - a.weight);
        const maxColors = clamp(Math.floor(options.maxColors), 2, 256);
        if (peaks.length <= maxColors) return peaks;

        // Weighted farthest-point sampling keeps common colors while ensuring
        // that rare but visually distinct accents (eyes, sword glints, gems)
        // are not swallowed by a huge background region.
        const selected = [];
        const selectedMask = new Uint8Array(peaks.length);
        const maxWeight = Math.max(peaks[0].weight, EPSILON);

        function addSelected(index) {
            if (index < 0 || index >= peaks.length || selectedMask[index]) return;
            selected.push(index);
            selectedMask[index] = 1;
        }

        addSelected(0);

        // Highlight recovery must not alter palette extraction. ON and OFF
        // intentionally use the exact same finite palette; recovery only
        // promotes suitable palette labels at the cell-candidate stage.

        const minDistance = new Float32Array(peaks.length);
        minDistance.fill(Infinity);
        for (let i = 0; i < peaks.length; i++) {
            for (const index of selected) {
                const d = perceptualDistanceSq(
                    peaks[i].L, peaks[i].A, peaks[i].B,
                    peaks[index].L, peaks[index].A, peaks[index].B
                );
                if (d < minDistance[i]) minDistance[i] = d;
            }
            if (selectedMask[i]) minDistance[i] = 0;
        }

        while (selected.length < maxColors) {
            let best = -1;
            let bestScore = -Infinity;

            for (let i = 0; i < peaks.length; i++) {
                if (selectedMask[i]) continue;
                const popularity = Math.pow(peaks[i].weight / maxWeight,
                    options.palettePopularityExponent);
                const diversity = Math.pow(0.04 + Math.sqrt(minDistance[i]),
                    options.paletteDiversityExponent);
                const score = popularity * diversity;
                if (score > bestScore) {
                    bestScore = score;
                    best = i;
                }
            }

            if (best < 0) break;
            addSelected(best);
            for (let i = 0; i < peaks.length; i++) {
                if (selectedMask[i]) continue;
                const d = perceptualDistanceSq(
                    peaks[i].L, peaks[i].A, peaks[i].B,
                    peaks[best].L, peaks[best].A, peaks[best].B
                );
                if (d < minDistance[i]) minDistance[i] = d;
            }
        }

        return selected.slice(0, maxColors).map(index => peaks[index]);
    }

    function mapSourceToPalette(source, palette, options) {
        const count = source.width * source.height;
        const transparentLabel = palette.length;
        const labels = palette.length + 1 <= 256
            ? new Uint8Array(count)
            : new Uint16Array(count);

        for (let i = 0; i < count; i++) {
            if (source.alpha[i] < options.alphaThreshold) {
                labels[i] = transparentLabel;
                continue;
            }

            let best = 0;
            let bestDistance = Infinity;
            for (let k = 0; k < palette.length; k++) {
                const color = palette[k];
                const d = perceptualDistanceSq(
                    source.L[i], source.A[i], source.B[i],
                    color.L, color.A, color.B
                );
                if (d < bestDistance) {
                    bestDistance = d;
                    best = k;
                }
            }
            labels[i] = best;
        }

        return { labels, transparentLabel };
    }

    function paletteLabelDistance(palette, transparentLabel, first, second) {
        if (first === second) return 0;
        if (first === transparentLabel || second === transparentLabel) return 1;
        const a = palette[first];
        const b = palette[second];
        return clamp(Math.sqrt(perceptualDistanceSq(
            a.L, a.A, a.B, b.L, b.A, b.B
        )) / 0.25, 0, 1);
    }

    function buildPositionWeights(scale, centerBias) {
        const result = new Float32Array(scale * scale);
        const center = (scale - 1) * 0.5;
        const sigma = Math.max(0.8, scale * 0.35);
        const denom = 2 * sigma * sigma;
        for (let y = 0; y < scale; y++) {
            for (let x = 0; x < scale; x++) {
                const dx = x - center;
                const dy = y - center;
                const gaussian = Math.exp(-(dx * dx + dy * dy) / denom);
                result[y * scale + x] = 1 + centerBias * gaussian;
            }
        }
        return result;
    }

    function buildCellCandidates(source, mapped, palette, scale, outputWidth, outputHeight, options) {
        const labelCount = palette.length + 1;
        const cellCount = outputWidth * outputHeight;
        const candidateLimit = Math.min(MAX_CANDIDATES, Math.max(2, options.candidateCount));
        const labels = new Int16Array(cellCount * MAX_CANDIDATES);
        labels.fill(-1);
        const unary = new Float32Array(cellCount * MAX_CANDIDATES);
        unary.fill(Infinity);
        const lineScore = new Float32Array(cellCount * MAX_CANDIDATES);
        const orientation = new Uint8Array(cellCount * MAX_CANDIDATES);
        const highlightScore = new Float32Array(cellCount * MAX_CANDIDATES);
        const protectedHighlight = new Uint8Array(cellCount * MAX_CANDIDATES);
        const count = new Uint8Array(cellCount);
        const confidence = new Float32Array(cellCount);

        const votes = new Float32Array(labelCount);
        const rawCount = new Uint16Array(labelCount);
        const centerVotes = new Float32Array(labelCount);
        const edgeFlags = new Uint8Array(labelCount);
        const highlightVotes = new Float32Array(labelCount);
        const touched = new Int16Array(labelCount);
        const positionWeight = buildPositionWeights(scale, options.centerBias);
        const centerMin = Math.max(0, Math.floor((scale - 2) / 2));
        const centerMax = Math.min(scale - 1, Math.ceil((scale + 1) / 2));

        for (let oy = 0; oy < outputHeight; oy++) {
            for (let ox = 0; ox < outputWidth; ox++) {
                let touchedCount = 0;
                let totalVote = 0;
                let totalCenterVote = 0;
                let opaqueCount = 0;
                let totalL = 0;
                let cellMaxL = -Infinity;

                for (let dy = 0; dy < scale; dy++) {
                    const sy = oy * scale + dy;
                    for (let dx = 0; dx < scale; dx++) {
                        const sx = ox * scale + dx;
                        const sourceIndex = sy * source.width + sx;
                        const label = mapped.labels[sourceIndex];
                        if (rawCount[label] === 0) touched[touchedCount++] = label;

                        const flatness = 1 - source.gradient[sourceIndex];
                        const weight = positionWeight[dy * scale + dx] *
                            (1 - options.flatnessWeight + options.flatnessWeight * flatness);
                        votes[label] += weight;
                        rawCount[label]++;
                        totalVote += weight;

                        if (dx >= centerMin && dx <= centerMax &&
                            dy >= centerMin && dy <= centerMax) {
                            centerVotes[label] += weight;
                            totalCenterVote += weight;
                        }

                        if (dx === 0) edgeFlags[label] |= 1;
                        if (dx === scale - 1) edgeFlags[label] |= 2;
                        if (dy === 0) edgeFlags[label] |= 4;
                        if (dy === scale - 1) edgeFlags[label] |= 8;

                        if (label !== mapped.transparentLabel) {
                            const lightness = source.L[sourceIndex];
                            totalL += lightness;
                            opaqueCount++;
                            if (lightness > cellMaxL) cellMaxL = lightness;
                        }
                    }
                }

                const cellMeanL = opaqueCount > 0 ? totalL / opaqueCount : 0;
                const smallHighlightLimit = Math.max(2, Math.floor(scale * 0.75));
                const highlightMaxSpread = Math.max(3, Math.floor(scale * 1.1));
                if (options.recoverSmallHighlights) {
                    for (let dy = 0; dy < scale; dy++) {
                        const sy = oy * scale + dy;
                        for (let dx = 0; dx < scale; dx++) {
                            const sx = ox * scale + dx;
                            const sourceIndex = sy * source.width + sx;
                            const label = mapped.labels[sourceIndex];
                            if (label === mapped.transparentLabel) continue;
                            const clusterSize = rawCount[label];
                            if (clusterSize > highlightMaxSpread) continue;

                            const lightness = source.L[sourceIndex];
                            const brightContrast = clamp((lightness - cellMeanL - 0.03) / 0.10, 0, 1);
                            if (brightContrast <= 0) continue;

                            let neighborSumL = 0;
                            let neighborCountL = 0;
                            let darkerNeighbors = 0;
                            let brighterNeighbors = 0;
                            for (let ny = Math.max(0, sy - 1); ny <= Math.min(source.height - 1, sy + 1); ny++) {
                                for (let nx = Math.max(0, sx - 1); nx <= Math.min(source.width - 1, sx + 1); nx++) {
                                    if (nx === sx && ny === sy) continue;
                                    const nIndex = ny * source.width + nx;
                                    if (source.alpha[nIndex] < options.alphaThreshold) continue;
                                    const nL = source.L[nIndex];
                                    neighborSumL += nL;
                                    neighborCountL++;
                                    if (nL + 0.02 < lightness) darkerNeighbors++;
                                    if (nL > lightness + 0.01) brighterNeighbors++;
                                }
                            }
                            const neighborMeanL = neighborCountL > 0 ? neighborSumL / neighborCountL : cellMeanL;
                            const localContrast = clamp((lightness - neighborMeanL - 0.02) / 0.09, 0, 1);
                            const localPeak = brighterNeighbors === 0 ? 1 : clamp(1 - brighterNeighbors / 3, 0, 1);
                            const shadowContext = clamp((cellMeanL - neighborMeanL + 0.04) / 0.14, 0, 1);
                            const compactness = clamp(1 - (clusterSize - 1) / Math.max(1, smallHighlightLimit - 1), 0, 1);
                            const microPoint = compactness * compactness;
                            const isolation = clamp(darkerNeighbors / Math.max(1, neighborCountL), 0, 1);
                            const inCenter = (dx >= centerMin && dx <= centerMax && dy >= centerMin && dy <= centerMax) ? 1 : 0.45;
                            const eyeLike = localContrast * (0.35 + 0.35 * microPoint + 0.20 * isolation + 0.10 * inCenter);
                            const score = brightContrast * (0.25 + 0.25 * localPeak + 0.30 * eyeLike + 0.10 * microPoint + 0.10 * shadowContext);
                            highlightVotes[label] += score;
                        }
                    }
                }

                let dominantLabel = touched[0];
                let dominantVote = -1;
                let secondVote = -1;
                for (let t = 0; t < touchedCount; t++) {
                    const label = touched[t];
                    const value = votes[label];
                    if (value > dominantVote) {
                        secondVote = dominantVote;
                        dominantVote = value;
                        dominantLabel = label;
                    } else if (value > secondVote) {
                        secondVote = value;
                    }
                }

                const scored = [];
                for (let t = 0; t < touchedCount; t++) {
                    const label = touched[t];
                    const support = votes[label] / Math.max(totalVote, EPSILON);
                    const centerSupport = centerVotes[label] / Math.max(totalCenterVote, EPSILON);
                    const flags = edgeFlags[label];
                    const horizontal = (flags & 3) === 3;
                    const vertical = (flags & 12) === 12;
                    const spans = horizontal || vertical;
                    const contrast = paletteLabelDistance(
                        palette, mapped.transparentLabel,
                        label, dominantLabel === label ?
                            findStrongestOtherLabel(touched, touchedCount, votes, label) : dominantLabel
                    );
                    const coherentPixels = Math.min(1, rawCount[label] / Math.max(1, scale));
                    const line = spans ? contrast * coherentPixels : 0;
                    const centralDetail = centerVotes[label] > 0
                        ? contrast * Math.min(1, rawCount[label] / 2)
                        : 0;
                    const compactness = clamp(1 - (rawCount[label] - 1) / Math.max(1, Math.max(2, Math.floor(scale * 0.75)) - 1), 0, 1);
                    const brightHighlight = highlightVotes[label] > 0
                        ? (highlightVotes[label] / Math.max(1, rawCount[label])) * (0.35 + 0.65 * compactness * compactness)
                        : 0;
                    const isProtected = label !== mapped.transparentLabel &&
                        rawCount[label] <= Math.max(2, Math.floor(scale * 1.0)) &&
                        brightHighlight >= 0.12;

                    // Higher evidence lowers unary energy. Crucially, this is
                    // based on label votes, not an RGB mean.
                    let evidence = support +
                        options.centerSupportWeight * centerSupport +
                        options.lineSupportWeight * line +
                        options.detailSupportWeight * centralDetail;

                    if (options.recoverSmallHighlights) {
                        const sparseBoost = support < 0.22 ? 1.15 : 1.0;
                        evidence += 0.65 * brightHighlight * sparseBoost;
                    }

                    scored.push({
                        label,
                        energy: 1 - evidence,
                        line,
                        orientation: (horizontal ? 1 : 0) | (vertical ? 2 : 0),
                        highlight: brightHighlight,
                        protected: isProtected
                    });
                }

                scored.sort((a, b) => a.energy - b.energy);
                const cell = oy * outputWidth + ox;
                const base = cell * MAX_CANDIDATES;
                let keep = Math.min(candidateLimit, scored.length);

                if (options.recoverSmallHighlights && keep > 0) {
                    let bestHighlightIndex = -1;
                    let bestHighlightScore = 0.05;
                    for (let k = 0; k < scored.length; k++) {
                        const score = scored[k].highlight;
                        if (score > bestHighlightScore) {
                            bestHighlightScore = score;
                            bestHighlightIndex = k;
                        }
                    }
                    if (bestHighlightIndex >= keep) {
                        scored[keep - 1] = scored[bestHighlightIndex];
                    }
                }

                count[cell] = keep;
                for (let k = 0; k < keep; k++) {
                    labels[base + k] = scored[k].label;
                    unary[base + k] = scored[k].energy;
                    lineScore[base + k] = scored[k].line;
                    orientation[base + k] = scored[k].orientation;
                    highlightScore[base + k] = scored[k].highlight;
                    protectedHighlight[base + k] = scored[k].protected ? 1 : 0;
                }
                confidence[cell] = dominantVote > 0
                    ? clamp((dominantVote - Math.max(0, secondVote)) / dominantVote, 0, 1)
                    : 1;

                for (let t = 0; t < touchedCount; t++) {
                    const label = touched[t];
                    votes[label] = 0;
                    rawCount[label] = 0;
                    centerVotes[label] = 0;
                    edgeFlags[label] = 0;
                    highlightVotes[label] = 0;
                }
            }
        }

        return { labels, unary, lineScore, orientation, highlightScore, protectedHighlight, count, confidence };
    }

    function findStrongestOtherLabel(touched, touchedCount, votes, excluded) {
        let best = excluded;
        let bestVote = -1;
        for (let i = 0; i < touchedCount; i++) {
            const label = touched[i];
            if (label === excluded) continue;
            if (votes[label] > bestVote) {
                bestVote = votes[label];
                best = label;
            }
        }
        return best;
    }

    function buildBoundaryStrengths(mapped, palette, sourceWidth, scale, outputWidth, outputHeight) {
        const horizontal = new Float32Array(outputHeight * Math.max(0, outputWidth - 1));
        const vertical = new Float32Array(Math.max(0, outputHeight - 1) * outputWidth);

        for (let oy = 0; oy < outputHeight; oy++) {
            const sy = oy * scale;
            for (let ox = 0; ox + 1 < outputWidth; ox++) {
                const x = (ox + 1) * scale;
                let different = 0;
                let distance = 0;
                for (let dy = 0; dy < scale; dy++) {
                    const left = mapped.labels[(sy + dy) * sourceWidth + x - 1];
                    const right = mapped.labels[(sy + dy) * sourceWidth + x];
                    if (left !== right) different++;
                    distance += paletteLabelDistance(
                        palette, mapped.transparentLabel, left, right
                    );
                }
                horizontal[oy * (outputWidth - 1) + ox] =
                    0.65 * different / scale + 0.35 * distance / scale;
            }
        }

        for (let oy = 0; oy + 1 < outputHeight; oy++) {
            const y = (oy + 1) * scale;
            for (let ox = 0; ox < outputWidth; ox++) {
                const sx = ox * scale;
                let different = 0;
                let distance = 0;
                for (let dx = 0; dx < scale; dx++) {
                    const top = mapped.labels[(y - 1) * sourceWidth + sx + dx];
                    const bottom = mapped.labels[y * sourceWidth + sx + dx];
                    if (top !== bottom) different++;
                    distance += paletteLabelDistance(
                        palette, mapped.transparentLabel, top, bottom
                    );
                }
                vertical[oy * outputWidth + ox] =
                    0.65 * different / scale + 0.35 * distance / scale;
            }
        }

        return { horizontal, vertical };
    }

    function optimizeLabels(candidates, boundaries, palette, transparentLabel,
        outputWidth, outputHeight, options) {
        const cellCount = outputWidth * outputHeight;
        const selected = new Uint8Array(cellCount);

        for (let cell = 0; cell < cellCount; cell++) {
            let best = 0;
            let bestEnergy = candidates.unary[cell * MAX_CANDIDATES];
            for (let k = 1; k < candidates.count[cell]; k++) {
                const e = candidates.unary[cell * MAX_CANDIDATES + k];
                if (e < bestEnergy) {
                    bestEnergy = e;
                    best = k;
                }
            }
            selected[cell] = best;
        }

        function selectedSlot(cell) {
            return cell * MAX_CANDIDATES + selected[cell];
        }

        for (let pass = 0; pass < options.optimizationPasses; pass++) {
            const reverse = (pass & 1) !== 0;
            const start = reverse ? cellCount - 1 : 0;
            const end = reverse ? -1 : cellCount;
            const step = reverse ? -1 : 1;

            for (let cell = start; cell !== end; cell += step) {
                const x = cell % outputWidth;
                const y = Math.floor(cell / outputWidth);
                const base = cell * MAX_CANDIDATES;
                let bestCandidate = selected[cell];
                let bestEnergy = Infinity;

                for (let k = 0; k < candidates.count[cell]; k++) {
                    const slot = base + k;
                    const label = candidates.labels[slot];
                    let energy = candidates.unary[slot];
                    let differentNeighbors = 0;
                    let neighborCount = 0;

                    if (x > 0) {
                        const nCell = cell - 1;
                        const nSlot = selectedSlot(nCell);
                        const edge = boundaries.horizontal[y * (outputWidth - 1) + x - 1];
                        energy += neighborEnergy(label, candidates.labels[nSlot], edge,
                            palette, transparentLabel, options);
                        if (label !== candidates.labels[nSlot]) differentNeighbors++;
                        if ((candidates.orientation[slot] & 1) && label === candidates.labels[nSlot]) {
                            energy -= options.lineContinuationBonus * candidates.lineScore[slot];
                        }
                        neighborCount++;
                    }
                    if (x + 1 < outputWidth) {
                        const nCell = cell + 1;
                        const nSlot = selectedSlot(nCell);
                        const edge = boundaries.horizontal[y * (outputWidth - 1) + x];
                        energy += neighborEnergy(label, candidates.labels[nSlot], edge,
                            palette, transparentLabel, options);
                        if (label !== candidates.labels[nSlot]) differentNeighbors++;
                        if ((candidates.orientation[slot] & 1) && label === candidates.labels[nSlot]) {
                            energy -= options.lineContinuationBonus * candidates.lineScore[slot];
                        }
                        neighborCount++;
                    }
                    if (y > 0) {
                        const nCell = cell - outputWidth;
                        const nSlot = selectedSlot(nCell);
                        const edge = boundaries.vertical[(y - 1) * outputWidth + x];
                        energy += neighborEnergy(label, candidates.labels[nSlot], edge,
                            palette, transparentLabel, options);
                        if (label !== candidates.labels[nSlot]) differentNeighbors++;
                        if ((candidates.orientation[slot] & 2) && label === candidates.labels[nSlot]) {
                            energy -= options.lineContinuationBonus * candidates.lineScore[slot];
                        }
                        neighborCount++;
                    }
                    if (y + 1 < outputHeight) {
                        const nCell = cell + outputWidth;
                        const nSlot = selectedSlot(nCell);
                        const edge = boundaries.vertical[y * outputWidth + x];
                        energy += neighborEnergy(label, candidates.labels[nSlot], edge,
                            palette, transparentLabel, options);
                        if (label !== candidates.labels[nSlot]) differentNeighbors++;
                        if ((candidates.orientation[slot] & 2) && label === candidates.labels[nSlot]) {
                            energy -= options.lineContinuationBonus * candidates.lineScore[slot];
                        }
                        neighborCount++;
                    }

                    if (neighborCount >= 3 && differentNeighbors >= 3 &&
                        candidates.confidence[cell] < 0.25 &&
                        candidates.lineScore[slot] < 0.25) {
                        if (!(options.recoverSmallHighlights &&
                            candidates.protectedHighlight[slot])) {
                            energy += options.isolatedPixelPenalty;
                        }
                    }

                    if (energy < bestEnergy) {
                        bestEnergy = energy;
                        bestCandidate = k;
                    }
                }

                selected[cell] = bestCandidate;
            }
        }

        // Extremely conservative cleanup: remove only an uncertain pixel that
        // is surrounded by at least three identical 4-neighbors and can select
        // that same label from its own candidate set.
        const cleaned = new Uint8Array(selected);
        for (let cell = 0; cell < cellCount; cell++) {
            if (candidates.confidence[cell] >= options.cleanupConfidenceThreshold) continue;
            if (options.recoverSmallHighlights &&
                candidates.protectedHighlight[selectedSlot(cell)]) continue;
            const x = cell % outputWidth;
            const y = Math.floor(cell / outputWidth);
            const neighborLabels = [];
            if (x > 0) neighborLabels.push(candidates.labels[selectedSlot(cell - 1)]);
            if (x + 1 < outputWidth) neighborLabels.push(candidates.labels[selectedSlot(cell + 1)]);
            if (y > 0) neighborLabels.push(candidates.labels[selectedSlot(cell - outputWidth)]);
            if (y + 1 < outputHeight) neighborLabels.push(candidates.labels[selectedSlot(cell + outputWidth)]);
            if (neighborLabels.length < 3) continue;

            let majority = -1;
            let majorityCount = 0;
            for (const label of neighborLabels) {
                let count = 0;
                for (const other of neighborLabels) if (other === label) count++;
                if (count > majorityCount) {
                    majorityCount = count;
                    majority = label;
                }
            }
            if (majorityCount < 3) continue;

            const base = cell * MAX_CANDIDATES;
            for (let k = 0; k < candidates.count[cell]; k++) {
                if (candidates.labels[base + k] === majority &&
                    candidates.lineScore[base + selected[cell]] < 0.2) {
                    cleaned[cell] = k;
                    break;
                }
            }
        }

        return cleaned;
    }

    function neighborEnergy(first, second, sourceEdge, palette, transparentLabel, options) {
        if (first === second) {
            return options.sameAcrossEdgePenalty * sourceEdge;
        }
        const colorDistance = paletteLabelDistance(
            palette, transparentLabel, first, second
        );
        return options.differentOnFlatPenalty * (1 - sourceEdge) *
            (0.3 + 0.7 * colorDistance);
    }


    function materializeSelectedLabels(candidates, selected) {
        const count = selected.length;
        const result = new Uint16Array(count);
        for (let cell = 0; cell < count; cell++) {
            result[cell] = candidates.labels[cell * MAX_CANDIDATES + selected[cell]];
        }
        return result;
    }

    function renderLabelGrid(labels, palette, transparentLabel, width, height) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let cell = 0; cell < width * height; cell++) {
            const label = labels[cell];
            const p = cell * 4;
            if (label === transparentLabel) {
                data[p] = 0;
                data[p + 1] = 0;
                data[p + 2] = 0;
                data[p + 3] = 0;
            } else {
                const color = palette[label];
                data[p] = color.r;
                data[p + 1] = color.g;
                data[p + 2] = color.b;
                data[p + 3] = 255;
            }
        }
        return new ImageData(data, width, height);
    }

    function detectMicroHighlights(source, mapped, palette, scale, options) {
        const width = source.width;
        const height = source.height;
        const count = width * height;
        const transparentLabel = mapped.transparentLabel;
        const contrastThreshold = clamp(Number(options.highlightMinContrast) || 0, 0.03, 0.35);
        const minBrightness = clamp(Number(options.highlightMinBrightness) || DEFAULTS.highlightMinBrightness, 0.40, 0.98);
        const strength = clamp(Number(options.highlightRelocationStrength) || 0, 0, 1);
        const maxArea = Math.max(1, Math.floor(scale * scale * clamp(Number(options.highlightMaxAreaRatio) || DEFAULTS.highlightMaxAreaRatio, 0.05, 1.50)));
        const maxFeatures = Math.max(1, Math.floor(Number(options.highlightMaxFeatures) || 1));
        const radius = scale >= 12 ? 2 : 1;
        const salient = new Uint8Array(count);
        const saliency = new Float32Array(count);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * width + x;
                if (source.alpha[i] < options.alphaThreshold) continue;
                const label = mapped.labels[i];
                if (label === transparentLabel) continue;

                const lightness = source.L[i];
                let sumL = 0;
                let neighborCount = 0;
                let darkerNeighbors = 0;
                let brighterNeighbors = 0;
                for (let ny = Math.max(0, y - radius); ny <= Math.min(height - 1, y + radius); ny++) {
                    for (let nx = Math.max(0, x - radius); nx <= Math.min(width - 1, x + radius); nx++) {
                        if (nx === x && ny === y) continue;
                        const j = ny * width + nx;
                        if (source.alpha[j] < options.alphaThreshold) continue;
                        const nL = source.L[j];
                        sumL += nL;
                        neighborCount++;
                        if (nL + 0.015 < lightness) darkerNeighbors++;
                        if (nL > lightness + 0.01) brighterNeighbors++;
                    }
                }
                if (!neighborCount) continue;

                const neighborMean = sumL / neighborCount;
                const localContrast = lightness - neighborMean;
                if (localContrast < contrastThreshold) continue;

                const localPeak = brighterNeighbors === 0 ? 1 : clamp(1 - brighterNeighbors / Math.max(1, neighborCount * 0.5), 0, 1);
                const darkerRatio = darkerNeighbors / neighborCount;
                const compactContrast = clamp((localContrast - contrastThreshold) / 0.14, 0, 1);
                const darkContext = clamp((0.72 - neighborMean) / 0.35, 0, 1);
                const chroma = Math.sqrt(source.A[i] * source.A[i] + source.B[i] * source.B[i]);
                const neutrality = 1 - clamp(chroma / 0.18, 0, 1);
                const score = compactContrast * (0.34 + 0.28 * localPeak + 0.20 * darkerRatio + 0.10 * darkContext + 0.08 * neutrality);
                if (score < 0.12 * (0.65 + 0.35 * strength)) continue;

                salient[i] = 1;
                saliency[i] = score;
            }
        }

        const visited = new Uint8Array(count);
        const stack = new Int32Array(count);
        const componentMask = new Uint8Array(count);
        const features = [];

        for (let start = 0; start < count; start++) {
            if (!salient[start] || visited[start]) continue;
            let top = 0;
            stack[top++] = start;
            visited[start] = 1;
            const pixels = [];
            let sumX = 0;
            let sumY = 0;
            let sumL = 0;
            let sumA = 0;
            let sumB = 0;
            let sumScore = 0;
            let maxScore = 0;
            let minX = width, minY = height, maxX = 0, maxY = 0;
            const hist = new Map();

            while (top > 0) {
                const i = stack[--top];
                pixels.push(i);
                componentMask[i] = 1;
                const x = i % width;
                const y = (i / width) | 0;
                sumX += x;
                sumY += y;
                sumL += source.L[i];
                sumA += source.A[i];
                sumB += source.B[i];
                sumScore += saliency[i];
                if (saliency[i] > maxScore) maxScore = saliency[i];
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                const label = mapped.labels[i];
                hist.set(label, (hist.get(label) || 0) + 1);

                for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
                    for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
                        const j = ny * width + nx;
                        if (!salient[j] || visited[j]) continue;
                        visited[j] = 1;
                        stack[top++] = j;
                    }
                }
            }

            const area = pixels.length;
            const boxW = maxX - minX + 1;
            const boxH = maxY - minY + 1;
            const maxSpread = Math.max(boxW, boxH);
            if (area > maxArea || maxSpread > Math.max(2, Math.ceil(scale * 0.6))) {
                for (const idx of pixels) componentMask[idx] = 0;
                continue;
            }

            let ringSumL = 0;
            let ringCount = 0;
            for (let y = Math.max(0, minY - 1); y <= Math.min(height - 1, maxY + 1); y++) {
                for (let x = Math.max(0, minX - 1); x <= Math.min(width - 1, maxX + 1); x++) {
                    const i = y * width + x;
                    if (componentMask[i]) continue;
                    if (source.alpha[i] < options.alphaThreshold) continue;
                    ringSumL += source.L[i];
                    ringCount++;
                }
            }
            const ringMean = ringCount ? ringSumL / ringCount : Math.max(0, (sumL / area) - 0.12);

            let preferredLabel = -1;
            let preferredCount = -1;
            hist.forEach((value, key) => {
                if (key === transparentLabel) return;
                if (value > preferredCount) {
                    preferredCount = value;
                    preferredLabel = key;
                }
            });
            if (preferredLabel < 0) {
                for (const idx of pixels) componentMask[idx] = 0;
                continue;
            }

            const meanL = sumL / area;
            const meanA = sumA / area;
            const meanB = sumB / area;
            const compactness = clamp(1 - (area - 1) / Math.max(1, maxArea - 1), 0, 1);
            const ringContrast = clamp((meanL - ringMean - 0.015) / 0.18, 0, 1);
            const darkContext = clamp((0.68 - ringMean) / 0.38, 0, 1);
            const pointShape = clamp(1 - Math.abs(boxW - boxH) / Math.max(1, boxW + boxH), 0, 1);
            const rawFeatureScore = 0.25 * maxScore +
                0.20 * (sumScore / area) +
                0.22 * ringContrast +
                0.25 * darkContext +
                0.08 * pointShape;
            const featureScore = rawFeatureScore * (0.65 + 0.35 * compactness);
            const brightnessScore = clamp((meanL - minBrightness) / Math.max(0.02, 1 - minBrightness), 0, 1);
            const priority = featureScore *
                (0.55 + 0.85 * darkContext) *
                (0.80 + 0.20 * pointShape) *
                (0.75 + 0.75 * brightnessScore);
            const paletteColor = palette[preferredLabel];
            const paletteBrightness = paletteColor ? paletteColor.L : meanL;
            if (featureScore < 0.11 || meanL < minBrightness ||
                paletteBrightness < minBrightness - 0.08 ||
                paletteBrightness - ringMean < contrastThreshold * 0.45) {
                for (const idx of pixels) componentMask[idx] = 0;
                continue;
            }

            features.push({
                cx: sumX / area,
                cy: sumY / area,
                area,
                score: featureScore,
                priority,
                darkContext,
                ringContrast,
                compactness,
                brightnessScore,
                preferredLabel,
                meanL,
                ringMean,
                boxW,
                boxH,
                projectedCellX: Math.floor((sumX / area) / scale),
                projectedCellY: Math.floor((sumY / area) / scale)
            });

            for (const idx of pixels) componentMask[idx] = 0;
        }

        features.sort((a, b) => b.priority - a.priority);
        return features.slice(0, maxFeatures);
    }

    function relocateMicroHighlights(baseLabels, features, palette, transparentLabel,
        candidates, scale, outputWidth, outputHeight, options) {
        const labels = new Uint16Array(baseLabels);
        const used = new Uint8Array(labels.length);
        const maxMove = clamp(Math.floor(Number(options.highlightMaxMove) || 0), 0, 2);
        const strength = clamp(Number(options.highlightRelocationStrength) || 0, 0, 1);

        function cellCenterX(x) { return x * scale + scale * 0.5; }
        function cellCenterY(y) { return y * scale + scale * 0.5; }

        for (const feature of features) {
            const baseX = clamp(feature.projectedCellX, 0, outputWidth - 1);
            const baseY = clamp(feature.projectedCellY, 0, outputHeight - 1);
            let bestCell = -1;
            let bestCost = Infinity;

            for (let dy = -maxMove; dy <= maxMove; dy++) {
                for (let dx = -maxMove; dx <= maxMove; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) > maxMove) continue;
                    const x = baseX + dx;
                    const y = baseY + dy;
                    if (x < 0 || x >= outputWidth || y < 0 || y >= outputHeight) continue;
                    const cell = y * outputWidth + x;
                    if (used[cell]) continue;

                    const currentLabel = labels[cell];
                    if (currentLabel === transparentLabel) continue;
                    if (currentLabel === feature.preferredLabel) {
                        bestCell = cell;
                        bestCost = -Infinity;
                        continue;
                    }

                    const currentL = palette[currentLabel].L;
                    const preferredL = palette[feature.preferredLabel].L;
                    const centerDistance = Math.hypot(cellCenterX(x) - feature.cx, cellCenterY(y) - feature.cy) / Math.max(1, scale);
                    const distanceCost = centerDistance * 0.50;
                    const overwritePenalty = candidates.confidence[cell] *
                        (0.50 - 0.30 * feature.darkContext);
                    const darknessBonus = clamp((preferredL - currentL) / 0.35, 0, 1);

                    let darkNeighborCount = 0;
                    let neighborCount = 0;
                    if (x > 0) { neighborCount++; if (palette[labels[cell - 1]].L + 0.03 < preferredL) darkNeighborCount++; }
                    if (x + 1 < outputWidth) { neighborCount++; if (palette[labels[cell + 1]].L + 0.03 < preferredL) darkNeighborCount++; }
                    if (y > 0) { neighborCount++; if (palette[labels[cell - outputWidth]].L + 0.03 < preferredL) darkNeighborCount++; }
                    if (y + 1 < outputHeight) { neighborCount++; if (palette[labels[cell + outputWidth]].L + 0.03 < preferredL) darkNeighborCount++; }
                    const eyeContextBonus = neighborCount ? darkNeighborCount / neighborCount : 0;
                    const featureBonus = strength * feature.score *
                        (0.70 + 0.30 * (1 - centerDistance / Math.max(1, maxMove + 0.5)));
                    const eyePriorityBonus = feature.darkContext * feature.ringContrast;
                    const cost = distanceCost + overwritePenalty -
                        0.32 * darknessBonus -
                        0.28 * eyeContextBonus -
                        0.72 * featureBonus -
                        0.42 * eyePriorityBonus;

                    if (cost < bestCost) {
                        bestCost = cost;
                        bestCell = cell;
                    }
                }
            }

            const acceptanceLimit = 0.58 + 0.28 * feature.darkContext * strength;
            if (bestCell >= 0 && (bestCost < acceptanceLimit || labels[bestCell] === feature.preferredLabel)) {
                labels[bestCell] = feature.preferredLabel;
                used[bestCell] = 1;
            }
        }

        return labels;
    }

    function renderOutput(candidates, selected, palette, transparentLabel, width, height) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let cell = 0; cell < width * height; cell++) {
            const slot = cell * MAX_CANDIDATES + selected[cell];
            const label = candidates.labels[slot];
            const p = cell * 4;
            if (label === transparentLabel) {
                data[p] = 0;
                data[p + 1] = 0;
                data[p + 2] = 0;
                data[p + 3] = 0;
            } else {
                const color = palette[label];
                data[p] = color.r;
                data[p + 1] = color.g;
                data[p + 2] = color.b;
                data[p + 3] = 255;
            }
        }
        return new ImageData(data, width, height);
    }

    CRT.core.smartDownsampleOptions = CRT.core.smartDownsampleOptions || {};

    const SMART_COLOR_STORAGE_KEY = 'kaboo.smartDownsample.maxColors';
    const SMART_OPTION_STORAGE_PREFIX = 'kaboo.smartDownsample.v4_4.option.';
    const SMART_COLOR_COUNTS = Object.freeze([2, 4, 8, 12, 16, 24, 32, 48, 64, 128, 256]);
    const SMART_OPTION_DEFS = Object.freeze([
        {
            key: 'recoverSmallHighlights',
            label: 'Recover Small Highlights',
            title: 'Recover small highlights without changing the selected palette'
        }
    ]);
    const SMART_PARAM_DEFS = Object.freeze([
        {
            key: 'highlightMinContrast',
            label: 'Min Contrast',
            title: 'Minimum local lightness contrast required to treat a micro-feature as a recoverable highlight',
            min: 0.03, max: 0.35, step: 0.01, digits: 2
        },
        {
            key: 'highlightMinBrightness',
            label: 'Min Brightness',
            title: 'Minimum absolute OKLab lightness required for a feature to be recovered',
            min: 0.40, max: 0.95, step: 0.01, digits: 2
        },
        {
            key: 'highlightRelocationStrength',
            label: 'Recovery Strength',
            title: 'How strongly the recovered highlight is allowed to override the base reconstruction',
            min: 0, max: 1, step: 0.05, digits: 2
        },
        {
            key: 'highlightMaxMove',
            label: 'Max Move',
            title: 'Maximum relocation distance in output pixels (cells)',
            min: 0, max: 2, step: 1, digits: 0
        },
        {
            key: 'highlightMaxAreaRatio',
            label: 'Max Feature Size',
            title: 'Maximum feature area relative to one output cell. Increase this when eye highlights are larger than expected.',
            min: 0.05, max: 1.50, step: 0.05, digits: 2
        },
        {
            key: 'highlightMaxFeatures',
            label: 'Max Recoveries',
            title: 'Maximum number of micro-highlights that may be recovered',
            min: 1, max: 64, step: 1, digits: 0
        }
    ]);

    function normalizeColorCount(value) {
        let count = Number.parseInt(value, 10);
        if (!Number.isFinite(count)) count = DEFAULTS.maxColors;

        // Restrict both the UI and programmatic settings to the supported palette sizes.
        // On an exact tie, prefer the smaller palette for a more pixel-art-like
        // result (for example, a previously stored value of 24 becomes 16).
        let best = SMART_COLOR_COUNTS[0];
        let bestDistance = Math.abs(count - best);
        for (let i = 1; i < SMART_COLOR_COUNTS.length; i++) {
            const candidate = SMART_COLOR_COUNTS[i];
            const distance = Math.abs(count - candidate);
            if (distance < bestDistance) {
                best = candidate;
                bestDistance = distance;
            }
        }
        return best;
    }

    function readStoredColorCount() {
        if (typeof localStorage === 'undefined') return DEFAULTS.maxColors;
        try {
            return normalizeColorCount(localStorage.getItem(SMART_COLOR_STORAGE_KEY));
        } catch (_error) {
            return DEFAULTS.maxColors;
        }
    }

    function storeColorCount(value) {
        if (typeof localStorage === 'undefined') return;
        try {
            localStorage.setItem(SMART_COLOR_STORAGE_KEY, String(value));
        } catch (_error) {
            // localStorage may be disabled for file:// pages in some browsers.
        }
    }


    function readStoredSmartOption(key, defaultValue) {
        if (typeof localStorage === 'undefined') return defaultValue;
        try {
            const value = localStorage.getItem(SMART_OPTION_STORAGE_PREFIX + key);
            if (value == null) return defaultValue;
            return value === '1';
        } catch (_error) {
            return defaultValue;
        }
    }

    function storeSmartOption(key, enabled) {
        if (typeof localStorage === 'undefined') return;
        try {
            localStorage.setItem(SMART_OPTION_STORAGE_PREFIX + key, enabled ? '1' : '0');
        } catch (_error) {
            // localStorage may be disabled for file:// pages in some browsers.
        }
    }

    function readStoredSmartValue(key, defaultValue) {
        if (typeof localStorage === 'undefined') return defaultValue;
        try {
            const value = localStorage.getItem(SMART_OPTION_STORAGE_PREFIX + key);
            return value == null ? defaultValue : value;
        } catch (_error) {
            return defaultValue;
        }
    }

    function storeSmartValue(key, value) {
        if (typeof localStorage === 'undefined') return;
        try {
            localStorage.setItem(SMART_OPTION_STORAGE_PREFIX + key, String(value));
        } catch (_error) {
            // localStorage may be disabled for file:// pages in some browsers.
        }
    }

    function installSmartColorCountControl() {
        if (typeof document === 'undefined') return;
        if (document.getElementById('smart-color-count')) return;

        const algorithmSelect = document.getElementById('downsample-algo');
        if (!algorithmSelect) return;

        const wrapper = document.createElement('span');
        wrapper.id = 'smart-color-count-wrapper';
        wrapper.style.display = 'inline-flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '4px';
        wrapper.style.marginLeft = '3px';

        const label = document.createElement('label');
        label.htmlFor = 'smart-color-count';
        label.textContent = 'Colors:';
        label.style.fontSize = '0.8rem';

        const input = document.createElement('select');
        input.id = 'smart-color-count';
        input.title = 'Smart palette colors (2, 4, 8, 12, 16, 24, 32, 48, 64, 128, 256)';
        input.style.width = '64px';
        input.style.fontSize = '0.8rem';
        input.style.padding = '2px 3px';

        for (const count of SMART_COLOR_COUNTS) {
            const option = document.createElement('option');
            option.value = String(count);
            option.textContent = String(count);
            input.appendChild(option);
        }

        const initialValue = normalizeColorCount(
            CRT.core.smartDownsampleOptions.maxColors ?? readStoredColorCount()
        );
        input.value = String(initialValue);
        CRT.core.smartDownsampleOptions.maxColors = initialValue;
        storeColorCount(initialValue);

        const optionWrapper = document.createElement('details');
        optionWrapper.id = 'smart-highlight-options-wrapper';
        optionWrapper.style.display = 'block';
        optionWrapper.style.marginTop = '6px';
        optionWrapper.style.marginLeft = '3px';
        optionWrapper.style.paddingLeft = '0';

        const optionSummary = document.createElement('summary');
        optionSummary.textContent = 'Highlight Recovery';
        optionSummary.style.fontSize = '0.8rem';
        optionSummary.style.cursor = 'pointer';
        optionSummary.style.userSelect = 'none';
        optionSummary.style.listStylePosition = 'inside';
        optionSummary.style.outline = 'none';
        optionWrapper.appendChild(optionSummary);

        const optionList = document.createElement('div');
        optionList.style.display = 'flex';
        optionList.style.flexDirection = 'column';
        optionList.style.alignItems = 'flex-start';
        optionList.style.gap = '4px';
        optionList.style.marginTop = '4px';
        optionList.style.marginLeft = '14px';

        const optionInputs = [];
        const paramInputs = [];
        const paramControls = [];
        const optionHeaderRow = document.createElement('div');
        optionHeaderRow.style.display = 'flex';
        optionHeaderRow.style.alignItems = 'center';
        optionHeaderRow.style.justifyContent = 'space-between';
        optionHeaderRow.style.gap = '8px';
        optionHeaderRow.style.width = '242px';
        optionHeaderRow.style.maxWidth = 'calc(100vw - 58px)';

        for (const def of SMART_OPTION_DEFS) {
            const item = document.createElement('label');
            item.style.display = 'inline-flex';
            item.style.alignItems = 'center';
            item.style.gap = '6px';
            item.style.fontSize = '0.76rem';
            item.style.minWidth = '0';
            item.title = def.title;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = 'smart-option-' + def.key;
            checkbox.checked = !!(CRT.core.smartDownsampleOptions[def.key] ??
                readStoredSmartOption(def.key, DEFAULTS[def.key]));
            checkbox.style.margin = '0';
            CRT.core.smartDownsampleOptions[def.key] = checkbox.checked;
            storeSmartOption(def.key, checkbox.checked);

            checkbox.addEventListener('change', () => {
                CRT.core.smartDownsampleOptions[def.key] = checkbox.checked;
                storeSmartOption(def.key, checkbox.checked);
                if (algorithmSelect.value === 'smart') {
                    algorithmSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
                syncEnabledState();
            });

            const textNode = document.createElement('span');
            textNode.textContent = def.label;
            textNode.style.whiteSpace = 'nowrap';

            item.appendChild(checkbox);
            item.appendChild(textNode);
            optionHeaderRow.appendChild(item);
            optionInputs.push(checkbox);
        }

        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.textContent = 'Reset';
        resetButton.title = 'Reset all Highlight Recovery sliders to their default values';
        resetButton.style.flex = '0 0 auto';
        resetButton.style.fontSize = '0.68rem';
        resetButton.style.lineHeight = '1.2';
        resetButton.style.padding = '2px 6px';
        resetButton.style.cursor = 'pointer';
        optionHeaderRow.appendChild(resetButton);
        optionList.appendChild(optionHeaderRow);

        const paramsContainer = document.createElement('div');
        paramsContainer.style.display = 'flex';
        paramsContainer.style.flexDirection = 'column';
        paramsContainer.style.gap = '6px';
        paramsContainer.style.marginTop = '5px';
        paramsContainer.style.marginLeft = '22px';
        paramsContainer.style.width = '220px';
        paramsContainer.style.maxWidth = 'calc(100vw - 80px)';

        function formatParamValue(def, value) {
            return def.digits > 0 ? Number(value).toFixed(def.digits) : String(Math.round(value));
        }

        for (const def of SMART_PARAM_DEFS) {
            const row = document.createElement('div');
            row.style.display = 'grid';
            row.style.gridTemplateColumns = '1fr 46px';
            row.style.columnGap = '6px';
            row.style.rowGap = '2px';
            row.title = def.title;

            const paramLabel = document.createElement('label');
            paramLabel.htmlFor = 'smart-param-' + def.key;
            paramLabel.textContent = def.label;
            paramLabel.style.fontSize = '0.74rem';
            paramLabel.style.alignSelf = 'center';

            const valueDisplay = document.createElement('span');
            valueDisplay.style.fontSize = '0.72rem';
            valueDisplay.style.textAlign = 'right';
            valueDisplay.style.fontVariantNumeric = 'tabular-nums';

            const control = document.createElement('input');
            control.type = 'range';
            control.id = 'smart-param-' + def.key;
            control.min = String(def.min);
            control.max = String(def.max);
            control.step = String(def.step);
            control.title = def.title;
            control.style.gridColumn = '1 / 3';
            control.style.width = '100%';
            control.style.margin = '0';

            function normalizeParamValue(rawValue) {
                let value = Number(rawValue);
                if (!Number.isFinite(value)) value = DEFAULTS[def.key];
                value = clamp(value, def.min, def.max);
                if (def.step >= 1) return Math.round(value);
                const rounded = Math.round(value / def.step) * def.step;
                return Number(rounded.toFixed(def.digits));
            }

            const storedValue = CRT.core.smartDownsampleOptions[def.key] ??
                readStoredSmartValue(def.key, DEFAULTS[def.key]);
            const normalizedValue = normalizeParamValue(storedValue);
            CRT.core.smartDownsampleOptions[def.key] = normalizedValue;
            control.value = String(normalizedValue);
            valueDisplay.textContent = formatParamValue(def, normalizedValue);
            storeSmartValue(def.key, normalizedValue);

            // While dragging, only update the number shown beside the slider.
            // Native range "change" fires after the pointer/key interaction is
            // committed, so the expensive image regeneration happens only then.
            control.addEventListener('input', () => {
                const previewValue = normalizeParamValue(control.value);
                valueDisplay.textContent = formatParamValue(def, previewValue);
            });

            control.addEventListener('change', () => {
                const value = normalizeParamValue(control.value);
                control.value = String(value);
                valueDisplay.textContent = formatParamValue(def, value);
                CRT.core.smartDownsampleOptions[def.key] = value;
                storeSmartValue(def.key, value);
                if (algorithmSelect.value === 'smart') {
                    algorithmSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });

            row.appendChild(paramLabel);
            row.appendChild(valueDisplay);
            row.appendChild(control);
            paramsContainer.appendChild(row);
            paramInputs.push(control);
            paramControls.push({ def, control, valueDisplay, normalizeParamValue });
        }
        optionList.appendChild(paramsContainer);

        resetButton.addEventListener('click', () => {
            for (const entry of paramControls) {
                const value = entry.normalizeParamValue(DEFAULTS[entry.def.key]);
                entry.control.value = String(value);
                entry.valueDisplay.textContent = formatParamValue(entry.def, value);
                CRT.core.smartDownsampleOptions[entry.def.key] = value;
                storeSmartValue(entry.def.key, value);
            }

            // Reset every slider first, then regenerate the image only once.
            if (algorithmSelect.value === 'smart') {
                algorithmSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        function syncEnabledState() {
            const enabled = algorithmSelect.value === 'smart';
            const recoveryEnabled = enabled && !!CRT.core.smartDownsampleOptions.recoverSmallHighlights;
            input.disabled = !enabled;
            wrapper.style.opacity = enabled ? '1' : '0.45';
            for (const checkbox of optionInputs) checkbox.disabled = !enabled;
            for (const paramInput of paramInputs) paramInput.disabled = !recoveryEnabled;
            resetButton.disabled = !enabled;
            resetButton.style.cursor = enabled ? 'pointer' : 'default';
            paramsContainer.style.opacity = recoveryEnabled ? '1' : '0.55';
            optionWrapper.style.opacity = enabled ? '1' : '0.45';
            optionSummary.style.opacity = enabled ? '1' : '0.75';
        }

        function applyColorCount() {
            const value = normalizeColorCount(input.value);
            input.value = String(value);
            CRT.core.smartDownsampleOptions.maxColors = value;
            storeColorCount(value);

            if (algorithmSelect.value === 'smart') {
                algorithmSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        input.addEventListener('change', applyColorCount);
        algorithmSelect.addEventListener('change', syncEnabledState);

        wrapper.appendChild(label);
        wrapper.appendChild(input);
        optionWrapper.appendChild(optionList);
        const container = document.createElement('div');
        container.id = 'smart-controls-container';
        container.style.display = 'inline-flex';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'flex-start';
        container.style.marginLeft = '3px';
        container.appendChild(wrapper);
        container.appendChild(optionWrapper);
        algorithmSelect.insertAdjacentElement('afterend', container);
        syncEnabledState();
    }

    CRT.core.smartDownsampleImage = function (imageData, dotWidth, customOptions) {
        const scale = Math.max(1, Math.floor(dotWidth));
        if (scale <= 1) {
            return new ImageData(
                new Uint8ClampedArray(imageData.data),
                imageData.width,
                imageData.height
            );
        }

        const outputWidth = Math.floor(imageData.width / scale);
        const outputHeight = Math.floor(imageData.height / scale);
        if (outputWidth < 1 || outputHeight < 1) {
            throw new Error('Pseudo Dot Width is larger than the source image.');
        }

        const options = Object.assign(
            {},
            DEFAULTS,
            CRT.core.smartDownsampleOptions,
            customOptions || {}
        );
        options.maxColors = normalizeColorCount(options.maxColors);
        options.highlightMinContrast = clamp(Number(options.highlightMinContrast) || DEFAULTS.highlightMinContrast, 0.03, 0.35);
        options.highlightMinBrightness = clamp(Number(options.highlightMinBrightness) || DEFAULTS.highlightMinBrightness, 0.40, 0.95);
        options.highlightRelocationStrength = clamp(Number(options.highlightRelocationStrength) || DEFAULTS.highlightRelocationStrength, 0, 1);
        options.highlightMaxMove = clamp(Math.floor(Number(options.highlightMaxMove) || DEFAULTS.highlightMaxMove), 0, 2);
        options.highlightMaxAreaRatio = clamp(Number(options.highlightMaxAreaRatio) || DEFAULTS.highlightMaxAreaRatio, 0.05, 1.50);
        options.highlightMaxFeatures = clamp(Math.floor(Number(options.highlightMaxFeatures) || DEFAULTS.highlightMaxFeatures), 1, 64);

        const source = analyzeSource(imageData);
        const palette = extractDiscretePalette(source, options);
        const mapped = mapSourceToPalette(source, palette, options);

        // The base reconstruction must stay identical to the OFF version.
        // Highlight recovery is applied strictly as a post-process on the
        // selected low-resolution label grid, without altering palette selection.
        const baseOptions = Object.assign({}, options, { recoverSmallHighlights: false });
        const candidates = buildCellCandidates(
            source, mapped, palette, scale, outputWidth, outputHeight, baseOptions
        );
        const boundaries = buildBoundaryStrengths(
            mapped, palette, source.width, scale, outputWidth, outputHeight
        );
        const selected = optimizeLabels(
            candidates, boundaries, palette, mapped.transparentLabel,
            outputWidth, outputHeight, baseOptions
        );

        if (options.recoverSmallHighlights) {
            const baseLabels = materializeSelectedLabels(candidates, selected);
            const features = detectMicroHighlights(source, mapped, palette, scale, options);
            if (features.length) {
                const recoveredLabels = relocateMicroHighlights(
                    baseLabels, features, palette, mapped.transparentLabel,
                    candidates, scale, outputWidth, outputHeight, options
                );
                return renderLabelGrid(
                    recoveredLabels, palette, mapped.transparentLabel,
                    outputWidth, outputHeight
                );
            }
        }

        return renderOutput(
            candidates, selected, palette, mapped.transparentLabel,
            outputWidth, outputHeight
        );
    };

    // Preserve the original implementation exactly once, so Center and Avg
    // continue to behave as before even if this script is reloaded.
    if (!CRT.core.__smartDownsampleOriginal) {
        CRT.core.__smartDownsampleOriginal = CRT.core.downsampleImage;
    }
    CRT.core.downsampleImage = function (imageData, dotWidth, algorithm) {
        if (algorithm === 'smart') {
            return CRT.core.smartDownsampleImage(imageData, dotWidth);
        }
        return CRT.core.__smartDownsampleOriginal(imageData, dotWidth, algorithm);
    };

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', installSmartColorCountControl, { once: true });
        } else {
            installSmartColorCountControl();
        }
    }

    CRT.core.__smartDownsampleInstalled = true;
    CRT.core.__smartDownsampleVersion = VERSION;
})();
