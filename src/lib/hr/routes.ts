import type { ServerRoute } from './server';
import { coreRoutes } from './routes-core';
import { leaveShiftRoutes } from './routes-leave';
import { reportRoutes } from './routes-reports';

export const hrRoutes: ServerRoute[] = [...coreRoutes, ...leaveShiftRoutes, ...reportRoutes];
