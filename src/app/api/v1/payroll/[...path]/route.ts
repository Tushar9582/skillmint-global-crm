import { routeApi } from '@/lib/hr/server';
import { payrollRoutes } from '@/lib/hr/routes-payroll';

const handler = routeApi(payrollRoutes, '/api/v1/payroll/');
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
