import { routeApi } from '@/lib/hr/server';
import { hrRoutes } from '@/lib/hr/routes';

const handler = routeApi(hrRoutes, '/api/v1/hr/');
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
