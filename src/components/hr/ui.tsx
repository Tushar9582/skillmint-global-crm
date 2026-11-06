'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { requestJson, friendly } from '@/lib/client-api';
import { can } from '@/lib/hr/core';
import { useCurrentUser } from '../workspace-shell';

export type Row = Record<string, unknown>;

export function useCan() {
  const user = useCurrentUser();
  return (permission: string) => can(user.role, permission);
}

export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(url));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) { setData(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true); setError('');
    requestJson<T>(url).then(v => { if (!cancelled) setData(v); }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url, tick]);
  const reload = useCallback(() => setTick(t => t + 1), []);
  return { data, error, loading, reload };
}

const TONES: Record<string, string> = {
  present: 'good', approved: 'good', paid: 'good', finalized: 'good', active: 'good', done: 'good', completed: 'good', reviewed: 'good',
  half_day: 'warn', pending: 'warn', in_progress: 'warn', probation: 'warn', draft: 'warn', partially_paid: 'warn', notice: 'warn', half_day_leave: 'warn', not_punched: 'warn',
  absent: 'bad', missing_punch: 'bad', rejected: 'bad', overdue: 'bad', cancelled: 'bad', terminated: 'bad', resigned: 'bad', inactive: 'bad', failed: 'bad',
  leave: 'info', holiday: 'info', weekly_off: 'info', sent: 'info', regional: 'info', public: 'info', company: 'info', optional: 'info', manual: 'info',
};
export const toneOf = (value: unknown) => TONES[String(value)] || 'muted';
export function Badge({ value, label }: { value: unknown; label?: string }) {
  return <span className={`status-badge tone-${toneOf(value)}`}>{label ?? friendly(value)}</span>;
}

export function Metric({ label, value, note, tone }: { label: string; value: ReactNode; note?: string; tone?: string }) {
  return <div className={`metric-card ${tone ? `metric-${tone}` : ''}`}><div className="metric-label">{label}</div><div className="metric-number">{value}</div>{note && <p>{note}</p>}</div>;
}

export function PageHeading({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: string; subtitle?: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}

export function Modal({ title, eyebrow, onClose, children, footer, wide = true, drawer = false }: {
  title: string; eyebrow?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; drawer?: boolean;
}) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={drawer ? 'detail-drawer' : `modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div><button className="icon-only" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
      {children}
      {footer && <div className="modal-footer">{footer}</div>}
    </div>
  </div>;
}

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={`form-field ${wide ? 'span-2' : ''}`}><span>{label}</span>{children}</label>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<[T, string]>; value: T; onChange: (v: T) => void }) {
  return <div className="tabs" role="tablist">{tabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={value === key} className={`tab ${value === key ? 'active' : ''}`} onClick={() => onChange(key)}>{label}</button>)}</div>;
}

export function ErrorNote({ message }: { message: string }) { return message ? <div className="alert danger">{message}</div> : null; }
export function Denied() { return <div className="alert danger">You do not have permission to view this page.</div>; }

export const fmtMinutes = (m: unknown) => { const n = Math.round(Number(m) || 0); return `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, '0')}m`; };
export const fmtTime = (iso: unknown, tz = 'Asia/Kolkata') => iso ? new Date(String(iso)).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) : '—';
export const money = (v: unknown, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(v) || 0);
export const thisMonth = () => new Date().toISOString().slice(0, 7);
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
export async function send<T = Row>(url: string, method: 'POST' | 'PATCH' | 'DELETE', payload?: unknown): Promise<T> {
  return requestJson<T>(url, { method, body: payload === undefined ? undefined : JSON.stringify(payload) });
}
