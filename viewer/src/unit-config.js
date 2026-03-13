/**
 * Infantry-type unit animation config. All units share the same animation frame structure
 * (stand, move, attack in 8 directions) for comparison. Frame indices are 0-based.
 */

const range = (start, end) =>
  Array.from({ length: end - start + 1 }, (_, i) => start + i);

/** Animation definitions (same frame layout for all infantry units). */
export const UNIT_ANIMATIONS = [
  // Stand (9 animations)
  { name: 'stand north', frames: [0], flipX: false },
  { name: 'stand northeast', frames: [2], flipX: false },
  { name: 'stand east', frames: [3], flipX: false },
  { name: 'stand southeast', frames: [3], flipX: false },
  { name: 'stand south', frames: [6], flipX: false },
  { name: 'stand south2', frames: [7], flipX: false },
  { name: 'stand southwest', frames: [11], flipX: false },
  { name: 'stand west', frames: [3], flipX: true },
  { name: 'stand northwest', frames: [2], flipX: true },
  // Move (8 animations)
  { name: 'move north', frames: range(80, 86), flipX: false },
  { name: 'move northeast', frames: range(92, 97), flipX: false },
  { name: 'move east', frames: range(98, 104), flipX: false },
  { name: 'move southeast', frames: range(116, 121), flipX: false },
  { name: 'move south', frames: range(122, 127), flipX: false },
  { name: 'move southwest', frames: range(140, 145), flipX: false },
  { name: 'move west', frames: range(146, 152), flipX: false },
  { name: 'move northwest', frames: range(164, 169), flipX: false },
  // Attack (8 animations)
  { name: 'attack north', frames: range(16, 19), flipX: false },
  { name: 'attack northeast', frames: range(24, 27), flipX: false },
  { name: 'attack east', frames: range(28, 31), flipX: false },
  { name: 'attack southeast', frames: range(40, 43), flipX: false },
  { name: 'attack south', frames: range(44, 47), flipX: false },
  { name: 'attack southwest', frames: range(56, 59), flipX: false },
  { name: 'attack west', frames: range(60, 63), flipX: false },
  { name: 'attack northwest', frames: range(72, 75), flipX: false },
];

/** Units available in the Units tab. { displayName, path, stem } */
export const UNITS = [
  { displayName: 'ElPresidente', path: 'units/elpresidente', stem: 'ElPresidente' },
  { displayName: 'Flamer', path: 'units/flamer', stem: 'Flamer' },
  { displayName: 'Harry', path: 'units/harry', stem: 'Harry' },
  { displayName: 'Infantry', path: 'units/infantry', stem: 'Infantry' },
  { displayName: 'KingZog', path: 'units/kingzog', stem: 'KingZog' },
  { displayName: 'Mech', path: 'units/mech', stem: 'Mech' },
  { displayName: 'Mekanik', path: 'units/mekanik', stem: 'Mekanik' },
  { displayName: 'Pyromaniac', path: 'units/pyromaniac', stem: 'Pyromaniac' },
  { displayName: 'Rioter', path: 'units/rioter', stem: 'Rioter' },
  { displayName: 'RocketInfantry', path: 'units/rocketinfantry', stem: 'RocketInfantry' },
  { displayName: 'RocketLauncher', path: 'units/rocketlauncher', stem: 'RocketLauncher' },
  { displayName: 'Saboteur', path: 'units/saboteur', stem: 'Saboteur' },
  { displayName: 'Sapper', path: 'units/sapper', stem: 'Sapper' },
  { displayName: 'Sniper', path: 'units/sniper', stem: 'Sniper' },
  { displayName: 'Swat', path: 'units/swat', stem: 'SWAT' },
  { displayName: 'Technician', path: 'units/technician', stem: 'Technician' },
  { displayName: 'Vandal', path: 'units/vandal', stem: 'Vandal' },
];

/** Scale factor for shoot effect relative to unit (Extras frames are larger than unit sprites). */
export const SHOOT_EFFECT_SCALE = 0.18;

/** For SWAT: maps attack animation name to shoot effect (from Extras). Offset places muzzle flash at barrel tip. */
export const ATTACK_TO_SHOOT_EFFECT = {
  'attack north': { frames: [31, 32], offsetX: -1, offsetY: -9 },
  'attack northeast': { frames: [1, 2], offsetX: 5, offsetY: -8 },
  'attack east': { frames: [7, 8], offsetX: 8, offsetY: -8 },
  'attack southeast': { frames: [13, 14], offsetX: 5, offsetY: 1 },
  'attack south': { frames: [15, 16], offsetX: 1, offsetY: 5 },
  'attack southwest': { frames: [17, 18], offsetX: -5, offsetY: 1 },
  'attack west': { frames: [23, 24], offsetX: -8, offsetY: -8 },
  'attack northwest': { frames: [25, 26], offsetX: -5, offsetY: -8 },
};
