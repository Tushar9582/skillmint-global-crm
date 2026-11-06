import { PAGE, buildPdf, inr, type PdfPage, type PdfText } from './pdf';

export interface InvoicePdfData {
  seller: { name: string; address?: string | null; tax_id?: string | null; payment_instructions?: string | null };
  client: { name: string; contact?: string | null; email?: string | null; city?: string | null };
  number: string | null; status: string; invoice_date: string; due_date: string; currency: string; service_description: string; notes?: string | null;
  lines: Array<{ description: string; quantity: number; unit_price: number; amount: number }>;
  subtotal: number; tax_breakup: Array<{ name: string; rate_percent: number; amount: number }>; tax_total: number; total: number; paid: number; balance: number;
  payments: Array<{ paid_on: string; method: string; reference?: string | null; amount: number }>; simulated?: boolean;
}

export function invoicePdf(d: InvoicePdfData): Uint8Array {
  const t: PdfText[] = []; const L = 40; const R = PAGE.width - 40;
  const page: PdfPage = { texts: t, rects: [{ x: 0, y: PAGE.height - 90, w: PAGE.width, h: 90, fill: [16, 42, 59] }], rules: [] };
  t.push({ x: L, y: PAGE.height - 46, text: d.seller.name, size: 20, bold: true, color: [255, 255, 255] }, { x: R, y: PAGE.height - 46, text: d.number ? 'TAX INVOICE' : 'DRAFT INVOICE', size: 14, bold: true, align: 'right', color: [255, 255, 255] },
    { x: R, y: PAGE.height - 66, text: d.number ?? 'Not yet issued', size: 11, align: 'right', color: [199, 232, 228] });
  if (d.simulated) t.push({ x: L, y: PAGE.height - 70, text: 'SIMULATED - DEMO DATA', size: 10, bold: true, color: [255, 214, 120] });
  let y = PAGE.height - 120;
  t.push({ x: L, y, text: 'FROM', size: 8, color: [110, 130, 145] }, { x: 320, y, text: 'BILL TO', size: 8, color: [110, 130, 145] });
  t.push({ x: L, y: y - 14, text: d.seller.name, size: 10, bold: true }, { x: 320, y: y - 14, text: d.client.name, size: 10, bold: true });
  const left = [d.seller.address, d.seller.tax_id ? `Tax ID: ${d.seller.tax_id}` : null].filter(Boolean) as string[];
  const right = [d.client.contact, d.client.email, d.client.city].filter(Boolean) as string[];
  left.forEach((s, i) => t.push({ x: L, y: y - 28 - i * 12, text: s.slice(0, 55), size: 9 })); right.forEach((s, i) => t.push({ x: 320, y: y - 28 - i * 12, text: s.slice(0, 50), size: 9 }));
  y -= 90;
  const meta = (x: number, label: string, value: string) => { t.push({ x, y, text: label, size: 8, color: [110, 130, 145] }, { x, y: y - 13, text: value, size: 10, bold: true }); };
  meta(L, 'INVOICE DATE', d.invoice_date); meta(200, 'DUE DATE', d.due_date); meta(360, 'STATUS', d.status.replace('_', ' ').toUpperCase()); meta(470, 'CURRENCY', d.currency);
  y -= 36; t.push({ x: L, y, text: `Service: ${d.service_description}`.slice(0, 95), size: 10 });
  y -= 24; page.rects!.push({ x: L, y: y - 5, w: R - L, h: 20, fill: [228, 248, 245] });
  t.push({ x: L + 6, y, text: 'DESCRIPTION', size: 9, bold: true }, { x: 350, y, text: 'QTY', size: 9, bold: true, align: 'right' }, { x: 430, y, text: 'UNIT PRICE', size: 9, bold: true, align: 'right' }, { x: R - 6, y, text: 'AMOUNT', size: 9, bold: true, align: 'right' });
  y -= 20;
  for (const l of d.lines) { t.push({ x: L + 6, y, text: l.description.slice(0, 55), size: 10 }, { x: 350, y, text: String(l.quantity), size: 10, align: 'right' }, { x: 430, y, text: inr(l.unit_price), size: 10, align: 'right' }, { x: R - 6, y, text: inr(l.amount), size: 10, align: 'right' }); y -= 16; }
  page.rules!.push({ x1: L, y1: y + 8, x2: R, y2: y + 8 }); y -= 8;
  const total = (label: string, value: string, bold = false) => { t.push({ x: 430, y, text: label, size: 10, bold, align: 'right' }, { x: R - 6, y, text: value, size: 10, bold, align: 'right' }); y -= 16; };
  total('Subtotal', inr(d.subtotal)); for (const x of d.tax_breakup) total(`${x.name} (${x.rate_percent}%)`, inr(x.amount)); total(`Total (${d.currency})`, inr(d.total), true);
  if (d.paid > 0) total('Paid', `-${inr(d.paid)}`); total('Balance due', inr(d.balance), true);
  if (d.payments.length) { y -= 10; t.push({ x: L, y, text: 'PAYMENTS RECEIVED (recorded manually by staff)', size: 8, bold: true, color: [110, 130, 145] }); y -= 14;
    for (const p of d.payments.slice(0, 8)) { t.push({ x: L, y, text: `${p.paid_on}  ${p.method.replace('_', ' ')}${p.reference ? `  ref ${p.reference}` : ''}`.slice(0, 70), size: 9 }, { x: R - 6, y, text: inr(p.amount), size: 9, align: 'right' }); y -= 13; } }
  if (d.notes) { y -= 8; t.push({ x: L, y, text: `Notes: ${d.notes}`.slice(0, 100), size: 9 }); y -= 14; }
  if (d.seller.payment_instructions) t.push({ x: L, y: Math.max(y - 6, 90), text: `Payment instructions: ${d.seller.payment_instructions}`.slice(0, 105), size: 9 });
  if (d.status === 'cancelled' || d.status === 'paid') t.push({ x: PAGE.width / 2, y: 400, text: d.status.toUpperCase(), size: 60, bold: true, align: 'center', color: d.status === 'paid' ? [190, 235, 225] : [245, 205, 200] });
  t.push({ x: L, y: 50, text: d.simulated ? 'Simulated invoice for development testing only. Not a valid tax document.' : 'Computer-generated invoice.', size: 8, color: [110, 130, 145] });
  return buildPdf([page]);
}
