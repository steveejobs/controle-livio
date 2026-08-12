import { Injectable, NotFoundException } from '@nestjs/common';
import {
  initialRolePermissions,
  systemRoleKeys,
  type AuthenticatedActor,
  type SystemRoleKey,
} from '@livio/shared';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateRoleInput, CreateUserInput, UserStatusInput } from './admin.schemas';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly audit: AuditService,
  ) {}

  async createUser(actor: AuthenticatedActor, input: CreateUserInput) {
    const roles = await this.prisma.role.findMany({
      where: { id: { in: input.roleIds }, organizationId: actor.organizationId },
    });
    if (roles.length !== new Set(input.roleIds).size)
      throw new NotFoundException('Papel não encontrado');
    if (
      input.clientId &&
      !(await this.prisma.client.findFirst({
        where: { id: input.clientId, organizationId: actor.organizationId },
      }))
    )
      throw new NotFoundException('Cliente não encontrado');
    const authUser = await this.supabaseAdmin.invite(input.email, input.fullName);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.profile.upsert({
          where: { id: authUser.id },
          create: { id: authUser.id, email: input.email, fullName: input.fullName },
          update: { email: input.email, fullName: input.fullName },
        });
        const user = await transaction.user.create({
          data: {
            authUserId: authUser.id,
            organizationId: actor.organizationId,
            email: input.email,
            fullName: input.fullName,
            passwordHash: null,
            status: 'ACTIVE',
            ...(input.clientId ? { clientId: input.clientId } : {}),
            roles: {
              create: input.roleIds.map((roleId) => ({
                organizationId: actor.organizationId,
                roleId,
                assignedById: actor.userId,
              })),
            },
          },
          select: {
            id: true,
            email: true,
            fullName: true,
            status: true,
            clientId: true,
            createdAt: true,
          },
        });
        await transaction.organizationMember.create({
          data: {
            organizationId: actor.organizationId,
            profileId: authUser.id,
            userId: user.id,
            clientId: input.clientId,
            status: 'ACTIVE',
            roles: {
              create: input.roleIds.map((roleId) => ({
                organizationId: actor.organizationId,
                roleId,
                assignedByMembershipId: actor.membershipId,
              })),
            },
          },
        });
        await this.audit.record(transaction, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          actorSessionId: actor.sessionId,
          action: 'CREATE',
          resource: 'user',
          resourceId: user.id,
          after: user,
        });
        return user;
      });
    } catch (error) {
      await this.supabaseAdmin.removeUser(authUser.id);
      throw error;
    }
  }

  listUsers(actor: AuthenticatedActor) {
    return this.prisma.user.findMany({
      where: { organizationId: actor.organizationId, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        clientId: true,
        lastLoginAt: true,
        roles: { select: { role: { select: { id: true, key: true, name: true } } } },
      },
      orderBy: { fullName: 'asc' },
    });
  }

  async setUserStatus(actor: AuthenticatedActor, userId: string, input: UserStatusInput) {
    const before = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Usuário não encontrado');
    return this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        where: { id: userId },
        data: {
          status: input.status,
          membership: { update: { status: input.status } },
        },
        select: { id: true, email: true, fullName: true, status: true },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'UPDATE',
        resource: 'user',
        resourceId: userId,
        before: { status: before.status },
        after: user,
      });
      return user;
    });
  }

  async createRole(actor: AuthenticatedActor, input: CreateRoleInput) {
    return this.prisma.$transaction(async (transaction) => {
      const permissions = await transaction.permission.findMany({
        where: { organizationId: actor.organizationId, OR: input.permissions },
      });
      if (permissions.length !== input.permissions.length)
        throw new NotFoundException('Permissão não encontrada');
      const role = await transaction.role.create({
        data: {
          organizationId: actor.organizationId,
          key: input.key,
          name: input.name,
          description: input.description,
          permissions: {
            create: permissions.map((permission) => ({
              organizationId: actor.organizationId,
              permissionId: permission.id,
            })),
          },
        },
        include: { permissions: { include: { permission: true } } },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CREATE',
        resource: 'role',
        resourceId: role.id,
        after: role,
      });
      return role;
    });
  }

  listRoles(actor: AuthenticatedActor) {
    return this.prisma.role.findMany({
      where: { organizationId: actor.organizationId },
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async reconcileSystemRoles(actor: AuthenticatedActor) {
    const roleNames: Record<SystemRoleKey, string> = {
      administrator: 'Administrador',
      lawyer: 'Advogado',
      secretary: 'Secretaria',
      finance: 'Financeiro',
      client: 'Cliente',
    };
    await this.prisma.$transaction(async (transaction) => {
      const permissions = await transaction.permission.findMany({
        where: { organizationId: actor.organizationId },
      });
      const permissionByCode = new Map(
        permissions.map((permission) => [
          `${permission.resource}:${permission.action}`,
          permission.id,
        ]),
      );
      for (const key of systemRoleKeys) {
        const role = await transaction.role.upsert({
          where: { organizationId_key: { organizationId: actor.organizationId, key } },
          create: {
            organizationId: actor.organizationId,
            key,
            name: roleNames[key],
            isSystem: true,
          },
          update: { name: roleNames[key], isSystem: true },
        });
        const permissionIds = initialRolePermissions[key].map((code) => permissionByCode.get(code));
        if (permissionIds.some((id) => !id))
          throw new NotFoundException('Catálogo de permissões incompleto');
        await transaction.rolePermission.deleteMany({
          where: { organizationId: actor.organizationId, roleId: role.id },
        });
        await transaction.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({
            organizationId: actor.organizationId,
            roleId: role.id,
            permissionId: permissionId!,
          })),
          skipDuplicates: true,
        });
        await this.audit.record(transaction, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          actorSessionId: actor.sessionId,
          action: 'UPDATE',
          resource: 'role',
          resourceId: role.id,
          after: { key, permissions: initialRolePermissions[key] },
        });
      }
    });
    return this.listRoles(actor);
  }
}
