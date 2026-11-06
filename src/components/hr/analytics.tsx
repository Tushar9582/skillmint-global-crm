'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { downloadFile } from '@/lib/client-api';
import { Badge, Denied, ErrorNote, Metric, PageHeading, Tabs, money, shiftMonth, thisMonth, useApi, useCan, type Row } from './ui';
import { OvertimeReport } from './overtime';
import { PayrollReports } from './payroll';

type Tab = 'attendance' | 'leave' | 'overtime' | 'payroll' | 'billing';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function AnalyticsPage() {
  const can = useCan();
  const all: Array<[Tab, string, boolean]> = [['attendance', 'Attendance', can('hr.reports')], ['leave', 'Leave', can('hr.reports')], ['overtime', 'Overtime', can('overtime.manage')], ['payroll', 'Payroll', can('payroll.view_all')], ['billing', 'Billing & Receivables', can('billing.view')]];
  const tabs = all.filter(t => t[2]).map(t => [t[0], t[1]] as [Tab, string]);
  const [tab, setTab] = useState<Tab | null>(null); const current = tab && tabs.some(t => t[0] === tab) ? tab : tabs[0]?.[0];
  if (!tabs.length || !current) return <Denied />;
  return <div className="page-shell"><PageHeading eyebrow="REPORTS & ANALYTICS" title="HR & Finance Analytics" subtitle="Reports are limited to the areas your role can access. Recruitment CRM reports are under Recruitment CRM." />
    <Tabs tabs={tabs} value={current} onChange={setTab} />
    {current === 'attendance' && <AttendanceReport />}{current === 'leave' && <LeaveReport />}{current === 'overtime' && <OvertimeReport />}{current === 'payroll' && <PayrollReports />}{current === 'billing' && <BillingReport />}</div>;
}

