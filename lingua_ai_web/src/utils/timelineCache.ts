import { dataTimeline, isDataTimelineId } from './dataTimeline';

export function readTimelineCache(key: string, localOnly = false): string | null {
  dataTimeline.reread();
  const raw = localStorage.getItem(key);
  if (localOnly || raw === null) return raw;
  try {
    const entry = JSON.parse(raw);
    const state = dataTimeline.snapshot();
    return state.status !== 'CHANGED' && isDataTimelineId(entry.dataTimelineId) && entry.dataTimelineId === state.lastConfirmed
      && entry.schemaVersion === 1 ? JSON.stringify(entry.payload) : null;
  } catch { return null; }
}
export function writeTimelineCache(key: string, raw: string, localOnly = false): void {
  if (localOnly) { localStorage.setItem(key, raw); return; }
  const { dataTimelineId } = dataTimeline.capture();
  localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, dataTimelineId, payload: JSON.parse(raw) }));
}
