import { buildArenaSvgString, getScopeDimensions } from './svgRenderer.js';

export const EXPORT_PRESETS = [
  { id: 'q1_4096_prop', label: 'Q1 原生1:1极清 (4096×6000px, 1px=1UU 无损矢量直出)', mode: 'q1', w: 4096, h: null },
  { id: 'q1_2048_prop', label: 'Q1 标准高清比例 (2048×3000px, 1px=2UU 无拉伸推荐)', mode: 'q1', w: 2048, h: null },
  { id: 'q1_1024_prop', label: 'Q1 中清真实比例 (1024×1500px, 1px=4UU 矢量直出更锐利)', mode: 'q1', w: 1024, h: null },
  { id: 'q1_512_prop', label: 'Q1 低清真实比例 (512×750px, 1px=8UU 轻量包体)', mode: 'q1', w: 512, h: null },
  { id: 'q1_256_prop', label: 'Q1 超低清真实比例 (256×375px, 1px=16UU 极小预览)', mode: 'q1', w: 256, h: null },
  { id: 'full_4096_prop', label: '全场 高清真实比例 (4096×6000px, 1px=2UU 无拉伸)', mode: 'full_mirror', w: 4096, h: null },
  { id: 'full_2048_prop', label: '全场 中清真实比例 (2048×3000px, 1px=4UU 无拉伸)', mode: 'full_mirror', w: 2048, h: null },
  { id: 'full_1024_prop', label: '全场 低清真实比例 (1024×1500px, 1px=8UU 无拉伸)', mode: 'full_mirror', w: 1024, h: null },
  { id: 'q1_2048_sq', label: 'Q1 2048×2048 (UV [0..1] 正方形贴图)', mode: 'q1', w: 2048, h: 2048 },
  { id: 'q1_1024_sq', label: 'Q1 1024×1024 (UV [0..1] 正方形中清)', mode: 'q1', w: 1024, h: 1024 },
  { id: 'q1_512_sq', label: 'Q1 512×512 (UV [0..1] 正方形低清)', mode: 'q1', w: 512, h: 512 },
  { id: 'full_2048_sq', label: '全场 2048×2048 (UV [0..1] 正方形贴图)', mode: 'full_mirror', w: 2048, h: 2048 }
];

export function resolvePresetDimensions(project, preset) {
  const { w: scopeW, h: scopeH } = getScopeDimensions(project.canvasScope);
  const aspect = scopeH / scopeW;
  const targetW = preset.w;
  const targetH = preset.h ? preset.h : Math.round(targetW * aspect);
  return { width: targetW, height: targetH, mode: preset.mode };
}

/**
 * Automatically distributes grayscale centers [0..255] across all current palette levels (0..N)
 * to maximize grayscale separation for WebP lossy compression tolerance, and computes
 * non-overlapping midpoint classification intervals [rangeMin, rangeMax] for each level.
 */
export function autoDistributePaletteGrayLevels(levels) {
  if (!Array.isArray(levels) || levels.length === 0) return [];
  const total = levels.length;
  if (total === 1) {
    levels[0].level = 0;
    levels[0].gray = 0;
    return levels;
  }
  const maxIdx = total - 1;
  levels.forEach((lvl, idx) => {
    lvl.level = idx;
    lvl.gray = Math.round((idx / maxIdx) * 255);
  });
  return computePaletteIntervals(levels);
}

/**
 * Computes exact non-overlapping grayscale classification intervals [rangeMin..rangeMax] (0..255)
 * and normalized float intervals [normMin..normMax] (0.0..1.0) for each level based on midpoints
 * between adjacent sorted grayscale centers.
 */
