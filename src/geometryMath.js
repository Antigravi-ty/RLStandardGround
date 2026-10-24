/**
 * Geometric Solvers for RLStandardGround Studio:
 * - Polyline inward/outward normal offset (miter-clamped inset/outset)
 * - 3-Point Circle / Circular Arc exact solver (Circumcircle + Sweep angle)
 * - 5-Point Monotone-Slope Oval Spline solver (with 4-Pad Intersection + Midfield C1 vertical tangent)
 * - Triangle Cone / Boost Collection Effective Zone solver (#KO1 -> #B2 with Dash Safe Area & Pad Safe Area)
 * - 1D Centerline Normal Clipper for Dashed & Solid Lines/Arcs/Splines (eliminates oblique Clip Box bevels)
 * - Magnetic Anchor Snapping & Nearest Layer Hit-Testing
 */

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
  Q1_DEMO_RESPAWNS
} from './physicsData.js';

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
      effA1: 0,
      effSweep: 2 * Math.PI,
      dir: 1,
      goesPositive: true,
      startDeg: 0,
      endDeg: 360,
      sweepDeg: 360,
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
  const sweepAngle = goesPositive ? ccw13 : (2 * Math.PI - ccw13);
  const dir = goesPositive ? 1 : -1;

  const tStartAngle = r > 1e-3 ? Math.max(0, Number(trimStart) || 0) / r : 0;
  const tEndAngle = r > 1e-3 ? Math.max(0, Number(trimEnd) || 0) / r : 0;

  if (tStartAngle + tEndAngle >= sweepAngle - 1e-4) {
    return { collinear: false, cx, cy, r, effA1: a1, effSweep: 0, dir, goesPositive, d: '' };
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
  return {
    collinear: false,
    cx,
    cy,
    r,
    effA1,
    effSweep,
    dir,
    goesPositive,
    startDeg: (effA1 * 180) / Math.PI,
    endDeg: (effA3 * 180) / Math.PI,
    sweepDeg: (effSweep * 180) / Math.PI,
    d
  };
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
 */
export function solveMonotoneFivePointSpline(layer) {
  const midExpand = Number(layer.midXExpand ?? 112);
  const tension = Math.max(0.15, Math.min(0.95, Number(layer.tension ?? 0.55)));
  const endMode = layer.endSlopeMode || 'natural_pointed';

  const pts = [
    [Math.max(2049, 2048 + midExpand), 0.0],
    [Number(layer.p2x ?? 2048), Number(layer.p2y ?? 1036)],
    [Number(layer.p3x ?? 1788), Number(layer.p3y ?? 2300)],
    [Number(layer.p4x ?? 940), Number(layer.p4y ?? 3308)],
    [Number(layer.p5x ?? 0), Number(layer.p5y ?? 4240)]
  ];

  const n = pts.length - 1;
  const D = [];
  for (let k = 0; k < n; k++) {
    const dx = pts[k + 1][0] - pts[k][0];
    const dy = Math.max(1.0, pts[k + 1][1] - pts[k][1]);
    D.push(Math.max(1e-4, -dx / dy));
  }

  const s = new Array(n + 1).fill(0);
  s[0] = 0.0;

  for (let k = 1; k < n; k++) {
    if (D[k - 1] < D[k]) {
      const ideal = 2 * D[k - 1] - s[k - 1];
      const lo = D[k - 1] + 0.18 * (D[k] - D[k - 1]);
      const hi = D[k - 1] + 0.82 * (D[k] - D[k - 1]);
      s[k] = Math.max(lo, Math.min(hi, ideal));
    } else {
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

    const uAx = -sk / Math.hypot(sk, 1);
    const uAy = 1 / Math.hypot(sk, 1);
    const uBx = -sk1 / Math.hypot(sk1, 1);
    const uBy = 1 / Math.hypot(sk1, 1);

    let L1 = tension * chord * 0.55;
    let L2 = tension * chord * 0.55;

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

    const steps = 48;
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
  const trimmedPoints = (tStart > 0.5 || tEnd > 0.5)
    ? trimPolylineByArcLength(sampledPoints, tStart, tEnd)
    : sampledPoints;

  let d = '';
  if (tStart > 0.5 || tEnd > 0.5) {
    d = trimmedPoints.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
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
    sampledPoints: trimmedPoints,
    d
  };
}

/**
 * Solves the Triangle Cone / Boost Collection Effective Zone (#KO1 -> #B2 or any P1 -> P2):
 * - Starts from apex P1(x1, y1) (with optional `apexSpread` half-width and `trimStart` axial offset)
 * - Expands to target pad P2(x2, y2) utilizing `targetRadius` (= `basePadRadius * radiusPercent / 100`)
 * - Supports `coneMode`: 'tangent' (exact tangent lines to the pad's radius circle) or 'chord' (perpendicular diameter endpoints)
 * - Computes left side segment, right side segment, base chord/arc, and closed polygon path.
 */
export function solveTriangleCone(layer) {
  const x1 = Number(layer.x1 ?? 2048);
  const y1 = Number(layer.y1 ?? 2560);
  const x2 = Number(layer.x2 ?? 3072);
  const y2 = Number(layer.y2 ?? 4096);

  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);

  if (dist < 1e-2) {
    return { valid: false, dist: 0 };
  }

  const ux = dx / dist;
  const uy = dy / dist;
  const nx = -uy;
  const ny = ux;

  const basePadR = Math.max(1, Number(layer.basePadRadius ?? 208));
  const pct = Math.max(1, Number(layer.radiusPercent ?? 100));
  const targetR = Math.max(2, Number(layer.targetRadius ?? ((basePadR * pct) / 100)));
  const apexSpread = Math.max(0, Number(layer.apexSpread ?? 0));
  const coneMode = layer.coneMode || 'tangent';

  const deltaR = targetR - apexSpread;
  let sinAlpha = 0;
  let cosAlpha = 1;
  let tanAlpha = 0;
  let sBase = dist;
  let wBase = targetR;

  if (coneMode === 'tangent' && Math.abs(deltaR) < dist * 0.98) {
    sinAlpha = deltaR / dist;
    cosAlpha = Math.sqrt(Math.max(1e-6, 1 - sinAlpha * sinAlpha));
    tanAlpha = sinAlpha / cosAlpha;
    sBase = dist - targetR * sinAlpha;
    wBase = targetR * cosAlpha;
  } else {
    tanAlpha = deltaR / dist;
    sinAlpha = tanAlpha / Math.hypot(1, tanAlpha);
    cosAlpha = 1 / Math.hypot(1, tanAlpha);
    sBase = dist;
    wBase = targetR;
  }

  const tStart = Math.max(0, Number(layer.trimStart) || 0);
  const tEnd = Math.max(0, Number(layer.trimEnd) || 0);
  const sMin = Math.min(sBase, tStart);
  const sMax = Math.max(sMin, sBase - tEnd);

  const widthAtAxial = (s) => Math.max(0, apexSpread + s * tanAlpha);

  const wMin = widthAtAxial(sMin);
  const wMax = widthAtAxial(sMax);

  const startCenterX = x1 + ux * sMin;
  const startCenterY = y1 + uy * sMin;
  const endCenterX = x1 + ux * sMax;
  const endCenterY = y1 + uy * sMax;

  // Left and Right vertices at sMin (near #KO1) and sMax (near #B2)
  const leftStart = [startCenterX + nx * wMin, startCenterY + ny * wMin];
  const rightStart = [startCenterX - nx * wMin, startCenterY - ny * wMin];
  const leftEnd = [endCenterX + nx * wMax, endCenterY + ny * wMax];
  const rightEnd = [endCenterX - nx * wMax, endCenterY - ny * wMax];

  // Unclipped full side rays from s=0 to s=sBase (for reference/polygon)
  const apexLeft = [x1 + nx * apexSpread, y1 + ny * apexSpread];
  const apexRight = [x1 - nx * apexSpread, y1 - ny * apexSpread];
  const baseLeft = [x1 + ux * sBase + nx * wBase, y1 + uy * sBase + ny * wBase];
  const baseRight = [x1 + ux * sBase - nx * wBase, y1 + uy * sBase - ny * wBase];

  // Closed polygon path for filled effective zone (from sMin to sMax, or around target circle)
  const fillPolygonD = [
    `M ${leftStart[0].toFixed(2)},${leftStart[1].toFixed(2)}`,
    `L ${leftEnd[0].toFixed(2)},${leftEnd[1].toFixed(2)}`,
    `L ${rightEnd[0].toFixed(2)},${rightEnd[1].toFixed(2)}`,
    `L ${rightStart[0].toFixed(2)},${rightStart[1].toFixed(2)}`,
    'Z'
  ].join(' ');

  return {
    valid: sMax > sMin + 0.5,
    x1,
    y1,
    x2,
    y2,
    dist,
    ux,
    uy,
    nx,
    ny,
    basePadR,
    targetR,
    apexSpread,
    halfAngleDeg: (Math.atan(tanAlpha) * 180) / Math.PI,
    tanAlpha,
    sinAlpha,
    cosAlpha,
    sBase,
    wBase,
    sMin,
    sMax,
    wMin,
    wMax,
    leftStart,
    rightStart,
    leftEnd,
    rightEnd,
    apexLeft,
    apexRight,
    baseLeft,
    baseRight,
    fillPolygonD
  };
}

/**
 * Computes whether a point (px, py) is inside the Center Dashed Line Safe Area of a triangle_cone
 * (or a general dashed segment from (x1, y1) to (x2, y2)).
 * Returns true if the point is SAFE (i.e. OUTSIDE the forbidden dash buffer zone),
 * or false if the point is INSIDE the forbidden dash buffer zone and should be clipped out.
 */
export function isOutsideCenterDashSafeZone(px, py, layer, extraStrokeClearance = 0) {
  if (!layer.cutByCenterDashSafeArea || layer.dashSafeMode === 'none') return true;

  const x1 = Number(layer.x1 ?? 2048);
  const y1 = Number(layer.y1 ?? 2560);
  const x2 = Number(layer.x2 ?? 3072);
  const y2 = Number(layer.y2 ?? 4096);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-2) return true;

  const ux = dx / dist;
  const uy = dy / dist;
  const nx = -uy;
  const ny = ux;

  // Axial coordinate s along P1 -> P2 and lateral distance lat from centerline
  const rx = px - x1;
  const ry = py - y1;
  const s = rx * ux + ry * uy;
  const lat = Math.abs(rx * nx + ry * ny);

  const centerSw = Math.max(0, Number(layer.centerDashStrokeWidth ?? 30));
  const safeExpand = Math.max(0, Number(layer.dashSafeExpand ?? 22));
  const halfSafeWidth = centerSw * 0.5 + safeExpand + extraStrokeClearance;

  if (lat >= halfSafeWidth) return true;

  const mode = layer.dashSafeMode || 'corridor';
  if (mode === 'corridor') {
    return false;
  }

  // Per-dash safe area ('per_dash_box' or 'per_dash_pill'):
  const trimS = Math.max(0, Number(layer.centerDashTrimStart ?? 85));
  const dLen = Math.max(1, Number(layer.centerDashLength ?? 110));
  const gLen = Math.max(1, Number(layer.centerGapLength ?? 120));
  const dOff = Number(layer.centerDashOffset ?? -30);
  const period = dLen + gLen;

  // Distance along trimmed dashed line
  const dCoord = s - trimS;
  if (dCoord < -safeExpand || dCoord > dist - trimS + safeExpand) return true;

  const kApprox = Math.floor((dCoord + dOff) / period);
  for (let k = kApprox - 1; k <= kApprox + 1; k++) {
    const dashStart = k * period - dOff;
    const dashEnd = dashStart + dLen;
    if (dashEnd < 0 || dashStart > dist - trimS) continue;

    if (mode === 'per_dash_pill') {
      // Capsule / pill around [dashStart, dashEnd] with radius halfSafeWidth
      const clampedD = Math.max(dashStart, Math.min(dashEnd, dCoord));
      const distToDash = Math.hypot(dCoord - clampedD, lat);
      if (distToDash < halfSafeWidth) return false;
    } else {
      // Rectangular box around [dashStart - safeExpand, dashEnd + safeExpand] x [-halfSafeWidth, +halfSafeWidth]
      if (dCoord >= dashStart - safeExpand - extraStrokeClearance && dCoord <= dashEnd + safeExpand + extraStrokeClearance) {
        return false;
      }
    }
  }

  return true;
}

/**
 * 1D Centerline Normal Clipper for Lines, Circular Arcs, Splines, and Triangle Edges:
 * Clips a parametric 1D curve `{ totalLen, pointAt(s), subPathD(s0, s1) }` against:
 * 1. Interior Clip Box boundaries (`clipXMin > 0`, `clipXMax < scopeW`, `clipYMin > 0`, `clipYMax < scopeH`)
 * 2. Small Boost Pad Safe Area circles (`R = 144 + smallPadSafeExpand`)
 * 3. Big Boost Pad Safe Area circles (`R = 208 + bigPadSafeExpand`)
 * 4. Optional `extraPointFilter(x, y, s)` (e.g. Target Pad Safe Area & Center Dash Safe Area)
 *
 * For dashed curves (`dashLength > 0 && gapLength > 0`), computes each dash interval `[d0, d1]`
 * along the original unclipped arc length `s` and intersects with valid intervals `[sA, sB]`.
 * Every visible dash/segment is emitted via `subPathD(u0, u1)` with `stroke-linecap="butt"`,
 * ensuring every cut edge is 100% perpendicular (normal) to the curve direction!
 */
export function buildNormalClippedSubPaths(curveDef, layer, project, scopeW = 4096, scopeH = 6000, extraPointFilter = null) {
  const L = curveDef?.totalLen || 0;
  if (L <= 0.5) return [];

  const cxMin = Number(layer.clipXMin ?? 0);
  const cxMax = Number(layer.clipXMax ?? scopeW);
  const cyMin = Number(layer.clipYMin ?? 0);
  const cyMax = Number(layer.clipYMax ?? scopeH);

  const cutSmall = Boolean(layer.cutBySmallPadSafeArea);
  const cutBig = Boolean(layer.cutByBigPadSafeArea);
  const smallSafeR = ARENA_CONSTANTS.PAD_CYL_RAD_SMALL + Math.max(0, Number(project?.smallPadSafeExpand ?? 60));
  const bigSafeR = ARENA_CONSTANTS.PAD_CYL_RAD_BIG + Math.max(0, Number(project?.bigPadSafeExpand ?? 0));

  const isValidAt = (s) => {
    const [x, y] = curveDef.pointAt(s);
    // Only clip at interior Clip Box boundaries (> 0 and < scopeW/H).
    // At X=0 (when cxMin<=0) and Y=0 (when cyMin<=0), allow the curve to reach the mirror axis
    // so the outer Q1 clipPath makes a flush 4-quadrant mirror joint!
    if (cxMin > 0.5 && x < cxMin) return false;
    if (cxMax < scopeW - 0.5 && x > cxMax) return false;
    if (cyMin > 0.5 && y < cyMin) return false;
    if (cyMax < scopeH - 0.5 && y > cyMax) return false;

    if (cutSmall) {
      for (let i = 0; i < Q1_BOOST_PADS_SMALL.length; i++) {
        const p = Q1_BOOST_PADS_SMALL[i];
        if (Math.hypot(x - p.x, y - p.y) < smallSafeR) return false;
      }
    }
    if (cutBig) {
      for (let i = 0; i < Q1_BOOST_PADS_BIG.length; i++) {
        const p = Q1_BOOST_PADS_BIG[i];
        if (Math.hypot(x - p.x, y - p.y) < bigSafeR) return false;
      }
    }
    if (extraPointFilter && !extraPointFilter(x, y, s)) {
      return false;
    }
    return true;
  };

  // Sample along s in [0, L] with step ~2 UU and refine transitions via bisection
  const numSteps = Math.max(32, Math.min(2500, Math.ceil(L / 2.0)));
  const step = L / numSteps;

  const refineBoundary = (sIn, sOut) => {
    let a = sIn;
    let b = sOut;
    for (let iter = 0; iter < 8; iter++) {
      const mid = 0.5 * (a + b);
      if (isValidAt(mid)) {
        a = mid;
      } else {
        b = mid;
      }
    }
    return 0.5 * (a + b);
  };

  const validIntervals = [];
  let inValid = isValidAt(0);
  let curStart = inValid ? 0 : null;

  for (let i = 1; i <= numSteps; i++) {
    const s = i === numSteps ? L : i * step;
    const v = isValidAt(s);
    if (!inValid && v) {
      curStart = refineBoundary(s, s - step);
      inValid = true;
    } else if (inValid && !v) {
      const curEnd = refineBoundary(s - step, s);
      if (curEnd - curStart > 0.5) {
        validIntervals.push([curStart, curEnd]);
      }
      curStart = null;
      inValid = false;
    }
  }
  if (inValid && curStart !== null && L - curStart > 0.5) {
    validIntervals.push([curStart, L]);
  }

  if (validIntervals.length === 0) return [];

  const dashLen = Number(layer.dashLength) || 0;
  const gapLen = Number(layer.gapLength) || 0;
  const dashOffset = Number(layer.dashOffset) || 0;
  const dashClipMode = layer.dashClipMode || 'normal_path';

  const outPaths = [];

  if (dashLen > 0 && gapLen > 0) {
    const period = dashLen + gapLen;
    const kMin = Math.floor((-dashOffset - dashLen) / period) - 1;
    const kMax = Math.ceil((L + Math.abs(dashOffset)) / period) + 1;

    for (let k = kMin; k <= kMax; k++) {
      const d0 = k * period - dashOffset;
      const d1 = d0 + dashLen;
      if (d1 <= 0 || d0 >= L) continue;

      for (let m = 0; m < validIntervals.length; m++) {
        const [sA, sB] = validIntervals[m];
        const u0 = Math.max(0, d0, sA);
        const u1 = Math.min(L, d1, sB);
        const segLen = u1 - u0;
        if (segLen <= 0.5) continue;

        // In 'whole_dash' mode, omit any partial dash that was chopped shorter than dashLen
        if (dashClipMode === 'whole_dash' && dashLen < L && segLen < dashLen - 1.5) {
          continue;
        }

        const dStr = curveDef.subPathD(u0, u1);
        if (dStr) outPaths.push(dStr);
      }
    }
  } else {
    for (let m = 0; m < validIntervals.length; m++) {
      const [sA, sB] = validIntervals[m];
      if (sB - sA > 0.5) {
        const dStr = curveDef.subPathD(sA, sB);
        if (dStr) outPaths.push(dStr);
      }
    }
  }

  return outPaths;
}

/**
 * Helper to create a 1D curve definition for a straight line segment (x1, y1) -> (x2, y2).
 */
export function makeLineCurveDef(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const totalLen = Math.hypot(dx, dy);
  const pointAt = (s) => {
    const t = totalLen > 1e-5 ? Math.max(0, Math.min(1, s / totalLen)) : 0;
    return [x1 + dx * t, y1 + dy * t];
  };
  const subPathD = (s0, s1) => {
    if (s1 - s0 <= 0.2) return '';
    const [ax, ay] = pointAt(s0);
    const [bx, by] = pointAt(s1);
    return `M ${ax.toFixed(2)},${ay.toFixed(2)} L ${bx.toFixed(2)},${by.toFixed(2)}`;
  };
  return { totalLen, pointAt, subPathD };
}

/**
 * Helper to create a 1D curve definition for a circular arc.
 */
export function makeCircularArcCurveDef(cx, cy, r, startAngleRad, sweepAngleRad, dir) {
  const totalLen = Math.max(0, r * sweepAngleRad);
  const pointAt = (s) => {
    const ang = startAngleRad + dir * (r > 1e-4 ? s / r : 0);
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  };
  const subPathD = (s0, s1) => {
    const ds = s1 - s0;
    if (ds <= 0.2 || r <= 1e-3) return '';
    const subSweep = ds / r;
    if (subSweep >= 2 * Math.PI - 1e-3) {
      return `M ${(cx - r).toFixed(2)},${cy.toFixed(2)} a ${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(r * 2).toFixed(2)},0 a ${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(-r * 2).toFixed(2)},0`;
    }
    const a0 = startAngleRad + dir * (s0 / r);
    const a1 = startAngleRad + dir * (s1 / r);
    const sx = cx + r * Math.cos(a0);
    const sy = cy + r * Math.sin(a0);
    const ex = cx + r * Math.cos(a1);
    const ey = cy + r * Math.sin(a1);
    const largeArc = subSweep > Math.PI ? 1 : 0;
    const sweepFlag = dir > 0 ? 1 : 0;
    return `M ${sx.toFixed(2)},${sy.toFixed(2)} A ${r.toFixed(2)},${r.toFixed(2)} 0 ${largeArc},${sweepFlag} ${ex.toFixed(2)},${ey.toFixed(2)}`;
  };
  return { totalLen, pointAt, subPathD };
}

/**
 * Helper to create a 1D curve definition for a sampled polyline.
 */
export function makePolylineCurveDef(pts) {
  if (!pts || pts.length < 2) {
    return { totalLen: 0, pointAt: () => [0, 0], subPathD: () => '' };
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const totalLen = cum[cum.length - 1];

  const pointAt = (s) => {
    if (s <= 0) return pts[0];
    if (s >= totalLen) return pts[pts.length - 1];
    let lo = 0;
    let hi = cum.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    const segLen = cum[lo + 1] - cum[lo];
    const t = segLen > 1e-5 ? (s - cum[lo]) / segLen : 0;
    return [
      pts[lo][0] + t * (pts[lo + 1][0] - pts[lo][0]),
      pts[lo][1] + t * (pts[lo + 1][1] - pts[lo][1])
    ];
  };

  const subPathD = (s0, s1) => {
    if (s1 - s0 <= 0.2) return '';
    const subPts = trimPolylineByArcLength(pts, s0, totalLen - s1);
    if (!subPts || subPts.length < 2) return '';
    return subPts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  };

  return { totalLen, pointAt, subPathD };
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

  if (layer.type === 'triangle_cone') {
    const cone = solveTriangleCone(layer);
    if (!cone.valid) return Infinity;
    const dLeft = distToSegment(px, py, cone.leftStart[0], cone.leftStart[1], cone.leftEnd[0], cone.leftEnd[1]);
    const dRight = distToSegment(px, py, cone.rightStart[0], cone.rightStart[1], cone.rightEnd[0], cone.rightEnd[1]);
    const dBase = distToSegment(px, py, cone.leftEnd[0], cone.leftEnd[1], cone.rightEnd[0], cone.rightEnd[1]);
    return Math.min(dLeft, dRight, layer.renderStyle === 'stroked_sides' ? Infinity : dBase);
  }

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
    let base = Q1_FLAT_FLOOR_CONTOUR;
    if (layer.baseContour === 'driftwoods_ground_mesh') base = Q1_DRIFTWOODS_GROUND_MESH_CONTOUR;
    else if (layer.baseContour === 'driftwoods_pitch_mesh') base = Q1_DRIFTWOODS_PITCH_MESH_CONTOUR;
    else if (layer.baseContour === 'pitch_flat_floor') base = Q1_PITCH_FLAT_FLOOR_CONTOUR;
    else if (layer.baseContour === 'outer_wall') base = Q1_OUTER_WALL_CONTOUR;
    else if (layer.baseContour === 'pitch_outer_wall') base = Q1_PITCH_OUTER_WALL_CONTOUR;
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

/**
 * Resolves the effective grayscale value (0..255) and CSS color for a given layer or background level
 * using the Multi-Level Grayscale & Color Palette (Level 0 = Ground Base, Levels 1..N = Active Line Tiers).
 */
export function resolveLayerGrayAndCss(layerOrLevel, opacity = 1.0, project = null, isShaderPreview = false) {
  const palette = project?.colorPalettePreview;
  const levels = Array.isArray(palette?.levels) ? palette.levels : null;
  const maxLvl = levels && levels.length > 1 ? levels.length - 1 : 7;
  const usePaletteColors = Boolean(palette?.enabled) && !isShaderPreview;

  let levelIdx = null;
  let rawGray = 255;

  if (typeof layerOrLevel === 'number') {
    levelIdx = layerOrLevel;
    const found = levels?.find(l => l.level === levelIdx);
    rawGray = found ? found.gray : (levelIdx === 0 ? (project?.backgroundGray ?? 0) : Math.round((levelIdx / maxLvl) * 255));
  } else if (layerOrLevel && typeof layerOrLevel === 'object') {
    if (layerOrLevel.grayLevel !== undefined && layerOrLevel.grayLevel !== null && layerOrLevel.grayLevel >= 0) {
      levelIdx = Math.min(maxLvl, Math.max(0, Number(layerOrLevel.grayLevel)));
      const found = levels?.find(l => l.level === levelIdx);
      rawGray = found ? Number(found.gray) : Number(layerOrLevel.gray ?? 255);
    } else {
      rawGray = Number(layerOrLevel.gray ?? 255);
      if (levels && levels.length > 0) {
        let bestL = levels[0];
        let bestD = Math.abs(rawGray - bestL.gray);
        for (const l of levels) {
          const d = Math.abs(rawGray - l.gray);
          if (d < bestD) {
            bestD = d;
            bestL = l;
          }
        }
        levelIdx = bestL.level;
      }
    }
  }

  if (usePaletteColors && levels && levelIdx !== null) {
    const found = levels.find(l => l.level === levelIdx);
    if (found && found.color) {
      const rgb = hexToRgb(found.color);
      return {
        gray: Math.max(0, Math.min(255, Math.round(rawGray))),
        css: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`,
        hex: found.color,
        level: levelIdx
      };
    }
  }

  const shaderSim = isShaderPreview ? { ...project?.shaderPreview, enabled: true } : null;
  return {
    gray: Math.max(0, Math.min(255, Math.round(rawGray))),
    css: grayToCss(rawGray, opacity, shaderSim),
    hex: null,
    level: levelIdx
  };
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
