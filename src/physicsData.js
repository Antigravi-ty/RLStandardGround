/**
 * Exact 1:1 Unreal Units (UU) Physical Geometry for RocketSim Soccar Mode
 * Extracted from RLConst.h, CarConfig.cpp, and CMF collision meshes (mesh_0..15.cmf).
 */

export const ARENA_CONSTANTS = {
  EXTENT_X: 4096.0,
  EXTENT_Y: 5120.0,
  GOAL_MAX_Y: 6000.0,
  GOAL_HALF_WIDTH_MESH: 896.0,
  GOAL_HALF_WIDTH_APPROX: 892.755,
  GOAL_SCORE_BASE_Y: 5124.25,
  BALL_RADIUS: 91.25,
  BALL_SCORE_CENTER_Y: 5215.5,
  FLAT_FLOOR_MAX_X: 3840.0,
  FLAT_FLOOR_MAX_Y: 4964.95,
  GOAL_FLAT_FLOOR_HALF_X: 804.95,
  GOAL_FLAT_FLOOR_MAX_Y: 5354.67,
  DRIFTWOODS_UV_MAX_X: 3840.0,
  DRIFTWOODS_UV_MAX_Y: 5755.61,
  PAD_CYL_RAD_BIG: 208.0,
  PAD_CYL_RAD_SMALL: 144.0,
  PAD_BOX_RAD_BIG: 160.0,
  PAD_BOX_RAD_SMALL: 120.0
};

/**
 * Q1 (+X, +Y) contour where the flat floor (Z = 0) meets the wall/corner/goal ramps.
 */
export const Q1_FLAT_FLOOR_CONTOUR = [
  [3840.00, 0.00],
  [3839.99, 3390.71],
  [3836.84, 3652.95],
  [3828.25, 3718.00],
  [3814.21, 3779.30],
  [3794.81, 3837.13],
  [3769.99, 3891.92],
  [3739.46, 3944.14],
  [3702.75, 3994.16],
  [3659.45, 4042.51],
  [3018.98, 4682.98],
  [2973.35, 4729.67],
  [2928.95, 4775.95],
  [2882.23, 4820.93],
  [2830.77, 4863.24],
  [2772.97, 4900.93],
  [2708.18, 4931.54],
  [2636.78, 4952.23],
  [2434.60, 4965.33],
  [1344.00, 4964.95],
  [1280.00, 4969.69],
  [1216.00, 4981.54],
  [1152.00, 4996.95],
  [1088.00, 5012.36],
  [1024.00, 5024.21],
  [960.00, 5028.95],
  [903.96, 5028.83],
  [884.02, 5030.52],
  [865.22, 5036.38],
  [848.31, 5045.58],
  [833.67, 5057.67],
  [821.58, 5072.31],
  [812.38, 5089.22],
  [806.52, 5108.02],
  [804.84, 5127.96],
  [804.95, 5354.66],
  [0.00, 5354.67]
];

/**
 * Pitch-only flat floor contour in Q1 (clamped at goal line Y = 4964.95 without entering goal).
 */
export const Q1_PITCH_FLAT_FLOOR_CONTOUR = [
  [3840.00, 0.00],
  [3839.99, 3390.71],
  [3836.84, 3652.95],
  [3828.25, 3718.00],
  [3814.21, 3779.30],
  [3794.81, 3837.13],
  [3769.99, 3891.92],
  [3739.46, 3944.14],
  [3702.75, 3994.16],
  [3659.45, 4042.51],
  [3018.98, 4682.98],
  [2973.35, 4729.67],
  [2928.95, 4775.95],
  [2882.23, 4820.93],
  [2830.77, 4863.24],
  [2772.97, 4900.93],
  [2708.18, 4931.54],
  [2636.78, 4952.23],
  [2434.60, 4964.95],
  [0.00, 4964.95]
];

/**
 * Exact Q1 (+X, +Y) 3D Stadium Model ground perimeter extracted from driftwoods.glb (Woods_Field_Ground, scale=100).
 * Unlike the physics CMF flat floor (Y=4964.95, goal X=804.95), the 3D visual ground mesh meets the wooden ramp trim
 * at Y=4928.00 along the back wall, curves into the goal mouth at X=702.98, and extends to Y=5755.61 inside the goal.
 */
