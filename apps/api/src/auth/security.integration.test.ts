import {
  Controller,
  Get,
  Module,
  Post,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequestWithActor } from '../common/request-with-actor';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';

class IntegrationActorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const requestWithActor = context.switchToHttp().getRequest<RequestWithActor>();
    requestWithActor.actor = {
      userId: 'user-a',
      profileId: 'profile-a',
      membershipId: 'membership-a',
      organizationId: 'org-a',
      permissions: ['clients:view', 'clients:create'],
    };
    return true;
  }
}

class IntegrationController {
  read() {
    return { ok: true };
  }

  mutate() {
    return { ok: true };
  }
}

class IntegrationModule {}

const controllerPrototype = IntegrationController.prototype;
Get()(controllerPrototype, 'read', Object.getOwnPropertyDescriptor(controllerPrototype, 'read')!);
RequirePermission('clients:view')(
  controllerPrototype,
  'read',
  Object.getOwnPropertyDescriptor(controllerPrototype, 'read')!,
);
Post()(
  controllerPrototype,
  'mutate',
  Object.getOwnPropertyDescriptor(controllerPrototype, 'mutate')!,
);
RequirePermission('clients:create')(
  controllerPrototype,
  'mutate',
  Object.getOwnPropertyDescriptor(controllerPrototype, 'mutate')!,
);
Controller('integration-security')(IntegrationController);
Module({ controllers: [IntegrationController] })(IntegrationModule);

describe('pipeline HTTP de segurança', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      imports: [IntegrationModule],
    }).compile();
    app = testingModule.createNestApplication();
    app.useGlobalGuards(new IntegrationActorGuard(), new PermissionGuard(app.get(Reflector)));
    await app.init();
  });

  afterAll(async () => app.close());

  it('integra autenticação resolvida e permissão no pipeline Nest', async () => {
    await request(app.getHttpServer()).get('/integration-security').expect(200, { ok: true });
    const response = await request(app.getHttpServer()).post('/integration-security').expect(201);
    expect(response.body).toEqual({ ok: true });
  });
});
