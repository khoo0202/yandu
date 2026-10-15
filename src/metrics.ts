// Event log for tuning and for the evaluation in the plan.
// Kept in memory and mirrored to browser storage (last 5000 events). Numbers only, no images.

export interface LogEvent { t: number; type: string; screen?: string; dir?: string; detail?: string }

const KEY = 'yandu2.log';
const MAX = 5000;
let events: LogEvent[] = [];
try { events = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { events = []; }
let dirty = false;

export function log(type: string, fields: Omit<LogEvent, 't' | 'type'> = {}) {
  events.push({ t: Date.now(), type, ...fields });
  if (events.length > MAX) events = events.slice(-MAX);
  dirty = true;
}

setInterval(() => {
  if (!dirty) return;
  dirty = false;
  try { localStorage.setItem(KEY, JSON.stringify(events)); } catch { /* full or blocked */ }
}, 5000);

export function clearLog() { events = []; dirty = true; }

export function exportCsv(): string {
  const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = events.map(e => [new Date(e.t).toISOString(), e.type, e.screen, e.dir, e.detail].map(esc).join(','));
  return ['time,type,screen,dir,detail', ...rows].join('\n');
}

export function downloadCsv() {
  const blob = new Blob(['﻿' + exportCsv()], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `yandu-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Summary used by the caregiver screen. */
export function summary() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  const todays = events.filter(e => e.t >= t0);
  const selects = todays.filter(e => e.type === 'select').length;
  const undos = todays.filter(e => e.type === 'undo').length;
  const spoken = todays.filter(e => e.type === 'speak').map(e => e.detail ?? '');
  return { selects, undos, spoken };
}