export const Q1_DRIFTWOODS_GROUND_MESH_CONTOUR = [
  [3840.00, 0.00],
  [3839.81, 895.16],
  [3839.62, 1790.31],
  [3839.42, 2685.47],
  [3839.23, 3580.62],
  [3836.93, 3653.34],
  [3828.43, 3717.58],
  [3814.22, 3779.52],
  [3794.65, 3837.70],
  [3769.86, 3892.39],
  [3739.11, 3944.51],
  [3702.32, 3994.27],
  [3670.79, 4029.91],
  [3006.47, 4695.51],
  [2972.28, 4728.50],
  [2925.95, 4771.48],
  [2877.43, 4811.74],
  [2824.92, 4848.46],
  [2767.10, 4880.29],
  [2703.44, 4905.42],
  [2634.12, 4921.94],
  [2559.92, 4927.96],
  [1753.12, 4927.98],
  [946.31, 4928.00],
  [909.01, 4928.29],
  [854.55, 4933.94],
  [802.71, 4955.61],
  [761.41, 4988.78],
  [729.28, 5030.76],
  [708.14, 5081.48],
  [702.99, 5129.98],
  [702.98, 5156.83],
  [702.98, 5344.50],
  [702.98, 5755.61],
  [469.47, 5755.58],
  [0.00, 5755.56]
];

/**
 * Pitch-only 3D Stadium Model ground contour in Q1 (clamped along the back wall line Y = 4928.00 without entering goal).
 */
export const Q1_DRIFTWOODS_PITCH_MESH_CONTOUR = [
  [3840.00, 0.00],
  [3839.81, 895.16],
  [3839.62, 1790.31],
  [3839.42, 2685.47],
  [3839.23, 3580.62],
  [3836.93, 3653.34],
  [3828.43, 3717.58],
  [3814.22, 3779.52],
  [3794.65, 3837.70],
  [3769.86, 3892.39],
  [3739.11, 3944.51],
  [3702.32, 3994.27],
  [3670.79, 4029.91],
  [3006.47, 4695.51],
  [2972.28, 4728.50],
  [2925.95, 4771.48],
  [2877.43, 4811.74],
  [2824.92, 4848.46],
  [2767.10, 4880.29],
  [2703.44, 4905.42],
  [2634.12, 4921.94],
  [2559.92, 4927.96],
  [1753.12, 4927.98],
  [946.31, 4928.00],
  [0.00, 4928.00]
];

/**
 * Q1 (+X, +Y) Outer Vertical Wall contour (Z = 300 UU slice).
 */
export const Q1_OUTER_WALL_CONTOUR = [
  [4096.00, 0.00],
  [4096.00, 3559.40],
  [4094.69, 3615.00],
  [4092.15, 3674.94],
  [4080.52, 3763.20],
  [4060.99, 3848.56],
  [4033.43, 3930.77],
  [3997.72, 4009.61],
  [3953.74, 4084.83],
  [3901.36, 4156.22],
  [3840.47, 4223.53],
  [3200.00, 4864.00],
  [3132.67, 4924.91],
  [3061.23, 4977.34],
  [2985.93, 5021.40],
  [2907.00, 5057.19],
  [2824.70, 5084.84],
  [2739.27, 5104.45],
  [2650.96, 5116.13],
  [2566.54, 5119.72],
  [903.99, 5120.00],
  [896.00, 5128.00],
  [896.01, 5895.94],
  [894.05, 5916.18],
  [888.45, 5935.04],
  [879.59, 5952.12],
  [867.87, 5967.00],
  [853.65, 5979.06],
  [837.35, 5987.96],
  [819.33, 5993.59],
  [800.00, 5995.55],
  [0.00, 5995.55]
];

export const Q1_PITCH_OUTER_WALL_CONTOUR = [
  [4096.00, 0.00],
  [4096.00, 3559.40],
  [4094.69, 3615.00],
  [4092.15, 3674.94],
  [4080.52, 3763.20],
  [4060.99, 3848.56],
  [4033.43, 3930.77],
  [3997.72, 4009.61],
  [3953.74, 4084.83],
  [3901.36, 4156.22],
  [3840.47, 4223.53],
  [3200.00, 4864.00],
  [3132.67, 4924.91],
  [3061.23, 4977.34],
  [2985.93, 5021.40],
  [2907.00, 5057.19],
  [2824.70, 5084.84],
  [2739.27, 5104.45],
  [2650.96, 5116.13],
  [2566.54, 5120.00],
  [0.00, 5120.00]
];

/**
 * Numbered Boost Pad locations in Q1 (+X >= 0, +Y >= 0).
 * Big Pads: #B1, #B2
 * Small Pads: #S1 .. #S9
 */
export const Q1_BOOST_PADS_BIG = [
  { id: 'big_side', code: 'B1', num: 1, x: 3584.0, y: 0.0, z: 73.0, isBig: true, onAxisY: true, label: '#B1 中场大垫 (3584, 0)' },
  { id: 'big_corner', code: 'B2', num: 2, x: 3072.0, y: 4096.0, z: 73.0, isBig: true, label: '#B2 底角大垫 (3072, 4096)' }
];

