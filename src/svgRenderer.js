import {
  ARENA_CONSTANTS,
  Q1_FLAT_FLOOR_CONTOUR,
  Q1_PITCH_FLAT_FLOOR_CONTOUR,
  Q1_OUTER_WALL_CONTOUR,
  Q1_PITCH_OUTER_WALL_CONTOUR,
  Q1_BOOST_PADS_BIG,
  Q1_BOOST_PADS_SMALL,
  Q1_KICKOFF_SPAWNS,
  Q1_DEMO_RESPAWNS,
  HITBOX_PRESETS
} from './physicsData.js';
import { offsetQ1Contour, solveThreePointArc, describePolarArc, grayToCss } from './geometryMath.js';

export function getScopeDimensions(canvasScope) {
  if (canvasScope === 'pitch_only') {
    return { w: 4096, h: 5120, label: '4096 × 5120 UU (Pitch Only, 4:5)' };
  }
  if (canvasScope === 'driftwoods_uv') {
    return { w: 3840, h: 5755.61, label: '3840 × 5755.61 UU (Driftwoods Ground UV)' };
  }
  return { w: 4096, h: 6000, label: '4096 × 6000 UU (Full Pitch + Goal)' };
}

function getBaseContourPoints(baseContour) {
  switch (baseContour) {
    case 'full_flat_floor':
      return Q1_FLAT_FLOOR_CONTOUR;
    case 'outer_wall':
      return Q1_OUTER_WALL_CONTOUR;
    case 'pitch_outer_wall':
      return Q1_PITCH_OUTER_WALL_CONTOUR;
    case 'pitch_flat_floor':
    default:
      return Q1_PITCH_FLAT_FLOOR_CONTOUR;
  }
}

function pointsToPathD(pts, closeToOrigin = false) {
  if (!pts || pts.length === 0) return '';
  const body = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  if (closeToOrigin) {
    return `${body} L 0.00,0.00 Z`;
  }
  return body;
}

/**
 * Renders a single parametric layer in Q1 space [0..4096, 0..6000].
 * Returns { defsHtml, bodyHtml } so clipPaths stay in <defs>.
 */
