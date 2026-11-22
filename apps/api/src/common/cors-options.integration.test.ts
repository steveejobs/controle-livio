import {
  Controller,
  Get,
  Module,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCorsOptions } from './cors-options';

const webOrigin = 'https://web.livio.test';

class ProbeController {
  read() {
    return { ok: true };
  }

  protectedRead() {
    return { ok: true };
  }
}

class SyntheticTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>();
    return request.headers.authorization === 'Bearer synthetic-only';
  }
}

class ProbeModule {}

Get()(
  ProbeController.prototype,
  'read',
  Object.getOwnPropertyDescriptor(ProbeController.prototype, 'read')!,
);
Get('protected')(
  ProbeController.prototype,
  'protectedRead',
  Object.getOwnPropertyDescriptor(ProbeController.prototype, 'protectedRead')!,
);
UseGuards(SyntheticTokenGuard)(
  ProbeController.prototype,
  'protectedRead',
  Object.getOwnPropertyDescriptor(ProbeController.prototype, 'protectedRead')!,
);
Controller('cors-probe')(ProbeController);
Module({ controllers: [ProbeController], providers: [SyntheticTokenGuard] })(ProbeModule);

describe('configuração HTTP de CORS da API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = module.createNestApplication();
    app.enableCors(createCorsOptions([webOrigin]));
    await app.init();
  });

  afterAll(async () => app.close());

  it('permite preflight da web com credenciais e apenas métodos e cabeçalhos configurados', async () => {
    const response = await request(app.getHttpServer())
      .options('/cors-probe')
      .set('Origin', webOrigin)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'Authorization,Content-Type');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(webOrigin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
    expect(response.headers['access-control-allow-methods']).toContain('GET');
    expect(response.headers['access-control-allow-methods']).not.toContain('TRACE');
    expect(response.headers['access-control-allow-headers']).toContain('Authorization');
    expect(response.headers['access-control-allow-headers']).not.toContain('X-Forbidden');
  });

  it('nega origem externa sem gerar 500 nem revelar detalhes internos', async () => {
    const response = await request(app.getHttpServer())
      .options('/cors-probe')
      .set('Origin', 'https://external.invalid')
      .set('Access-Control-Request-Method', 'GET');

    expect(response.status).toBe(404);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    expect(response.text).not.toMatch(/stack|secret|password|Origem não permitida/i);
  });

  it('não exige Origin para uma requisição direta', async () => {
    const response = await request(app.getHttpServer()).options('/cors-probe');
    expect(response.status).toBeLessThan(500);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('não autoriza método e cabeçalho fora da lista, mesmo com Origin válido', async () => {
    const response = await request(app.getHttpServer())
      .options('/cors-probe')
      .set('Origin', webOrigin)
      .set('Access-Control-Request-Method', 'TRACE')
      .set('Access-Control-Request-Headers', 'X-Forbidden');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-methods']).not.toContain('TRACE');
    expect(response.headers['access-control-allow-headers']).not.toContain('X-Forbidden');
  });

  it('mantém a resposta normal e o CORS da web com e sem cookie', async () => {
    for (const cookie of [undefined, 'session=synthetic']) {
      const call = request(app.getHttpServer()).get('/cors-probe').set('Origin', webOrigin);
      if (cookie) call.set('Cookie', cookie);
      const response = await call;
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
      expect(response.headers['access-control-allow-origin']).toBe(webOrigin);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    }
  });

  it('não libera a resposta normal para leitura cross-origin não autorizada', async () => {
    const response = await request(app.getHttpServer())
      .get('/cors-probe')
      .set('Origin', 'https://external.invalid');
    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('não substitui a autorização de uma rota protegida', async () => {
    const denied = await request(app.getHttpServer())
      .get('/cors-probe/protected')
      .set('Origin', webOrigin);
    expect(denied.status).toBe(403);
    expect(denied.headers['access-control-allow-origin']).toBe(webOrigin);

    const allowed = await request(app.getHttpServer())
      .get('/cors-probe/protected')
      .set('Origin', webOrigin)
      .set('Authorization', 'Bearer synthetic-only');
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ ok: true });
  });
});
