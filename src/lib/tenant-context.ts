import { AsyncLocalStorage } from 'node:async_hooks';

/** Tenant scope is derived solely from the verified server-side account/session. */
export type TenantScope={organizationId:string;userId:string};
const context=new AsyncLocalStorage<TenantScope>();
export function saasIsolationEnabled(){return process.env.SAAS_TENANT_RLS==='true';}
export function registrationEnabled(){return saasIsolationEnabled()&&process.env.SAAS_REGISTRATION_ENABLED==='true'&&process.env.DEMO_MODE!=='true'&&process.env.DEV_DEMO_MODE!=='true';}
export function platformEnabled(){return saasIsolationEnabled()&&process.env.SAAS_PLATFORM_ENABLED==='true'&&process.env.DEMO_MODE!=='true'&&process.env.DEV_DEMO_MODE!=='true';}
export function tenantScope(){return context.getStore();}
export function withTenantScope<T>(scope:TenantScope,work:()=>Promise<T>):Promise<T>{return context.run(scope,work);}