function MonthNav({ month, set }: { month: string; set: (m: string) => void }) {
  return <div className="month-nav"><button className="btn ghost small" onClick={() => set(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft size={15} /></button><strong>{month}</strong><button className="btn ghost small" onClick={() => set(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight size={15} /></button></div>;
}

function AttendanceReport() {
  const [month, setMonth] = useState(thisMonth()); const api = useApi<{ data: Row[] }>(`/api/v1/hr/reports/attendance?month=${month}`); const [error, setError] = useState('');
  const rows = api.data?.data ?? []; const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  return <div className="stack"><div className="heading-actions"><MonthNav month={month} set={setMonth} /><button className="btn primary" onClick={() => void downloadFile(`/api/v1/hr/reports/attendance?month=${month}&format=csv`, 'attendance-summary.csv').catch(e => setError(e.message))}><Download size={16} /> Export CSV</button></div>
    <ErrorNote message={error || api.error} />
    <div className="metric-grid"><Metric label="Present Days" value={sum('present')} /><Metric label="Absent Days" value={sum('absent')} /><Metric label="Late Arrivals" value={sum('late_count')} note={`${sum('late_minutes')} minutes in total`} /><Metric label="Missing Punch-outs" value={sum('missing_punch')} /></div>
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Employee', 'Present', 'Half', 'Absent', 'Missing', 'Leave', 'Late', 'Early', 'Worked (h)', 'OT (h)'].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={String(r.employee_code)}><td><b>{String(r.employee_name)}</b><br /><small className="muted">{String(r.department ?? '')}</small></td><td>{String(r.present)}</td><td>{String(r.half_day)}</td><td>{String(r.absent)}</td><td>{String(r.missing_punch)}</td><td>{String(r.leave)}</td><td>{String(r.late_count)}</td><td>{String(r.early_count)}</td><td className="num">{String(r.worked_hours)}</td><td className="num">{String(r.overtime_hours)}</td></tr>)}</tbody></table></div></div></div>;
}

function LeaveReport() {
  const [year, setYear] = useState(new Date().getFullYear()); const api = useApi<{ data: Row[] }>(`/api/v1/hr/reports/leave?year=${year}`);
  return <div className="stack"><div className="heading-actions"><div className="month-nav"><button className="btn ghost small" onClick={() => setYear(year - 1)}><ChevronLeft size={15} /></button><strong>{year}</strong><button className="btn ghost small" onClick={() => setYear(year + 1)}><ChevronRight size={15} /></button></div></div><ErrorNote message={api.error} />
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Employee', 'Department', 'Leave Type', 'Approved Days', 'Pending Days'].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{api.data?.data.map((r, i) => <tr key={i}><td><b>{String(r.employee_name)}</b></td><td>{String(r.department ?? '—')}</td><td>{String(r.leave_type)}</td><td className="num">{String(r.approved_days)}</td><td className="num">{String(r.pending_days)}</td></tr>)}
        {!api.data?.data.length && <tr><td colSpan={5} className="table-empty">No leave recorded for {year}.</td></tr>}</tbody></table></div></div></div>;
}

function BillingReport() {
  const api = useApi<{ data: { summary: { outstanding: number; overdue_amount: number; overdue_count: number; open_invoices: number }; aging: Record<string, number>; top_outstanding: Array<{ client: string; outstanding: number }>; invoiced: Row[]; collected: Row[]; year: number } }>('/api/v1/finance/reports');
  const d = api.data?.data; const maxMonth = Math.max(1, ...(d?.invoiced ?? []).map(r => Number(r.invoiced)), ...(d?.collected ?? []).map(r => Number(r.collected)));
  return <div className="stack"><ErrorNote message={api.error} />
    <div className="metric-grid"><Metric label="Outstanding" value={d ? money(d.summary.outstanding) : '—'} note={`${d?.summary.open_invoices ?? '—'} open invoices`} /><Metric label="Overdue" value={d ? money(d.summary.overdue_amount) : '—'} note={`${d?.summary.overdue_count ?? '—'} invoices`} />
      {d && Object.entries(d.aging).filter(([k]) => k !== 'current').slice(0, 2).map(([k, v]) => <Metric key={k} label={`Overdue ${k} days`} value={money(v)} />)}</div>
    <div className="panel table-panel"><div className="panel-header"><h2>Receivables Ageing</h2></div><div className="table-scroll"><table><thead><tr>{Object.keys(d?.aging ?? {}).map(k => <th key={k}>{k === 'current' ? 'Not yet due' : `${k} days overdue`}</th>)}</tr></thead><tbody><tr>{Object.values(d?.aging ?? {}).map((v, i) => <td key={i} className="num">{money(v)}</td>)}</tr></tbody></table></div></div>
    <div className="panel"><div className="panel-header"><h2>Invoiced vs Collected ({d?.year})</h2></div><div className="stack" style={{ padding: '0 22px 22px' }}>{MONTHS.map((m, i) => { const inv = Number(d?.invoiced.find(r => r.month === i + 1)?.invoiced ?? 0); const col = Number(d?.collected.find(r => r.month === i + 1)?.collected ?? 0);
      return inv || col ? <div key={m}><b>{m}</b> <small className="muted">invoiced {money(inv)} · collected {money(col)}</small><div className="progress-track" style={{ height: 8, margin: '4px 0' }}><div style={{ width: `${inv / maxMonth * 100}%`, height: '100%', background: '#0da79b', borderRadius: 4 }} /></div><div className="progress-track" style={{ height: 8 }}><div style={{ width: `${col / maxMonth * 100}%`, height: '100%', background: '#2a6aa6', borderRadius: 4 }} /></div></div> : null; })}</div></div>
    <div className="panel table-panel"><div className="panel-header"><h2>Largest Outstanding Balances</h2></div><div className="table-scroll"><table><tbody>{d?.top_outstanding.map(t => <tr key={t.client}><td>{t.client}</td><td className="num">{money(t.outstanding)}</td></tr>)}{!d?.top_outstanding.length && <tr><td className="table-empty">Nothing outstanding.</td></tr>}</tbody></table></div></div>
    <small className="muted"><Badge value="info" label="Note" /> Payments are manual entries recorded by staff; no payment gateway is connected.</small></div>;
}
