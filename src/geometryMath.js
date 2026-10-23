/**
 * Geometric Solvers for RLStandardGround Studio:
 * - Polyline inward/outward normal offset (miter-clamped inset/outset)
 * - 3-Point Circle / Circular Arc exact solver (Circumcircle + Sweep angle)
 * - Grayscale to Hex / Shader Tint simulation
 */

/**
 * Offsets an ordered Q1 contour polyline inward (inset > 0) or outward (inset < 0).
 * Points are ordered from (+X, 0) counter-clockwise in Q1 toward (0, +Y).
 * Therefore the inward normal (pointing toward the origin (0,0)) for segment (dx, dy)
 * is (-dy, dx) normalized (wait: from (3840,0) to (3840,3390), dx=0, dy=+3390 -> inward is (-1, 0) = (-dy/L, dx/L)!).
 */
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
      // Moving from (+X, 0) toward (0, +Y): inward toward (0,0) is (-dy/len, dx/len)
      segNormals.push([-dy / len, dx / len]);
    }
  }

  const result = [];
  for (let i = 0; i < n; i++) {
    let nx, ny;
    if (i === 0) {
      // First point lies on Y = 0 symmetry axis -> constrain Y = 0, shift along normal
      nx = segNormals[0][0];
      ny = 0;
    } else if (i === n - 1) {
      // Last point lies on X = 0 symmetry axis -> constrain X = 0, shift along normal
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
 * Given 3 points P1(x1,y1), P2(x2,y2), P3(x3,y3), computes the exact circle passing through all 3,
 * and returns the SVG path `d` for the arc from P1 -> through P2 -> to P3 (or full circle).
 */
export function solveThreePointArc(x1, y1, x2, y2, x3, y3, fullCircle = false) {
  const A = x2 - x1;
  const B = y2 - y1;
  const C = x3 - x1;
  const D = y3 - y1;
  const E = A * (x1 + x2) + B * (y1 + y2);
  const F = C * (x1 + x3) + D * (y1 + y3);
  const G = 2.0 * (A * (y3 - y2) - B * (x3 - x2));

  if (Math.abs(G) < 1e-5) {
    // Collinear fallback -> straight polyline P1 -> P2 -> P3
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

  // Determine sweep flag and large-arc flag so arc goes from P1 through P2 to P3
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  const a2 = Math.atan2(y2 - cy, x2 - cx);
  const a3 = Math.atan2(y3 - cy, x3 - cx);

  const normAngle = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw12 = normAngle(a2 - a1);
  const ccw13 = normAngle(a3 - a1);

  // In SVG coordinate space (where +X is right, +Y is down), positive atan2 delta is clockwise on screen (sweepFlag = 1)
  const goesPositive = ccw12 <= ccw13;
  const sweepAngle = goesPositive ? ccw13 : (2 * Math.PI - ccw13);
  const largeArcFlag = sweepAngle > Math.PI ? 1 : 0;
  const sweepFlag = goesPositive ? 1 : 0;

  const d = `M ${x1.toFixed(2)},${y1.toFixed(2)} A ${r.toFixed(2)},${r.toFixed(2)} 0 ${largeArcFlag},${sweepFlag} ${x3.toFixed(2)},${y3.toFixed(2)}`;
  return { collinear: false, cx, cy, r, startDeg: (a1 * 180) / Math.PI, endDeg: (a3 * 180) / Math.PI, sweepDeg: (sweepAngle * 180) / Math.PI, d };
}

/**
 * Generates an SVG arc path from center (cx, cy), radius r, and startAngleDeg -> endAngleDeg.
 * Angle 0° = +X (Right), 90° = +Y (Down toward goal in Q1), 180° = -X, 270° = -Y.
 */
export function describePolarArc(cx, cy, r, startDeg, endDeg, closePie = false) {
  const span = Math.abs(endDeg - startDeg);
  if (span >= 359.99) {
    return `M ${(cx - r).toFixed(2)},${cy.toFixed(2)} a ${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(r * 2).toFixed(2)},0 a ${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(-r * 2).toFixed(2)},0`;
  }
  const sRad = (startDeg * Math.PI) / 180.0;
  const eRad = (endDeg * Math.PI) / 180.0;
  const x1 = cx + r * Math.cos(sRad);
  const y1 = cy + r * Math.sin(sRad);
  const x2 = cx + r * Math.cos(eRad);
  const y2 = cy + r * Math.sin(eRad);
  const largeArc = span > 180 ? 1 : 0;
  const sweep = endDeg >= startDeg ? 1 : 0;
  let d = `M ${x1.toFixed(2)},${y1.toFixed(2)} A ${r.toFixed(2)},${r.toFixed(2)} 0 ${largeArc},${sweep} ${x2.toFixed(2)},${y2.toFixed(2)}`;
  if (closePie) {
    d += ` L ${cx.toFixed(2)},${cy.toFixed(2)} Z`;
  }
  return d;
}

/**
 * Converts a 0..255 grayscale value into CSS hex or simulated shader color.
 * In DriftwoodsMaterialManager.js:
 *   float lineLum = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
 *   float isLine = smoothstep(uLineThreshold - halfWidth, uLineThreshold + halfWidth, lineLum);
 *   diffuseColor.rgb = mix(uGroundColor, uLineColor, isLine);
 */
export function grayToCss(grayVal, opacity = 1.0, shaderSim = null) {
  const g = Math.max(0, Math.min(255, Math.round(grayVal)));
  if (!shaderSim || !shaderSim.enabled) {
    return `rgba(${g}, ${g}, ${g}, ${opacity})`;
  }
  // Simulate smoothstep shader mixing between groundColor and lineColor
  const lum = g / 255.0;
  // Convert sRGB texel to linear approx if needed, or direct luminance
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