export function computePaletteIntervals(levels) {
  if (!Array.isArray(levels) || levels.length === 0) return [];
  const sorted = [...levels].sort((a, b) => a.gray - b.gray);
  const n = sorted.length;

  return sorted.map((lvl, i) => {
    const center = Math.max(0, Math.min(255, Math.round(Number(lvl.gray) || 0)));
    const prevCenter = i > 0 ? Math.max(0, Math.min(255, Math.round(Number(sorted[i - 1].gray) || 0))) : 0;
    const nextCenter = i < n - 1 ? Math.max(0, Math.min(255, Math.round(Number(sorted[i + 1].gray) || 0))) : 255;

    const rangeMin = i === 0 ? 0 : Math.floor((prevCenter + center) / 2) + 1;
    const rangeMax = i === n - 1 ? 255 : Math.floor((center + nextCenter) / 2);

    const toleranceMinus = center - rangeMin;
    const tolerancePlus = rangeMax - center;

    return {
      ...lvl,
      gray: center,
      normCenter: Number((center / 255).toFixed(4)),
      rangeMin: Math.min(rangeMin, rangeMax),
      rangeMax: Math.max(rangeMin, rangeMax),
      normMin: Number((Math.min(rangeMin, rangeMax) / 255).toFixed(4)),
      normMax: Number((Math.max(rangeMin, rangeMax) / 255).toFixed(4)),
      webpToleranceMinus: toleranceMinus,
      webpTolerancePlus: tolerancePlus
    };
  });
}

/**
 * Builds the complete machine-readable Texture & Physical Space Manifest JSON object.
 * Contains:
 * 1. Physical Space & UV Mapping specification (Q1 bounds, Full Arena bounds, 4-quadrant mirror formulas, key Z=0 / Goal / Pad coordinates)
 * 2. Export Texture resolution & UU-per-pixel scale
 * 3. Grayscale Classification Table (Levels 0..N with centerGray, [rangeMin, rangeMax], normalized [0..1] bounds, default color, and bound layers)
 */
