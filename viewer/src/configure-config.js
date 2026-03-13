/**
 * Configure tab: combined animation list from units and effects.
 */

import { UNITS, UNIT_ANIMATIONS } from './unit-config.js';
import { EFFECTS_SPRITE, EFFECTS_ANIMATIONS } from './effects-config.js';

/** SWAT attack directions; maps to composition id and shoot effect. */
export const SWAT_ATTACK_COMPOSITIONS = [
  { id: 'SWAT/attack north', label: 'SWAT attack north', shootAnim: 'shootNorth1' },
  { id: 'SWAT/attack northeast', label: 'SWAT attack northeast', shootAnim: 'shootNorthEast1' },
  { id: 'SWAT/attack east', label: 'SWAT attack east', shootAnim: 'shootEast1' },
  { id: 'SWAT/attack southeast', label: 'SWAT attack southeast', shootAnim: 'shootSouthEast1' },
  { id: 'SWAT/attack south', label: 'SWAT attack south', shootAnim: 'shootSouth1' },
  { id: 'SWAT/attack southwest', label: 'SWAT attack southwest', shootAnim: 'shootSouthWest1' },
  { id: 'SWAT/attack west', label: 'SWAT attack west', shootAnim: 'shootWest1' },
  { id: 'SWAT/attack northwest', label: 'SWAT attack northwest', shootAnim: 'shootNorthWest1' },
];

/**
 * Returns a flat list of all animations (units + effects) for the Configure tab.
 * Each item: { id, displayName, path, stem, anim }
 */
export function getAllAnimations() {
  const result = [];

  for (const unit of UNITS) {
    for (const anim of UNIT_ANIMATIONS) {
      result.push({
        id: `${unit.stem}/${anim.name}`,
        displayName: `${unit.displayName} / ${anim.name}`,
        path: unit.path,
        stem: unit.stem,
        anim: { ...anim, name: anim.name, frames: [...anim.frames], flipX: anim.flipX ?? false },
      });
    }
  }

  const { path, stem } = EFFECTS_SPRITE;
  for (const anim of EFFECTS_ANIMATIONS) {
    result.push({
      id: `${stem}/${anim.name}`,
      displayName: `${stem} / ${anim.name}`,
      path,
      stem,
      anim: { ...anim, name: anim.name, frames: [...anim.frames] },
    });
  }

  return result;
}
