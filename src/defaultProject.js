/**
 * Default Parametric Project State for RLStandardGround Studio.
 * Loaded directly from `/project.json` in the repository root so you can edit or replace
 * `project.json` directly without modifying any JavaScript code!
 */

import projectJson from '../project.json';

export const DEFAULT_GRAY_PALETTE_LEVELS = (
  Array.isArray(projectJson?.colorPalettePreview?.levels) && projectJson.colorPalettePreview.levels.length >= 2
    ? projectJson.colorPalettePreview.levels.map(l => ({ ...l }))
    : [
        { level: 0, name: 'L0 地面空余基底 (Ground)', gray: 0, color: '#174000' },
        { level: 1, name: 'L1 场地外边界线 (Perimeter)', gray: 36, color: '#38bdf8' },
        { level: 2, name: 'L2 Boost Pad 判定内收环', gray: 73, color: '#ffffff' },
        { level: 3, name: 'L3 核心实线/主圆弧/斜向引导', gray: 109, color: '#ffffff' },
        { level: 4, name: 'L4 车辆生成点碰撞箱四角框', gray: 146, color: '#606060' },
        { level: 5, name: 'L5 内场衔接虚线弧 (33 + 14)', gray: 182, color: '#444444' },
        { level: 6, name: 'L6 外围长距三点圆弧 & 后场虚线', gray: 219, color: '#f87171' },
        { level: 7, name: 'L7 开球氮气收集三角有效区 (#KO1→#B2)', gray: 255, color: '#fbbf24' }
      ]
);

export const DEFAULT_PROJECT = JSON.parse(JSON.stringify(projectJson));