export function renderParametricLayerQ1(layer, index, shaderSim, isInteractiveSelected = false) {
  if (!layer || !layer.visible) return { defsHtml: '', bodyHtml: '' };

  const clipId = `clip_${layer.id}_${index}`;
  const cxMin = Number(layer.clipXMin ?? 0);
  const cxMax = Number(layer.clipXMax ?? 4096);
  const cyMin = Number(layer.clipYMin ?? 0);
  const cyMax = Number(layer.clipYMax ?? 6000);
  const cw = Math.max(0, cxMax - cxMin);
  const ch = Math.max(0, cyMax - cyMin);

  let defsHtml = `<clipPath id="${clipId}"><rect x="${cxMin}" y="${cyMin}" width="${cw}" height="${ch}" /></clipPath>`;
  let innerHtml = '';

  const strokeColor = grayToCss(layer.gray ?? 255, layer.opacity ?? 1.0, shaderSim);
  const fillColor = (layer.fillGray !== undefined && layer.fillGray >= 0)
    ? grayToCss(layer.fillGray, layer.opacity ?? 1.0, shaderSim)
    : 'none';

  const dashAttr = (layer.dashLength > 0 && layer.gapLength > 0)
    ? `stroke-dasharray="${layer.dashLength},${layer.gapLength}" stroke-dashoffset="${layer.dashOffset || 0}"`
    : '';
  const capJoinAttr = `stroke-linecap="${layer.lineCap || 'butt'}" stroke-linejoin="${layer.lineJoin || 'round'}"`;

  if (layer.type === 'turf_stripes') {
    const span = Math.max(32, Number(layer.stripeSpan) || 512);
    const duty = Math.max(0.05, Math.min(0.95, Number(layer.dutyCycle) || 0.5));
    const offset = Number(layer.offset) || 0;
    const stripeColor = grayToCss(layer.gray ?? 16, layer.opacity ?? 1.0, shaderSim);

    let turfClipAttr = '';
    if (layer.clipToFlatFloor) {
      const turfFloorClipId = `turf_floor_${layer.id}_${index}`;
      const insetPts = offsetQ1Contour(Q1_PITCH_FLAT_FLOOR_CONTOUR, Number(layer.insetFromFloor) || 0);
      const polyD = pointsToPathD(insetPts, true);
      defsHtml += `<clipPath id="${turfFloorClipId}"><path d="${polyD}" /></clipPath>`;
      turfClipAttr = `clip-path="url(#${turfFloorClipId})"`;
    }

    let stripes = '';
    if (layer.orientation === 'vertical') {
      for (let x = offset; x < 4096; x += span) {
        const w = span * duty;
        if (x + w > 0) {
          stripes += `<rect x="${Math.max(0, x).toFixed(2)}" y="0" width="${w.toFixed(2)}" height="6000" fill="${stripeColor}" />`;
        }
      }
    } else {
      for (let y = offset; y < 6000; y += span) {
        const h = span * duty;
        if (y + h > 0) {
          stripes += `<rect x="0" y="${Math.max(0, y).toFixed(2)}" width="4096" height="${h.toFixed(2)}" fill="${stripeColor}" />`;
        }
      }
    }
    innerHtml = `<g ${turfClipAttr}>${stripes}</g>`;
  } else if (layer.type === 'contour_offset') {
    const basePts = getBaseContourPoints(layer.baseContour);
    const offsetPts = offsetQ1Contour(basePts, Number(layer.insetDist) || 0);
    if (layer.fillGray !== undefined && layer.fillGray >= 0) {
      const fillD = pointsToPathD(offsetPts, true);
      innerHtml += `<path d="${fillD}" fill="${fillColor}" stroke="none" />`;
    }
    const strokeD = pointsToPathD(offsetPts, false);
    if (Number(layer.strokeWidth) > 0) {
      innerHtml += `<path d="${strokeD}" fill="none" stroke="${strokeColor}" stroke-width="${layer.strokeWidth}" ${dashAttr} ${capJoinAttr} />`;
    }
  } else if (layer.type === 'circle_arc') {
    const cx = Number(layer.cx) || 0;
    const cy = Number(layer.cy) || 0;
    const r = Math.max(1, Number(layer.radius) || 100);
    const sDeg = Number(layer.startDeg ?? 0);
    const eDeg = Number(layer.endDeg ?? 360);
    const d = describePolarArc(cx, cy, r, sDeg, eDeg, false);
    if (layer.fillGray !== undefined && layer.fillGray >= 0) {
      const fillD = describePolarArc(cx, cy, r, sDeg, eDeg, Math.abs(eDeg - sDeg) < 359.9);
      innerHtml += `<path d="${fillD}" fill="${fillColor}" stroke="none" />`;
    }
    if (Number(layer.strokeWidth) > 0) {
      innerHtml += `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${layer.strokeWidth}" ${dashAttr} ${capJoinAttr} />`;
    }
  } else if (layer.type === 'three_point_arc') {
    const x1 = Number(layer.x1) || 0;
    const y1 = Number(layer.y1) || 0;
    const x2 = Number(layer.x2) || 500;
    const y2 = Number(layer.y2) || 500;
    const x3 = Number(layer.x3) || 1000;
    const y3 = Number(layer.y3) || 0;
    const arc = solveThreePointArc(x1, y1, x2, y2, x3, y3, Boolean(layer.fullCircle));
    if (Number(layer.strokeWidth) > 0) {
      innerHtml += `<path d="${arc.d}" fill="none" stroke="${strokeColor}" stroke-width="${layer.strokeWidth}" ${dashAttr} ${capJoinAttr} />`;
    }
  } else if (layer.type === 'rect_or_line') {
    const sw = Number(layer.strokeWidth) || 0;
    if (layer.subMode === 'hline_y0') {
      // Drawn along Y=0 symmetry axis: since Q1 mirrors across Y=0, a line centered at Y=0 with total width `sw`
      // needs `sw` stroke width at y=0 (half of it >=0, half mirrored!).
      const x1 = Number(layer.x1) || 0;
      const x2 = Number(layer.x2) || 3840;
      const y = Number(layer.y1) || 0;
      innerHtml += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} ${capJoinAttr} />`;
    } else if (layer.subMode === 'vline_x0') {
      const x = Number(layer.x1) || 0;
      const y1 = Number(layer.y1) || 0;
      const y2 = Number(layer.y2) || 5120;
      innerHtml += `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} ${capJoinAttr} />`;
    } else if (layer.subMode === 'custom_segment') {
      innerHtml += `<line x1="${layer.x1}" y1="${layer.y1}" x2="${layer.x2}" y2="${layer.y2}" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} ${capJoinAttr} />`;
    } else {
      // 'rect_box': If x1 === 0 (on symmetry axis X=0), draw only the top/right/bottom edges in Q1 so there's no vertical seam line at X=0!
      const rx1 = Math.min(Number(layer.x1) || 0, Number(layer.x2) || 1000);
      const rx2 = Math.max(Number(layer.x1) || 0, Number(layer.x2) || 1000);
      const ry1 = Math.min(Number(layer.y1) || 0, Number(layer.y2) || 1000);
      const ry2 = Math.max(Number(layer.y1) || 0, Number(layer.y2) || 1000);
      const rw = rx2 - rx1;
      const rh = ry2 - ry1;

      if (layer.fillGray !== undefined && layer.fillGray >= 0) {
        innerHtml += `<rect x="${rx1}" y="${ry1}" width="${rw}" height="${rh}" rx="${layer.cornerRadius || 0}" fill="${fillColor}" stroke="none" />`;
      }
      if (sw > 0) {
        if (rx1 <= 0.01) {
          // Open at X=0 symmetry axis so mirroring across X=0 creates a seamless centered box!
          const d = `M 0,${ry1} L ${rx2},${ry1} L ${rx2},${ry2} L 0,${ry2}`;
          innerHtml += `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} ${capJoinAttr} />`;
        } else {
          innerHtml += `<rect x="${rx1}" y="${ry1}" width="${rw}" height="${rh}" rx="${layer.cornerRadius || 0}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} ${capJoinAttr} />`;
        }
      }
    }
  } else if (layer.type === 'boost_pad_group') {
    const pads = [];
    if (layer.targetPads === 'big' || layer.targetPads === 'both') pads.push(...Q1_BOOST_PADS_BIG);
    if (layer.targetPads === 'small' || layer.targetPads === 'both') pads.push(...Q1_BOOST_PADS_SMALL);

    const r = Math.max(2, Number(layer.radius) || 80);
    const sw = Number(layer.strokeWidth) || 0;
    const outerR = Number(layer.outerDashRadius) || 0;
    const outerSw = Number(layer.outerDashWidth) || 0;
    const outerColor = grayToCss(layer.outerDashGray ?? 160, layer.opacity ?? 1.0, shaderSim);
    const outerDash = (layer.outerDashLength > 0 && layer.outerGapLength > 0)
      ? `stroke-dasharray="${layer.outerDashLength},${layer.outerGapLength}"`
      : '';

    for (const p of pads) {
      if (layer.fillGray !== undefined && layer.fillGray >= 0) {
        innerHtml += `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${fillColor}" stroke="none" />`;
      }
      if (sw > 0) {
        innerHtml += `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} />`;
      }
      if (outerR > 0 && outerSw > 0) {
        innerHtml += `<circle cx="${p.x}" cy="${p.y}" r="${outerR}" fill="none" stroke="${outerColor}" stroke-width="${outerSw}" ${outerDash} />`;
      }
    }
  } else if (layer.type === 'spawn_marker_group') {
    const spawns = [];
    if (layer.targetSpawns === 'kickoff' || layer.targetSpawns === 'both') spawns.push(...Q1_KICKOFF_SPAWNS);
    if (layer.targetSpawns === 'demo' || layer.targetSpawns === 'both') spawns.push(...Q1_DEMO_RESPAWNS);

    const hb = HITBOX_PRESETS.find(h => h.id === layer.hitboxPreset) || HITBOX_PRESETS[0];
    const margin = Number(layer.expandMargin) || 0;
    const sw = Number(layer.strokeWidth) || 12;

    for (const sp of spawns) {
      if (layer.shape === 'circle') {
        const rad = Math.max(10, 75 + margin);
        innerHtml += `<circle cx="${sp.x}" cy="${sp.y}" r="${rad}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} />`;
      } else if (layer.shape === 'crosshair') {
        const arm = Math.max(20, 60 + margin);
        innerHtml += `<g transform="translate(${sp.x}, ${sp.y}) rotate(${sp.yawDeg})">
          <line x1="${-arm}" y1="0" x2="${arm}" y2="0" stroke="${strokeColor}" stroke-width="${sw}" />
          <line x1="0" y1="${-arm}" x2="0" y2="${arm}" stroke="${strokeColor}" stroke-width="${sw}" />
        </g>`;
      } else {
        // 'hitbox_outline': Exact car hitbox aligned via hitboxPosOffset.x!
        const lx = hb.length + margin * 2;
        const ly = hb.width + margin * 2;
        const rx = hb.offsetX - lx / 2;
        const ry = hb.offsetY - ly / 2;
        innerHtml += `<g transform="translate(${sp.x}, ${sp.y}) rotate(${sp.yawDeg})">
          <rect x="${rx.toFixed(2)}" y="${ry.toFixed(2)}" width="${lx.toFixed(2)}" height="${ly.toFixed(2)}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} />
        </g>`;
      }
    }
  }

  const bodyHtml = `<g id="${layer.id}" clip-path="url(#${clipId})">${innerHtml}</g>`;
  return { defsHtml, bodyHtml };
}

