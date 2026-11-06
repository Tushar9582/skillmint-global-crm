import { routeApi } from '@/lib/hr/server';
import { financeRoutes } from '@/lib/hr/routes-finance';

const handler = routeApi(financeRoutes, '/api/v1/finance/');
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