export function createNewLayerTemplate(type, index = 1) {
  const id = `layer_${type}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const maxActiveLevel = DEFAULT_GRAY_PALETTE_LEVELS.length - 1;
  const defaultLevel = ((index - 1) % maxActiveLevel) + 1;
  const levelInfo = DEFAULT_GRAY_PALETTE_LEVELS[defaultLevel] || DEFAULT_GRAY_PALETTE_LEVELS[maxActiveLevel];
  const baseClip = {
    grayLevel: defaultLevel,
    opacity: 1.0,
    trimStart: 0,
    trimEnd: 0,
    dashClipMode: 'normal_path',
    cutBySmallPadSafeArea: true,
    clipXMin: 0,
    clipXMax: 4096,
    clipYMin: 0,
    clipYMax: 6000
  };

  switch (type) {
    case 'triangle_cone':
      return {
        id,
        name: `${index}. 开球氮气收集三角有效区 (#KO1 → #B2)`,
        type: 'triangle_cone',
        visible: true,
        grayLevel: maxActiveLevel,
        gray: DEFAULT_GRAY_PALETTE_LEVELS[maxActiveLevel]?.gray ?? 255,
        fillGray: -1,
        fillGrayLevel: maxActiveLevel,
        renderStyle: 'stroked_sides', // 'stroked_sides' | 'stroked_closed' | 'stroked_arc' | 'filled_zone' | 'filled_and_stroked'
        anchor1: 'ko_diag',
        anchor2: 'pad_big_corner',
        x1: 2048,
        y1: 2560,
        x2: 3072,
        y2: 4096,
        basePadRadius: 208,
        radiusPercent: 100,
        targetRadius: 208,
        coneMode: 'tangent', // 'tangent' | 'chord'
        apexSpread: 0,
        trimStart: 85,
        trimEnd: 0,
        cutByTargetPad: true,
        targetPadSafeExpand: 32,
        cutByCenterDashSafeArea: true,
        dashSafeMode: 'corridor', // 'corridor' | 'per_dash_box' | 'per_dash_pill' | 'none'
        centerDashStrokeWidth: 30,
        dashSafeExpand: 22,
        centerDashLength: 110,
        centerGapLength: 120,
        centerDashOffset: -30,
        centerDashTrimStart: 85,
        strokeWidth: 24,
        dashLength: 0,
        gapLength: 0,
        dashOffset: 0,
        lineCap: 'butt',
        lineJoin: 'round',
        ...baseClip,
        grayLevel: maxActiveLevel
      };
    case 'monotone_pad_spline':
      return {
        id,
        name: `${index}. 五点斜率单调橄榄球曲线`,
        type: 'monotone_pad_spline',
        visible: true,
        midXExpand: 26,
        p2x: 2048,
        p2y: 1036,
        p3x: 1788,
        p3y: 2300,
        p4x: 940,
        p4y: 3308,
        p5x: 0,
        p5y: 4240,
        tension: 0.95,
        endSlopeMode: 'natural_pointed',
        strokeWidth: 18,
        gray: levelInfo.gray,
        fillGray: -1,
        dashLength: 100,
        gapLength: 120,
        dashOffset: 0,
        lineCap: 'butt',
        ...baseClip
      };
    case 'rect_or_line':
      return {
        id,
        name: `${index}. 锚点吸附直线/虚线 (支持首尾跳过)`,
        type: 'rect_or_line',
        visible: true,
        subMode: 'custom_segment',
        anchor1: 'ko_diag',
        anchor2: 'pad_big_corner',
        x1: 2048,
        y1: 2560,
        x2: 3072,
        y2: 4096,
        trimStart: 85,
        trimEnd: 240,
        strokeWidth: 20,
        gray: levelInfo.gray,
        fillGray: -1,
        cornerRadius: 0,
        dashLength: 110,
        gapLength: 120,
        dashOffset: -30,
        lineCap: 'butt',
        ...baseClip
      };
    case 'spawn_marker_group':
      return {
        id,
        name: `${index}. 车辆生成点全碰撞箱最小包围四角`,
        type: 'spawn_marker_group',
        visible: true,
        targetSpawns: 'both',
        shape: 'union_corners',
        hitboxPreset: 'octane',
        cornerLength: 28,
        expandMargin: 0,
        hugOuterEdge: true,
        strokeWidth: 8,
        gray: levelInfo.gray,
        fillGray: -1,
        dashLength: 0,
        gapLength: 0,
        lineCap: 'square',
        lineJoin: 'miter',
        ...baseClip,
        cutBySmallPadSafeArea: false
      };
    case 'contour_offset':
      return {
        id,
        name: `${index}. 场地边界内缩线`,
        type: 'contour_offset',
        visible: true,
        baseContour: 'driftwoods_ground_mesh',
        hugInnerEdge: true,
        insetDist: 0,
        strokeWidth: 20,
        gray: levelInfo.gray,
        fillGray: -1,
        dashLength: 0,
        gapLength: 0,
        dashOffset: 0,
        lineCap: 'butt',
        lineJoin: 'round',
        ...baseClip,
        cutBySmallPadSafeArea: false
      };
    case 'circle_arc':
      return {
        id,
        name: `${index}. 定点圆 / 圆弧 (支持首尾跳过 & SafeArea截断)`,
        type: 'circle_arc',
        visible: true,
        anchorId: 'center',
        cx: 0,
        cy: 0,
        radius: 1024,
        startDeg: 0,
        endDeg: 90,
        strokeWidth: 20,
        gray: levelInfo.gray,
        fillGray: -1,
        dashLength: 80,
        gapLength: 100,
        dashOffset: 0,
        lineCap: 'butt',
        ...baseClip
      };
    case 'three_point_arc':
      return {
        id,
        name: `${index}. 三点连线圆弧`,
        type: 'three_point_arc',
        visible: true,
        x1: 2048,
        y1: 1036,
        x2: 1788,
        y2: 2300,
        x3: 940,
        y3: 3308,
        fullCircle: false,
        strokeWidth: 20,
        gray: levelInfo.gray,
        dashLength: 0,
        gapLength: 0,
        lineCap: 'butt',
        ...baseClip
      };
    case 'boost_pad_group':
      return {
        id,
        name: `${index}. Boost Pad 判定圆向内收边线`,
        type: 'boost_pad_group',
        visible: true,
        targetPads: 'both',
        ringMode: 'inward_from_pickup',
        inwardWidth: 10,
        insetFromPickup: 0,
        radius: 134,
        strokeWidth: 20,
        gray: levelInfo.gray,
        fillGray: -1,
        outerDashRadius: 0,
        outerDashWidth: 0,
        outerDashLength: 32,
        outerGapLength: 24,
        outerDashGray: 160,
        ...baseClip,
        cutBySmallPadSafeArea: false
      };
    case 'turf_stripes':
    default:
      return {
        id,
        name: `${index}. 草坪深浅条纹层`,
        type: 'turf_stripes',
        visible: true,
        orientation: 'horizontal',
        stripeSpan: 512,
        dutyCycle: 0.5,
        offset: 0,
        gray: 36,
        clipToFlatFloor: true,
        insetFromFloor: 20,
        ...baseClip,
        grayLevel: 1,
        cutBySmallPadSafeArea: false
      };
  }
}
