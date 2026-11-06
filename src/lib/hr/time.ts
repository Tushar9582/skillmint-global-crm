/** Time-zone aware date helpers. Dates are 'YYYY-MM-DD' strings in the company time zone. */
export const DEFAULT_TZ = 'Asia/Kolkata';

function offsetMinutes(utc: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(utc);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(utc.getTime() / 1000) * 1000) / 60000);
}

export function localDate(utc: Date, tz = DEFAULT_TZ): string {
  return new Date(utc.getTime() + offsetMinutes(utc, tz) * 60000).toISOString().slice(0, 10);
}

/** Converts a local wall-clock date and time to the matching UTC instant. */
export function zonedTime(date: string, time: string, tz = DEFAULT_TZ): Date {
  const [h, m] = time.split(':').map(Number);
  const naive = Date.parse(`${date}T00:00:00Z`) + (h * 60 + m) * 60000;
  let guess = naive - offsetMinutes(new Date(naive), tz) * 60000;
  guess = naive - offsetMinutes(new Date(guess), tz) * 60000;
  return new Date(guess);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
export const weekday = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
export const monthRange = (year: number, month: number): [string, string] => {
  const mm = String(month).padStart(2, '0');
  return [`${year}-${mm}-01`, `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, '0')}`];
};
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from, guard = 0; d <= to && guard < 800; d = addDays(d, 1), guard++) out.push(d);
  return out;
}
export const minutesBetween = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / 60000);
