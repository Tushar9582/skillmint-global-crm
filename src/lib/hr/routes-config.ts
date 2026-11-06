import { HttpError, ensureAdmin } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { ensureConfigSeeded, loadOptions, workflowSettings } from '@/lib/crm-config';
import { one, sql } from '@/lib/db';
import { json } from '@/lib/http';
import { OPTION_KINDS, SYSTEM_VALUES, cleanLabel, toValue, validateFieldDefinition, type OptionKind } from './crm-config';
import { UUID_RE } from './core';
import { v, has } from './validate';
import { buildUpdate, jsonBody, type Row, type ServerRoute } from './server';

async function guarded<T>(work: () => Promise<T>, message: string): Promise<T> {
  try { return await work(); } catch (error) { if ((error as { code?: string }).code === '23505') throw new HttpError(409, message); throw error; }
}

export const configRoutes: ServerRoute[] = [
  { method: 'GET', path: 'options', handle: async ctx => {
    const rows = await loadOptions(ctx.actor.organization_id); const out: Record<string, unknown[]> = {};
    for (const kind of OPTION_KINDS) out[kind] = rows.filter(r => r.kind === kind);
    return json({ data: out });
  } },
  { method: 'POST', path: 'options', handle: async ctx => {
    ensureAdmin(ctx.actor); const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id; await ensureConfigSeeded(orgId);
    const kind = v.oneOf(d.kind, 'List', OPTION_KINDS, true) as OptionKind; const value = toValue(d.value ?? d.label); const label = cleanLabel(d.label);
    const row = await guarded(() => one<Row>(`INSERT INTO crm_config_options(organization_id,kind,value,label,sort_order,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,kind,value,label,sort_order,active,is_system`,
      [orgId, kind, value, label, v.num(d.sort_order ?? 100, 'Sort order', { max: 10000 }), ctx.actor.id]), 'That value already exists in this list');
    await audit(ctx.actor, 'crm_option_create', 'crm_config_options', String(row!.id), { kind, value });
    return json({ data: row }, 201);
  } },
  { method: 'PATCH', path: 'options/:id', handle: async ctx => {
    ensureAdmin(ctx.actor); const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id;
    if (!UUID_RE.test(ctx.params.id)) throw new HttpError(404, 'Option not found');
    const cur = await one<Row>('SELECT * FROM crm_config_options WHERE id=$1 AND organization_id=$2', [ctx.params.id, orgId]); if (!cur) throw new HttpError(404, 'Option not found');
    if (has(d, 'value') && d.value !== cur.value) throw new HttpError(400, 'The stored value of an option cannot change; edit its label instead');
    const out: Row = {};
    if (has(d, 'label')) out.label = cleanLabel(d.label);
    if (has(d, 'sort_order')) out.sort_order = v.num(d.sort_order, 'Sort order', { max: 10000, required: true });
    if (has(d, 'active')) {
      const active = v.bool(d.active);
      if (!active && (cur.is_system || SYSTEM_VALUES[cur.kind as OptionKind].includes(String(cur.value)))) throw new HttpError(409, 'System values drive application logic and cannot be deactivated');
      if (!active) { const left = await one<{ n: number }>(`SELECT count(*)::int AS n FROM crm_config_options WHERE organization_id=$1 AND kind=$2 AND active=true AND id<>$3`, [orgId, cur.kind, cur.id]); if (!left || left.n < 1) throw new HttpError(409, 'A list needs at least one active value'); }
      out.active = active;
    }
    const q = buildUpdate('crm_config_options', out, orgId, ctx.params.id, ''); const row = await one<Row>(q.text, q.args);
    await audit(ctx.actor, 'crm_option_update', 'crm_config_options', ctx.params.id, { fields: Object.keys(out) });
    return json({ data: row });
  } },

  { method: 'GET', path: 'custom-fields', handle: async ctx => {
    const orgId = ctx.actor.organization_id; const all = ctx.actor.role === 'admin' && ctx.query.get('all') === '1';
    const rows = await sql<Row>(`SELECT id,entity,field_key,label,field_type,options,required,active,sort_order FROM crm_custom_fields WHERE organization_id=$1 ${all ? '' : 'AND active=true'} ORDER BY entity,sort_order,label`, [orgId]);
    return json({ data: rows });
  } },
  { method: 'POST', path: 'custom-fields', handle: async ctx => {
    ensureAdmin(ctx.actor); const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id; const def = validateFieldDefinition(d, true);
    if (def.field_type === 'select' && !def.options?.length) throw new HttpError(400, 'A select field needs at least one option');
    const limit = await one<{ n: number }>(`SELECT count(*)::int AS n FROM crm_custom_fields WHERE organization_id=$1 AND entity=$2`, [orgId, def.entity]);
    if ((limit?.n ?? 0) >= 30) throw new HttpError(409, 'At most 30 custom fields per record type');
    const row = await guarded(() => one<Row>(`INSERT INTO crm_custom_fields(organization_id,entity,field_key,label,field_type,options,required,sort_order,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,entity,field_key`,
      [orgId, def.entity, def.field_key, def.label, def.field_type, def.field_type === 'select' ? def.options : [], def.required ?? false, v.num(d.sort_order ?? 100, 'Sort order', { max: 10000 }), ctx.actor.id]), 'A custom field with this key already exists');
    await audit(ctx.actor, 'crm_custom_field_create', 'crm_custom_fields', String(row!.id), { entity: def.entity, key: def.field_key });
    return json({ data: row }, 201);
  } },
  { method: 'PATCH', path: 'custom-fields/:id', handle: async ctx => {
    ensureAdmin(ctx.actor); const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id;
    if ('field_type' in d || 'field_key' in d || 'entity' in d) throw new HttpError(400, 'Key, type and record type cannot change after creation');
    const cur = await one<Row>('SELECT field_type FROM crm_custom_fields WHERE id=$1 AND organization_id=$2', [ctx.params.id, orgId]); if (!cur) throw new HttpError(404, 'Custom field not found');
    const def = validateFieldDefinition(d, false); const out: Row = {};
    if (def.label !== undefined) out.label = def.label; if (def.required !== undefined) out.required = def.required; if (def.active !== undefined) out.active = def.active;
    if (def.options !== undefined) { if (cur.field_type !== 'select') throw new HttpError(400, 'Only select fields have options'); if (!def.options.length) throw new HttpError(400, 'A select field needs at least one option'); out.options = def.options; }
    if (has(d, 'sort_order')) out.sort_order = v.num(d.sort_order, 'Sort order', { max: 10000, required: true });
    const q = buildUpdate('crm_custom_fields', out, orgId, ctx.params.id, ''); const row = await one<Row>(q.text, q.args);
    await audit(ctx.actor, 'crm_custom_field_update', 'crm_custom_fields', ctx.params.id, { fields: Object.keys(out) });
    return json({ data: row });
  } },

  { method: 'GET', path: 'workflow', handle: async ctx => json({ data: await workflowSettings(ctx.actor.organization_id) }) },
  { method: 'PATCH', path: 'workflow', handle: async ctx => {
    ensureAdmin(ctx.actor); const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id; await ensureConfigSeeded(orgId);
    const days = v.num(d.resume_followup_days, 'Follow-up delay', { max: 30, required: true })!; if (!Number.isInteger(days)) throw new HttpError(400, 'Follow-up delay must be a whole number of days');
    await sql('UPDATE crm_workflow_settings SET resume_followup_days=$2,updated_by=$3,updated_at=now() WHERE organization_id=$1', [orgId, days, ctx.actor.id]);
    await audit(ctx.actor, 'crm_workflow_update', 'crm_workflow_settings', null, { resume_followup_days: days });
    return json({ data: await workflowSettings(orgId) });
  } },
];
