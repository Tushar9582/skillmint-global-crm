import { CATALOG, type ResourceDefinition } from '../catalog';
import { RuleError } from './core';

export const OPTION_KINDS = ['company_lead_stage', 'candidate_stage', 'priority', 'company_lead_source', 'candidate_source', 'followup_type'] as const;
export type OptionKind = typeof OPTION_KINDS[number];
export const KIND_LABELS: Record<OptionKind, string> = {
  company_lead_stage: 'Company lead statuses', candidate_stage: 'Candidate stages', priority: 'Lead priorities',
  company_lead_source: 'Company lead sources', candidate_source: 'Candidate sources', followup_type: 'Follow-up types',
};

/** Which catalog field each pick-list drives. */
export const FIELD_KINDS: Array<{ resource: string; field: string; kind: OptionKind }> = [
  { resource: 'company-leads', field: 'stage', kind: 'company_lead_stage' }, { resource: 'company-leads', field: 'priority', kind: 'priority' }, { resource: 'company-leads', field: 'source', kind: 'company_lead_source' },
  { resource: 'candidates', field: 'stage', kind: 'candidate_stage' }, { resource: 'candidates', field: 'source', kind: 'candidate_source' },
  { resource: 'jobs', field: 'priority', kind: 'priority' }, { resource: 'followups', field: 'priority', kind: 'priority' },
];

/** Values that application logic depends on (conversion, resume intake, daily call counts, defaults). */
export const SYSTEM_VALUES: Record<OptionKind, string[]> = {
  company_lead_stage: ['new', 'converted'], candidate_stage: ['new'], priority: ['medium'], company_lead_source: ['manual'], candidate_source: ['manual', 'resume'], followup_type: ['call', 'other'],
};
export const FOLLOWUP_TYPE_DEFAULTS = ['call', 'email', 'whatsapp', 'meeting', 'other'];
const titleCase = (v: string) => v.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

export function defaultOptions(kind: OptionKind): Array<{ value: string; label: string; sort_order: number; is_system: boolean }> {
  const fromCatalog = (resource: string, field: string) => CATALOG[resource].fields.find(f => f.name === field)?.options ?? [];
  const values = kind === 'company_lead_stage' ? CATALOG['company-leads'].stages ?? [] : kind === 'candidate_stage' ? CATALOG.candidates.stages ?? []
    : kind === 'priority' ? fromCatalog('company-leads', 'priority') : kind === 'company_lead_source' ? fromCatalog('company-leads', 'source')
    : kind === 'candidate_source' ? fromCatalog('candidates', 'source') : FOLLOWUP_TYPE_DEFAULTS;
  return values.map((value, i) => ({ value, label: titleCase(value), sort_order: (i + 1) * 10, is_system: SYSTEM_VALUES[kind].includes(value) }));
}

export const VALUE_RE = /^[a-z][a-z0-9_]{1,39}$/;
export function toValue(input: unknown): string {
  const v = String(input ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!VALUE_RE.test(v)) throw new RuleError(400, 'Value must start with a letter and contain 2-40 letters, digits or underscores');
  return v;
}
export function cleanLabel(input: unknown): string {
  const label = String(input ?? '').trim();
  if (!label || label.length > 60) throw new RuleError(400, 'Label is required (up to 60 characters)');
  return label;
}

export interface CustomFieldDef { field_key: string; label: string; field_type: 'text' | 'number' | 'date' | 'select'; options: string[]; required: boolean; active: boolean }

export function validateFieldDefinition(d: Record<string, unknown>, create: boolean): Partial<CustomFieldDef> & { entity?: string } {
  const out: Partial<CustomFieldDef> & { entity?: string } = {};
  if (create) {
    out.field_key = toValue(d.field_key ?? d.label);
    if (!['company_leads', 'candidates'].includes(String(d.entity))) throw new RuleError(400, 'Entity must be company_leads or candidates');
    out.entity = String(d.entity);
    if (!['text', 'number', 'date', 'select'].includes(String(d.field_type))) throw new RuleError(400, 'Field type is invalid');
    out.field_type = d.field_type as CustomFieldDef['field_type'];
    if ([...CATALOG['company-leads'].fields, ...CATALOG.candidates.fields].some(f => f.name === out.field_key)) throw new RuleError(400, 'That key is already used by a built-in field');
  }
  if (create || 'label' in d) out.label = cleanLabel(d.label);
  if (create || 'required' in d) out.required = d.required === true || d.required === 'true';
  if ('active' in d) out.active = d.active === true || d.active === 'true';
  if (create || 'options' in d) {
    const raw = Array.isArray(d.options) ? d.options : String(d.options ?? '').split(',');
    const options = [...new Set(raw.map(x => String(x).trim()).filter(Boolean))];
    if (options.some(o => o.length > 60) || options.length > 40) throw new RuleError(400, 'Options are limited to 40 entries of 60 characters');
    out.options = options;
  }
  return out;
}

/** Validates custom values against the active definitions. Unknown keys are rejected; values of inactive fields are preserved. */
export function validateCustomValues(defs: CustomFieldDef[], input: unknown, previous: Record<string, unknown>, create: boolean): Record<string, unknown> {
  const source = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const active = defs.filter(d => d.active);
  for (const key of Object.keys(source)) if (!active.some(d => d.field_key === key)) throw new RuleError(400, `Unknown custom field "${key}"`);
  const out: Record<string, unknown> = { ...previous };
  for (const d of active) {
    const provided = Object.prototype.hasOwnProperty.call(source, d.field_key);
    if (!provided) { if (create && d.required) throw new RuleError(400, `${d.label} is required`); continue; }
    const raw = source[d.field_key];
    if (raw === '' || raw === null || raw === undefined) { if (d.required) throw new RuleError(400, `${d.label} is required`); delete out[d.field_key]; continue; }
    if (d.field_type === 'number') { const n = Number(raw); if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw new RuleError(400, `${d.label} must be a number`); out[d.field_key] = n; }
    else if (d.field_type === 'date') { const s = String(raw).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new RuleError(400, `${d.label} must be a valid date`); out[d.field_key] = s; }
    else if (d.field_type === 'select') { if (!d.options.includes(String(raw))) throw new RuleError(400, `${d.label} must be one of the configured options`); out[d.field_key] = String(raw); }
    else { const s = String(raw).trim(); if (s.length > 300) throw new RuleError(400, `${d.label} is too long`); out[d.field_key] = s; }
  }
  return out;
}

/** Applies configured pick-list values to a catalog definition for forms and filters. */
export function applyOptions(def: ResourceDefinition, resource: string, options: Partial<Record<OptionKind, string[]>>, keep: Record<string, unknown> = {}): ResourceDefinition {
  const mapped = FIELD_KINDS.filter(m => m.resource === resource);
  if (!mapped.length) return def;
  const fields = def.fields.map(f => {
    const m = mapped.find(x => x.field === f.name); const values = m && options[m.kind]; if (!values?.length) return f;
    const current = keep[f.name]; return { ...f, options: current && !values.includes(String(current)) ? [...values, String(current)] : values };
  });
  const stageKind = mapped.find(m => m.field === 'stage'); return { ...def, fields, stages: stageKind && options[stageKind.kind]?.length ? options[stageKind.kind] : def.stages };
}
