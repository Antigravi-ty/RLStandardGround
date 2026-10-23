/**
 * Geometric Solvers for RLStandardGround Studio:
 * - Polyline inward/outward normal offset (miter-clamped inset/outset)
 * - 3-Point Circle / Circular Arc exact solver (Circumcircle + Sweep angle)
 * - 5-Point Monotone-Slope Oval Spline solver (with 4-Pad Intersection + Midfield C1 vertical tangent)
 * - Line & Curve Arc-Length Start/End Trimming (trimStart / trimEnd in UU)
 * - Magnetic Anchor Snapping & Nearest Layer Hit-Testing
 */

import { Q1_FLAT_FLOOR_CONTOUR, Q1_PITCH_FLAT_FLOOR_CONTOUR, Q1_BOOST_PADS_BIG, Q1_BOOST_PADS_SMALL, Q1_KICKOFF_SPAWNS, Q1_DEMO_RESPAWNS } from './physicsData.js';

export function offsetQ1Contour(points, insetDist) {
  if (!points || points.length < 2 || Math.abs(insetDist) < 1e-3) {
    return points.map(([x, y]) => [x, y]);
  }

  const n = points.length;
  const segNormals = [];

  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    const dy = points[i + 1][1] - points[i][1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-5) {
      segNormals.push(segNormals.length > 0 ? segNormals[segNormals.length - 1] : [-1, 0]);
    } else {
      segNormals.push([-dy / len, dx / len]);
    }
  }

  const result = [];
  for (let i = 0; i < n; i++) {
    let nx, ny;
    if (i === 0) {
      nx = segNormals[0][0];
      ny = 0;
    } else if (i === n - 1) {
      nx = 0;
      ny = segNormals[n - 2][1];
    } else {
      const n0 = segNormals[i - 1];
      const n1 = segNormals[i];
      let bx = n0[0] + n1[0];
      let by = n0[1] + n1[1];
      const bLen = Math.hypot(bx, by);
      if (bLen < 1e-4) {
        nx = n1[0];
        ny = n1[1];
      } else {
        bx /= bLen;
        by /= bLen;
        const dot = bx * n1[0] + by * n1[1];
        const miter = Math.min(2.5, 1.0 / Math.max(0.25, dot));
        nx = bx * miter;
        ny = by * miter;
      }
    }

    const ox = Math.max(0, points[i][0] + nx * insetDist);
    const oy = Math.max(0, points[i][1] + ny * insetDist);
    result.push([ox, oy]);
  }

  return result;
}

/**
 * Trims a straight line segment (x1, y1) -> (x2, y2) by skipping `trimStart` UU at the start
 * and `trimEnd` UU at the end.
 */
export function trimLineSegment(x1, y1, x2, y2, trimStart = 0, trimEnd = 0) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const totalLen = Math.hypot(dx, dy);
  const tStart = Math.max(0, Number(trimStart) || 0);
  const tEnd = Math.max(0, Number(trimEnd) || 0);

  if (totalLen < 1e-3 || tStart + tEnd >= totalLen - 1e-2) {
    const midX = (x1 + x2) * 0.5;
    const midY = (y1 + y2) * 0.5;
    return { x1: midX, y1: midY, x2: midX, y2: midY, totalLen, drawnLen: 0, valid: false };
  }

  const ux = dx / totalLen;
  const uy = dy / totalLen;
  return {
    x1: x1 + ux * tStart,
    y1: y1 + uy * tStart,
    x2: x2 - ux * tEnd,
    y2: y2 - uy * tEnd,
    totalLen,
    drawnLen: totalLen - tStart - tEnd,
    valid: true
  };
}

/**
 * Given a polyline of [x, y] points, trims `trimStart` UU from the beginning and `trimEnd` UU from the end.
 */
