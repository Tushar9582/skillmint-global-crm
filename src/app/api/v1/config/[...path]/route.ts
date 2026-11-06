import { routeApi } from '@/lib/hr/server';
import { configRoutes } from '@/lib/hr/routes-config';

const handler = routeApi(configRoutes, '/api/v1/config/');
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
