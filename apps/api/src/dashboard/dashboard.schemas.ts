import { z } from 'zod';

export const dashboardPeriodSchema = z.enum(['3m', '6m', '12m', 'all']).default('6m');
export const dashboardSummaryQuerySchema = z.object({ period: dashboardPeriodSchema });

export type DashboardPeriod = z.infer<typeof dashboardPeriodSchema>;