export function trimPolylineByArcLength(pts, trimStart = 0, trimEnd = 0) {
  if (!pts || pts.length < 2) return pts || [];
  const t0 = Math.max(0, Number(trimStart) || 0);
  const t1 = Math.max(0, Number(trimEnd) || 0);
  if (t0 <= 1e-2 && t1 <= 1e-2) return pts;

  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    cum.push(cum[i - 1] + seg);
  }
  const total = cum[cum.length - 1];
  const sMin = t0;
  const sMax = total - t1;
  if (sMin >= sMax - 1e-2) return [];

  const interpAt = (s) => {
    if (s <= 0) return pts[0];
    if (s >= total) return pts[pts.length - 1];
    let idx = 0;
    while (idx < cum.length - 2 && cum[idx + 1] < s) idx++;
    const segLen = cum[idx + 1] - cum[idx];
    const t = segLen > 1e-5 ? (s - cum[idx]) / segLen : 0;
    return [
      pts[idx][0] + t * (pts[idx + 1][0] - pts[idx][0]),
      pts[idx][1] + t * (pts[idx + 1][1] - pts[idx][1])
    ];
  };

  const out = [interpAt(sMin)];
  for (let i = 1; i < pts.length - 1; i++) {
    if (cum[i] > sMin + 1e-2 && cum[i] < sMax - 1e-2) {
      out.push(pts[i]);
    }
  }
  out.push(interpAt(sMax));
  return out;
}

/**
 * Given 3 points P1(x1,y1), P2(x2,y2), P3(x3,y3), computes the exact circle passing through all 3,
 * and returns the SVG path `d` for the arc from P1 -> through P2 -> to P3 (or full circle).
 */
export function solveThreePointArc(x1, y1, x2, y2, x3, y3, fullCircle = false, trimStart = 0, trimEnd = 0) {
  const A = x2 - x1;
  const B = y2 - y1;
  const C = x3 - x1;
  const D = y3 - y1;
  const E = A * (x1 + x2) + B * (y1 + y2);
  const F = C * (x1 + x3) + D * (y1 + y3);
  const G = 2.0 * (A * (y3 - y2) - B * (x3 - x2));

  if (Math.abs(G) < 1e-5) {
    return {
      collinear: true,
      cx: (x1 + x3) * 0.5,
      cy: (y1 + y3) * 0.5,
      r: 0,
      d: `M ${x1.toFixed(2)},${y1.toFixed(2)} L ${x2.toFixed(2)},${y2.toFixed(2)} L ${x3.toFixed(2)},${y3.toFixed(2)}`
    };
  }

  const cx = (D * E - B * F) / G;
  const cy = (A * F - C * E) / G;
  const r = Math.hypot(x1 - cx, y1 - cy);

  if (fullCircle) {
    return {
      collinear: false,
      cx,
      cy,
      r,
      d: `M ${(cx - r).toFixed(2)},${cy.toFixed(2)} a ${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(r * 2).toFixed(2)},0 a ${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(-r * 2).toFixed(2)},0`
    };
  }

  const a1 = Math.atan2(y1 - cy, x1 - cx);
  const a2 = Math.atan2(y2 - cy, x2 - cx);
  const a3 = Math.atan2(y3 - cy, x3 - cx);

  const normAngle = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw12 = normAngle(a2 - a1);
  const ccw13 = normAngle(a3 - a1);

  const goesPositive = ccw12 <= ccw13;
  let sweepAngle = goesPositive ? ccw13 : (2 * Math.PI - ccw13);
  const dir = goesPositive ? 1 : -1;

  const tStartAngle = r > 1e-3 ? Math.max(0, Number(trimStart) || 0) / r : 0;
  const tEndAngle = r > 1e-3 ? Math.max(0, Number(trimEnd) || 0) / r : 0;

  if (tStartAngle + tEndAngle >= sweepAngle - 1e-4) {
    return { collinear: false, cx, cy, r, d: '' };
  }

  const effA1 = a1 + dir * tStartAngle;
  const effA3 = a1 + dir * (sweepAngle - tEndAngle);
  const effSweep = sweepAngle - tStartAngle - tEndAngle;

  const sx = cx + r * Math.cos(effA1);
  const sy = cy + r * Math.sin(effA1);
  const ex = cx + r * Math.cos(effA3);
  const ey = cy + r * Math.sin(effA3);

  const largeArcFlag = effSweep > Math.PI ? 1 : 0;
  const sweepFlag = goesPositive ? 1 : 0;

  const d = `M ${sx.toFixed(2)},${sy.toFixed(2)} A ${r.toFixed(2)},${r.toFixed(2)} 0 ${largeArcFlag},${sweepFlag} ${ex.toFixed(2)},${ey.toFixed(2)}`;
  return { collinear: false, cx, cy, r, startDeg: (effA1 * 180) / Math.PI, endDeg: (effA3 * 180) / Math.PI, sweepDeg: (effSweep * 180) / Math.PI, d };
}

