/**
 * Live settings from wallpaper hosts.
 *  - Lively Wallpaper calls window.livelyPropertyListener(name, value) for each LivelyProperties.json entry.
 *  - Wallpaper Engine calls window.wallpaperPropertyListener.applyUserProperties({ name: { value } }).
 * The property names and option lists are shared with scripts/package.mjs, which writes both hosts' files.
 */
import { CONFIG } from './config.js';


export const TEAM_PRESETS = [
  { label: 'Survivors vs Evolved', teams: ['survivors', 'evolved'] },
  { label: 'Mixed vs Mixed', teams: ['mixed', 'mixed'] },
  { label: 'Survivors civil war', teams: ['survivors', 'survivors'] },
  { label: 'Evolved civil war', teams: ['evolved', 'evolved'] },
];

/** Settings that need a fresh battle; the rest apply immediately. */
const RESTART = new Set(['map', 'teams', 'zoom', 'units', 'vehicles']);
// these change the battlefield itself (zoom changes how many cells fit on screen)
const NEW_WORLD = new Set(['map', 'zoom']);

export function installWallpaperHooks(game) {
  let restartTimer = null;
  let pending = { restart: false, newMap: false };

  const scene = () => game.scene.getScene('battle');

  function scheduleRestart(newMap) {
    pending.restart = true;
    pending.newMap = pending.newMap || newMap;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      const s = scene();
      if (s?.sys.isActive() && s.world) s.restart(pending.newMap);
      pending = { restart: false, newMap: false };
    }, 400);
  }

  function apply(name, value) {
    switch (name) {
      case 'map': {
        const db = game.cache.json.get('db');
        const list = (db?.maps || []).filter((m) => m.id !== 'shellmap');
        const idx = Number(value);
        CONFIG.map = idx <= 0 || !list[idx - 1] ? 'random' : list[idx - 1].id;
        break;
      }
      case 'teams':
        CONFIG.teams = (TEAM_PRESETS[Number(value)] || TEAM_PRESETS[0]).teams;
        break;
      case 'zoom': CONFIG.zoom = Number(value); break;
      case 'units': CONFIG.units = Number(value); break;
      case 'vehicles': CONFIG.vehicles = value ? 1 : 0; break;
      case 'lethality': CONFIG.lethality = Number(value); break;
      case 'wave': CONFIG.waveInterval = Number(value); break;
      case 'rotate': CONFIG.rotate = Number(value); scene()?.resetRotateTimer?.(); break;
      case 'corpses': CONFIG.corpseTime = Number(value); break;
      case 'airstrike': CONFIG.airstrike = Number(value); scene()?.resetAirTimer?.(); break;
      case 'speed': CONFIG.speed = Number(value); break;
      case 'fps':
        CONFIG.fps = Number(value) === 1 ? 30 : 60;
        game.loop.targetFps = CONFIG.fps;
        game.loop.fpsLimit = CONFIG.fps < 60 ? CONFIG.fps : 0;
        game.loop._limitRate = game.loop.fpsLimit ? 1000 / game.loop.fpsLimit : 0;
        break;
      default:
        return;
    }
    if (RESTART.has(name)) scheduleRestart(NEW_WORLD.has(name));
  }

  // Lively Wallpaper
  window.livelyPropertyListener = (name, value) => apply(name, value);

  // Wallpaper Engine
  window.wallpaperPropertyListener = {
    applyUserProperties(props) {
      for (const [name, p] of Object.entries(props)) apply(name, p.value);
    },
  };
}