export const Q1_BOOST_PADS_SMALL = [
  { id: 'sm_mid_x', code: 'S1', num: 1, x: 1024.0, y: 0.0, z: 70.0, isBig: false, onAxisY: true, label: '#S1 中圈横轴小垫 (1024, 0)' },
  { id: 'sm_mid_y', code: 'S2', num: 2, x: 0.0, y: 1024.0, z: 70.0, isBig: false, onAxisX: true, label: '#S2 中圈纵轴小垫 (0, 1024)' },
  { id: 'sm_diag_inner', code: 'S3', num: 3, x: 2048.0, y: 1036.0, z: 70.0, isBig: false, label: '#S3 橄榄球弧1 (2048, 1036)' },
  { id: 'sm_diag_mid', code: 'S4', num: 4, x: 1788.0, y: 2300.0, z: 70.0, isBig: false, label: '#S4 橄榄球弧2 (1788, 2300)' },
  { id: 'sm_side_wall', code: 'S5', num: 5, x: 3584.0, y: 2484.0, z: 70.0, isBig: false, label: '#S5 边墙小垫 (3584, 2484)' },
  { id: 'sm_center_mid', code: 'S6', num: 6, x: 0.0, y: 2816.0, z: 70.0, isBig: false, onAxisX: true, label: '#S6 中轴腰部小垫 (0, 2816)' },
  { id: 'sm_slot_inner', code: 'S7', num: 7, x: 940.0, y: 3308.0, z: 70.0, isBig: false, label: '#S7 橄榄球弧3 (940, 3308)' },
  { id: 'sm_back_flank', code: 'S8', num: 8, x: 1792.0, y: 4184.0, z: 70.0, isBig: false, label: '#S8 后场侧翼小垫 (1792, 4184)' },
  { id: 'sm_goal_front', code: 'S9', num: 9, x: 0.0, y: 4240.0, z: 70.0, isBig: false, onAxisX: true, label: '#S9 门前中心小垫 (0, 4240)' }
];

/**
 * Kickoff & Demo Respawn Positions in Q1 (+X >= 0, +Y >= 0).
 */
export const Q1_KICKOFF_SPAWNS = [
  { id: 'ko_diag', code: 'KO1', name: '#KO1 斜向开球点', x: 2048.0, y: 2560.0, z: 17.0, yawDeg: 225.0 },
  { id: 'ko_back_off', code: 'KO2', name: '#KO2 后场偏置开球点', x: 256.0, y: 3840.0, z: 17.0, yawDeg: 270.0 },
  { id: 'ko_goalie', code: 'KO3', name: '#KO3 门前中轴开球点', x: 0.0, y: 4608.0, z: 17.0, yawDeg: 270.0 }
];

export const Q1_DEMO_RESPAWNS = [
  { id: 'demo_inner', code: 'DM1', name: '#DM1 复活点内侧', x: 2304.0, y: 4608.0, z: 36.0, yawDeg: 270.0 },
  { id: 'demo_outer', code: 'DM2', name: '#DM2 复活点外侧', x: 2688.0, y: 4608.0, z: 36.0, yawDeg: 270.0 }
];

/**
 * All 7 RocketSim Car Hitbox Presets (Dimensions & Offset from Car RigidBody Origin).
 */
export const HITBOX_PRESETS = [
  { id: 'octane', name: 'Octane', length: 120.507, width: 86.6994, height: 38.6591, offsetX: 13.8757, offsetY: 0, offsetZ: 20.755, color: '#00e5ff' },
  { id: 'dominus', name: 'Dominus', length: 130.427, width: 85.7799, height: 33.8, offsetX: 9.0, offsetY: 0, offsetZ: 15.75, color: '#ff4081' },
  { id: 'plank', name: 'Plank', length: 131.32, width: 87.1704, height: 31.8944, offsetX: 9.00857, offsetY: 0, offsetZ: 12.0942, color: '#ffd740' },
  { id: 'breakout', name: 'Breakout', length: 133.992, width: 83.021, height: 32.8, offsetX: 12.5, offsetY: 0, offsetZ: 11.75, color: '#69f0ae' },
  { id: 'hybrid', name: 'Hybrid', length: 129.519, width: 84.6879, height: 36.6591, offsetX: 13.8757, offsetY: 0, offsetZ: 20.755, color: '#b388ff' },
  { id: 'merc', name: 'Merc', length: 123.22, width: 79.2103, height: 44.1591, offsetX: 11.3757, offsetY: 0, offsetZ: 21.505, color: '#ff6e40' },
  { id: 'psyclops', name: 'Psyclops', length: 120.641, width: 86.8334, height: 38.7931, offsetX: 13.8757, offsetY: 0, offsetZ: 15.0, color: '#ffffff' }
];

