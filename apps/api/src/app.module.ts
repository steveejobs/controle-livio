import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { parseApiEnvironment } from '@livio/shared';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthenticationGuard } from './auth/authentication.guard';
import { PermissionGuard } from './auth/permission.guard';
import { TenantContextInterceptor } from './auth/tenant-context.interceptor';
import { DashboardModule } from './dashboard/dashboard.module';
import { ClientsModule } from './clients/clients.module';
import { DocumentsModule } from './documents/documents.module';
import { FinanceModule } from './finance/finance.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { MattersModule } from './matters/matters.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { WorkModule } from './work/work.module';
import { RequestRateLimitGuard } from './common/request-rate-limit.guard';
import { REQUEST_LOG_REDACT_PATHS } from './common/request-log-redaction';
import { RequestTimingInterceptor } from './common/request-timing.interceptor';

function generateRequestId(request: IncomingMessage): string {
  const header = request.headers['x-request-id'];
  const candidate = Array.isArray(header) ? header[0] : header;
  return candidate && candidate.length <= 100 ? candidate : randomUUID();
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../../.env'],
      validate: (values: Record<string, unknown>) => parseApiEnvironment(values),
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: generateRequestId,
        redact: { paths: [...REQUEST_LOG_REDACT_PATHS], censor: '[REDACTED]' },
        customProps: () => ({ service: 'livio-api' }),
      },
    }),
    PrismaModule,
    AuthModule,
    AdminModule,
    AuditModule,
    HealthModule,
    DashboardModule,
    ClientsModule,
    MattersModule,
    FinanceModule,
    DocumentsModule,
    WorkModule,
    NotificationsModule,
    ReportsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RequestRateLimitGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: RequestTimingInterceptor },
  ],
})
export class AppModule {}
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
