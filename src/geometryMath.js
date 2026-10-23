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
 * Solves the 5-Point Monotone-Slope Oval Curve in Q1:
 * - P1: Midfield line point (2048 + midXExpand, 0), derived from the 4-Boost-Pad Intersection (2048, 0)
 *       of Line(#S1(1024,0)--#B1(3584,0)) and Line(#S3(2048,-1036)--#S3(2048,1036)).
 *       Enforces exact vertical tangent at Y=0 (dX/dY = 0) so mirroring across Y=0 is 100% smooth!
 * - P2: #S3 (2048, 1036)
 * - P3: #S4 (1788, 2300)
 * - P4: #S7 (940, 3308)
 * - P5: #S9 (0, 4240)
 *
 * Uses a convex tangent-triangle Cubic Bézier solver (s_k < D_k < s_{k+1}) so that on every segment,
 * both the coordinates AND the slope dX/dY change strictly monotonically with zero inflection points.
 */
export function solveMonotoneFivePointSpline(layer) {
  const midExpand = Number(layer.midXExpand ?? 112);
  const tension = Math.max(0.15, Math.min(0.95, Number(layer.tension ?? 0.55)));
  const endMode = layer.endSlopeMode || 'natural_pointed'; // 'natural_pointed' | 'flat_x0'

  const pts = [
    [Math.max(2049, 2048 + midExpand), 0.0],
    [Number(layer.p2x ?? 2048), Number(layer.p2y ?? 1036)],
    [Number(layer.p3x ?? 1788), Number(layer.p3y ?? 2300)],
    [Number(layer.p4x ?? 940), Number(layer.p4y ?? 3308)],
    [Number(layer.p5x ?? 0), Number(layer.p5y ?? 4240)]
  ];

  const n = pts.length - 1; // 4 segments
  const D = [];
  for (let k = 0; k < n; k++) {
    const dx = pts[k + 1][0] - pts[k][0];
    const dy = Math.max(1.0, pts[k + 1][1] - pts[k][1]);
    D.push(Math.max(1e-4, -dx / dy)); // Positive secant slope s = -dX/dY
  }

  // Node slopes s[0..n] = -dX/dY at each node:
  // s[0] = 0.0 (exact vertical tangent at Y = 0 midfield line!)
  const s = new Array(n + 1).fill(0);
  s[0] = 0.0;

  for (let k = 1; k < n; k++) {
    if (D[k - 1] < D[k]) {
      // Strictly increasing secant slopes -> pick balanced slope strictly inside (D[k-1], D[k])
      // Ideal quadratic midpoint condition is s[k] = 2*D[k-1] - s[k-1], clamped strictly inside (D[k-1], D[k])
      const ideal = 2 * D[k - 1] - s[k - 1];
      const lo = D[k - 1] + 0.18 * (D[k] - D[k - 1]);
      const hi = D[k - 1] + 0.82 * (D[k] - D[k - 1]);
      s[k] = Math.max(lo, Math.min(hi, ideal));
    } else {
      // Fallback if user pushed midXExpand beyond collinear limit (> 213.1 UU): Fritsch-Carlson harmonic mean
      s[k] = (2 * D[k - 1] * D[k]) / (D[k - 1] + D[k]);
    }
  }

  if (endMode === 'flat_x0') {
    s[n] = Math.max(D[n - 1] * 3.5, 4.0);
  } else {
    s[n] = D[n - 1] + 0.65 * Math.max(0.05, D[n - 1] - s[n - 1]);
  }

  const bezierSegments = [];
  const sampledPoints = [];

  for (let k = 0; k < n; k++) {
    const [xA, yA] = pts[k];
    const [xB, yB] = pts[k + 1];
    const sk = s[k];
    const sk1 = s[k + 1];
    const chord = Math.hypot(xB - xA, yB - yA);

    // Unit tangent vectors at A (pointing toward B) and at B (pointing from A)
    const uAx = -sk / Math.hypot(sk, 1);
    const uAy = 1 / Math.hypot(sk, 1);
    const uBx = -sk1 / Math.hypot(sk1, 1);
    const uBy = 1 / Math.hypot(sk1, 1);

    let L1 = tension * chord * 0.55;
    let L2 = tension * chord * 0.55;

    // If sk < D[k] < sk1, clamp handle lengths inside the tangent intersection triangle Q_k so inflection is impossible!
    const denom = sk1 - sk;
    if (denom > 1e-5 && sk <= D[k] && D[k] <= sk1) {
      const yQ = (xB - xA + sk1 * yB - sk * yA) / denom;
      const xQ = xA - sk * (yQ - yA);
      const distAQ = Math.hypot(xQ - xA, yQ - yA);
      const distBQ = Math.hypot(xB - xQ, yB - yQ);
      L1 = Math.min(L1, distAQ * 0.88);
      L2 = Math.min(L2, distBQ * 0.88);
    }

    const c1x = xA + L1 * uAx;
    const c1y = yA + L1 * uAy;
    const c2x = xB - L2 * uBx;
    const c2y = yB - L2 * uBy;

    bezierSegments.push({ xA, yA, c1x, c1y, c2x, c2y, xB, yB });

    const steps = 36;
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