/**
 * Minimal Bounding Rectangle (AABB Union) enclosing ALL 7 Car Hitbox Presets in car local coordinates.
 * - Rearmost edge: Plank (offsetX 9.00857 - 131.32/2 = -56.65143 UU)
 * - Frontmost edge: Breakout (offsetX 12.5 + 133.992/2 = +79.49600 UU)
 * - Widest lateral edges: Plank (±87.1704/2 = ±43.58520 UU)
 */
export const ALL_HITBOX_UNION_BOUNDS = (() => {
  const minX = Math.min(...HITBOX_PRESETS.map(p => p.offsetX - p.length * 0.5));
  const maxX = Math.max(...HITBOX_PRESETS.map(p => p.offsetX + p.length * 0.5));
  const minY = Math.min(...HITBOX_PRESETS.map(p => p.offsetY - p.width * 0.5));
  const maxY = Math.max(...HITBOX_PRESETS.map(p => p.offsetY + p.width * 0.5));
  return {
    minX,
    maxX,
    minY,
    maxY,
    length: maxX - minX,
    width: maxY - minY,
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5
  };
})();

/**
 * Named Snap/Anchor Points in Q1 for quick anchoring and magnetic cursor snapping.
 */
export const Q1_NAMED_ANCHORS = [
  { id: 'pad_sm_1024_0', code: 'S1', label: '#S1 中圈横轴小垫 (1024, 0)', x: 1024, y: 0 },
  { id: 'pad_sm_0_1024', code: 'S2', label: '#S2 中圈纵轴小垫 (0, 1024)', x: 0, y: 1024 },
  { id: 'pad_sm_2048_1036', code: 'S3', label: '#S3 橄榄球弧1小垫 (2048, 1036)', x: 2048, y: 1036 },
  { id: 'pad_sm_1788_2300', code: 'S4', label: '#S4 橄榄球弧2小垫 (1788, 2300)', x: 1788, y: 2300 },
  { id: 'pad_sm_3584_2484', code: 'S5', label: '#S5 边墙小垫 (3584, 2484)', x: 3584, y: 2484 },
  { id: 'pad_sm_0_2816', code: 'S6', label: '#S6 中轴腰部小垫 (0, 2816)', x: 0, y: 2816 },
  { id: 'pad_sm_940_3308', code: 'S7', label: '#S7 橄榄球弧3小垫 (940, 3308)', x: 940, y: 3308 },
  { id: 'pad_sm_1792_4184', code: 'S8', label: '#S8 后场侧翼小垫 (1792, 4184)', x: 1792, y: 4184 },
  { id: 'pad_sm_0_4240', code: 'S9', label: '#S9 门前中心小垫 (0, 4240)', x: 0, y: 4240 },
  { id: 'pad_big_side', code: 'B1', label: '#B1 中场大垫 (3584, 0)', x: 3584, y: 0 },
  { id: 'pad_big_corner', code: 'B2', label: '#B2 底角大垫 (3072, 4096)', x: 3072, y: 4096 },
  { id: 'ix_mid_2048_0', code: 'IX1', label: '#IX1 四垫交线点 (#S1-#B1 ∩ #S3上下) (2048, 0)', x: 2048, y: 0 },
  { id: 'ko_diag', code: 'KO1', label: '#KO1 斜向开球车位 (2048, 2560)', x: 2048, y: 2560 },
  { id: 'ko_back', code: 'KO2', label: '#KO2 后场偏置车位 (256, 3840)', x: 256, y: 3840 },
  { id: 'ko_goalie', code: 'KO3', label: '#KO3 门前中轴车位 (0, 4608)', x: 0, y: 4608 },
  { id: 'demo_inner', code: 'DM1', label: '#DM1 复活点内侧 (2304, 4608)', x: 2304, y: 4608 },
  { id: 'demo_outer', code: 'DM2', label: '#DM2 复活点外侧 (2688, 4608)', x: 2688, y: 4608 },
  { id: 'center', code: 'O', label: '场地中心原点 (0, 0)', x: 0, y: 0 },
  { id: 'goal_center', code: 'GC', label: '球门线中心 (0, 5120)', x: 0, y: 5120 },
  { id: 'goal_post_mesh', code: 'GP', label: '球门柱外沿 (896, 5120)', x: 896, y: 5120 },
  { id: 'goal_post_flat', code: 'GF', label: '球门平地内柱 (804.95, 5128)', x: 804.95, y: 5127.96 }
];
