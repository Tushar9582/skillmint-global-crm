'use client';

/** Browser-only simulation of the HR, payroll and finance APIs. Separate from the CRM demo store; never resets automatically. */
import { RuleError, can, matchRoute, type Role } from './core';

export type Row = Record<string, unknown>;
export type Store = Record<string, Row[]>;
export type DemoCtx = { store: Store; actor: DemoActor; params: Record<string, string>; query: URLSearchParams; payload: Row; form: FormData | null; method: string };
export type DemoRoute = { method: string; path: string; handle: (c: DemoCtx) => unknown };
export type DemoActor = { id: string; role: Role; full_name: string; email: string; employee_id: string };

const KEY = 'skillmint-hr-demo-v1';
const ROLE_KEY = 'skillmint-demo-role';
export const eid = (n: number) => `00000000-0000-4000-8000-0000000000${n.toString(16).padStart(2, '0')}`;
export const DEMO_PEOPLE: Record<Role, DemoActor> = {
  admin: { id: '00000000-0000-4000-8000-000000000001', role: 'admin', full_name: 'SkillMint Development Admin', email: 'development-admin@skillmint.local', employee_id: eid(1) },
  hr_manager: { id: '00000000-0000-4000-8000-000000000011', role: 'hr_manager', full_name: 'Hema Rao', email: 'hema.rao@skillmint.local', employee_id: eid(2) },
  employee: { id: '00000000-0000-4000-8000-000000000012', role: 'employee', full_name: 'Aarav Sharma', email: 'aarav.sharma@skillmint.local', employee_id: eid(3) },
  finance: { id: '00000000-0000-4000-8000-000000000013', role: 'finance', full_name: 'Farah Khan', email: 'farah.khan@skillmint.local', employee_id: eid(4) },
};

export function getDemoRole(): Role {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return 'admin';
  if (typeof window === 'undefined') return 'admin';
  const stored = localStorage.getItem(ROLE_KEY) as Role | null;
  return stored && stored in DEMO_PEOPLE ? stored : 'admin';
}
export function setDemoRole(role: Role) {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return;
  localStorage.setItem(ROLE_KEY, role);
}
export const demoActor = (): DemoActor => DEMO_PEOPLE[getDemoRole()];

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

type Module = { name: string; seed: (store: Store) => void; routes: DemoRoute[] };
const modules: Module[] = [];
export function registerDemoModule(m: Module) { if (!modules.some(x => x.name === m.name)) modules.push(m); }

export function loadStore(): Store {
  let store: Store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}') as Store; } catch { store = {}; }
  const meta = (store.meta ||= [{}])[0] as Row;
  const seeded = (meta.seeded ||= {}) as Record<string, boolean>;
  let changed = false;
  for (const m of modules) if (!seeded[m.name]) { m.seed(store); seeded[m.name] = true; changed = true; }
  if (changed) saveStore(store);
  return store;
}
export function saveStore(store: Store) { localStorage.setItem(KEY, JSON.stringify(store)); }
export const table = (store: Store, name: string): Row[] => (store[name] ||= []);

export function need(actor: DemoActor, permission: string) {
  if (!can(actor.role, permission)) throw new Error('You do not have permission for this action');
}

export async function demoHrRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const [path, qs = ''] = url.replace('/api/v1/', '').split('?');
  const segments = path.split('/').filter(Boolean);
  const method = (init?.method || 'GET').toUpperCase();
  const routes = modules.flatMap(m => m.routes.map(r => ({ ...r, handle: r.handle })));
  const prefixed = routes.map(r => ({ method: r.method, path: r.path, handle: r.handle }));
  const found = matchRoute(prefixed, method, segments);
  if (!found) throw new Error('Not available in demo mode');
  const form = init?.body instanceof FormData ? init.body : null;
  const payload = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : {};
  const store = loadStore();
  try {
    const result = await found.handle({ store, actor: demoActor(), params: found.params, query: new URLSearchParams(qs), payload, form, method });
    saveStore(store);
    return result as T;
  } catch (error) {
    if (error instanceof RuleError) throw new Error(error.message);
    throw error;
  }
}
