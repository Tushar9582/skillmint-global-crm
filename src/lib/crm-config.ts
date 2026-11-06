import type { PoolClient } from 'pg';
import { one, sql } from './db';
import { FIELD_KINDS, OPTION_KINDS, defaultOptions, type CustomFieldDef, type OptionKind } from './hr/crm-config';

export interface OptionRow { id: string; kind: OptionKind; value: string; label: string; sort_order: number; active: boolean; is_system: boolean }

/** Seeds each pick-list from the built-in catalog the first time an organization uses it. */
export async function ensureConfigSeeded(orgId: string, client?: PoolClient): Promise<void> {
  const present = new Set((await sql<{ kind: string }>('SELECT DISTINCT kind FROM crm_config_options WHERE organization_id=$1', [orgId], client)).map(r => r.kind));
  for (const kind of OPTION_KINDS) {
    if (present.has(kind)) continue;
    for (const o of defaultOptions(kind))
      await sql(`INSERT INTO crm_config_options(organization_id,kind,value,label,sort_order,is_system) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [orgId, kind, o.value, o.label, o.sort_order, o.is_system], client);
  }
  await sql('INSERT INTO crm_workflow_settings(organization_id) VALUES($1) ON CONFLICT DO NOTHING', [orgId], client);
}

export async function loadOptions(orgId: string, client?: PoolClient): Promise<OptionRow[]> {
  await ensureConfigSeeded(orgId, client);
  return sql<OptionRow>('SELECT id,kind,value,label,sort_order,active,is_system FROM crm_config_options WHERE organization_id=$1 ORDER BY kind,sort_order,label', [orgId], client);
}

/** Allowed values per catalog field name for a resource. Inactive values are excluded unless requested (used for filters). */
export async function optionValuesFor(orgId: string, resource: string, includeInactive = false, client?: PoolClient): Promise<Record<string, string[]>> {
  const mapped = FIELD_KINDS.filter(m => m.resource === resource);
  if (!mapped.length) return {};
  const rows = await loadOptions(orgId, client); const out: Record<string, string[]> = {};
  for (const m of mapped) out[m.field] = rows.filter(r => r.kind === m.kind && (includeInactive || r.active)).map(r => r.value);
  return out;
}

export async function activeValues(orgId: string, kind: OptionKind, client?: PoolClient): Promise<string[]> {
  return (await loadOptions(orgId, client)).filter(r => r.kind === kind && r.active).map(r => r.value);
}

export async function customFieldDefs(orgId: string, entity: 'company_leads' | 'candidates', client?: PoolClient): Promise<CustomFieldDef[]> {
  return sql<CustomFieldDef>(`SELECT field_key,label,field_type,options,required,active FROM crm_custom_fields WHERE organization_id=$1 AND entity=$2 ORDER BY sort_order,label`, [orgId, entity], client);
}

export async function workflowSettings(orgId: string, client?: PoolClient): Promise<{ resume_followup_days: number }> {
  await ensureConfigSeeded(orgId, client);
  const row = await one<{ resume_followup_days: number }>('SELECT resume_followup_days FROM crm_workflow_settings WHERE organization_id=$1', [orgId], client);
  return { resume_followup_days: Number(row?.resume_followup_days ?? 1) };
}
