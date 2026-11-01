import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { Prisma, PrismaClient } from '@livio/db';
import {
  summarizePoolGauges,
  summarizePoolWaitHistogram,
  summarizeQueryShape,
} from './pool-diagnostics';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private poolMetricsTimer?: NodeJS.Timeout;
  private poolMetricSamples = 0;
  private maxWaitingQueries = 0;
  private maxBusyConnections = 0;
  private maxOpenConnections = 0;

  constructor() {
    const timingEnabled = process.env.QA_TIMINGS === 'true';
    const log: Prisma.LogDefinition[] = timingEnabled ? [{ emit: 'event', level: 'query' }] : [];
    super({ log });
    if (timingEnabled) {
      const subscribeToQuery = this.$on as unknown as (
        eventName: 'query',
        listener: (event: { duration: number; query: string }) => void,
      ) => void;
      subscribeToQuery.call(this, 'query', (event) => {
        process.stdout.write(
          `${JSON.stringify({
            event: 'prisma_query_timing',
            time: Date.now(),
            durationMs: event.duration,
            ...summarizeQueryShape(event.query),
          })}\n`,
        );
      });
    }
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    if (process.env.QA_TIMINGS !== 'true') return;

    const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
    process.stdout.write(
      `${JSON.stringify({
        event: 'prisma_pool_config',
        connectionLimit: databaseUrl?.searchParams.get('connection_limit') ?? 'Prisma default',
        poolTimeoutSeconds: databaseUrl?.searchParams.get('pool_timeout') ?? '10 (Prisma default)',
        metricsPreview: true,
      })}\n`,
    );
    const sample = async () => {
      try {
        const metrics = await this.$metrics.json();
        const { waiting, busy, open } = summarizePoolGauges(metrics);
        this.poolMetricSamples += 1;
        this.maxWaitingQueries = Math.max(this.maxWaitingQueries, waiting);
        this.maxBusyConnections = Math.max(this.maxBusyConnections, busy);
        this.maxOpenConnections = Math.max(this.maxOpenConnections, open);
        const waitHistogram = summarizePoolWaitHistogram(metrics);
        return {
          waiting,
          busy,
          open,
          waitHistogram: waitHistogram
            ? { count: waitHistogram.count, sum: waitHistogram.sum }
            : null,
        };
      } catch {
        return undefined;
      }
    };
    await sample();
    let lastLogAt = performance.now();
    this.poolMetricsTimer = setInterval(() => {
      void sample().then((values) => {
        if (!values) return;
        const now = performance.now();
        if (values.waiting > 0 || now - lastLogAt >= 1_000) {
          process.stdout.write(
            `${JSON.stringify({ event: 'prisma_pool_sample', time: Date.now(), ...values })}\n`,
          );
          lastLogAt = now;
        }
      });
    }, 100);
    this.poolMetricsTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.poolMetricsTimer) clearInterval(this.poolMetricsTimer);
    if (process.env.QA_TIMINGS === 'true') {
      try {
        const metrics = await this.$metrics.json();
        process.stdout.write(
          `${JSON.stringify({
            event: 'prisma_pool_summary',
            samples: this.poolMetricSamples,
            maxWaitingQueries: this.maxWaitingQueries,
            maxBusyConnections: this.maxBusyConnections,
            maxOpenConnections: this.maxOpenConnections,
            waitHistogram: summarizePoolWaitHistogram(metrics),
          })}\n`,
        );
      } catch {
        process.stdout.write(
          `${JSON.stringify({ event: 'prisma_pool_summary', available: false })}\n`,
        );
      }
    }
    await this.$disconnect();
  }
}
