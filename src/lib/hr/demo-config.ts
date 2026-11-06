'use client';

import { RuleError } from './core';
import { v, has } from './validate';
import { FIELD_KINDS, OPTION_KINDS, SYSTEM_VALUES, cleanLabel, defaultOptions, toValue, validateCustomValues, validateFieldDefinition, type CustomFieldDef, type OptionKind } from './crm-config';
import { loadStore, nowIso, registerDemoModule, table, uid, type DemoCtx, type DemoRoute, type Row, type Store } from './demo-hr';

const admin = (c: DemoCtx) => { if (c.actor.role !== 'admin') throw new RuleError(403, 'Admin permission required'); };
const find = (store: Store, name: string, id: string) => table(store, name).find(r => r.id === id);
const workflow = (store: Store): Row => table(store, 'crm_workflow')[0];

const routes: DemoRoute[] = [
  { method: 'GET', path: 'config/options', handle: c => ({ data: Object.fromEntries(OPTION_KINDS.map(k => [k, table(c.store, 'crm_options').filter(o => o.kind === k).sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || String(a.label).localeCompare(String(b.label)))])) }) },
  { method: 'POST', path: 'config/options', handle: c => { admin(c); const d = c.payload; const kind = v.oneOf(d.kind, 'List', OPTION_KINDS, true) as OptionKind; const value = toValue(d.value ?? d.label); const label = cleanLabel(d.label);
    if (table(c.store, 'crm_options').some(o => o.kind === kind && o.value === value)) throw new RuleError(409, 'That value already exists in this list');
    const row = { id: uid(), kind, value, label, sort_order: v.num(d.sort_order ?? 100, 'Sort order', { max: 10000 }), active: true, is_system: false }; table(c.store, 'crm_options').push(row); return { data: row }; } },
  { method: 'PATCH', path: 'config/options/:id', handle: c => { admin(c); const d = c.payload; const cur = find(c.store, 'crm_options', c.params.id); if (!cur) throw new RuleError(404, 'Option not found');
    if (has(d, 'value') && d.value !== cur.value) throw new RuleError(400, 'The stored value of an option cannot change; edit its label instead');
    if (has(d, 'label')) cur.label = cleanLabel(d.label); if (has(d, 'sort_order')) cur.sort_order = v.num(d.sort_order, 'Sort order', { max: 10000, required: true });
    if (has(d, 'active')) { const active = v.bool(d.active);
      if (!active && (cur.is_system || SYSTEM_VALUES[cur.kind as OptionKind].includes(String(cur.value)))) throw new RuleError(409, 'System values drive application logic and cannot be deactivated');
      if (!active && !table(c.store, 'crm_options').some(o => o.kind === cur.kind && o.active && o.id !== cur.id)) throw new RuleError(409, 'A list needs at least one active value'); cur.active = active; }
    return { data: cur }; } },

  { method: 'GET', path: 'config/custom-fields', handle: c => ({ data: table(c.store, 'crm_fields').filter(f => f.active || (c.actor.role === 'admin' && c.query.get('all') === '1')) }) },
  { method: 'POST', path: 'config/custom-fields', handle: c => { admin(c); const def = validateFieldDefinition(c.payload, true);
    if (def.field_type === 'select' && !def.options?.length) throw new RuleError(400, 'A select field needs at least one option');
    const fields = table(c.store, 'crm_fields'); if (fields.some(f => f.entity === def.entity && f.field_key === def.field_key)) throw new RuleError(409, 'A custom field with this key already exists');
    if (fields.filter(f => f.entity === def.entity).length >= 30) throw new RuleError(409, 'At most 30 custom fields per record type');
    const row = { id: uid(), entity: def.entity, field_key: def.field_key, label: def.label, field_type: def.field_type, options: def.field_type === 'select' ? def.options : [], required: def.required ?? false, active: true, sort_order: v.num(c.payload.sort_order ?? 100, 'Sort order', { max: 10000 }), created_at: nowIso() };
    fields.push(row); return { data: row }; } },
  { method: 'PATCH', path: 'config/custom-fields/:id', handle: c => { admin(c); const d = c.payload; if ('field_type' in d || 'field_key' in d || 'entity' in d) throw new RuleError(400, 'Key, type and record type cannot change after creation');
    const cur = find(c.store, 'crm_fields', c.params.id); if (!cur) throw new RuleError(404, 'Custom field not found'); const def = validateFieldDefinition(d, false);
    if (def.label !== undefined) cur.label = def.label; if (def.required !== undefined) cur.required = def.required; if (def.active !== undefined) cur.active = def.active;
    if (def.options !== undefined) { if (cur.field_type !== 'select') throw new RuleError(400, 'Only select fields have options'); if (!def.options.length) throw new RuleError(400, 'A select field needs at least one option'); cur.options = def.options; }
    if (has(d, 'sort_order')) cur.sort_order = v.num(d.sort_order, 'Sort order', { max: 10000, required: true }); return { data: cur }; } },

  { method: 'GET', path: 'config/workflow', handle: c => ({ data: { resume_followup_days: Number(workflow(c.store).resume_followup_days) } }) },
  { method: 'PATCH', path: 'config/workflow', handle: c => { admin(c); const days = v.num(c.payload.resume_followup_days, 'Follow-up delay', { max: 30, required: true })!; if (!Number.isInteger(days)) throw new RuleError(400, 'Follow-up delay must be a whole number of days');
    workflow(c.store).resume_followup_days = days; return { data: { resume_followup_days: days } }; } },
];

function seed(store: Store) {
  for (const kind of OPTION_KINDS) for (const o of defaultOptions(kind)) table(store, 'crm_options').push({ id: uid(), kind, value: o.value, label: o.label, sort_order: o.sort_order, active: true, is_system: o.is_system });
  table(store, 'crm_workflow').push({ resume_followup_days: 1 });
}
registerDemoModule({ name: 'config', seed, routes });

/** Applies the same validation as the server to the CRM demo store's records. Throws Error with the server's wording. */
export function demoValidateCrm(resource: string, payload: Record<string, unknown>, previous: Record<string, unknown> | null): void {
  const store = loadStore();
  for (const m of FIELD_KINDS.filter(x => x.resource === resource)) {
    const value = payload[m.field]; if (value === undefined || value === null || value === '') continue;
    const allowed = table(store, 'crm_options').filter(o => o.kind === m.kind && o.active).map(o => String(o.value));
    if (!allowed.includes(String(value)) && String(previous?.[m.field] ?? '') !== String(value)) throw new Error(`Invalid ${m.field === 'stage' ? 'Stage' : m.field === 'priority' ? 'Priority' : 'Source'}`);
  }
  const entity = resource === 'company-leads' ? 'company_leads' : resource === 'candidates' ? 'candidates' : null; if (!entity) return;
  const defs = table(store, 'crm_fields').filter(f => f.entity === entity) as unknown as CustomFieldDef[];
  if ('custom' in payload || (!previous && defs.some(d => d.active && d.required))) {
    try { payload.custom = validateCustomValues(defs, payload.custom, (previous?.custom as Record<string, unknown>) ?? {}, !previous); }
    catch (error) { throw new Error(error instanceof RuleError ? error.message : 'Invalid custom fields'); }
  }
}
