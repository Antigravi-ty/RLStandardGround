/**
 * Default Parametric Project State for RLStandardGround Studio.
 * All spatial dimensions are in 1:1 Unreal Units (UU).
 * Grayscale values are in 0..255 (0 = pure black ground base, 255 = pure white line).
 */

export const DEFAULT_PROJECT = {
  version: '1.0.0',
  name: 'Standard Soccar Ground v1',
  canvasScope: 'pitch_and_goal', // 'pitch_only' (4096x5120 Q1) | 'pitch_and_goal' (4096x6000 Q1) | 'driftwoods_uv' (3840x5755.61 Q1)
  backgroundGray: 0,

  shaderPreview: {
    enabled: false,
    groundColor: '#18441c',
    lineColor: '#e1e6eb',
    threshold: 0.13,
    smoothness: 0.05
  },

  referenceOverlays: {
    showGrid: true,
    showFlatFloorZ0: true,
    showOuterWall: true,
    showGoalBox: true,
    showBoostPads: true,
    showBoostPadLockBoxes: false, // Hidden by default so those square dashed boxes don't confuse!
    showSpawns: true,
    showHitboxPreset: 'octane', // 'octane' | 'dominus' | 'plank' | 'breakout' | 'hybrid' | 'merc' | 'all'
    customSvgContent: null,
    customSvgOpacity: 0.45,
    customSvgVisible: true
  },

  layers: [
    {
      id: 'layer_turf_stripes',
      name: '1. Alternating Turf Stripes (草坪深浅条纹)',
      type: 'turf_stripes',
      visible: true,
      orientation: 'horizontal', // 'horizontal' (along Y) | 'vertical' (along X)
      stripeSpan: 512,
      dutyCycle: 0.5,
      offset: 0,
      gray: 12,
      opacity: 1.0,
      clipToFlatFloor: true,
      insetFromFloor: 140,
      clipXMin: 0,
      clipXMax: 4096,
      clipYMin: 0,
      clipYMax: 4965
    },
    {
      id: 'layer_perimeter_border',
      name: '2. Pitch Perimeter Inset Line (场地内缩边线)',
      type: 'contour_offset',
      visible: true,
      baseContour: 'pitch_flat_floor', // 'pitch_flat_floor' (Z=0 pitch) | 'full_flat_floor' (Z=0 w/ goal) | 'outer_wall'
      insetDist: 140,
      strokeWidth: 40,
      gray: 255,
      fillGray: -1,
      opacity: 1.0,
      dashLength: 0,
      gapLength: 0,
      dashOffset: 0,
      lineCap: 'butt',
      lineJoin: 'round',
      clipXMin: 0,
      clipXMax: 4096,
      clipYMin: 0,
      clipYMax: 5120
    },
    {
      id: 'layer_center_line',
      name: '3. Halfway Line Y=0 (中场线)',
      type: 'rect_or_line',
      visible: true,
      subMode: 'hline_y0', // 'hline_y0' | 'vline_x0' | 'rect_box' | 'custom_segment'
      x1: 0,
      y1: 0,
      x2: 3700,
      y2: 0,
      strokeWidth: 40,
      gray: 255,
      fillGray: -1,
      cornerRadius: 0,
      opacity: 1.0,
      dashLength: 0,
      gapLength: 0,
      clipXMin: 0,
      clipXMax: 3700,
      clipYMin: 0,
      clipYMax: 6000
    },
    {
      id: 'layer_center_circle',
      name: '4. Center Circle R=1024 (中圈圆环)',
      type: 'circle_arc',
      visible: true,
      anchorId: 'center',
      cx: 0,
      cy: 0,
      radius: 1024,
      startDeg: 0,
      endDeg: 90,
      strokeWidth: 40,
      gray: 255,
      fillGray: -1,
      opacity: 1.0,
      dashLength: 0,
      gapLength: 0,
      dashOffset: 0,
      lineCap: 'butt',
      clipXMin: 0,
      clipXMax: 4096,
      clipYMin: 0,
      clipYMax: 6000
    },
    {
      id: 'layer_center_spot',
      name: '5. Center Ball Ring R=160 (开球中心内环)',
      type: 'circle_arc',
      visible: true,
      anchorId: 'center',
      cx: 0,
      cy: 0,
      radius: 160,
      startDeg: 0,
      endDeg: 90,
      strokeWidth: 24,
      gray: 220,
      fillGray: 30,
      opacity: 1.0,
      dashLength: 45,
      gapLength: 25,
      dashOffset: 0,
      lineCap: 'butt',
      clipXMin: 0,
      clipXMax: 4096,
      clipYMin: 0,
      clipYMax: 6000
    },
    {
      id: 'layer_penalty_box',
      name: '6. Penalty Box (大禁区矩形框)',
      type: 'rect_or_line',
      visible: true,
      subMode: 'rect_box',
      x1: 0,
      y1: 3584,
      x2: 1920,
      y2: 4965,
      strokeWidth: 36,
      gray: 255,
      fillGray: -1,
      cornerRadius: 0,
      opacity: 1.0,
      dashLength: 0,
      gapLength: 0,
      clipXMin: 0,
      clipXMax: 4096,
      clipYMin: 0,
      clipYMax: 4965
    },
    {
      id: 'layer_goal_area_box',
      name: '7. Goal Box (小禁区框)',
      type: 'rect_or_line',
      visible: true,
      subMode: 'rect_box',
      x1: 0,
      y1: 4352,
      x2: 1100,
      y2: 4965,
      strokeWidth: 32,
      gray: 255,
      fillGray: -1,
      cornerRadius: 0,
      opacity: 1.0,
      dashLength: 0,
      gapLength: 0,
      clipXMin: 0,
      clipXMax: 4096,
      clipYMin: 0,
      clipYMax: 4965
    },
    {
      id: 'layer_penalty_arc_3pt',
      name: '8. Penalty D-Arc (三点定圆弧 - 禁区弧顶)',
      type: 'three_point_arc',
      visible: true,
      x1: 0,
      y1: 3150,
      x2: 520,
      y2: 3310,
      x3: 750,
      y3: 3584,
      fullCircle: false,
      strokeWidth: 36,
      gray: 255,
      opacity: 1.0,
      dashLength: 0,
      gapLength: 0,
      lineCap: 'butt',
      clipXMin: 0,
      clipXMax: 4096,
      clipYMin: 0,
      clipYMax: 3584
    },
    {
      id: 'layer_big_boost_rings',
      name: '9. Big Boost Pad Rings (大氮气垫地面标识)',
      type: 'boost_pad_group',
      visible: true,
      targetPads: 'big', // 'big' | 'small' | 'both'
      radius: 110,
      strokeWidth: 20,
      gray: 230,
      fillGray: 40,
      outerDashRadius: 208,
      outerDashWidth: 10,
      outerDashLength: 40,
      outerGapLength: 32,
      outerDashGray: 160,
      opacity: 1.0,
      clipXMin: 0,
      clipXMax: 4096,
      clipYMin: 0,
      clipYMax: 6000
    },
    {
      id: 'layer_small_boost_rings',
      name: '10. Small Boost Pad Rings (小氮气垫地面标识)',
      type: 'boost_pad_group',
      visible: true,
      targetPads: 'small',
      radius: 68,
      strokeWidth: 14,
      gray: 210,
      fillGray: 32,
      outerDashRadius: 144,
      outerDashWidth: 0,
      outerDashLength: 30,
      outerGapLength: 24,
      outerDashGray: 140,
      opacity: 1.0,
      clipXMin: 0,
      clipXMax: 4096,
      clipYMin: 0,
      clipYMax: 6000
    }
  ]
};

