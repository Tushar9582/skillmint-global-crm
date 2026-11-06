import { assertDate, RuleError, UUID_RE, TIME_RE } from './core';

type Opt = { required?: boolean; max?: number };
const missing = (x: unknown) => x === undefined || x === null || String(x).trim() === '';

export const v = {
  str(x: unknown, label: string, o: Opt = {}): string | null {
    if (missing(x)) { if (o.required) throw new RuleError(400, `${label} is required`); return null; }
    const s = String(x).trim();
    if (s.length > (o.max ?? 300)) throw new RuleError(400, `${label} is too long`);
    return s;
  },
  email(x: unknown, label = 'Email', required = false): string | null {
    const s = v.str(x, label, { required, max: 200 });
    if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new RuleError(400, `${label} is invalid`);
    return s ? s.toLowerCase() : null;
  },
  phone(x: unknown, label = 'Phone'): string | null {
    const s = v.str(x, label, { max: 30 });
    if (s && !/^[+\d][\d\s\-()]{5,}$/.test(s)) throw new RuleError(400, `${label} is invalid`);
    return s;
  },
  num(x: unknown, label: string, o: { min?: number; max?: number; required?: boolean } = {}): number | null {
    if (missing(x)) { if (o.required) throw new RuleError(400, `${label} is required`); return null; }
    const n = Number(x);
    if (!Number.isFinite(n) || n < (o.min ?? 0) || n > (o.max ?? 1e9)) throw new RuleError(400, `${label} is invalid`);
    return n;
  },
  oneOf<T extends string>(x: unknown, label: string, list: readonly T[], required = false): T | null {
    if (missing(x)) { if (required) throw new RuleError(400, `${label} is required`); return null; }
    if (!list.includes(String(x) as T)) throw new RuleError(400, `${label} is invalid`);
    return String(x) as T;
  },
  date(x: unknown, label: string, required = false): string | null {
    if (missing(x)) { if (required) throw new RuleError(400, `${label} is required`); return null; }
    return assertDate(x, label);
  },
  uuid(x: unknown, label: string, required = false): string | null {
    if (missing(x)) { if (required) throw new RuleError(400, `${label} is required`); return null; }
    if (!UUID_RE.test(String(x))) throw new RuleError(400, `${label} is invalid`);
    return String(x);
  },
  time(x: unknown, label: string): string {
    if (!TIME_RE.test(String(x ?? ''))) throw new RuleError(400, `${label} must be HH:MM`);
    return String(x);
  },
  list(x: unknown, label: string, max = 50): string[] {
    const items = Array.isArray(x) ? x : String(x ?? '').split(',');
    const out = items.map(i => String(i).trim()).filter(Boolean);
    if (out.length > max) throw new RuleError(400, `${label} has too many entries`);
    return out;
  },
  ints(x: unknown, label: string, min: number, max: number): number[] {
    const items = Array.isArray(x) ? x : String(x ?? '').split(',').filter(s => s.trim() !== '');
    const out = items.map(Number);
    if (out.some(n => !Number.isInteger(n) || n < min || n > max)) throw new RuleError(400, `${label} is invalid`);
    return [...new Set(out)].sort();
  },
  bool(x: unknown): boolean { return x === true || x === 'true' || x === 1 || x === '1'; },
};

/** Picks only keys present in the payload so PATCH requests leave other columns untouched. */
export const has = (data: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(data, key);