export function buildTextureManifest(project, {
  mode = 'q1',
  width = 2048,
  height = 3000
} = {}) {
  const { w: scopeW, h: scopeH, label: scopeLabel } = getScopeDimensions(project.canvasScope);
  const rawLevels = project.colorPalettePreview?.levels || [];
  const computedLevels = computePaletteIntervals(rawLevels);

  const n = computedLevels.length;
  const minStep = n > 1
    ? Math.min(...computedLevels.slice(1).map((l, idx) => l.gray - computedLevels[idx].gray))
    : 255;

  const fullW = scopeW * 2;
  const fullH = scopeH * 2;
  const exportedWorldW = mode === 'q1' ? scopeW : fullW;
  const exportedWorldH = mode === 'q1' ? scopeH : fullH;

  const classificationLevels = computedLevels.map((lvl) => {
    const allBoundLayers = (project.layers || []).filter(l => Number(l.grayLevel) === lvl.level);
    const visibleBoundLayers = allBoundLayers.filter(l => l.visible);
    return {
      level: lvl.level,
      key: `L${lvl.level}`,
      name: lvl.name,
      role: lvl.level === 0 ? 'ground_empty_base' : 'drawn_geometry_tier',
      centerGray: lvl.gray,
      centerNormalized: lvl.normCenter,
      rangeGray: [lvl.rangeMin, lvl.rangeMax],
      rangeNormalized: [lvl.normMin, lvl.normMax],
      webpCompressionToleranceGray: [-lvl.webpToleranceMinus, lvl.webpTolerancePlus],
      defaultColorHex: lvl.color,
      activeLayerCount: visibleBoundLayers.length,
      totalBoundLayerCount: allBoundLayers.length,
      activeLayers: visibleBoundLayers.map(l => ({
        id: l.id,
        name: l.name,
        type: l.type,
        strokeWidthUU: l.type === 'boost_pad_group' ? (l.inwardWidth ?? l.strokeWidth ?? 10) : (l.strokeWidth ?? 0)
      }))
    };
  });

  return {
    schemaVersion: '1.0.0',
    generator: 'RLStandardGround Studio (1:1 Unreal Units)',
    generatedAt: new Date().toISOString(),
    projectName: project.name || 'RLStandardGround Texture',

    textureSpec: {
      exportMode: mode,
      exportModeDescription: mode === 'q1'
        ? 'Single Quadrant Q1 (+X, +Y). Reconstruct full arena via 4-quadrant MirroredRepeat.'
        : 'Full 4-Quadrant Mirrored Arena (-X..+X, -Y..+Y).',
      pixelWidth: width,
      pixelHeight: height,
      worldWidthUU: exportedWorldW,
      worldHeightUU: exportedWorldH,
      uuPerPixelX: Number((exportedWorldW / width).toFixed(4)),
      uuPerPixelY: Number((exportedWorldH / height).toFixed(4)),
      recommendedColorSpace: 'Linear / Raw / Non-Color Data (disable sRGB gamma correction when sampling grayscale intervals)'
    },

    physicalSpaceAndUvMapping: {
      unit: 'Unreal Units (UU)',
      canvasScopeId: project.canvasScope,
      canvasScopeLabel: scopeLabel,
      quadrantQ1BoundsUU: {
        xMin: 0,
        xMax: scopeW,
        yMin: 0,
        yMax: scopeH,
        originCorner: 'Top-Left (u=0, v=0) is Arena Center (X=0, Y=0); Bottom-Right (u=1, v=1) is (+XMax, +YMax).'
      },
      fullArenaMirroredBoundsUU: {
        xMin: -scopeW,
        xMax: scopeW,
        yMin: -scopeH,
        yMax: scopeH,
        totalWidthUU: fullW,
        totalLengthUU: fullH
      },
      uvMappingFormulas: {
        fromWorldToQ1Uv: {
          u: `abs(worldX) / ${scopeW}`,
          v: `abs(worldY) / ${scopeH}`,
          samplerWrapMode: 'MirroredRepeat (GL_MIRRORED_REPEAT)'
        },
        fromWorldToFullMirrorUv: {
          u: `(worldX + ${scopeW}) / ${fullW}`,
          v: `(worldY + ${scopeH}) / ${fullH}`,
          samplerWrapMode: 'ClampToEdge (GL_CLAMP_TO_EDGE)'
        }
      },
      soccarStandardLandmarksUU: {
        sideWallX: 4096,
        backWallY: 5120,
        goalDepthEndY: 6000,
        goalMouthHalfWidthX: 892.75,
        cornerChamfer45Deg: { startX: 4096, startY: 3968, endX: 2944, endY: 5120 },
        flatFloorZ0Boundary: {
          sideX: 3840,
          backY: 4864,
          goalPostX: 760,
          goalBackY: 5880
        },
        driftwoods3DStadiumGroundMeshBoundary: {
          sideX: 3839.99,
          backY: 4928.0,
          goalPostOuterX: 946.31,
          goalMouthInnerX: 702.98,
          goalBackY: 5755.61
        },
        smallPadPickupRadiusUU: 144,
        smallPadSafeAreaExpandUU: Number(project.smallPadSafeExpand ?? 60),
        smallPadSafeAreaTotalRadiusUU: 144 + Number(project.smallPadSafeExpand ?? 60),
        bigPadPickupRadiusUU: 208
      }
    },

    grayscaleClassification: {
      totalLevels: n,
      groundLevelIndex: 0,
      activeGeometryLevelsCount: Math.max(0, n - 1),
      minCenterSeparationGray: minStep,
      minHalfBandMarginGray: Math.floor(minStep / 2),
      classificationRule: 'For any sampled pixel grayscale G in [0..255] (or normalized g in [0.0..1.0]), match the level whose rangeGray [min, max] contains G, or find argmin_i |G - level[i].centerGray|.',
      levels: classificationLevels
    }
  };
}

