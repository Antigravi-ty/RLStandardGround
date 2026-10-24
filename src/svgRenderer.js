import {
  ARENA_CONSTANTS,
  Q1_FLAT_FLOOR_CONTOUR,
  Q1_PITCH_FLAT_FLOOR_CONTOUR,
  Q1_DRIFTWOODS_GROUND_MESH_CONTOUR,
  Q1_DRIFTWOODS_PITCH_MESH_CONTOUR,
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
  solveTriangleCone,
  isOutsideCenterDashSafeZone,
  buildNormalClippedSubPaths,
  makeLineCurveDef,
  makeCircularArcCurveDef,
  makePolylineCurveDef,
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
    case 'driftwoods_ground_mesh':
      return Q1_DRIFTWOODS_GROUND_MESH_CONTOUR;
    case 'driftwoods_pitch_mesh':
      return Q1_DRIFTWOODS_PITCH_MESH_CONTOUR;
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
 * Builds the SVG <mask> elements for Center Dash Safe Area cutouts on a triangle_cone layer.
 */
function buildCenterDashSafeMaskShapes(layer, fillOrStroke = 'black') {
  if (!layer.cutByCenterDashSafeArea || layer.dashSafeMode === 'none') return '';

  const x1 = Number(layer.x1 ?? 2048);
  const y1 = Number(layer.y1 ?? 2560);
  const x2 = Number(layer.x2 ?? 3072);
  const y2 = Number(layer.y2 ?? 4096);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-2) return '';

  const ux = dx / dist;
  const uy = dy / dist;

  const centerSw = Math.max(0, Number(layer.centerDashStrokeWidth ?? 30));
  const safeExpand = Math.max(0, Number(layer.dashSafeExpand ?? 22));
  const totalSafeW = centerSw + safeExpand * 2;
  const mode = layer.dashSafeMode || 'corridor';

  if (mode === 'corridor') {
    return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${fillOrStroke}" stroke-width="${totalSafeW.toFixed(2)}" stroke-linecap="butt" />`;
  }

  // Per-dash cutouts ('per_dash_box' or 'per_dash_pill')
  const trimS = Math.max(0, Number(layer.centerDashTrimStart ?? 85));
  const dLen = Math.max(1, Number(layer.centerDashLength ?? 110));
  const gLen = Math.max(1, Number(layer.centerGapLength ?? 120));
  const dOff = Number(layer.centerDashOffset ?? -30);
  const period = dLen + gLen;
  const maxD = dist - trimS;

  let shapes = '';
  const kMin = Math.floor((-dOff - dLen) / period) - 1;
  const kMax = Math.ceil((maxD + Math.abs(dOff)) / period) + 1;

  for (let k = kMin; k <= kMax; k++) {
    const ds0 = Math.max(0, k * period - dOff);
    const ds1 = Math.min(maxD, k * period - dOff + dLen);
    if (ds1 - ds0 <= 1) continue;

    if (mode === 'per_dash_pill') {
      const s0 = trimS + ds0;
      const s1 = trimS + ds1;
      const sx = x1 + ux * s0;
      const sy = y1 + uy * s0;
      const ex = x1 + ux * s1;
      const ey = y1 + uy * s1;
      shapes += `<line x1="${sx.toFixed(2)}" y1="${sy.toFixed(2)}" x2="${ex.toFixed(2)}" y2="${ey.toFixed(2)}" stroke="${fillOrStroke}" stroke-width="${totalSafeW.toFixed(2)}" stroke-linecap="round" />`;
    } else {
      const s0 = trimS + ds0 - safeExpand;
      const s1 = trimS + ds1 + safeExpand;
      const sx = x1 + ux * s0;
      const sy = y1 + uy * s0;
      const ex = x1 + ux * s1;
      const ey = y1 + uy * s1;
      shapes += `<line x1="${sx.toFixed(2)}" y1="${sy.toFixed(2)}" x2="${ex.toFixed(2)}" y2="${ey.toFixed(2)}" stroke="${fillOrStroke}" stroke-width="${totalSafeW.toFixed(2)}" stroke-linecap="butt" />`;
    }
  }
  return shapes;
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

  const { w: scopeW, h: scopeH } = getScopeDimensions(project?.canvasScope);
  const clipId = `clip_${layer.id}_${index}`;
  const cxMin = Number(layer.clipXMin ?? 0);
  const cxMax = Number(layer.clipXMax ?? scopeW);
  const cyMin = Number(layer.clipYMin ?? 0);
  const cyMax = Number(layer.clipYMax ?? scopeH);
  const cw = Math.max(0, cxMax - cxMin);
  const ch = Math.max(0, cyMax - cyMin);

  const useNormalPathClip = (layer.dashClipMode || 'normal_path') !== 'box_mask' &&
    ['rect_or_line', 'circle_arc', 'three_point_arc', 'monotone_pad_spline', 'triangle_cone'].includes(layer.type) &&
    !(layer.type === 'rect_or_line' && layer.subMode === 'rect_box');

  // When using 1D Centerline Normal Clipping, the outer clipPath only clips at Q1 quadrant boundaries [0..scopeW, 0..scopeH]
  // so interior Clip Box cuts are perpendicular to the stroke rather than obliquely sliced!
  const effClipX = useNormalPathClip ? 0 : cxMin;
  const effClipY = useNormalPathClip ? 0 : cyMin;
  const effClipW = useNormalPathClip ? scopeW : cw;
  const effClipH = useNormalPathClip ? scopeH : ch;

  let defsHtml = `<clipPath id="${clipId}"><rect x="${effClipX}" y="${effClipY}" width="${effClipW}" height="${effClipH}" /></clipPath>`;
  let innerHtml = '';

  const resolvedStroke = project
    ? resolveLayerGrayAndCss(layer, layer.opacity ?? 1.0, project, Boolean(shaderSim?.enabled))
    : { css: grayToCss(layer.gray ?? 255, layer.opacity ?? 1.0, shaderSim) };
  const strokeColor = resolvedStroke.css;

  const fillColor = (layer.fillGray !== undefined && layer.fillGray >= 0)
    ? (project
        ? resolveLayerGrayAndCss({ gray: layer.fillGray, grayLevel: layer.fillGrayLevel ?? layer.grayLevel }, layer.opacity ?? 1.0, project, Boolean(shaderSim?.enabled)).css
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
    const sw = Number(layer.strokeWidth) || 0;

    if (layer.fillGray !== undefined && layer.fillGray >= 0) {
      const fillD = describePolarArc(cx, cy, r, sDeg, eDeg, Math.abs(eDeg - sDeg) < 359.9, 0, 0);
      innerHtml += `<path d="${fillD}" fill="${fillColor}" stroke="none" />`;
    }

    if (sw > 0) {
      if (useNormalPathClip) {
        const dir = eDeg >= sDeg ? 1 : -1;
        const trimStartDeg = ((trimS / r) * 180) / Math.PI;
        const trimEndDeg = ((trimE / r) * 180) / Math.PI;
        const effStartDeg = sDeg + dir * trimStartDeg;
        const effEndDeg = eDeg - dir * trimEndDeg;
        const spanDeg = (effEndDeg - effStartDeg) * dir;
        if (spanDeg > 0.01) {
          const curveDef = makeCircularArcCurveDef(
            cx,
            cy,
            r,
            (effStartDeg * Math.PI) / 180,
            (Math.min(360, spanDeg) * Math.PI) / 180,
            dir
          );
          const subPaths = buildNormalClippedSubPaths(curveDef, layer, project, scopeW, scopeH);
          if (subPaths.length > 0) {
            innerHtml += `<path d="${subPaths.join(' ')}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" ${capJoinAttr} />`;
          }
        }
      } else {
        const d = describePolarArc(cx, cy, r, sDeg, eDeg, false, trimS, trimE);
        if (d) {
          innerHtml += `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} ${capJoinAttr} />`;
        }
      }
    }
  } else if (layer.type === 'three_point_arc') {
    const x1 = Number(layer.x1) || 0;
    const y1 = Number(layer.y1) || 0;
    const x2 = Number(layer.x2) || 500;
    const y2 = Number(layer.y2) || 500;
    const x3 = Number(layer.x3) || 1000;
    const y3 = Number(layer.y3) || 0;
    const sw = Number(layer.strokeWidth) || 0;
    const arc = solveThreePointArc(x1, y1, x2, y2, x3, y3, Boolean(layer.fullCircle), trimS, trimE);

    if (sw > 0 && arc.d) {
      if (useNormalPathClip && !arc.collinear && arc.r > 1e-3 && arc.effSweep > 1e-4) {
        const curveDef = makeCircularArcCurveDef(arc.cx, arc.cy, arc.r, arc.effA1, arc.effSweep, arc.dir);
        const subPaths = buildNormalClippedSubPaths(curveDef, layer, project, scopeW, scopeH);
        if (subPaths.length > 0) {
          innerHtml += `<path d="${subPaths.join(' ')}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" ${capJoinAttr} />`;
        }
      } else {
        innerHtml += `<path d="${arc.d}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} ${capJoinAttr} />`;
      }
    }
  } else if (layer.type === 'monotone_pad_spline') {
    const spline = solveMonotoneFivePointSpline(layer);
    const sw = Number(layer.strokeWidth) || 0;
    if (sw > 0 && spline.d) {
      if (useNormalPathClip && spline.sampledPoints?.length >= 2) {
        const curveDef = makePolylineCurveDef(spline.sampledPoints);
        const subPaths = buildNormalClippedSubPaths(curveDef, layer, project, scopeW, scopeH);
        if (subPaths.length > 0) {
          innerHtml += `<path d="${subPaths.join(' ')}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" ${capJoinAttr} />`;
        }
      } else {
        innerHtml += `<path d="${spline.d}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} ${capJoinAttr} />`;
      }
    }
  } else if (layer.type === 'rect_or_line') {
    const sw = Number(layer.strokeWidth) || 0;
    if (layer.subMode === 'hline_y0' || layer.subMode === 'vline_x0' || layer.subMode === 'custom_segment') {
      let lx1 = Number(layer.x1) || 0;
      let ly1 = Number(layer.y1) || 0;
      let lx2 = Number(layer.x2) || 0;
      let ly2 = Number(layer.y2) || 0;
      if (layer.subMode === 'hline_y0') {
        ly2 = ly1;
        if (!layer.x2) lx2 = 3840;
      } else if (layer.subMode === 'vline_x0') {
        lx2 = lx1;
        if (!layer.y2) ly2 = 5120;
      }
      const t = trimLineSegment(lx1, ly1, lx2, ly2, trimS, trimE);
      if (t.valid && sw > 0) {
        if (useNormalPathClip) {
          const curveDef = makeLineCurveDef(t.x1, t.y1, t.x2, t.y2);
          const subPaths = buildNormalClippedSubPaths(curveDef, layer, project, scopeW, scopeH);
          if (subPaths.length > 0) {
            innerHtml += `<path d="${subPaths.join(' ')}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" ${capJoinAttr} />`;
          }
        } else {
          innerHtml += `<line x1="${t.x1.toFixed(2)}" y1="${t.y1.toFixed(2)}" x2="${t.x2.toFixed(2)}" y2="${t.y2.toFixed(2)}" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} ${capJoinAttr} />`;
        }
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
  } else if (layer.type === 'triangle_cone') {
    const cone = solveTriangleCone(layer);
    if (cone.valid) {
      const sw = Number(layer.strokeWidth ?? 24);
      const renderStyle = layer.renderStyle || 'stroked_sides';
      const hasFill = renderStyle === 'filled_zone' || renderStyle === 'filled_and_stroked' || (layer.fillGray !== undefined && layer.fillGray >= 0);
      const hasStroke = renderStyle !== 'filled_zone' && sw > 0;

      const targetPadClipR = layer.cutByTargetPad
        ? Math.max(0, Number(layer.basePadRadius ?? 208) + Number(layer.targetPadSafeExpand ?? 32))
        : 0;

      // Build dedicated mask for filled zone (and box_mask mode) combining Target Pad Safe Area, Small/Big Pad Safe Area, and Center Dash Safe Area
      const triMaskId = `mask_tri_${layer.id}_${index}`;
      const smallExpand = Math.max(0, Number(project?.smallPadSafeExpand ?? 60));
      const smallSafeR = ARENA_CONSTANTS.PAD_CYL_RAD_SMALL + smallExpand;
      const bigExpand = Math.max(0, Number(project?.bigPadSafeExpand ?? 0));
      const bigSafeR = ARENA_CONSTANTS.PAD_CYL_RAD_BIG + bigExpand;

      let maskCutouts = '';
      if (layer.cutBySmallPadSafeArea) {
        maskCutouts += Q1_BOOST_PADS_SMALL.map(p => `<circle cx="${p.x}" cy="${p.y}" r="${smallSafeR.toFixed(2)}" fill="black" />`).join('');
      }
      if (layer.cutByBigPadSafeArea) {
        maskCutouts += Q1_BOOST_PADS_BIG.map(p => `<circle cx="${p.x}" cy="${p.y}" r="${bigSafeR.toFixed(2)}" fill="black" />`).join('');
      }
      if (targetPadClipR > 0) {
        maskCutouts += `<circle cx="${cone.x2.toFixed(2)}" cy="${cone.y2.toFixed(2)}" r="${targetPadClipR.toFixed(2)}" fill="black" />`;
      }
      maskCutouts += buildCenterDashSafeMaskShapes(layer, 'black');

      defsHtml += `<mask id="${triMaskId}" maskUnits="userSpaceOnUse" x="-600" y="-600" width="5200" height="7200">
        <rect x="-600" y="-600" width="5200" height="7200" fill="white" />
        ${maskCutouts}
      </mask>`;

      if (hasFill) {
        const effFillColor = fillColor !== 'none' ? fillColor : strokeColor;
        innerHtml += `<path d="${cone.fillPolygonD}" fill="${effFillColor}" stroke="none" mask="url(#${triMaskId})" />`;
      }

      if (hasStroke) {
        // Extra point filter for 1D centerline normal clipping on triangle edges:
        // 1. Outside target pad safe circle (R = targetPadClipR)
        // 2. Outside Center Dash Safe Area (with sw*0.5 clearance so inner edge of side stroke never touches the Dash Safe Area!)
        const extraFilter = (px, py) => {
          if (targetPadClipR > 0 && Math.hypot(px - cone.x2, py - cone.y2) < targetPadClipR) {
            return false;
          }
          if (!isOutsideCenterDashSafeZone(px, py, layer, sw * 0.5)) {
            return false;
          }
          return true;
        };

        const leftCurve = makeLineCurveDef(cone.leftStart[0], cone.leftStart[1], cone.leftEnd[0], cone.leftEnd[1]);
        const rightCurve = makeLineCurveDef(cone.rightStart[0], cone.rightStart[1], cone.rightEnd[0], cone.rightEnd[1]);

        if (useNormalPathClip) {
          const leftPaths = buildNormalClippedSubPaths(leftCurve, layer, project, scopeW, scopeH, extraFilter);
          const rightPaths = buildNormalClippedSubPaths(rightCurve, layer, project, scopeW, scopeH, extraFilter);
          const allEdgePaths = [...leftPaths, ...rightPaths];

          if (renderStyle === 'stroked_closed') {
            const baseCurve = makeLineCurveDef(cone.leftEnd[0], cone.leftEnd[1], cone.rightEnd[0], cone.rightEnd[1]);
            allEdgePaths.push(...buildNormalClippedSubPaths(baseCurve, layer, project, scopeW, scopeH, extraFilter));
          } else if (renderStyle === 'stroked_arc') {
            const arcR = Math.max(targetPadClipR, cone.targetR);
            const aL = Math.atan2(cone.leftEnd[1] - cone.y2, cone.leftEnd[0] - cone.x2);
            const aR = Math.atan2(cone.rightEnd[1] - cone.y2, cone.rightEnd[0] - cone.x2);
            let diff = aR - aL;
            while (diff > Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;
            const arcCurve = makeCircularArcCurveDef(cone.x2, cone.y2, arcR, aL, Math.abs(diff), diff >= 0 ? 1 : -1);
            const baseFilter = (px, py) => isOutsideCenterDashSafeZone(px, py, layer, sw * 0.5);
            allEdgePaths.push(...buildNormalClippedSubPaths(arcCurve, layer, project, scopeW, scopeH, baseFilter));
          }

          if (allEdgePaths.length > 0) {
            innerHtml += `<path d="${allEdgePaths.join(' ')}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" ${capJoinAttr} />`;
          }
        } else {
          let rawD = `M ${cone.leftStart[0].toFixed(2)},${cone.leftStart[1].toFixed(2)} L ${cone.leftEnd[0].toFixed(2)},${cone.leftEnd[1].toFixed(2)} M ${cone.rightStart[0].toFixed(2)},${cone.rightStart[1].toFixed(2)} L ${cone.rightEnd[0].toFixed(2)},${cone.rightEnd[1].toFixed(2)}`;
          if (renderStyle === 'stroked_closed') {
            rawD += ` M ${cone.leftEnd[0].toFixed(2)},${cone.leftEnd[1].toFixed(2)} L ${cone.rightEnd[0].toFixed(2)},${cone.rightEnd[1].toFixed(2)}`;
          }
          innerHtml += `<path d="${rawD}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" ${dashAttr} ${capJoinAttr} mask="url(#${triMaskId})" />`;
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

  // Only apply the pixel mask if 1D normal path clipping is not handling it
  const maskAttr = (!useNormalPathClip && layer.cutBySmallPadSafeArea && layer.type !== 'triangle_cone')
    ? ` mask="url(#mask_small_pad_safe_q1)"`
    : '';
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

  if (ref.showDriftwoodsGroundMesh) {
    const dwFloorD = pointsToPathD(Q1_DRIFTWOODS_GROUND_MESH_CONTOUR, false);
    parts.push(`<path d="${dwFloorD}" fill="rgba(56, 189, 248, 0.04)" stroke="#38bdf8" stroke-width="9" stroke-dasharray="18,10" />`);
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

  // 4b. Small Pad Safe Area & Dash Safe Area Visualization
  if (ref.showSmallPadSafeArea) {
    const expand = Math.max(0, Number(project.smallPadSafeExpand ?? 60));
    const safeR = ARENA_CONSTANTS.PAD_CYL_RAD_SMALL + expand;
    let safeHtml = '<g id="Ref_SmallPad_SafeArea">';
    for (const p of Q1_BOOST_PADS_SMALL) {
      safeHtml += `<circle cx="${p.x}" cy="${p.y}" r="${safeR.toFixed(2)}" fill="rgba(236, 72, 153, 0.05)" stroke="#f472b6" stroke-width="5" stroke-dasharray="16,12" />`;
    }
    for (const l of (project.layers || [])) {
      if (l.visible && l.type === 'triangle_cone') {
        if (l.cutByTargetPad) {
          const padR = Math.max(0, Number(l.basePadRadius ?? 208) + Number(l.targetPadSafeExpand ?? 32));
          safeHtml += `<circle cx="${l.x2}" cy="${l.y2}" r="${padR.toFixed(2)}" fill="rgba(251, 191, 36, 0.05)" stroke="#fbbf24" stroke-width="5" stroke-dasharray="16,12" />`;
        }
        if (l.cutByCenterDashSafeArea && l.dashSafeMode !== 'none') {
          safeHtml += `<g opacity="0.28">${buildCenterDashSafeMaskShapes(l, '#f472b6')}</g>`;
        }
      }
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

  // 6. Hovered Layer Visual Highlight
  if (hoveredLayer && hoveredLayer.visible && (!activeLayer || hoveredLayer.id !== activeLayer.id)) {
    const hovRender = renderParametricLayerQ1(
      { ...hoveredLayer, gray: 255, opacity: 0.9, strokeWidth: Math.max(24, (Number(hoveredLayer.strokeWidth) || 16) + 14), dashLength: 0, gapLength: 0 },
      998,
      { enabled: true, groundColor: '#000000', lineColor: '#38bdf8', threshold: 0.1, smoothness: 0.05 },
      false,
      project
    );
    parts.push(`<g opacity="0.55">${hovRender.bodyHtml}</g>`);
  }

  // 7. Active Selected Layer Interactive Handles & Construction Guides
  if (activeLayer && activeLayer.visible) {
    const selRender = renderParametricLayerQ1(
      { ...activeLayer, gray: 255, opacity: 0.85, strokeWidth: Math.max(26, (Number(activeLayer.strokeWidth) || 16) + 16), dashLength: 0, gapLength: 0 },
      999,
      { enabled: true, groundColor: '#000000', lineColor: '#22d3ee', threshold: 0.1, smoothness: 0.05 },
      true,
      project
    );
    parts.push(`<g opacity="0.32">${selRender.bodyHtml}</g>`);

    if (activeLayer.type === 'triangle_cone') {
      const cone = solveTriangleCone(activeLayer);
      if (cone.valid) {
        parts.push(`<path d="${cone.fillPolygonD}" fill="rgba(251, 191, 36, 0.07)" stroke="#fbbf24" stroke-width="4" stroke-dasharray="14,10" opacity="0.75" />`);
        parts.push(`<circle cx="${cone.x2}" cy="${cone.y2}" r="${cone.targetR.toFixed(2)}" fill="none" stroke="#fbbf24" stroke-width="5" stroke-dasharray="12,8" opacity="0.85" />`);
        if (activeLayer.cutByCenterDashSafeArea && activeLayer.dashSafeMode !== 'none') {
          parts.push(`<g opacity="0.22">${buildCenterDashSafeMaskShapes(activeLayer, '#f472b6')}</g>`);
        }
        parts.push(`<circle cx="${cone.x1}" cy="${cone.y1}" r="24" fill="#22c55e" stroke="#ffffff" stroke-width="5" />`);
        parts.push(`<text x="${Number(cone.x1) + 34}" y="${Number(cone.y1) - 18}" fill="#4ade80" font-family="monospace" font-size="38" font-weight="bold">顶点P1(${Math.round(cone.x1)},${Math.round(cone.y1)})</text>`);
        parts.push(`<circle cx="${cone.x2}" cy="${cone.y2}" r="24" fill="#fbbf24" stroke="#ffffff" stroke-width="5" />`);
        parts.push(`<text x="${Number(cone.x2) + 34}" y="${Number(cone.y2) + 36}" fill="#fde047" font-family="monospace" font-size="38" font-weight="bold">目标P2(R=${Math.round(cone.targetR)} UU)</text>`);
      }
    } else if (activeLayer.type === 'monotone_pad_spline') {
      const spline = solveMonotoneFivePointSpline(activeLayer);
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