/**
 * Renders the Reference Overlay in Q1 space [0..4096, 0..6000] (never included in clean grayscale texture export unless requested).
 */
export function renderReferenceOverlayQ1(project, activeLayer = null) {
  const ref = project.referenceOverlays || {};
  const parts = [];

  // Custom uploaded SVG backdrop if provided
  if (ref.customSvgContent && ref.customSvgVisible) {
    const encoded = encodeURIComponent(ref.customSvgContent);
    parts.push(`<image href="data:image/svg+xml;utf8,${encoded}" x="0" y="0" width="4096" height="6000" opacity="${ref.customSvgOpacity ?? 0.45}" preserveAspectRatio="none" />`);
  }

  // 1. 512 / 1024 UU Grid
  if (ref.showGrid) {
    let gridHtml = '<g id="Ref_Grid" opacity="0.55">';
    for (let x = 0; x <= 4096; x += 512) {
      const isMajor = x % 1024 === 0;
      gridHtml += `<line x1="${x}" y1="0" x2="${x}" y2="6000" stroke="${isMajor ? '#3b82f6' : '#334155'}" stroke-width="${isMajor ? 5 : 3}" stroke-dasharray="${isMajor ? '20,20' : '8,16'}" />`;
    }
    for (let y = 0; y <= 6000; y += 512) {
      const isMajor = y % 1024 === 0;
      gridHtml += `<line x1="0" y1="${y}" x2="4096" y2="${y}" stroke="${isMajor ? '#3b82f6' : '#334155'}" stroke-width="${isMajor ? 5 : 3}" stroke-dasharray="${isMajor ? '20,20' : '8,16'}" />`;
    }
    gridHtml += '</g>';
    parts.push(gridHtml);
  }

  // 2. Outer Wall & Flat Floor (Z=0) Boundaries
  if (ref.showOuterWall) {
    const wallD = pointsToPathD(Q1_OUTER_WALL_CONTOUR, false);
    parts.push(`<path d="${wallD}" fill="none" stroke="#60a5fa" stroke-width="10" opacity="0.85" />`);
    parts.push(`<rect x="0" y="0" width="4096" height="5120" fill="none" stroke="#3b82f6" stroke-width="6" stroke-dasharray="28,14" opacity="0.5" />`);
  }

  if (ref.showFlatFloorZ0) {
    const floorD = pointsToPathD(Q1_FLAT_FLOOR_CONTOUR, false);
    parts.push(`<path d="${floorD}" fill="rgba(16, 185, 129, 0.04)" stroke="#10b981" stroke-width="9" stroke-dasharray="24,12" />`);
  }

  // 3. Goal Box & Score Line
  if (ref.showGoalBox) {
    parts.push(`<rect x="0" y="5120" width="896" height="880" fill="rgba(245, 158, 11, 0.08)" stroke="#f59e0b" stroke-width="8" />`);
    parts.push(`<line x1="0" y1="${ARENA_CONSTANTS.GOAL_SCORE_BASE_Y}" x2="892.75" y2="${ARENA_CONSTANTS.GOAL_SCORE_BASE_Y}" stroke="#ef4444" stroke-width="7" stroke-dasharray="18,10" />`);
    parts.push(`<line x1="0" y1="${ARENA_CONSTANTS.BALL_SCORE_CENTER_Y}" x2="892.75" y2="${ARENA_CONSTANTS.BALL_SCORE_CENTER_Y}" stroke="#f43f5e" stroke-width="5" />`);
  }

  // 4. Boost Pads (Cylinder R=208 / R=144; optional hysteresis box)
  if (ref.showBoostPads) {
    let padsHtml = '<g id="Ref_BoostPads">';
    for (const p of Q1_BOOST_PADS_BIG) {
      padsHtml += `<circle cx="${p.x}" cy="${p.y}" r="${ARENA_CONSTANTS.PAD_CYL_RAD_BIG}" fill="rgba(251, 191, 36, 0.16)" stroke="#fbbf24" stroke-width="7" />`;
      if (ref.showBoostPadLockBoxes) {
        padsHtml += `<rect x="${p.x - 160}" y="${p.y - 160}" width="320" height="320" fill="none" stroke="#f59e0b" stroke-width="4" stroke-dasharray="12,8" />`;
      }
      padsHtml += `<circle cx="${p.x}" cy="${p.y}" r="12" fill="#fbbf24" />`;
    }
    for (const p of Q1_BOOST_PADS_SMALL) {
      padsHtml += `<circle cx="${p.x}" cy="${p.y}" r="${ARENA_CONSTANTS.PAD_CYL_RAD_SMALL}" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" stroke-width="6" />`;
      if (ref.showBoostPadLockBoxes) {
        padsHtml += `<rect x="${p.x - 120}" y="${p.y - 120}" width="240" height="240" fill="none" stroke="#0284c7" stroke-width="4" stroke-dasharray="10,6" />`;
      }
      padsHtml += `<circle cx="${p.x}" cy="${p.y}" r="10" fill="#38bdf8" />`;
    }
    padsHtml += '</g>';
    parts.push(padsHtml);
  }

  // 5. Kickoff Spawns & Demo Respawns + Car Hitbox Alignment
  if (ref.showSpawns) {
    const presetsToDraw = ref.showHitboxPreset === 'all'
      ? HITBOX_PRESETS.slice(0, 6)
      : [HITBOX_PRESETS.find(h => h.id === ref.showHitboxPreset) || HITBOX_PRESETS[0]];

    const renderCarRef = (sp, isDemo) => {
      let g = `<g transform="translate(${sp.x}, ${sp.y}) rotate(${sp.yawDeg})">`;
      for (const hb of presetsToDraw) {
        const rx = hb.offsetX - hb.length / 2;
        const ry = hb.offsetY - hb.width / 2;
        g += `<rect x="${rx.toFixed(2)}" y="${ry.toFixed(2)}" width="${hb.length.toFixed(2)}" height="${hb.width.toFixed(2)}" fill="${hb.color}" fill-opacity="0.2" stroke="${hb.color}" stroke-width="5" />`;
      }
      const primaryHb = presetsToDraw[0];
      g += `<line x1="0" y1="0" x2="${primaryHb.offsetX}" y2="0" stroke="#22d3ee" stroke-width="4" />`;
      g += `<circle cx="${primaryHb.offsetX}" cy="0" r="7" fill="#22d3ee" />`;
      g += `<line x1="${primaryHb.offsetX}" y1="0" x2="115" y2="0" stroke="#ffffff" stroke-width="5" />`;
      g += `<polygon points="130,0 105,-14 105,14" fill="#ffffff" />`;
      g += `<circle cx="0" cy="0" r="11" fill="${isDemo ? '#f97316' : '#ef4444'}" stroke="#ffffff" stroke-width="3" />`;
      g += '</g>';
      return g;
    };

    for (const sp of Q1_KICKOFF_SPAWNS) parts.push(renderCarRef(sp, false));
    for (const sp of Q1_DEMO_RESPAWNS) parts.push(renderCarRef(sp, true));
  }

  // 6. Active Layer Interactive Handles (e.g. 3-Point Arc P1/P2/P3 or Circle Center)
  if (activeLayer && activeLayer.visible) {
    if (activeLayer.type === 'three_point_arc') {
      const pts = [
        { label: 'P1', x: activeLayer.x1, y: activeLayer.y1, color: '#22c55e' },
        { label: 'P2 (Mid)', x: activeLayer.x2, y: activeLayer.y2, color: '#eab308' },
        { label: 'P3', x: activeLayer.x3, y: activeLayer.y3, color: '#ec4899' }
      ];
      for (const pt of pts) {
        parts.push(`<circle cx="${pt.x}" cy="${pt.y}" r="28" fill="${pt.color}" stroke="#ffffff" stroke-width="6" />`);
        parts.push(`<text x="${Number(pt.x) + 42}" y="${Number(pt.y) + 12}" fill="${pt.color}" font-family="monospace" font-size="44" font-weight="bold">${pt.label}(${Math.round(pt.x)},${Math.round(pt.y)})</text>`);
      }
    } else if (activeLayer.type === 'circle_arc') {
      parts.push(`<circle cx="${activeLayer.cx}" cy="${activeLayer.cy}" r="24" fill="#a855f7" stroke="#ffffff" stroke-width="5" />`);
    }
  }

  return `<g id="Reference_Overlays_Q1" pointer-events="none">${parts.join('\n')}</g>`;
}

