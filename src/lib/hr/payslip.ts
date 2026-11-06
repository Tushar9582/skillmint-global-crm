import { PAGE, buildPdf, inr, type PdfPage, type PdfText } from './pdf';
import type { PayLine } from './payroll';

export interface PayslipData {
  company: string; period: string; simulated?: boolean; currency?: string;
  employee: { code: string; name: string; department?: string | null; designation?: string | null; joining_date?: string | null; email?: string | null };
  working_days: number; lop_days: number; payable_days: number;
  lines: PayLine[]; gross: number; total_deductions: number; net: number; generated_at: string;
}

export function payslipPdf(d: PayslipData): Uint8Array {
  const t: PdfText[] = []; const L = 40; const R = PAGE.width - 40; let y = PAGE.height - 50;
  const page: PdfPage = { texts: t, rects: [{ x: 0, y: PAGE.height - 92, w: PAGE.width, h: 92, fill: [16, 42, 59] }], rules: [] };
  t.push({ x: L, y: PAGE.height - 48, text: d.company, size: 20, bold: true, color: [255, 255, 255] });
  t.push({ x: L, y: PAGE.height - 70, text: `Payslip for ${d.period}`, size: 12, color: [199, 232, 228] });
  if (d.simulated) t.push({ x: R, y: PAGE.height - 48, text: 'SIMULATED - DEMO DATA', size: 11, bold: true, align: 'right', color: [255, 214, 120] });
  y = PAGE.height - 125;
  const kv = (x: number, label: string, value: string) => { t.push({ x, y, text: label, size: 8, color: [110, 130, 145] }); t.push({ x, y: y - 13, text: value || '-', size: 10, bold: true }); };
  kv(L, 'EMPLOYEE', d.employee.name); kv(230, 'EMPLOYEE ID', d.employee.code); kv(390, 'DEPARTMENT', d.employee.department ?? '');
  y -= 38; kv(L, 'DESIGNATION', d.employee.designation ?? ''); kv(230, 'DATE OF JOINING', d.employee.joining_date ?? ''); kv(390, 'EMAIL', d.employee.email ?? '');
  y -= 38; kv(L, 'WORKING DAYS', String(d.working_days)); kv(230, 'LOSS OF PAY DAYS', String(d.lop_days)); kv(390, 'PAYABLE DAYS', String(d.payable_days));
  y -= 34; page.rules!.push({ x1: L, y1: y, x2: R, y2: y });
  const earnings = d.lines.filter(l => l.kind === 'earning'); const deductions = d.lines.filter(l => l.kind === 'deduction');
  const colW = (R - L - 20) / 2; const xr = L + colW + 20; let top = y - 22;
  page.rects!.push({ x: L, y: top - 4, w: colW, h: 20, fill: [228, 248, 245] }, { x: xr, y: top - 4, w: colW, h: 20, fill: [228, 248, 245] });
  t.push({ x: L + 8, y: top + 2, text: 'EARNINGS', size: 9, bold: true }, { x: L + colW - 8, y: top + 2, text: `AMOUNT (${d.currency ?? 'INR'})`, size: 9, bold: true, align: 'right' },
    { x: xr + 8, y: top + 2, text: 'DEDUCTIONS', size: 9, bold: true }, { x: xr + colW - 8, y: top + 2, text: `AMOUNT (${d.currency ?? 'INR'})`, size: 9, bold: true, align: 'right' });
  const rows = Math.max(earnings.length, deductions.length); let ry = top - 24;
  for (let i = 0; i < rows; i++) {
    const e = earnings[i]; const dd = deductions[i];
    if (e) t.push({ x: L + 8, y: ry, text: e.label.slice(0, 38), size: 10 }, { x: L + colW - 8, y: ry, text: inr(e.amount), size: 10, align: 'right' });
    if (dd) t.push({ x: xr + 8, y: ry, text: dd.label.slice(0, 38), size: 10 }, { x: xr + colW - 8, y: ry, text: inr(dd.amount), size: 10, align: 'right' });
    ry -= 17;
  }
  ry -= 6; page.rules!.push({ x1: L, y1: ry + 10, x2: L + colW, y2: ry + 10 }, { x1: xr, y1: ry + 10, x2: xr + colW, y2: ry + 10 });
  const totalEarn = earnings.reduce((s, l) => s + l.amount, 0);
  t.push({ x: L + 8, y: ry - 6, text: 'Total Earnings', size: 10, bold: true }, { x: L + colW - 8, y: ry - 6, text: inr(totalEarn), size: 10, bold: true, align: 'right' },
    { x: xr + 8, y: ry - 6, text: 'Total Deductions', size: 10, bold: true }, { x: xr + colW - 8, y: ry - 6, text: inr(d.total_deductions), size: 10, bold: true, align: 'right' });
  ry -= 44;
  page.rects!.push({ x: L, y: ry - 8, w: R - L, h: 34, fill: [16, 42, 59] });
  t.push({ x: L + 12, y: ry + 4, text: 'NET PAY', size: 12, bold: true, color: [255, 255, 255] }, { x: R - 12, y: ry + 4, text: `${d.currency ?? 'INR'} ${inr(d.net)}`, size: 14, bold: true, align: 'right', color: [255, 255, 255] });
  t.push({ x: L, y: 60, text: `Generated ${d.generated_at}. This is a computer-generated document and does not require a signature.`, size: 8, color: [110, 130, 145] });
  if (d.simulated) t.push({ x: L, y: 48, text: 'Simulated financial calculation for development testing only. Not valid for payment or statutory filing.', size: 8, color: [180, 100, 40] });
  return buildPdf([page]);
}