export function createNewLayerTemplate(type, index = 1) {
  const id = `layer_${type}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const baseClip = {
    opacity: 1.0,
    clipXMin: 0,
    clipXMax: 4096,
    clipYMin: 0,
    clipYMax: 6000
  };

  switch (type) {
    case 'contour_offset':
      return {
        id,
        name: `${index}. Inset Boundary Line (内缩场地线)`,
        type: 'contour_offset',
        visible: true,
        baseContour: 'pitch_flat_floor',
        insetDist: 200,
        strokeWidth: 32,
        gray: 255,
        fillGray: -1,
        dashLength: 80,
        gapLength: 50,
        dashOffset: 0,
        lineCap: 'butt',
        lineJoin: 'round',
        ...baseClip
      };
    case 'circle_arc':
      return {
        id,
        name: `${index}. Circle / Polar Arc (定点外扩圆/圆弧)`,
        type: 'circle_arc',
        visible: true,
        anchorId: 'center',
        cx: 0,
        cy: 0,
        radius: 600,
        startDeg: 0,
        endDeg: 90,
        strokeWidth: 30,
        gray: 255,
        fillGray: -1,
        dashLength: 0,
        gapLength: 0,
        dashOffset: 0,
        lineCap: 'butt',
        ...baseClip
      };
    case 'three_point_arc':
      return {
        id,
        name: `${index}. 3-Point Arc (三点确定圆弧)`,
        type: 'three_point_arc',
        visible: true,
        x1: 200,
        y1: 2500,
        x2: 800,
        y2: 2700,
        x3: 1200,
        y3: 3200,
        fullCircle: false,
        strokeWidth: 30,
        gray: 255,
        dashLength: 0,
        gapLength: 0,
        lineCap: 'round',
        ...baseClip
      };
    case 'rect_or_line':
      return {
        id,
        name: `${index}. Box / Line (矩形框/直线段)`,
        type: 'rect_or_line',
        visible: true,
        subMode: 'rect_box',
        x1: 0,
        y1: 2000,
        x2: 1500,
        y2: 3500,
        strokeWidth: 30,
        gray: 255,
        fillGray: -1,
        cornerRadius: 0,
        dashLength: 0,
        gapLength: 0,
        ...baseClip
      };
    case 'boost_pad_group':
      return {
        id,
        name: `${index}. Boost Pad Markers (氮气垫批量环)`,
        type: 'boost_pad_group',
        visible: true,
        targetPads: 'both',
        radius: 90,
        strokeWidth: 16,
        gray: 240,
        fillGray: -1,
        outerDashRadius: 144,
        outerDashWidth: 8,
        outerDashLength: 32,
        outerGapLength: 24,
        outerDashGray: 160,
        ...baseClip
      };
    case 'spawn_marker_group':
      return {
        id,
        name: `${index}. Spawn / Demo Slot Markers (出生/复活点标记)`,
        type: 'spawn_marker_group',
        visible: true,
        targetSpawns: 'both', // 'kickoff' | 'demo' | 'both'
        shape: 'hitbox_outline', // 'hitbox_outline' | 'circle' | 'crosshair'
        hitboxPreset: 'octane',
        expandMargin: 16,
        strokeWidth: 16,
        gray: 220,
        fillGray: -1,
        dashLength: 30,
        gapLength: 20,
        ...baseClip
      };
    case 'turf_stripes':
    default:
      return {
        id,
        name: `${index}. Turf Stripes (草坪条纹层)`,
        type: 'turf_stripes',
        visible: true,
        orientation: 'horizontal',
        stripeSpan: 512,
        dutyCycle: 0.5,
        offset: 0,
        gray: 18,
        clipToFlatFloor: true,
        insetFromFloor: 140,
        ...baseClip
      };
  }
}