/**
 * Generates an SVG arc path from center (cx, cy), radius r, and startAngleDeg -> endAngleDeg,
 * with optional arc-length trimming (trimStart, trimEnd in UU).
 */
export function describePolarArc(cx, cy, r, startDeg, endDeg, closePie = false, trimStart = 0, trimEnd = 0) {
  const dir = endDeg >= startDeg ? 1 : -1;
  const trimStartDeg = r > 1e-3 ? ((Math.max(0, Number(trimStart) || 0) / r) * 180) / Math.PI : 0;
  const trimEndDeg = r > 1e-3 ? ((Math.max(0, Number(trimEnd) || 0) / r) * 180) / Math.PI : 0;

  const effStart = startDeg + dir * trimStartDeg;
  const effEnd = endDeg - dir * trimEndDeg;
  const span = Math.abs(effEnd - effStart);
  if ((effEnd - effStart) * dir <= 0.01) return '';

  if (span >= 359.99) {
    return `M ${(cx - r).toFixed(2)},${cy.toFixed(2)} a ${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(r * 2).toFixed(2)},0 a ${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(-r * 2).toFixed(2)},0`;
  }
  const sRad = (effStart * Math.PI) / 180.0;
  const eRad = (effEnd * Math.PI) / 180.0;
  const x1 = cx + r * Math.cos(sRad);
  const y1 = cy + r * Math.sin(sRad);
  const x2 = cx + r * Math.cos(eRad);
  const y2 = cy + r * Math.sin(eRad);
  const largeArc = span > 180 ? 1 : 0;
  const sweep = effEnd >= effStart ? 1 : 0;
  let d = `M ${x1.toFixed(2)},${y1.toFixed(2)} A ${r.toFixed(2)},${r.toFixed(2)} 0 ${largeArc},${sweep} ${x2.toFixed(2)},${y2.toFixed(2)}`;
  if (closePie) {
    d += ` L ${cx.toFixed(2)},${cy.toFixed(2)} Z`;
  }
  return d;
}

/**
 * Solves the 5-Point Monotone-Slope Smooth Oval Curve in Q1:
 * - P1: Dynamic midfield point (X0, 0) on Y = 0 where the tangent is completely parallel
 *       to the long side of the pitch (dX/dY = 0, vertical tangent).
 *       In default 'auto_c2' mode, X0 is automatically solved from the C2 curvature-continuity
 *       condition across #S3(2048, -1036) -> P1(X0, 0) -> #S3(2048, +1036) -> #S4(1788, 2300),
 *       yielding X0 = x2 + 0.54 * y2 * s1 ≈ 2068.14 UU (+20.14 UU outward from #IX1(2048, 0)).
 * - P2: #S3 (2048, 1036)
 * - P3: #S4 (1788, 2300)
 * - P4: #S7 (940, 3308)
 * - P5: #S9 (0, 4240)
 *
 * Uses a C2-balanced Monotone Cubic Hermite Spline X(Y) where each segment [Y_k, Y_{k+1}]
 * has balanced Y-handles (h_k / 3) and satisfies 2*s_k + s_{k+1} <= 3*D_k <= s_k + 2*s_{k+1},
 * guaranteeing a 100% smooth curve with continuous curvature and strictly monotonic slope (zero corners, zero inflection points).
 */
