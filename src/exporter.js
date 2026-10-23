import { buildArenaSvgString, getScopeDimensions } from './svgRenderer.js';

export const EXPORT_PRESETS = [
  { id: 'q1_512_sq', label: 'Q1 512×512 (1:1 正方形低清)', mode: 'q1', w: 512, h: 512 },
  { id: 'q1_1024_sq', label: 'Q1 1024×1024 (1:1 正方形中清)', mode: 'q1', w: 1024, h: 1024 },
  { id: 'q1_2048_sq', label: 'Q1 2048×2048 (1:1 正方形高清)', mode: 'q1', w: 2048, h: 2048 },
  { id: 'q1_512_prop', label: 'Q1 按真实比例 (宽 512px)', mode: 'q1', w: 512, h: null },
  { id: 'q1_2048_prop', label: 'Q1 按真实比例 (宽 2048px, 1px=2UU)', mode: 'q1', w: 2048, h: null },
  { id: 'full_1024_sq', label: '全场 1024×1024 (对称拼接正方形)', mode: 'full_mirror', w: 1024, h: 1024 },
  { id: 'full_2048_sq', label: '全场 2048×2048 (对称拼接高清正方形)', mode: 'full_mirror', w: 2048, h: 2048 },
  { id: 'full_2048_prop', label: '全场 按真实比例 (宽 2048px)', mode: 'full_mirror', w: 2048, h: null },
  { id: 'full_4096_prop', label: '全场 按真实比例 (宽 4096px, 1px=2UU)', mode: 'full_mirror', w: 4096, h: null }
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

export function exportSvgFile(project, mode = 'q1', includeReference = false) {
  const svgStr = buildArenaSvgString(project, {
    mode,
    includeReference,
    useShaderPreview: false
  });
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const suffix = mode === 'q1' ? 'quadrant_q1' : 'full_arena';
  downloadBlob(blob, `rl_ground_${suffix}${includeReference ? '_with_ref' : ''}.svg`);
}

export async function exportRasterTexture(project, {
  mode = 'q1',
  width = 2048,
  height = 2048,
  format = 'image/png', // 'image/png' | 'image/webp'
  useShaderPreview = false,
  includeReference = false
} = {}) {
  const svgStr = buildArenaSvgString(project, {
    mode,
    includeReference,
    useShaderPreview,
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
      const typeTag = useShaderPreview ? 'tinted' : 'grayscale';

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
