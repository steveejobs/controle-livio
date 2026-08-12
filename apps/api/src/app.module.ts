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
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers.forwarded',
            'req.headers["x-vercel-oidc-token"]',
            'req.headers["x-vercel-proxy-signature"]',
            'req.headers["x-vercel-proxy-signature-ts"]',
            'req.body.password',
            'req.body.newPassword',
            'req.body.token',
            'req.body.refreshToken',
            'req.body.csrfToken',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDACTED]',
        },
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
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
