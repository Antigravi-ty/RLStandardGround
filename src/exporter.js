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

export async function exportRasterTexture(project, {
  mode = 'q1',
  width = 2048,
  height = 3000,
  format = 'image/webp', // 'image/webp' | 'image/png'
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

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);

      const ext = format === 'image/webp' ? 'webp' : 'png';
      const prefix = mode === 'q1' ? 'ground_q1' : 'ground_full';
      const lvlCount = project.colorPalettePreview?.levels?.length || 7;
      const typeTag = useColorPalettePreview ? `${lvlCount}color` : (useShaderPreview ? 'tinted' : `${lvlCount}gray`);

      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Canvas toBlob failed'));
          return;
        }
        downloadBlob(blob, `${prefix}_${typeTag}_${width}x${height}.${ext}`);
        resolve();
      }, format, 0.98);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}
