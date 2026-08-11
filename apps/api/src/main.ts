import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { parseCorsOrigins, type ApiEnvironment } from '@livio/shared';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  const config = app.get<ConfigService<ApiEnvironment, true>>(ConfigService);
  const origins = parseCorsOrigins(config.get('CORS_ORIGINS', { infer: true }));

  app.useLogger(logger);
  if (config.get('TRUST_PROXY', { infer: true })) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }
  app.use(helmet());
  app.setGlobalPrefix('v1');
  app.enableCors({
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Organization-Id',
      'X-Request-Id',
      'Idempotency-Key',
    ],
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (!origin || origins.includes(origin)) return callback(null, true);
      return callback(new Error('Origem não permitida pelo CORS'), false);
    },
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Lívio Jurídico API')
    .setDescription('API multiempresa para operação jurídica e financeira.')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'Supabase JWT' })
    .build();
  SwaggerModule.setup('v1/docs', app, SwaggerModule.createDocument(app, swaggerConfig), {
    jsonDocumentUrl: 'v1/docs/openapi.json',
  });

  const port = config.get('API_PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  logger.log({ event: 'api_started', port }, 'API iniciada');
}

void bootstrap();
