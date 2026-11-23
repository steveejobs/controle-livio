import type { RequestWithActor } from './request-with-actor';

export function recordRequestTiming(request: RequestWithActor, name: string, durationMs: number) {
  if (process.env.QA_TIMINGS !== 'true') return;
  request.qaTimings ??= {};
  request.qaTimings[name] = Math.round(durationMs * 10) / 10;
}
