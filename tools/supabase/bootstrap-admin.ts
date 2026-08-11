import { existsSync, readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import {
  initialRolePermissions,
  permissionActions,
  permissionResources,
} from '../../packages/shared/src/permissions';

function loadEnvironment() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]])
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Bootstrap bloqueado: variável ${name} ausente`);
  return value;
}

async function main() {
  loadEnvironment();
  const environment = required('SUPABASE_ENVIRONMENT');
  const supabaseUrl = required('SUPABASE_URL');
  const isLocal = process.env.SUPABASE_LOCAL === 'true';
  if (!['development', 'test', 'staging', 'production'].includes(environment)) {
    throw new Error('Bootstrap bloqueado: SUPABASE_ENVIRONMENT inválido');
  }
  if (isLocal) {
    if (
      !['development', 'test'].includes(environment) ||
      !['localhost', '127.0.0.1'].includes(new URL(supabaseUrl).hostname)
    ) {
      throw new Error('Bootstrap local exige development/test e URL local');
    }
  } else {
    if (process.env.ALLOW_REMOTE_BOOTSTRAP !== 'true')
      throw new Error('Bootstrap remoto não autorizado');
    if (required('SUPABASE_PROJECT_REF') !== required('CONFIRM_SUPABASE_PROJECT_REF')) {
      throw new Error('Bootstrap bloqueado: project ref não confirmado');
    }
    if (environment === 'production' && process.env.ALLOW_PRODUCTION_BOOTSTRAP !== 'true') {
      throw new Error('Bootstrap de produção exige confirmação adicional explícita');
    }
  }

  const email = required('BOOTSTRAP_ADMIN_EMAIL').trim().toLowerCase();
  const password = required('BOOTSTRAP_ADMIN_PASSWORD');
  if (password.length < 12)
    throw new Error('Bootstrap bloqueado: senha deve ter ao menos 12 caracteres');
  const fullName = required('BOOTSTRAP_ADMIN_NAME').trim();
  const organizationName = required('BOOTSTRAP_ORGANIZATION_NAME').trim();
  const organizationSlug = required('BOOTSTRAP_ORGANIZATION_SLUG').trim();

  const supabase = createClient(supabaseUrl, required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const prisma = new PrismaClient();
  let authUserId: string | undefined;
  let createdAuthUser = false;

  try {
    const listed = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listed.error) throw listed.error;
    authUserId = listed.data.users.find((user) => user.email?.toLowerCase() === email)?.id;
    if (!authUserId) {
      const created = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: isLocal,
        user_metadata: { full_name: fullName },
      });
      if (created.error || !created.data.user)
        throw created.error ?? new Error('Auth user não criado');
      authUserId = created.data.user.id;
      createdAuthUser = true;
    }

    await prisma.$transaction(async (transaction) => {
      const organization = await transaction.organization.upsert({
        where: { slug: organizationSlug },
        create: {
          slug: organizationSlug,
          legalName: organizationName,
          tradeName: organizationName,
        },
        update: { legalName: organizationName, tradeName: organizationName, status: 'ACTIVE' },
      });
      await transaction.profile.upsert({
        where: { id: authUserId! },
        create: { id: authUserId!, email, fullName },
        update: { email, fullName },
      });
      for (const resource of permissionResources) {
        for (const action of permissionActions) {
          await transaction.permission.upsert({
            where: {
              organizationId_resource_action: { organizationId: organization.id, resource, action },
            },
            create: { organizationId: organization.id, resource, action },
            update: {},
          });
        }
      }
      const role = await transaction.role.upsert({
        where: { organizationId_key: { organizationId: organization.id, key: 'administrator' } },
        create: {
          organizationId: organization.id,
          key: 'administrator',
          name: 'Administrador',
          isSystem: true,
        },
        update: { name: 'Administrador', isSystem: true },
      });
      const permissions = await transaction.permission.findMany({
        where: { organizationId: organization.id },
      });
      const adminCodes = new Set(initialRolePermissions.administrator);
      for (const permission of permissions) {
        if (!adminCodes.has(`${permission.resource}:${permission.action}` as never)) continue;
        await transaction.rolePermission.upsert({
          where: {
            organizationId_roleId_permissionId: {
              organizationId: organization.id,
              roleId: role.id,
              permissionId: permission.id,
            },
          },
          create: { organizationId: organization.id, roleId: role.id, permissionId: permission.id },
          update: {},
        });
      }
      const user = await transaction.user.upsert({
        where: { organizationId_email: { organizationId: organization.id, email } },
        create: {
          authUserId,
          organizationId: organization.id,
          email,
          passwordHash: null,
          fullName,
          status: 'ACTIVE',
        },
        update: { authUserId, passwordHash: null, fullName, status: 'ACTIVE', deletedAt: null },
      });
      const membership = await transaction.organizationMember.upsert({
        where: {
          organizationId_profileId: { organizationId: organization.id, profileId: authUserId! },
        },
        create: {
          organizationId: organization.id,
          profileId: authUserId!,
          userId: user.id,
          status: 'ACTIVE',
        },
        update: { userId: user.id, status: 'ACTIVE' },
      });
      await transaction.userRole.upsert({
        where: {
          organizationId_userId_roleId: {
            organizationId: organization.id,
            userId: user.id,
            roleId: role.id,
          },
        },
        create: { organizationId: organization.id, userId: user.id, roleId: role.id },
        update: {},
      });
      await transaction.organizationMemberRole.upsert({
        where: {
          organizationId_membershipId_roleId: {
            organizationId: organization.id,
            membershipId: membership.id,
            roleId: role.id,
          },
        },
        create: { organizationId: organization.id, membershipId: membership.id, roleId: role.id },
        update: {},
      });
    });
    process.stdout.write('Bootstrap concluído: organização e administrador estão vinculados.\n');
  } catch (error) {
    if (createdAuthUser && authUserId) await supabase.auth.admin.deleteUser(authUserId, true);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
