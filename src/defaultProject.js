/**
 * Default Parametric Project State for RLStandardGround Studio.
 * All spatial dimensions are in 1:1 Unreal Units (UU).
 * Grayscale values are in 0..255 (0 = pure black ground base, 255 = pure white line).
 */

export const DEFAULT_PROJECT = {
  version: '2.0.0',
  name: 'Minimal Soccar Ground v2',
  canvasScope: 'pitch_and_goal', // 'pitch_only' (4096x5120 Q1) | 'pitch_and_goal' (4096x6000 Q1) | 'driftwoods_uv' (3840x5755.61 Q1)
  backgroundGray: 0,

  // Global Safe Area expansion around Small Boost Pads (pickup R = 144 UU; safe R = 144 + smallPadSafeExpand)
  smallPadSafeExpand: 60,
  bigPadSafeExpand: 0,

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
    showOuterWall: false,
    showGoalBox: true,
    showBoostPads: true,
    showSmallPadSafeArea: true,
    showBoostPadLockBoxes: false,
    showSpawns: false,
    showHitboxPreset: 'octane',
    customSvgContent: null,
    customSvgOpacity: 0.45,
    customSvgVisible: true
  },

  layers: [
    {
      id: 'layer_perimeter_border',
      name: '1. 紧贴绿虚线内缩边线 (Z=0 内侧)',
      type: 'contour_offset',
      visible: true,
      baseContour: 'full_flat_floor', // 'full_flat_floor' (Z=0 w/ goal) | 'pitch_flat_floor' (Z=0 pitch) | 'outer_wall'
      hugInnerEdge: true, // Automatically shifts center path inward by strokeWidth/2 so outer edge touches the Z=0 green dashed line
      insetDist: 0, // Extra inward offset beyond hugging the edge (0 = tight against green dashed line)
      strokeWidth: 20,
      gray: 255,
      fillGray: -1,
      opacity: 1.0,
      dashLength: 0,
      gapLength: 0,
      dashOffset: 0,
      lineCap: 'butt',
      lineJoin: 'round',
      cutBySmallPadSafeArea: false,
      clipXMin: 0,
      clipXMax: 4096,
      clipYMin: 0,
      clipYMax: 6000
    },
    {
      id: 'layer_all_boost_inward_20',
      name: '2. 所有 Boost Pad 判定圆内收 20UU',
      type: 'boost_pad_group',
      visible: true,
      targetPads: 'both', // 'big' (R=208 -> 188..208) | 'small' (R=144 -> 124..144) | 'both'
      ringMode: 'inward_from_pickup', // 'inward_from_pickup' | 'custom_radius'
      inwardWidth: 20, // Draws from (R_pickup - insetFromPickup - inwardWidth) to (R_pickup - insetFromPickup)
      insetFromPickup: 0, // 0 = outer edge of stroke is exact pickup circle
      radius: 134,
      strokeWidth: 20,
      gray: 255,
      fillGray: -1,
      outerDashRadius: 0,
      outerDashWidth: 0,
      outerDashLength: 30,
      outerGapLength: 24,
      outerDashGray: 160,
      opacity: 1.0,
      dashLength: 0,
      gapLength: 0,
      clipXMin: 0,
      clipXMax: 4096,
      clipYMin: 0,
      clipYMax: 6000
    },
    {
      id: 'layer_center_4pads_circle',
      name: '3. 中场四小垫连线圆 (R=1024, SafeArea截断)',
      type: 'circle_arc',
      visible: true,
      anchorId: 'center',
      cx: 0,
      cy: 0,
      radius: 1024,
      startDeg: 0,
      endDeg: 90,
      strokeWidth: 20,
      gray: 255,
      fillGray: -1,
      opacity: 1.0,
      dashLength: 0,
      gapLength: 0,
      dashOffset: 0,
      lineCap: 'butt',
      cutBySmallPadSafeArea: true,
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
    cutBySmallPadSafeArea: true,
    clipXMin: 0,
    clipXMax: 4096,
    clipYMin: 0,
    clipYMax: 6000
  };

  switch (type) {
    case 'contour_offset':
      return {
        id,
        name: `${index}. 场地边界内缩线`,
        type: 'contour_offset',
        visible: true,
        baseContour: 'full_flat_floor',
        hugInnerEdge: true,
        insetDist: 0,
        strokeWidth: 20,
        gray: 255,
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
        name: `${index}. 定点圆 / 圆弧 (可被 SafeArea 截断)`,
        type: 'circle_arc',
        visible: true,
        anchorId: 'center',
        cx: 0,
        cy: 0,
        radius: 1024,
        startDeg: 0,
        endDeg: 90,
        strokeWidth: 20,
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
        name: `${index}. 三点连线圆弧 (可被 SafeArea 截断)`,
        type: 'three_point_arc',
        visible: true,
        x1: 1024,
        y1: 0,
        x2: 724,
        y2: 724,
        x3: 0,
        y3: 1024,
        fullCircle: false,
        strokeWidth: 20,
        gray: 255,
        dashLength: 0,
        gapLength: 0,
        lineCap: 'butt',
        ...baseClip
      };
    case 'rect_or_line':
      return {
        id,
        name: `${index}. 直线段 / 矩形框 (可被 SafeArea 截断)`,
        type: 'rect_or_line',
        visible: true,
        subMode: 'hline_y0',
        x1: 0,
        y1: 0,
        x2: 3820,
        y2: 0,
        strokeWidth: 20,
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
        name: `${index}. Boost Pad 判定圆向内收边线`,
        type: 'boost_pad_group',
        visible: true,
        targetPads: 'both',
        ringMode: 'inward_from_pickup',
        inwardWidth: 20,
        insetFromPickup: 0,
        radius: 134,
        strokeWidth: 20,
        gray: 255,
        fillGray: -1,
        outerDashRadius: 0,
        outerDashWidth: 0,
        outerDashLength: 32,
        outerGapLength: 24,
        outerDashGray: 160,
        ...baseClip,
        cutBySmallPadSafeArea: false
      };
    case 'spawn_marker_group':
      return {
        id,
        name: `${index}. 出生/复活点地面框`,
        type: 'spawn_marker_group',
        visible: true,
        targetSpawns: 'both',
        shape: 'hitbox_outline',
        hitboxPreset: 'octane',
        expandMargin: 16,
        strokeWidth: 16,
        gray: 220,
        fillGray: -1,
        dashLength: 30,
        gapLength: 20,
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
        gray: 18,
        clipToFlatFloor: true,
        insetFromFloor: 20,
        ...baseClip,
        cutBySmallPadSafeArea: false
      };
  }
}
