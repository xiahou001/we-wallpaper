// Shared validation for the standalone ZCode wallpaper server.
// Keep this browser/Node safe and dependency-free.
export const DEFAULTS = {
  currentId: null, paused: false, volume: 1,
  rotate: { enabled: false, intervalMin: 30, playlist: null },
  transition: { kind: 'crossfade', ms: 1800 },
  appearance: { main: 0, row: 52, sidebar: 55, brightness: 100, stroke: 35, zoom: 100 },
  readability: { auto: true }, occlusion: 'hidden', sceneFps: 30, playlists: [], workshopDirs: [],
};
const num = (v, min, max, fallback) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; };
export function sanitizeState(input = {}) {
  const s = { ...DEFAULTS, ...input };
  s.currentId = input.currentId == null ? null : String(input.currentId);
  s.paused = Boolean(input.paused); s.volume = num(input.volume, 0, 1, 1);
  s.rotate = { ...DEFAULTS.rotate, ...(input.rotate || {}) };
  s.rotate.enabled = Boolean(s.rotate.enabled); s.rotate.intervalMin = num(s.rotate.intervalMin, 1, 1440, 30);
  s.rotate.playlist = s.rotate.playlist ? String(s.rotate.playlist) : null;
  s.transition = { ...DEFAULTS.transition, ...(input.transition || {}) };
  s.transition.ms = num(s.transition.ms, 0, 8000, 1800);
  s.transition.kind = s.transition.ms ? 'crossfade' : 'none';
  s.appearance = { ...DEFAULTS.appearance, ...(input.appearance || {}) };
  for (const k of ['main','row','sidebar','stroke']) s.appearance[k] = num(s.appearance[k], 0, 100, DEFAULTS.appearance[k]);
  s.appearance.brightness = num(s.appearance.brightness, 40, 160, 100);
  s.appearance.zoom = num(s.appearance.zoom, 80, 140, 100);
  s.readability = { auto: input.readability?.auto !== false };
  s.occlusion = ['never','hidden','focus'].includes(input.occlusion) ? input.occlusion : 'hidden';
  s.sceneFps = [15,30,60].includes(Number(input.sceneFps)) ? Number(input.sceneFps) : 30;
  s.playlists = Array.isArray(input.playlists) ? input.playlists.filter(p => p && String(p.name || '').trim()).map(p => ({ name: String(p.name).trim(), ids: Array.isArray(p.ids) ? p.ids.map(String) : [] })) : [];
  s.workshopDirs = Array.isArray(input.workshopDirs) ? input.workshopDirs.map(String).filter(Boolean) : [];
  return s;
}