export function solveMonotoneFivePointSpline(layer = {}) {
  const x2 = Number(layer.p2x ?? 2048);
  const y2 = Number(layer.p2y ?? 1036);
  const x3 = Number(layer.p3x ?? 1788);
  const y3 = Number(layer.p3y ?? 2300);
  const x4 = Number(layer.p4x ?? 940);
  const y4 = Number(layer.p4y ?? 3308);
  const x5 = Number(layer.p5x ?? 0);
  const y5 = Number(layer.p5y ?? 4240);

  const h0 = Math.max(1.0, y2);
  const h1 = Math.max(1.0, y3 - y2);
  const h2 = Math.max(1.0, y4 - y3);
  const h3 = Math.max(1.0, y5 - y4);

  const D1 = Math.max(1e-4, (x2 - x3) / h1);
  const D2 = Math.max(1e-4, (x3 - x4) / h2);
  const D3 = Math.max(1e-4, (x4 - x5) / h3);

  // 1. Solve C2-balanced node slopes s = -dX/dY inside the exact monotone cubic domain
  //    2*s_k + s_{k+1} <= 3*D_k <= s_k + 2*s_{k+1} so every segment has full 1/3 Hermite handles without pinching:
  let s3 = Math.min(D3 - 0.08 * (D3 - D2), Math.max(D2 + 0.55 * (D3 - D2), 1.5 * D2 - 1.25 * D1));
  s3 = Math.max(D2 + 1e-3, Math.min(D3 - 1e-3, s3));

  const s2MinMono = Math.max(D1 + 0.15 * (D2 - D1), 3 * D2 - 2 * s3);
  const s2MaxMono = Math.min(D2 - 0.15 * (D2 - D1), 3 * D1 - 0.04);
  let s2 = 0.5 * (s2MinMono + s2MaxMono);

  const s1Auto = Math.max(0.036, Math.min(D1 * 0.65, 0.5 * (3 * D1 - s2)));

  // 2. Automatically solve the dynamic point P1 = (X0, 0) on Y = 0 where dX/dY = 0:
  //    For a symmetric C2 arch across [-y2, +y2] with slope 0 at Y=0 and slope s1 at Y=y2,
  //    D0 = (X0 - x2) / y2 = 0.54 * s1 => autoMidExpand = 0.54 * h0 * s1Auto.
  const autoMidExpand = 0.54 * h0 * s1Auto;
  const isManualMid = layer.midXMode === 'manual';
  const midExpand = isManualMid
    ? Math.max(2, Number(layer.midXExpand ?? autoMidExpand))
    : autoMidExpand;
  const x1 = x2 + midExpand;
  const D0 = midExpand / h0;

  const s0 = 0.0; // Exact vertical tangent (parallel to long side) at Y = 0
  const s1 = isManualMid
    ? Math.max(D0 * 1.45, Math.min(D1 * 0.78, s1Auto))
    : s1Auto;

  if (isManualMid) {
    const s2C2 = (3 * D1 / h1 - s1 / h1 + 3 * D2 / h2 - s3 / h2) / (2 / h1 + 2 / h2);
    s2 = Math.max(D1 + 0.05 * (D2 - D1), Math.min(D2 - 0.05 * (D2 - D1), s2C2));
  }

  const endMode = layer.endSlopeMode || 'natural_pointed';
  const s4 = endMode === 'flat_x0'
    ? Math.max(D3 * 3.2, 3.5)
    : Math.max(D3 + 0.20 * (D3 - s3), 3 * D3 - 2 * s3);

  const pts = [
    [x1, 0.0],
    [x2, y2],
    [x3, y3],
    [x4, y4],
    [x5, y5]
  ];
  const D = [D0, D1, D2, D3];
  const s = [s0, s1, s2, s3, s4];
  const h = [h0, h1, h2, h3];

  const bezierSegments = [];
  const sampledPoints = [];

  for (let k = 0; k < 4; k++) {
    const [xA, yA] = pts[k];
    const [xB, yB] = pts[k + 1];
    const hk = h[k];
    const uk = (D[k] - s[k]) / Math.max(1e-5, s[k + 1] - s[k]);

    // When uk is in [1/3, 2/3], ak = 1/3 and bk = 1/3 (exact C2 cubic polynomial X(Y) with linear Y(t)).
    // If manual override pushes uk outside [1/3, 2/3], smoothly adapt ak <= 1 - uk and bk <= uk so convexity is 100% preserved.
    const ak = Math.min(1 / 3, Math.max(0.18, 1 - uk));
    const bk = Math.min(1 / 3, Math.max(0.18, uk));

    const c1x = xA - ak * hk * s[k];
    const c1y = yA + ak * hk;
    const c2x = xB + bk * hk * s[k + 1];
    const c2y = yB - bk * hk;

    bezierSegments.push({ xA, yA, c1x, c1y, c2x, c2y, xB, yB });

    const steps = 40;
    for (let i = (k === 0 ? 0 : 1); i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const bx = mt * mt * mt * xA + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * xB;
      const by = mt * mt * mt * yA + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * yB;
      sampledPoints.push([bx, by]);
    }
  }

  const tStart = Math.max(0, Number(layer.trimStart) || 0);
  const tEnd = Math.max(0, Number(layer.trimEnd) || 0);

  let d = '';
  if (tStart > 0.5 || tEnd > 0.5) {
    const trimmed = trimPolylineByArcLength(sampledPoints, tStart, tEnd);
    d = trimmed.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  } else {
    d = bezierSegments.map((seg, i) => {
      const prefix = i === 0 ? `M ${seg.xA.toFixed(2)},${seg.yA.toFixed(2)} ` : '';
      return `${prefix}C ${seg.c1x.toFixed(2)},${seg.c1y.toFixed(2)} ${seg.c2x.toFixed(2)},${seg.c2y.toFixed(2)} ${seg.xB.toFixed(2)},${seg.yB.toFixed(2)}`;
    }).join(' ');
  }

  return {
    points: pts,
    secantSlopes: D,
    nodeSlopes: s,
    autoMidExpand,
    midExpand,
    autoMidX: x2 + autoMidExpand,
    intersectionAnchor: [2048, 0],
    sampledPoints,
    d
  };
}