/**
 * Generates the complete SVG string for either:
 * - mode = 'q1' (Single Quadrant Q1: [0..W, 0..H])
 * - mode = 'full_mirror' (4-Quadrant Mirrored Full Arena: [-W..W, -H..H])
 */
export function buildArenaSvgString(project, {
  mode = 'full_mirror', // 'q1' | 'full_mirror'
  includeReference = true,
  useShaderPreview = false,
  activeLayerId = null,
  customPixelWidth = null,
  customPixelHeight = null
} = {}) {
  const { w: scopeW, h: scopeH } = getScopeDimensions(project.canvasScope);
  const shaderSim = useShaderPreview ? { ...project.shaderPreview, enabled: true } : null;
  const bgColor = grayToCss(project.backgroundGray ?? 0, 1.0, shaderSim);

  let allDefs = '';
  let allBodies = '';

  project.layers.forEach((layer, idx) => {
    const { defsHtml, bodyHtml } = renderParametricLayerQ1(
      layer,
      idx,
      shaderSim,
      layer.id === activeLayerId
    );
    allDefs += defsHtml;
    allBodies += bodyHtml;
  });

  const activeLayer = project.layers.find(l => l.id === activeLayerId) || null;
  const refHtml = includeReference ? renderReferenceOverlayQ1(project, activeLayer) : '';

  if (mode === 'q1') {
    const outW = customPixelWidth || scopeW;
    const outH = customPixelHeight || scopeH;
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scopeW} ${scopeH}" width="${outW}" height="${outH}" preserveAspectRatio="none">
  <defs>
    ${allDefs}
  </defs>
  <rect x="0" y="0" width="${scopeW}" height="${scopeH}" fill="${bgColor}" />
  <g id="Q1_Texture_Layers">
    ${allBodies}
  </g>
  ${refHtml}
</svg>`;
  }

  // Full 4-Quadrant Mirrored Arena: viewBox = [-scopeW, -scopeH, scopeW*2, scopeH*2]
  const fullW = scopeW * 2;
  const fullH = scopeH * 2;
  const outW = customPixelWidth || fullW;
  const outH = customPixelHeight || fullH;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-scopeW} ${-scopeH} ${fullW} ${fullH}" width="${outW}" height="${outH}" preserveAspectRatio="none">
  <defs>
    ${allDefs}
    <g id="Master_Q1_Content">
      ${allBodies}
    </g>
    ${includeReference ? `<g id="Master_Q1_Ref">${refHtml}</g>` : ''}
  </defs>
  <rect x="${-scopeW}" y="${-scopeH}" width="${fullW}" height="${fullH}" fill="${bgColor}" />
  <!-- 4x Symmetry Mirroring from Q1 (+X, +Y) -->
  <g id="Full_Mirrored_Texture">
    <use href="#Master_Q1_Content" transform="scale(1, 1)" />
    <use href="#Master_Q1_Content" transform="scale(-1, 1)" />
    <use href="#Master_Q1_Content" transform="scale(1, -1)" />
    <use href="#Master_Q1_Content" transform="scale(-1, -1)" />
  </g>
  ${includeReference ? `
  <g id="Full_Mirrored_References">
    <use href="#Master_Q1_Ref" transform="scale(1, 1)" />
    <use href="#Master_Q1_Ref" transform="scale(-1, 1)" />
    <use href="#Master_Q1_Ref" transform="scale(1, -1)" />
    <use href="#Master_Q1_Ref" transform="scale(-1, -1)" />
  </g>` : ''}
</svg>`;
}
