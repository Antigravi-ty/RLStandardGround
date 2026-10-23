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
  HITBOX_PRESETS,
  ALL_HITBOX_UNION_BOUNDS
} from './physicsData.js';
import {
  offsetQ1Contour,
  solveThreePointArc,
  describePolarArc,
  solveMonotoneFivePointSpline,
  trimLineSegment,
  trimPolylineByArcLength,
  grayToCss,
  resolveLayerGrayAndCss
} from './geometryMath.js';

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
 * Builds the global SVG <mask> that cuts out Small Boost Pad Safe Areas (R = 144 + smallPadSafeExpand).
 */
export function buildSmallPadSafeAreaMaskDef(project) {
  const expand = Math.max(0, Number(project.smallPadSafeExpand ?? 60));
  const safeR = ARENA_CONSTANTS.PAD_CYL_RAD_SMALL + expand;
  const circles = Q1_BOOST_PADS_SMALL.map(
    (p) => `<circle cx="${p.x}" cy="${p.y}" r="${safeR.toFixed(2)}" fill="black" />`
  ).join('');

  return `<mask id="mask_small_pad_safe_q1" maskUnits="userSpaceOnUse" x="-600" y="-600" width="5200" height="7200">
    <rect x="-600" y="-600" width="5200" height="7200" fill="white" />
    ${circles}
  </mask>`;
}

/**
 * Helper to build the 4 L-shaped corner brackets path for a bounding box [x0, x1] x [y0, y1].
 */
function buildFourCornersPathD(x0, x1, y0, y1, cornerLen) {
  const lx = Math.min(cornerLen, (x1 - x0) * 0.48);
  const ly = Math.min(cornerLen, (y1 - y0) * 0.48);
  return [
    // Rear-Left (x0, y0)
    `M ${(x0 + lx).toFixed(2)},${y0.toFixed(2)} L ${x0.toFixed(2)},${y0.toFixed(2)} L ${x0.toFixed(2)},${(y0 + ly).toFixed(2)}`,
    // Front-Left (x1, y0)
    `M ${(x1 - lx).toFixed(2)},${y0.toFixed(2)} L ${x1.toFixed(2)},${y0.toFixed(2)} L ${x1.toFixed(2)},${(y0 + ly).toFixed(2)}`,
    // Rear-Right (x0, y1)
    `M ${(x0 + lx).toFixed(2)},${y1.toFixed(2)} L ${x0.toFixed(2)},${y1.toFixed(2)} L ${x0.toFixed(2)},${(y1 - ly).toFixed(2)}`,
    // Front-Right (x1, y1)
    `M ${(x1 - lx).toFixed(2)},${y1.toFixed(2)} L ${x1.toFixed(2)},${y1.toFixed(2)} L ${x1.toFixed(2)},${(y1 - ly).toFixed(2)}`
  ].join(' ');
}

/**
 * Renders a single parametric layer in Q1 space [0..4096, 0..6000].
 * Returns { defsHtml, bodyHtml } so clipPaths stay in <defs>.
 */