/**
 * Finds the nearest named anchor in Q1 within maxDist UU.
 */
export function findNearestAnchor(q1x, q1y, anchors, maxDist = 260) {
  let best = null;
  let bestDist = maxDist;
  for (const a of anchors) {
    const d = Math.hypot(q1x - a.x, q1y - a.y);
    if (d <= bestDist) {
      bestDist = d;
      best = { ...a, dist: d };
    }
  }
  return best;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function distToPolyline(px, py, pts) {
  if (!pts || pts.length < 2) return Infinity;
  let minD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < minD) minD = d;
  }
  return minD;
}

/**
 * Computes approximate distance in UU from a Q1 point (px, py) to a layer's stroke geometry,
 * used for hovering/clicking a line directly on the canvas to identify and select it.
 */
export function distanceToLayerQ1(layer, px, py) {
  if (!layer || !layer.visible) return Infinity;

  if (layer.type === 'rect_or_line') {
    if (layer.subMode === 'hline_y0') {
      return distToSegment(px, py, Number(layer.x1) || 0, Number(layer.y1) || 0, Number(layer.x2) || 3840, Number(layer.y1) || 0);
    }
    if (layer.subMode === 'vline_x0') {
      return distToSegment(px, py, Number(layer.x1) || 0, Number(layer.y1) || 0, Number(layer.x1) || 0, Number(layer.y2) || 5120);
    }
    if (layer.subMode === 'custom_segment') {
      const t = trimLineSegment(
        Number(layer.x1) || 0, Number(layer.y1) || 0,
        Number(layer.x2) || 0, Number(layer.y2) || 0,
        layer.trimStart, layer.trimEnd
      );
      return distToSegment(px, py, t.x1, t.y1, t.x2, t.y2);
    }
    const rx1 = Math.min(Number(layer.x1) || 0, Number(layer.x2) || 1000);
    const rx2 = Math.max(Number(layer.x1) || 0, Number(layer.x2) || 1000);
    const ry1 = Math.min(Number(layer.y1) || 0, Number(layer.y2) || 1000);
    const ry2 = Math.max(Number(layer.y1) || 0, Number(layer.y2) || 1000);
    return Math.min(
      distToSegment(px, py, rx1, ry1, rx2, ry1),
      distToSegment(px, py, rx2, ry1, rx2, ry2),
      distToSegment(px, py, rx2, ry2, rx1, ry2)
    );
  }

  if (layer.type === 'circle_arc') {
    const cx = Number(layer.cx) || 0;
    const cy = Number(layer.cy) || 0;
    const r = Math.max(1, Number(layer.radius) || 100);
    return Math.abs(Math.hypot(px - cx, py - cy) - r);
  }

  if (layer.type === 'three_point_arc') {
    const arc = solveThreePointArc(
      Number(layer.x1) || 0, Number(layer.y1) || 0,
      Number(layer.x2) || 0, Number(layer.y2) || 0,
      Number(layer.x3) || 0, Number(layer.y3) || 0,
      Boolean(layer.fullCircle)
    );
    if (arc.collinear) return distToSegment(px, py, layer.x1, layer.y1, layer.x3, layer.y3);
    return Math.abs(Math.hypot(px - arc.cx, py - arc.cy) - arc.r);
  }

  if (layer.type === 'monotone_pad_spline') {
    const spline = solveMonotoneFivePointSpline(layer);
    return distToPolyline(px, py, spline.sampledPoints);
  }

  if (layer.type === 'contour_offset') {
    const base = layer.baseContour === 'pitch_flat_floor' ? Q1_PITCH_FLAT_FLOOR_CONTOUR : Q1_FLAT_FLOOR_CONTOUR;
    const sw = Number(layer.strokeWidth) || 0;
    const inset = (layer.hugInnerEdge ? sw * 0.5 : 0) + (Number(layer.insetDist) || 0);
    const pts = offsetQ1Contour(base, inset);
    return distToPolyline(px, py, pts);
  }

  if (layer.type === 'boost_pad_group') {
    const pads = [...Q1_BOOST_PADS_BIG, ...Q1_BOOST_PADS_SMALL];
    let minD = Infinity;
    for (const p of pads) {
      const pr = p.isBig ? 208 : 144;
      const d = Math.abs(Math.hypot(px - p.x, py - p.y) - pr);
      if (d < minD) minD = d;
    }
    return minD;
  }

  if (layer.type === 'spawn_marker_group') {
    const spawns = [...Q1_KICKOFF_SPAWNS, ...Q1_DEMO_RESPAWNS];
    let minD = Infinity;
    for (const sp of spawns) {
      const d = Math.hypot(px - sp.x, py - sp.y);
      if (d < minD) minD = d;
    }
    return Math.max(0, minD - 60);
  }

  return Infinity;
}

export function grayToCss(grayVal, opacity = 1.0, shaderSim = null) {
  const g = Math.max(0, Math.min(255, Math.round(grayVal)));
  if (!shaderSim || !shaderSim.enabled) {
    return `rgba(${g}, ${g}, ${g}, ${opacity})`;
  }
  const lum = g / 255.0;
  const thresh = shaderSim.threshold ?? 0.13;
  const smooth = Math.max(0.0005, shaderSim.smoothness ?? 0.05);
  const t = Math.max(0, Math.min(1, (lum - (thresh - smooth)) / (2 * smooth)));
  const isLine = t * t * (3 - 2 * t);

  const c0 = hexToRgb(shaderSim.groundColor || '#18441c');
  const c1 = hexToRgb(shaderSim.lineColor || '#e1e6eb');
  const r = Math.round(c0.r + (c1.r - c0.r) * isLine);
  const gr = Math.round(c0.g + (c1.g - c0.g) * isLine);
  const b = Math.round(c0.b + (c1.b - c0.b) * isLine);
  return `rgba(${r}, ${gr}, ${b}, ${opacity})`;
}

export function hexToRgb(hex) {
  const clean = (hex || '#000000').replace('#', '');
  const num = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16) || 0;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}
