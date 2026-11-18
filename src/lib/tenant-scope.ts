import {AsyncLocalStorage} from 'node:async_hooks';
const scope=new AsyncLocalStorage<{organizationId:string}>();
export const tenantScope=()=>scope.getStore();
export function withTenantScope<T>(organizationId:string,work:()=>Promise<T>){return scope.run({organizationId},work);}