export function renderParametricLayerQ1(layer, index, shaderSim, isInteractiveSelected = false, project = null) {
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

  const resolvedStroke = project
    ? resolveLayerGrayAndCss(layer, layer.opacity ?? 1.0, project, Boolean(shaderSim?.enabled))
    : { css: grayToCss(layer.gray ?? 255, layer.opacity ?? 1.0, shaderSim) };
  const strokeColor = resolvedStroke.css;

  const fillColor = (layer.fillGray !== undefined && layer.fillGray >= 0)
    ? (project
        ? resolveLayerGrayAndCss({ gray: layer.fillGray, grayLevel: layer.fillGrayLevel }, layer.opacity ?? 1.0, project, Boolean(shaderSim?.enabled)).css
        : grayToCss(layer.fillGray, layer.opacity ?? 1.0, shaderSim))
    : 'none';

  const dashAttr = (layer.dashLength > 0 && layer.gapLength > 0)
    ? `stroke-dasharray="${layer.dashLength},${layer.gapLength}" stroke-dashoffset="${layer.dashOffset || 0}"`
    : '';
  const capJoinAttr = `stroke-linecap="${layer.lineCap || 'butt'}" stroke-linejoin="${layer.lineJoin || 'round'}"`;

  const trimS = Math.max(0, Number(layer.trimStart) || 0);
  const trimE = Math.max(0, Number(layer.trimEnd) || 0);

  if (layer.type === 'turf_stripes') {
    const span = Math.max(32, Number(layer.stripeSpan) || 512);
    const duty = Math.max(0.05, Math.min(0.95, Number(layer.dutyCycle) || 0.5));
    const offset = Number(layer.offset) || 0;
    const stripeColor = strokeColor;

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
    const sw = Number(layer.strokeWidth) || 0;
    const hugOffset = layer.hugInnerEdge ? sw * 0.5 : 0;
    const totalInset = hugOffset + (Number(layer.insetDist) || 0);
    let offsetPts = offsetQ1Contour(basePts, totalInset);
    if (layer.fillGray !== undefined && layer.fillGray >= 0) {
      const fillD = pointsToPathD(offsetPts, true);
      innerHtml += `<path d="${fillD}" fill="${fillColor}" stroke="none" />`;
    }
    if (trimS > 0 || trimE > 0) {
      offsetPts = trimPolylineByArcLength(offsetPts, trimS, trimE);
    }
    const strokeD = pointsToPathD(offsetPts, false);
    if (sw > 0 && strokeD) {
      innerHtml += `<path d="${strokeD}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} ${capJoinAttr} />`;
    }
  } else if (layer.type === 'circle_arc') {
    const cx = Number(layer.cx) || 0;
    const cy = Number(layer.cy) || 0;
    const r = Math.max(1, Number(layer.radius) || 100);
    const sDeg = Number(layer.startDeg ?? 0);
    const eDeg = Number(layer.endDeg ?? 360);
    const d = describePolarArc(cx, cy, r, sDeg, eDeg, false, trimS, trimE);
    if (layer.fillGray !== undefined && layer.fillGray >= 0) {
      const fillD = describePolarArc(cx, cy, r, sDeg, eDeg, Math.abs(eDeg - sDeg) < 359.9, 0, 0);
      innerHtml += `<path d="${fillD}" fill="${fillColor}" stroke="none" />`;
    }
    if (Number(layer.strokeWidth) > 0 && d) {
      innerHtml += `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${layer.strokeWidth}" ${dashAttr} ${capJoinAttr} />`;
    }
  } else if (layer.type === 'three_point_arc') {
    const x1 = Number(layer.x1) || 0;
    const y1 = Number(layer.y1) || 0;
    const x2 = Number(layer.x2) || 500;
    const y2 = Number(layer.y2) || 500;
    const x3 = Number(layer.x3) || 1000;
    const y3 = Number(layer.y3) || 0;
    const arc = solveThreePointArc(x1, y1, x2, y2, x3, y3, Boolean(layer.fullCircle), trimS, trimE);
    if (Number(layer.strokeWidth) > 0 && arc.d) {
      innerHtml += `<path d="${arc.d}" fill="none" stroke="${strokeColor}" stroke-width="${layer.strokeWidth}" ${dashAttr} ${capJoinAttr} />`;
    }
  } else if (layer.type === 'monotone_pad_spline') {
    const spline = solveMonotoneFivePointSpline(layer);
    if (Number(layer.strokeWidth) > 0 && spline.d) {
      innerHtml += `<path d="${spline.d}" fill="none" stroke="${strokeColor}" stroke-width="${layer.strokeWidth}" ${dashAttr} ${capJoinAttr} />`;
    }
  } else if (layer.type === 'rect_or_line') {
    const sw = Number(layer.strokeWidth) || 0;
    if (layer.subMode === 'hline_y0') {
      const y = Number(layer.y1) || 0;
      const t = trimLineSegment(Number(layer.x1) || 0, y, Number(layer.x2) || 3840, y, trimS, trimE);
      if (t.valid && sw > 0) {
        innerHtml += `<line x1="${t.x1.toFixed(2)}" y1="${t.y1.toFixed(2)}" x2="${t.x2.toFixed(2)}" y2="${t.y2.toFixed(2)}" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} ${capJoinAttr} />`;
      }
    } else if (layer.subMode === 'vline_x0') {
      const x = Number(layer.x1) || 0;
      const t = trimLineSegment(x, Number(layer.y1) || 0, x, Number(layer.y2) || 5120, trimS, trimE);
      if (t.valid && sw > 0) {
        innerHtml += `<line x1="${t.x1.toFixed(2)}" y1="${t.y1.toFixed(2)}" x2="${t.x2.toFixed(2)}" y2="${t.y2.toFixed(2)}" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} ${capJoinAttr} />`;
      }
    } else if (layer.subMode === 'custom_segment') {
      const t = trimLineSegment(
        Number(layer.x1) || 0, Number(layer.y1) || 0,
        Number(layer.x2) || 0, Number(layer.y2) || 0,
        trimS, trimE
      );
      if (t.valid && sw > 0) {
        innerHtml += `<line x1="${t.x1.toFixed(2)}" y1="${t.y1.toFixed(2)}" x2="${t.x2.toFixed(2)}" y2="${t.y2.toFixed(2)}" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} ${capJoinAttr} />`;
      }
    } else {
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

    const isInwardMode = layer.ringMode !== 'custom_radius';
    const inwardW = Math.max(1, Number(layer.inwardWidth ?? layer.strokeWidth ?? 10));
    const insetFromEdge = Number(layer.insetFromPickup ?? 0);

    const customR = Math.max(2, Number(layer.radius) || 80);
    const customSw = Number(layer.strokeWidth) || 0;

    for (const p of pads) {
      if (isInwardMode) {
        const pickupR = p.isBig ? ARENA_CONSTANTS.PAD_CYL_RAD_BIG : ARENA_CONSTANTS.PAD_CYL_RAD_SMALL;
        const outerEdgeR = Math.max(2, pickupR - insetFromEdge);
        const strokeCenterR = Math.max(1, outerEdgeR - inwardW * 0.5);
        const innerEdgeR = Math.max(0, outerEdgeR - inwardW);
        if (layer.fillGray !== undefined && layer.fillGray >= 0 && innerEdgeR > 0) {
          innerHtml += `<circle cx="${p.x}" cy="${p.y}" r="${innerEdgeR.toFixed(2)}" fill="${fillColor}" stroke="none" />`;
        }
        innerHtml += `<circle cx="${p.x}" cy="${p.y}" r="${strokeCenterR.toFixed(2)}" fill="none" stroke="${strokeColor}" stroke-width="${inwardW}" ${dashAttr} />`;
      } else {
        if (layer.fillGray !== undefined && layer.fillGray >= 0) {
          innerHtml += `<circle cx="${p.x}" cy="${p.y}" r="${customR}" fill="${fillColor}" stroke="none" />`;
        }
        if (customSw > 0) {
          innerHtml += `<circle cx="${p.x}" cy="${p.y}" r="${customR}" fill="none" stroke="${strokeColor}" stroke-width="${customSw}" ${dashAttr} />`;
        }
      }
    }
  } else if (layer.type === 'spawn_marker_group') {
    const spawns = [];
    if (layer.targetSpawns === 'kickoff' || layer.targetSpawns === 'both') spawns.push(...Q1_KICKOFF_SPAWNS);
    if (layer.targetSpawns === 'demo' || layer.targetSpawns === 'both') spawns.push(...Q1_DEMO_RESPAWNS);

    const hb = HITBOX_PRESETS.find(h => h.id === layer.hitboxPreset) || HITBOX_PRESETS[0];
    const margin = Number(layer.expandMargin) || 0;
    const sw = Number(layer.strokeWidth) || 8;
    const cornerLen = Math.max(4, Number(layer.cornerLength) || 28);
    const hugShift = layer.hugOuterEdge !== false ? sw * 0.5 : 0;
    const totalPad = margin + hugShift;

    for (const sp of spawns) {
      if (layer.shape === 'union_corners' || layer.shape === 'union_rect') {
        const x0 = ALL_HITBOX_UNION_BOUNDS.minX - totalPad;
        const x1 = ALL_HITBOX_UNION_BOUNDS.maxX + totalPad;
        const y0 = ALL_HITBOX_UNION_BOUNDS.minY - totalPad;
        const y1 = ALL_HITBOX_UNION_BOUNDS.maxY + totalPad;

        if (layer.shape === 'union_corners') {
          const cornersD = buildFourCornersPathD(x0, x1, y0, y1, cornerLen);
          innerHtml += `<g transform="translate(${sp.x}, ${sp.y}) rotate(${sp.yawDeg})">
            <path d="${cornersD}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} stroke-linecap="${layer.lineCap || 'square'}" stroke-linejoin="miter" />
          </g>`;
        } else {
          innerHtml += `<g transform="translate(${sp.x}, ${sp.y}) rotate(${sp.yawDeg})">
            <rect x="${x0.toFixed(2)}" y="${y0.toFixed(2)}" width="${(x1 - x0).toFixed(2)}" height="${(y1 - y0).toFixed(2)}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} />
          </g>`;
        }
      } else if (layer.shape === 'circle') {
        const rad = Math.max(10, 75 + margin);
        innerHtml += `<circle cx="${sp.x}" cy="${sp.y}" r="${rad}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} />`;
      } else if (layer.shape === 'crosshair') {
        const arm = Math.max(20, 60 + margin);
        innerHtml += `<g transform="translate(${sp.x}, ${sp.y}) rotate(${sp.yawDeg})">
          <line x1="${-arm}" y1="0" x2="${arm}" y2="0" stroke="${strokeColor}" stroke-width="${sw}" />
          <line x1="0" y1="${-arm}" x2="0" y2="${arm}" stroke="${strokeColor}" stroke-width="${sw}" />
        </g>`;
      } else {
        const lx = hb.length + totalPad * 2;
        const ly = hb.width + totalPad * 2;
        const rx = hb.offsetX - lx / 2;
        const ry = hb.offsetY - ly / 2;
        innerHtml += `<g transform="translate(${sp.x}, ${sp.y}) rotate(${sp.yawDeg})">
          <rect x="${rx.toFixed(2)}" y="${ry.toFixed(2)}" width="${lx.toFixed(2)}" height="${ly.toFixed(2)}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} />
        </g>`;
      }
    }
  }

  const maskAttr = layer.cutBySmallPadSafeArea ? ` mask="url(#mask_small_pad_safe_q1)"` : '';
  const bodyHtml = `<g id="${layer.id}" clip-path="url(#${clipId})"${maskAttr}>${innerHtml}</g>`;
  return { defsHtml, bodyHtml };
}

/**
 * Renders the Reference Overlay in Q1 space [0..4096, 0..6000].
 */
export function renderReferenceOverlayQ1(project, {
  activeLayer = null,
  hoveredLayer = null,
  snappedAnchor = null
} = {}) {
  const ref = project.referenceOverlays || {};
  const parts = [];

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

  // 4. Boost Pads (Cylinder R=208 / R=144)
  if (ref.showBoostPads) {
    let padsHtml = '<g id="Ref_BoostPads">';
    for (const p of Q1_BOOST_PADS_BIG) {
      padsHtml += `<circle cx="${p.x}" cy="${p.y}" r="${ARENA_CONSTANTS.PAD_CYL_RAD_BIG}" fill="rgba(251, 191, 36, 0.14)" stroke="#fbbf24" stroke-width="6" stroke-dasharray="14,10" />`;
      padsHtml += `<circle cx="${p.x}" cy="${p.y}" r="14" fill="#fbbf24" />`;
    }
    for (const p of Q1_BOOST_PADS_SMALL) {
      padsHtml += `<circle cx="${p.x}" cy="${p.y}" r="${ARENA_CONSTANTS.PAD_CYL_RAD_SMALL}" fill="rgba(56, 189, 248, 0.12)" stroke="#38bdf8" stroke-width="5" stroke-dasharray="12,8" />`;
      padsHtml += `<circle cx="${p.x}" cy="${p.y}" r="11" fill="#38bdf8" />`;
    }
    padsHtml += '</g>';
    parts.push(padsHtml);
  }

  // 4b. Small Pad Safe Area Visualization (R = 144 + smallPadSafeExpand)
  if (ref.showSmallPadSafeArea) {
    const expand = Math.max(0, Number(project.smallPadSafeExpand ?? 60));
    const safeR = ARENA_CONSTANTS.PAD_CYL_RAD_SMALL + expand;
    let safeHtml = '<g id="Ref_SmallPad_SafeArea">';
    for (const p of Q1_BOOST_PADS_SMALL) {
      safeHtml += `<circle cx="${p.x}" cy="${p.y}" r="${safeR.toFixed(2)}" fill="rgba(236, 72, 153, 0.05)" stroke="#f472b6" stroke-width="5" stroke-dasharray="16,12" />`;
    }
    safeHtml += '</g>';
    parts.push(safeHtml);
  }

  // 4c. Numbered Badges for Boost Pads (#B1-#B2, #S1-#S9), 4-Pad Intersection (#IX1), and Spawns (#KO1-#KO3, #DM1-#DM2)
  if (ref.showPadNumbers !== false) {
    let numHtml = '<g id="Ref_PadNumbers" font-family="monospace" font-weight="bold">';
    for (const p of Q1_BOOST_PADS_BIG) {
      const tx = p.x - 110;
      const ty = p.y + 85;
      numHtml += `<rect x="${tx - 10}" y="${ty - 46}" width="128" height="58" rx="10" fill="rgba(15,23,42,0.88)" stroke="#fbbf24" stroke-width="4" />`;
      numHtml += `<text x="${tx + 54}" y="${ty - 4}" fill="#fde047" font-size="44" text-anchor="middle">#${p.code}</text>`;
    }
    for (const p of Q1_BOOST_PADS_SMALL) {
      const tx = p.x + 26;
      const ty = p.y + (p.y < 100 ? 85 : -35);
      numHtml += `<rect x="${tx - 8}" y="${ty - 44}" width="118" height="54" rx="10" fill="rgba(15,23,42,0.88)" stroke="#38bdf8" stroke-width="3.5" />`;
      numHtml += `<text x="${tx + 51}" y="${ty - 4}" fill="#7dd3fc" font-size="42" text-anchor="middle">#${p.code}</text>`;
    }
    // 4-Pad Intersection #IX1 at (2048, 0)
    numHtml += `<circle cx="2048" cy="0" r="16" fill="#a855f7" stroke="#ffffff" stroke-width="4" />`;
    numHtml += `<rect x="1970" y="24" width="156" height="52" rx="10" fill="rgba(15,23,42,0.9)" stroke="#a855f7" stroke-width="3.5" />`;
    numHtml += `<text x="2048" y="62" fill="#e9d5ff" font-size="38" text-anchor="middle">#IX1</text>`;

    for (const sp of Q1_KICKOFF_SPAWNS) {
      const tx = sp.x + 60;
      const ty = sp.y + 10;
      numHtml += `<rect x="${tx}" y="${ty - 38}" width="136" height="48" rx="8" fill="rgba(15,23,42,0.85)" stroke="#34d399" stroke-width="3" />`;
      numHtml += `<text x="${tx + 68}" y="${ty - 2}" fill="#6ee7b7" font-size="36" text-anchor="middle">#${sp.code}</text>`;
    }
    for (const sp of Q1_DEMO_RESPAWNS) {
      const tx = sp.x - 68;
      const ty = sp.y + 125;
      numHtml += `<rect x="${tx}" y="${ty - 38}" width="136" height="48" rx="8" fill="rgba(15,23,42,0.85)" stroke="#fb923c" stroke-width="3" />`;
      numHtml += `<text x="${tx + 68}" y="${ty - 2}" fill="#fdba74" font-size="36" text-anchor="middle">#${sp.code}</text>`;
    }
    numHtml += '</g>';
    parts.push(numHtml);
  }

  // 5. Kickoff Spawns & Demo Respawns + All 7 Car Hitbox Overlay + Union Bounding Box Reference
  if (ref.showSpawns) {
    const presetsToDraw = ref.showHitboxPreset === 'all'
      ? HITBOX_PRESETS
      : [HITBOX_PRESETS.find(h => h.id === ref.showHitboxPreset) || HITBOX_PRESETS[0]];

    const renderCarRef = (sp, isDemo) => {
      let g = `<g transform="translate(${sp.x}, ${sp.y}) rotate(${sp.yawDeg})">`;
      for (const hb of presetsToDraw) {
        const rx = hb.offsetX - hb.length / 2;
        const ry = hb.offsetY - hb.width / 2;
        g += `<rect x="${rx.toFixed(2)}" y="${ry.toFixed(2)}" width="${hb.length.toFixed(2)}" height="${hb.width.toFixed(2)}" fill="${hb.color}" fill-opacity="0.08" stroke="${hb.color}" stroke-width="3" stroke-dasharray="10,6" />`;
      }
      // Also show the exact Union Bounding Box in dashed emerald
      g += `<rect x="${ALL_HITBOX_UNION_BOUNDS.minX.toFixed(2)}" y="${ALL_HITBOX_UNION_BOUNDS.minY.toFixed(2)}" width="${ALL_HITBOX_UNION_BOUNDS.length.toFixed(2)}" height="${ALL_HITBOX_UNION_BOUNDS.width.toFixed(2)}" fill="none" stroke="#10b981" stroke-width="4" stroke-dasharray="12,8" />`;
      g += `<line x1="0" y1="0" x2="115" y2="0" stroke="#ffffff" stroke-width="4" />`;
      g += `<polygon points="130,0 105,-12 105,12" fill="#ffffff" />`;
      g += `<circle cx="0" cy="0" r="10" fill="${isDemo ? '#f97316' : '#ef4444'}" stroke="#ffffff" stroke-width="3" />`;
      g += '</g>';
      return g;
    };

    for (const sp of Q1_KICKOFF_SPAWNS) parts.push(renderCarRef(sp, false));
    for (const sp of Q1_DEMO_RESPAWNS) parts.push(renderCarRef(sp, true));
  }

  // 6. Hovered Layer Visual Highlight (when user moves mouse near a line on the canvas)
  if (hoveredLayer && hoveredLayer.visible && (!activeLayer || hoveredLayer.id !== activeLayer.id)) {
    const hovRender = renderParametricLayerQ1(
      { ...hoveredLayer, gray: 255, opacity: 0.9, strokeWidth: Math.max(24, (Number(hoveredLayer.strokeWidth) || 16) + 14), dashLength: 0, gapLength: 0 },
      998,
      { enabled: true, groundColor: '#000000', lineColor: '#38bdf8', threshold: 0.1, smoothness: 0.05 }
    );
    parts.push(`<g opacity="0.55">${hovRender.bodyHtml}</g>`);
  }

  // 7. Active Selected Layer Interactive Handles & Construction Guides
  if (activeLayer && activeLayer.visible) {
    // Subtle cyan selection halo on the selected layer
    const selRender = renderParametricLayerQ1(
      { ...activeLayer, gray: 255, opacity: 0.85, strokeWidth: Math.max(26, (Number(activeLayer.strokeWidth) || 16) + 16), dashLength: 0, gapLength: 0 },
      999,
      { enabled: true, groundColor: '#000000', lineColor: '#22d3ee', threshold: 0.1, smoothness: 0.05 }
    );
    parts.push(`<g opacity="0.32">${selRender.bodyHtml}</g>`);

    if (activeLayer.type === 'monotone_pad_spline') {
      const spline = solveMonotoneFivePointSpline(activeLayer);
      // Show the 4-pad intersection construction lines: #S1(1024,0)--#B1(3584,0) and #S3(2048,0)--#S3(2048,1036)
      parts.push(`<line x1="1024" y1="0" x2="3584" y2="0" stroke="#a855f7" stroke-width="5" stroke-dasharray="16,12" opacity="0.8" />`);
      parts.push(`<line x1="2048" y1="0" x2="2048" y2="1036" stroke="#a855f7" stroke-width="5" stroke-dasharray="16,12" opacity="0.8" />`);
      parts.push(`<circle cx="2048" cy="0" r="18" fill="#a855f7" stroke="#ffffff" stroke-width="4" />`);
      for (let i = 0; i < spline.points.length; i++) {
        const [px, py] = spline.points[i];
        parts.push(`<circle cx="${px}" cy="${py}" r="22" fill="#22c55e" stroke="#ffffff" stroke-width="5" />`);
        parts.push(`<text x="${px + 30}" y="${py + 45}" fill="#4ade80" font-family="monospace" font-size="38" font-weight="bold">P${i + 1}(${Math.round(px)},${Math.round(py)})</text>`);
      }
    } else if (activeLayer.type === 'three_point_arc') {
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
    } else if (activeLayer.type === 'rect_or_line' && activeLayer.subMode === 'custom_segment') {
      // Show full raw segment in faint dashed yellow and endpoints P1 / P2
      parts.push(`<line x1="${activeLayer.x1}" y1="${activeLayer.y1}" x2="${activeLayer.x2}" y2="${activeLayer.y2}" stroke="#facc15" stroke-width="4" stroke-dasharray="14,14" opacity="0.65" />`);
      parts.push(`<circle cx="${activeLayer.x1}" cy="${activeLayer.y1}" r="24" fill="#22c55e" stroke="#ffffff" stroke-width="5" />`);
      parts.push(`<text x="${Number(activeLayer.x1) + 34}" y="${Number(activeLayer.y1) - 18}" fill="#4ade80" font-family="monospace" font-size="38" font-weight="bold">起点P1(${Math.round(activeLayer.x1)},${Math.round(activeLayer.y1)})</text>`);
      parts.push(`<circle cx="${activeLayer.x2}" cy="${activeLayer.y2}" r="24" fill="#f43f5e" stroke="#ffffff" stroke-width="5" />`);
      parts.push(`<text x="${Number(activeLayer.x2) + 34}" y="${Number(activeLayer.y2) + 36}" fill="#fb7185" font-family="monospace" font-size="38" font-weight="bold">终点P2(${Math.round(activeLayer.x2)},${Math.round(activeLayer.y2)})</text>`);
    }
  }

  // 8. Magnetic Snap Target Indicator
  if (snappedAnchor) {
    parts.push(`<circle cx="${snappedAnchor.x}" cy="${snappedAnchor.y}" r="48" fill="rgba(34, 211, 238, 0.2)" stroke="#22d3ee" stroke-width="7" />`);
    parts.push(`<circle cx="${snappedAnchor.x}" cy="${snappedAnchor.y}" r="14" fill="#22d3ee" />`);
    parts.push(`<text x="${snappedAnchor.x + 58}" y="${snappedAnchor.y - 24}" fill="#22d3ee" font-family="monospace" font-size="42" font-weight="bold">🧲 吸附: ${snappedAnchor.label}</text>`);
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
  useColorPalettePreview = null,
  activeLayerId = null,
  hoveredLayerId = null,
  snappedAnchor = null,
  customPixelWidth = null,
  customPixelHeight = null
} = {}) {
  const { w: scopeW, h: scopeH } = getScopeDimensions(project.canvasScope);
  const shaderSim = useShaderPreview ? { ...project.shaderPreview, enabled: true } : null;

  // Allow overriding colorPalettePreview.enabled (e.g. when exporting pure grayscale vs color preview)
  const effectiveProject = useColorPalettePreview !== null
    ? {
        ...project,
        colorPalettePreview: {
          ...(project.colorPalettePreview || {}),
          enabled: Boolean(useColorPalettePreview)
        }
      }
    : project;

  const bgResolved = resolveLayerGrayAndCss(0, 1.0, effectiveProject, useShaderPreview);
  const bgColor = bgResolved.css;

  let allDefs = buildSmallPadSafeAreaMaskDef(effectiveProject);
  let allBodies = '';

  effectiveProject.layers.forEach((layer, idx) => {
    const { defsHtml, bodyHtml } = renderParametricLayerQ1(
      layer,
      idx,
      shaderSim,
      layer.id === activeLayerId,
      effectiveProject
    );
    allDefs += defsHtml;
    allBodies += bodyHtml;
  });

  const activeLayer = project.layers.find(l => l.id === activeLayerId) || null;
  const hoveredLayer = project.layers.find(l => l.id === hoveredLayerId) || null;
  const refHtml = includeReference
    ? renderReferenceOverlayQ1(project, { activeLayer, hoveredLayer, snappedAnchor })
    : '';

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
