import { one } from './db';
import { HttpError, isDevDemoMode, isDemoModeRequested, type Actor } from './auth';
import { platformEnabled } from './tenant-context';
export type WorkspaceAccess={status:'legacy'|'trial'|'active'|'suspended'|'platform';trial_ends_at:string|null;paid_until:string|null;allowed:boolean};
export async function workspaceAccess(organizationId:string){
  return one<WorkspaceAccess>(`SELECT status,trial_ends_at,paid_until,
    (status IN ('legacy','platform') OR (status='trial' AND trial_ends_at>now()) OR
    (status='active' AND paid_until>now())) AS allowed FROM saas_workspace_access WHERE organization_id=$1`,[organizationId]);
}
export async function assertWorkspaceAccess(organizationId:string){
  const access=await workspaceAccess(organizationId);
  if(!access?.allowed)throw new HttpError(403,'Workspace access expired or suspended. Contact your account administrator.');
}
export async function isPlatformAdmin(actor:Pick<Actor,'id'|'role'>){
  if(!platformEnabled()||isDevDemoMode()||isDemoModeRequested()||actor.role!=='admin')return false;
  return Boolean(await one('SELECT user_id FROM saas_platform_owner WHERE user_id=$1',[actor.id]));
}
