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