export function exportManifestJson(project, { mode = 'q1', width = 2048, height = 3000 } = {}) {
  const manifest = buildTextureManifest(project, { mode, width, height });
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const prefix = mode === 'q1' ? 'ground_q1' : 'ground_full';
  const lvlCount = manifest.grayscaleClassification.totalLevels;
  downloadBlob(blob, `${prefix}_${lvlCount}levels_${width}x${height}_manifest.json`);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportProjectJson(project) {
  const copy = JSON.parse(JSON.stringify(project));
  const blob = new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
  const safeName = (project.name || 'rl_ground_project').toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  downloadBlob(blob, `${safeName}.json`);
}

export function exportSvgFile(project, mode = 'q1', includeReference = false, useColorPalettePreview = false) {
  const svgStr = buildArenaSvgString(project, {
    mode,
    includeReference,
    useShaderPreview: false,
    useColorPalettePreview
  });
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const suffix = mode === 'q1' ? 'quadrant_q1' : 'full_arena';
  const lvlCount = project.colorPalettePreview?.levels?.length || 7;
  const colorTag = useColorPalettePreview ? `_${lvlCount}color` : `_${lvlCount}level_gray`;
  downloadBlob(blob, `rl_ground_${suffix}${colorTag}${includeReference ? '_with_ref' : ''}.svg`);
}

/**
 * Pure-JS RFC 9649 WebP Lossless (VP8L) bitstream encoder with SUBTRACT_GREEN_TRANSFORM,
 * LZ77 Run-Length coding, and Canonical Huffman coding.
 *
 * Note on WebP Color Space:
 * The WebP container specification (RFC 9649) does not have a separate "Grayscale" header flag
 * (unlike PNG color_type=0), so OS/browser file inspectors always report WebP color space as "RGB".
 * However, with `SUBTRACT_GREEN_TRANSFORM` enabled (`R' = R - G`, `B' = B - G`), for any grayscale
 * image (`R = G = B`), `R'` and `B'` are identically `0` for every pixel, and `A` is identically `255`.
 * In VP8L, a Huffman alphabet with only 1 active symbol writes 0 bits per pixel in the bitstream!
 * Thus, only the single Green/Luminance channel `G` is actually stored on disk (~30 KB for 2048x3000).
 */
export function encodeLosslessWebpVP8L(rgba, width, height, { forceGrayscale = false } = {}) {
  const numPixels = width * height;
  const pixels32 = new Uint32Array(numPixels);
  for (let i = 0, p = 0; i < numPixels; i++, p += 4) {
    let r = rgba[p];
    let g = rgba[p + 1];
    let b = rgba[p + 2];
    let a = rgba[p + 3];
    if (forceGrayscale) {
      // Force exact R = G = B = G and A = 255 so Wide-Gamut (Display P3) browser canvas color management
      // never introduces any 1-bit R/G/B channel drift.
      r = g;
      b = g;
      a = 255;
    }
    pixels32[i] = ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
  }

  function buildCanonicalCodes(freqs, maxBits = 15) {
    const n = freqs.length;
    const lengths = new Uint8Array(n);
    const codes = new Uint16Array(n);
    const active = [];
    for (let i = 0; i < n; i++) {
      if (freqs[i] > 0) active.push(i);
    }
    if (active.length === 0) {
      lengths[0] = 1;
      return { lengths, codes, active: [0] };
    }
    if (active.length === 1) {
      lengths[active[0]] = 1;
      codes[active[0]] = 0;
      return { lengths, codes, active };
    }

    let nodes = active.map(sym => ({ weight: freqs[sym], syms: [sym], depth: 0 }));
    while (nodes.length > 1) {
      nodes.sort((a, b) => a.weight - b.weight || a.depth - b.depth);
      const left = nodes.shift();
      const right = nodes.shift();
      for (const s of left.syms) lengths[s]++;
      for (const s of right.syms) lengths[s]++;
      nodes.push({
        weight: left.weight + right.weight,
        syms: left.syms.concat(right.syms),
        depth: Math.max(left.depth, right.depth) + 1
      });
    }

    let maxLen = 0;
    for (const s of active) {
      if (lengths[s] > maxLen) maxLen = lengths[s];
    }
    if (maxLen > maxBits) {
      const blCount = new Int32Array(maxBits + 1);
      const symsByFreq = [...active].sort((a, b) => freqs[b] - freqs[a]);
      for (const s of active) {
        const l = Math.min(maxBits, lengths[s]);
        lengths[s] = l;
        blCount[l]++;
      }
      let kraft = 0;
      for (let bits = 1; bits <= maxBits; bits++) {
        kraft += blCount[bits] * (1 << (maxBits - bits));
      }
      const target = 1 << maxBits;
      let idx = symsByFreq.length - 1;
      while (kraft > target && idx >= 0) {
        const s = symsByFreq[idx];
        if (lengths[s] < maxBits) {
          kraft -= (1 << (maxBits - lengths[s])) - (1 << (maxBits - (lengths[s] + 1)));
          lengths[s]++;
        } else {
          idx--;
        }
      }
    }

    const blCount = new Int32Array(maxBits + 1);
    for (const s of active) blCount[lengths[s]]++;
    const nextCode = new Int32Array(maxBits + 1);
    let code = 0;
    for (let bits = 1; bits <= maxBits; bits++) {
      code = (code + blCount[bits - 1]) << 1;
      nextCode[bits] = code;
    }
    const sortedSyms = [...active].sort((a, b) => lengths[a] - lengths[b] || a - b);
    for (const s of sortedSyms) {
      const len = lengths[s];
      const c = nextCode[len]++;
      let rev = 0;
      for (let b = 0; b < len; b++) {
        rev = (rev << 1) | ((c >>> b) & 1);
      }
      codes[s] = rev;
    }
    return { lengths, codes, active };
  }

  function lengthToPrefix(val) {
    if (val < 5) return { code: val - 1, extraBits: 0, extraVal: 0 };
    const v = val - 1;
    const msb = 31 - Math.clz32(v);
    const extraBits = msb - 1;
    const secondBit = (v >>> extraBits) & 1;
    const code = 2 * msb + secondBit;
    const extraVal = v & ((1 << extraBits) - 1);
    return { code, extraBits, extraVal };
  }

  const tokens = [];
  const freqG = new Uint32Array(256 + 24);
  const freqR = new Uint32Array(256);
  const freqB = new Uint32Array(256);
  const freqA = new Uint32Array(256);
  const freqD = new Uint32Array(40);

  let i = 0;
  while (i < numPixels) {
    if (i > 0 && pixels32[i] === pixels32[i - 1]) {
      let run = 1;
      while (i + run < numPixels && run < 4096 && pixels32[i + run] === pixels32[i - 1]) {
        run++;
      }
      if (run >= 2) {
        const lp = lengthToPrefix(run);
        const sym = 256 + lp.code;
        freqG[sym]++;
        freqD[1]++;
        tokens.push({ isLen: true, sym, extraBits: lp.extraBits, extraVal: lp.extraVal });
        i += run;
        continue;
      }
    }
    const px = pixels32[i];
    const a = (px >>> 24) & 255;
    const r = (px >>> 16) & 255;
    const g = (px >>> 8) & 255;
    const b = px & 255;
    // SUBTRACT_GREEN_TRANSFORM: R' = (R - G) & 255, B' = (B - G) & 255
    const rSub = (r - g) & 255;
    const bSub = (b - g) & 255;
    freqG[g]++;
    freqR[rSub]++;
    freqB[bSub]++;
    freqA[a]++;
    tokens.push({ isLen: false, g, r: rSub, b: bSub, a });
    i++;
  }

  const huffG = buildCanonicalCodes(freqG, 15);
  const huffR = buildCanonicalCodes(freqR, 15);
  const huffB = buildCanonicalCodes(freqB, 15);
  const huffA = buildCanonicalCodes(freqA, 15);
  const huffD = buildCanonicalCodes(freqD, 15);

  const bytes = [];
  let bitBuf = 0;
  let bitCount = 0;
  function writeBits(val, nBits) {
    let v = val >>> 0;
    let rem = nBits;
    while (rem > 0) {
      const take = Math.min(rem, 24 - bitCount);
      const mask = (1 << take) - 1;
      bitBuf |= (v & mask) << bitCount;
      bitCount += take;
      v >>>= take;
      rem -= take;
      while (bitCount >= 8) {
        bytes.push(bitBuf & 255);
        bitBuf >>>= 8;
        bitCount -= 8;
      }
    }
  }

  writeBits(0x2f, 8);
  writeBits((width - 1) & 0x3fff, 14);
  writeBits((height - 1) & 0x3fff, 14);
  writeBits(0, 1); // alpha_is_used = 0
  writeBits(0, 3); // version = 0

  // Always write SUBTRACT_GREEN_TRANSFORM (type 2) in header so decoder adds G back to R' and B'
  writeBits(1, 1); // transform present
  writeBits(2, 2); // SUBTRACT_GREEN_TRANSFORM
  writeBits(0, 1); // no more transforms
  writeBits(0, 1); // no color cache
  writeBits(0, 1); // no meta huffman

  const kCodeLengthCodeOrder = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  function writeHuffmanTree(huff) {
    const active = huff.active;
    if (active.length <= 2 && active.every(s => s < 256)) {
      writeBits(1, 1);
      writeBits(active.length - 1, 1);
      const s0 = active[0];
      if (s0 < 2) {
        writeBits(0, 1);
        writeBits(s0, 1);
      } else {
        writeBits(1, 1);
        writeBits(s0, 8);
      }
      if (active.length === 2) {
        writeBits(active[1], 8);
      }
      return;
    }

    writeBits(0, 1);
    const numSyms = huff.lengths.length;
    const clFreq = new Uint32Array(19);
    for (let s = 0; s < numSyms; s++) {
      clFreq[huff.lengths[s]]++;
    }
    const clHuff = buildCanonicalCodes(clFreq, 7);
    let numClCodes = 19;
    while (numClCodes > 4 && clHuff.lengths[kCodeLengthCodeOrder[numClCodes - 1]] === 0) {
      numClCodes--;
    }
    writeBits(numClCodes - 4, 4);
    for (let k = 0; k < numClCodes; k++) {
      writeBits(clHuff.lengths[kCodeLengthCodeOrder[k]], 3);
    }
    writeBits(0, 1);
    for (let s = 0; s < numSyms; s++) {
      const len = huff.lengths[s];
      writeBits(clHuff.codes[len], clHuff.lengths[len]);
    }
  }

  writeHuffmanTree(huffG);
  writeHuffmanTree(huffR);
  writeHuffmanTree(huffB);
  writeHuffmanTree(huffA);
  writeHuffmanTree(huffD);

  const singleG = huffG.active.length === 1;
  const singleR = huffR.active.length === 1;
  const singleB = huffB.active.length === 1;
  const singleA = huffA.active.length === 1;
  const singleD = huffD.active.length === 1;

  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t];
    if (tok.isLen) {
      if (!singleG) writeBits(huffG.codes[tok.sym], huffG.lengths[tok.sym]);
      if (tok.extraBits > 0) writeBits(tok.extraVal, tok.extraBits);
      if (!singleD) writeBits(huffD.codes[1], huffD.lengths[1]);
    } else {
      if (!singleG) writeBits(huffG.codes[tok.g], huffG.lengths[tok.g]);
      if (!singleR) writeBits(huffR.codes[tok.r], huffR.lengths[tok.r]);
      if (!singleB) writeBits(huffB.codes[tok.b], huffB.lengths[tok.b]);
      if (!singleA) writeBits(huffA.codes[tok.a], huffA.lengths[tok.a]);
    }
  }

  if (bitCount > 0) {
    bytes.push(bitBuf & 255);
  }

  const vp8lSize = bytes.length;
  const pad = vp8lSize & 1;
  const riffSize = 4 + 8 + vp8lSize + pad;
  const out = new Uint8Array(8 + riffSize);
  const dv = new DataView(out.buffer);
  out.set([82, 73, 70, 70], 0); // 'RIFF'
  dv.setUint32(4, riffSize, true);
  out.set([87, 69, 66, 80], 8); // 'WEBP'
  out.set([86, 80, 56, 76], 12); // 'VP8L'
  dv.setUint32(16, vp8lSize, true);
  out.set(bytes, 20);
  return new Blob([out], { type: 'image/webp' });
}

