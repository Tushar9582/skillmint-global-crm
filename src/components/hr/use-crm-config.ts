'use client';

import { useEffect, useState } from 'react';
import { friendly, requestJson } from '@/lib/client-api';
import { FIELD_KINDS, applyOptions, type CustomFieldDef, type OptionKind } from '@/lib/hr/crm-config';
import type { ResourceDefinition } from '@/lib/catalog';

export type ConfigOption = { id: string; kind: OptionKind; value: string; label: string; sort_order: number; active: boolean; is_system: boolean };
export type ConfigField = CustomFieldDef & { id: string; entity: 'company_leads' | 'candidates'; sort_order: number };
type Cfg = { options: Partial<Record<OptionKind, ConfigOption[]>>; fields: ConfigField[] };

let cache: Cfg | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function invalidateCrmConfig() { cache = null; inflight = null; listeners.forEach(l => l()); }

function load(): Promise<void> {
  inflight ??= Promise.all([requestJson<{ data: Cfg['options'] }>('/api/v1/config/options'), requestJson<{ data: ConfigField[] }>('/api/v1/config/custom-fields')])
    .then(([o, f]) => { cache = { options: o.data, fields: f.data }; })
    .catch(() => { cache = { options: {}, fields: [] }; }) // fall back to the built-in lists
    .finally(() => listeners.forEach(l => l()));
  return inflight;
}

const entityOf = (resource: string) => resource === 'company-leads' ? 'company_leads' : resource === 'candidates' ? 'candidates' : null;

/** Admin-configured pick lists and custom fields, shared across the CRM screens. */
export function useCrmConfig() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1); listeners.add(l);
    if (!cache) void load().then(() => force(n => n + 1));
    return () => { listeners.delete(l); };
  }, []);
  const values = (kind: OptionKind, includeInactive = false) => (cache?.options[kind] ?? []).filter(o => includeInactive || o.active).map(o => o.value);
  return {
    ready: Boolean(cache),
    /** Catalog definition with configured values; a record's current value stays selectable even if it was deactivated. */
    configure(resource: string, def: ResourceDefinition, keep: Record<string, unknown> = {}): ResourceDefinition {
      const map: Partial<Record<OptionKind, string[]>> = {}; for (const k of new Set(FIELD_KINDS.filter(m => m.resource === resource).map(m => m.kind))) map[k] = values(k);
      return applyOptions(def, resource, map, keep);
    },
    stagesFor(resource: string, fallback?: string[]): string[] | undefined {
      const m = FIELD_KINDS.find(x => x.resource === resource && x.field === 'stage'); const all = m ? values(m.kind, true) : [];
      return all.length ? all : fallback;
    },
    label(resource: string, field: string, value: unknown): string {
      const m = FIELD_KINDS.find(x => x.resource === resource && x.field === field);
      return cache?.options[m?.kind as OptionKind]?.find(o => o.value === String(value))?.label ?? friendly(value);
    },
    /** Active values with labels for a pick list, or the fallback values while config is loading. */
    list(kind: OptionKind, fallback: string[]): Array<{ value: string; label: string }> {
      const rows = (cache?.options[kind] ?? []).filter(o => o.active);
      return rows.length ? rows.map(o => ({ value: o.value, label: o.label })) : fallback.map(value => ({ value, label: friendly(value) }));
    },
    customFields(resource: string): ConfigField[] { const e = entityOf(resource); return e ? (cache?.fields ?? []).filter(f => f.entity === e && f.active) : []; },
  };
}
