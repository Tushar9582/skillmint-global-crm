import type { PoolClient } from 'pg';
import { sql } from './db';
import type { Actor } from './auth';

export async function audit(
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string,unknown> = {},
  client?: PoolClient,
) {
  await sql(
    `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,details)
     VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [actor.organization_id,actor.id,action,entityType,entityId,JSON.stringify(details)],
    client,
  );
}

export async function notify(
  orgId: string,
  userId: string | null | undefined,
  title: string,
  body: string,
  href: string,
  client?: PoolClient,
) {
  if(!userId) return;
  await sql(
    `INSERT INTO notifications(organization_id,user_id,title,body,href) VALUES($1,$2,$3,$4,$5)`,
    [orgId,userId,title,body,href],client,
  );
}
