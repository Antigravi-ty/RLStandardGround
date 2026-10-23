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
 * Ordered from (+X, 0) along side wall -> 45° corner -> back wall -> goal mouth -> (0, +Y).
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
 * Ideal for drawing the main pitch perimeter line (touchline + corner arc + goal line).
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

/**
 * Pitch-only Outer Wall contour in Q1 (clamped at Y = 5120 goal line).
 */
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
 * Boost Pad locations in Q1 (+X >= 0, +Y >= 0).
 * Pads on X=0 or Y=0 axes are marked with onAxisX / onAxisY.
 */
export const Q1_BOOST_PADS_BIG = [
  { id: 'big_side', x: 3584.0, y: 0.0, z: 73.0, isBig: true, onAxisY: true, label: 'Side Big (3584, 0)' },
  { id: 'big_corner', x: 3072.0, y: 4096.0, z: 73.0, isBig: true, label: 'Corner Big (3072, 4096)' }
];

export const Q1_BOOST_PADS_SMALL = [
  { id: 'sm_mid_x', x: 1024.0, y: 0.0, z: 70.0, isBig: false, onAxisY: true, label: 'Center X (1024, 0)' },
  { id: 'sm_mid_y', x: 0.0, y: 1024.0, z: 70.0, isBig: false, onAxisX: true, label: 'Center Y (0, 1024)' },
  { id: 'sm_diag_inner', x: 2048.0, y: 1036.0, z: 70.0, isBig: false, label: 'Mid Flank (2048, 1036)' },
  { id: 'sm_diag_mid', x: 1788.0, y: 2300.0, z: 70.0, isBig: false, label: 'Diag Mid (1788, 2300)' },
  { id: 'sm_side_wall', x: 3584.0, y: 2484.0, z: 70.0, isBig: false, label: 'Side Wall (3584, 2484)' },
  { id: 'sm_center_mid', x: 0.0, y: 2816.0, z: 70.0, isBig: false, onAxisX: true, label: 'Spine Mid (0, 2816)' },
  { id: 'sm_slot_inner', x: 940.0, y: 3308.0, z: 70.0, isBig: false, label: 'Box Corner (940, 3308)' },
  { id: 'sm_back_flank', x: 1792.0, y: 4184.0, z: 70.0, isBig: false, label: 'Back Flank (1792, 4184)' },
  { id: 'sm_goal_front', x: 0.0, y: 4240.0, z: 70.0, isBig: false, onAxisX: true, label: 'Goal Front (0, 4240)' }
];

/**
 * Kickoff & Demo Respawn Positions in Q1 (+X >= 0, +Y >= 0).
 */
export const Q1_KICKOFF_SPAWNS = [
  { id: 'ko_diag', name: 'Kickoff Diagonal', x: 2048.0, y: 2560.0, z: 17.0, yawDeg: 225.0 },
  { id: 'ko_back_off', name: 'Kickoff Back Offset', x: 256.0, y: 3840.0, z: 17.0, yawDeg: 270.0 },
  { id: 'ko_goalie', name: 'Kickoff Goalie Center', x: 0.0, y: 4608.0, z: 17.0, yawDeg: 270.0 }
];

export const Q1_DEMO_RESPAWNS = [
  { id: 'demo_inner', name: 'Demo Slot Inner', x: 2304.0, y: 4608.0, z: 36.0, yawDeg: 270.0 },
  { id: 'demo_outer', name: 'Demo Slot Outer', x: 2688.0, y: 4608.0, z: 36.0, yawDeg: 270.0 }
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
 * Named Snap/Anchor Points in Q1 for quick anchoring of circles, arcs, and lines.
 */
export const Q1_NAMED_ANCHORS = [
  { id: 'center', label: 'Center Origin (0, 0)', x: 0, y: 0 },
  { id: 'goal_center', label: 'Goal Line Center (0, 5120)', x: 0, y: 5120 },
  { id: 'goal_post_mesh', label: 'Goal Post Mesh (896, 5120)', x: 896, y: 5120 },
  { id: 'goal_post_flat', label: 'Goal Post Flat Floor (804.95, 5128)', x: 804.95, y: 5127.96 },
  { id: 'ko_diag', label: 'Kickoff Diagonal (2048, 2560)', x: 2048, y: 2560 },
  { id: 'ko_back', label: 'Kickoff Back (256, 3840)', x: 256, y: 3840 },
  { id: 'ko_goalie', label: 'Kickoff Goalie (0, 4608)', x: 0, y: 4608 },
  { id: 'demo_inner', label: 'Demo Inner (2304, 4608)', x: 2304, y: 4608 },
  { id: 'demo_outer', label: 'Demo Outer (2688, 4608)', x: 2688, y: 4608 },
  { id: 'pad_big_side', label: 'Big Pad Side (3584, 0)', x: 3584, y: 0 },
  { id: 'pad_big_corner', label: 'Big Pad Corner (3072, 4096)', x: 3072, y: 4096 },
  { id: 'pad_sm_1024_0', label: 'Small Pad (1024, 0)', x: 1024, y: 0 },
  { id: 'pad_sm_0_1024', label: 'Small Pad (0, 1024)', x: 0, y: 1024 },
  { id: 'pad_sm_2048_1036', label: 'Small Pad (2048, 1036)', x: 2048, y: 1036 },
  { id: 'pad_sm_1788_2300', label: 'Small Pad (1788, 2300)', x: 1788, y: 2300 },
  { id: 'pad_sm_3584_2484', label: 'Small Pad (3584, 2484)', x: 3584, y: 2484 },
  { id: 'pad_sm_0_2816', label: 'Small Pad (0, 2816)', x: 0, y: 2816 },
  { id: 'pad_sm_940_3308', label: 'Small Pad (940, 3308)', x: 940, y: 3308 },
  { id: 'pad_sm_1792_4184', label: 'Small Pad (1792, 4184)', x: 1792, y: 4184 },
  { id: 'pad_sm_0_4240', label: 'Small Pad (0, 4240)', x: 0, y: 4240 }
];