/**
 * Normalizes a grayscale Canvas ImageData so every pixel has strictly R = G = B = G and A = 255,
 * eliminating any Wide-Gamut (Display P3) color management drift before PNG or WebP encoding.
 */
function normalizeGrayscaleCanvasPixels(ctx, width, height) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  for (let p = 0; p < data.length; p += 4) {
    const g = data[p + 1];
    data[p] = g;
    data[p + 2] = g;
    data[p + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
}

/**
 * Optional post-process on Canvas ImageData: snaps anti-aliased edge pixels in grayscale mode
 * directly to their exact discrete palette grayscale level (or L0 background if below threshold)
 * so every pixel in the exported texture has 0 anti-aliasing intermediate grayscale values.
 */
function quantizeGrayscaleCanvasPixels(ctx, width, height, project, thresholdNorm = 0.25) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const rawLevels = project.colorPalettePreview?.levels || [];
  const sortedCenters = rawLevels
    .map(l => Math.max(0, Math.min(255, Math.round(Number(l.gray) || 0))))
    .sort((a, b) => a - b);
  const bgGray = sortedCenters[0] ?? 0;

  // Step 1: Build single-channel luminance map (using green channel)
  const lum = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = data[p + 1];
  }

  // Step 2: For each pixel, find 3x3 local peak to classify its true layer, then threshold coverage
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const g = lum[idx];
      if (g <= bgGray) {
        const p = idx * 4;
        data[p] = bgGray;
        data[p + 1] = bgGray;
        data[p + 2] = bgGray;
        data[p + 3] = 255;
        continue;
      }

      let peak = g;
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(width - 1, x + 1);
      for (let ny = y0; ny <= y1; ny++) {
        const rowOff = ny * width;
        for (let nx = x0; nx <= x1; nx++) {
          const ng = lum[rowOff + nx];
          if (ng > peak) peak = ng;
        }
      }

      // Snap peak to nearest discrete palette center
      let nearestCenter = sortedCenters[0] ?? 0;
      let minDiff = Math.abs(peak - nearestCenter);
      for (let k = 1; k < sortedCenters.length; k++) {
        const d = Math.abs(peak - sortedCenters[k]);
        if (d < minDiff) {
          minDiff = d;
          nearestCenter = sortedCenters[k];
        }
      }

      const coverage = nearestCenter > bgGray ? (g - bgGray) / (nearestCenter - bgGray) : 0;
      const outG = coverage >= thresholdNorm ? nearestCenter : bgGray;
      const p = idx * 4;
      data[p] = outG;
      data[p + 1] = outG;
      data[p + 2] = outG;
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

