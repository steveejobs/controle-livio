import type { Request } from 'express';
import type { AuthenticatedActor } from '@livio/shared';

export interface RequestWithActor extends Request {
  actor?: AuthenticatedActor;
  qaTimings?: Record<string, number>;
}
