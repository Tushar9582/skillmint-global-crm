/** Minimal dependency-free PDF writer (Helvetica, text, rules and filled boxes) used for payslips and invoices. */
export interface PdfText { x: number; y: number; text: string; size?: number; bold?: boolean; align?: 'left' | 'right' | 'center'; color?: [number, number, number] }
export interface PdfRect { x: number; y: number; w: number; h: number; fill?: [number, number, number]; stroke?: boolean }
export interface PdfRule { x1: number; y1: number; x2: number; y2: number; width?: number }
export interface PdfPage { texts: PdfText[]; rects?: PdfRect[]; rules?: PdfRule[] }

export const PAGE = { width: 595.28, height: 841.89 };

const ascii = (text: string) => text.replace(/[\u20b9]/g, 'Rs.').replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x20-\x7e]/g, '?');
const esc = (text: string) => ascii(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Approximate Helvetica advance widths (digits and punctuation are exact; letters are averaged). */
export function textWidth(text: string, size: number, bold = false): number {
  let units = 0;
  for (const ch of ascii(text)) {
    if (/\d/.test(ch)) units += 556;
    else if (ch === ' ' || ch === '.' || ch === ',' || ch === ':' || ch === ';' || ch === "'" || ch === '|') units += 278;
    else if (ch === '(' || ch === ')' || ch === '-' || ch === '/') units += 333;
    else if (/[A-Z]/.test(ch)) units += 667;
    else if (/[iljtf]/.test(ch)) units += 250;
    else if (/[mw]/.test(ch)) units += 780;
    else units += 530;
  }
  return units * size / 1000 * (bold ? 1.05 : 1);
}

const num = (n: number) => n.toFixed(2);

export function buildPdf(pages: PdfPage[]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const catalog = add('');        // 1
  const pagesRoot = add('');      // 2
  const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds: number[] = [];
  for (const page of pages) {
    const ops: string[] = [];
    for (const r of page.rects ?? []) {
      if (r.fill) ops.push(`${r.fill.map(c => (c / 255).toFixed(3)).join(' ')} rg ${num(r.x)} ${num(r.y)} ${num(r.w)} ${num(r.h)} re f`);
      if (r.stroke) ops.push(`0.8 0.85 0.88 RG 0.6 w ${num(r.x)} ${num(r.y)} ${num(r.w)} ${num(r.h)} re S`);
    }
    for (const l of page.rules ?? []) ops.push(`0.8 0.85 0.88 RG ${num(l.width ?? 0.6)} w ${num(l.x1)} ${num(l.y1)} m ${num(l.x2)} ${num(l.y2)} l S`);
    for (const t of page.texts) {
      const size = t.size ?? 10; const w = textWidth(t.text, size, t.bold);
      const x = t.align === 'right' ? t.x - w : t.align === 'center' ? t.x - w / 2 : t.x;
      const c = t.color ?? [16, 42, 59];
      ops.push(`BT ${c.map(v => (v / 255).toFixed(3)).join(' ')} rg /${t.bold ? 'F2' : 'F1'} ${size} Tf ${num(x)} ${num(t.y)} Td (${esc(t.text)}) Tj ET`);
    }
    const stream = ops.join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`;
  objects[pagesRoot - 1] = `<< /Type /Pages /Kids [${pageIds.map(i => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let out = '%PDF-1.4\n'; const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const inr = (n: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