export async function exportRasterTexture(project, {
  mode = 'q1',
  width = 2048,
  height = 3000,
  format = 'image/webp', // 'image/webp' (Lossless VP8L) | 'image/png'
  edgeMode = 'aa_continuous', // 'aa_continuous' (Anti-Aliased Continuous) | 'quantized_sharp' (Strict Discrete Grayscale)
  useShaderPreview = false,
  useColorPalettePreview = false,
  includeReference = false
} = {}) {
  const svgStr = buildArenaSvgString(project, {
    mode,
    includeReference,
    useShaderPreview,
    useColorPalettePreview,
    customPixelWidth: width,
    customPixelHeight: height
  });

  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const isPureGrayscale = !useColorPalettePreview && !useShaderPreview;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);

      if (isPureGrayscale) {
        if (edgeMode === 'quantized_sharp') {
          quantizeGrayscaleCanvasPixels(ctx, width, height, project, 0.25);
        } else {
          normalizeGrayscaleCanvasPixels(ctx, width, height);
        }
      }

      const ext = format === 'image/webp' ? 'webp' : 'png';
      const prefix = mode === 'q1' ? 'ground_q1' : 'ground_full';
      const lvlCount = project.colorPalettePreview?.levels?.length || 7;
      const typeTag = useColorPalettePreview ? `${lvlCount}color` : (useShaderPreview ? 'tinted' : `${lvlCount}gray`);
      const filename = `${prefix}_${typeTag}_${width}x${height}.${ext}`;

      if (format === 'image/webp') {
        try {
          const imgData = ctx.getImageData(0, 0, width, height);
          const vp8lBlob = encodeLosslessWebpVP8L(imgData.data, width, height, { forceGrayscale: isPureGrayscale });
          downloadBlob(vp8lBlob, filename);
          resolve();
        } catch (err) {
          reject(err);
        }
        return;
      }

      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Canvas toBlob failed'));
          return;
        }
        downloadBlob(blob, filename);
        resolve();
      }, format);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}
