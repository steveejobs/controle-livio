import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma, type AuditAction } from '@livio/db';
import type { AuthenticatedActor, PermissionCode } from '@livio/shared';
import { CurrentActor } from '../auth/current-actor.decorator';
import { AuthenticatedRoute } from '../auth/authenticated-route.decorator';
import { RequireAdministrator } from '../auth/require-administrator.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import {
  auditQuerySchema,
  clientViewSchema,
  moduleViewSchema,
  type AuditQuery,
  type ClientViewInput,
  type ModuleViewInput,
  type TrackedModule,
} from './audit.schemas';

const accessActions = [
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'SESSION_REVOKED',
] satisfies AuditAction[];

const moduleLabels = {
  dashboard: 'Visão geral',
  portal: 'Minha área',
  clients: 'Clientes',
  matters: 'Processos',
  legal: 'CRM jurídico e comercial',
  collection: 'Cobrança',
  documents: 'Documentos',
  tasks: 'Tarefas',
  calendar: 'Agenda',
  notifications: 'Notificações',
  contracts: 'Contratos',
  finance: 'Recebíveis',
  reports: 'Relatórios',
  admin: 'Usuários e permissões',
  pipelines: 'Pipelines',
  audit: 'Atividades do sistema',
} as const;

const modulePermissions: Record<TrackedModule, PermissionCode> = {
  dashboard: 'reports:view',
  portal: 'messages:view',
  clients: 'clients:view',
  matters: 'matters:view',
  legal: 'matters:view',
  collection: 'matters:view',
  documents: 'documents:view',
  tasks: 'tasks:view',
  calendar: 'calendar:view',
  notifications: 'notifications:view',
  contracts: 'contracts:view',
  finance: 'receivables:view',
  reports: 'reports:view',
  admin: 'users:view',
  pipelines: 'pipelines:view',
  audit: 'audit:view',
};

const fieldLabels: Record<string, string> = {
  address: 'Endereço',
  amount: 'Valor',
  assignedToId: 'Responsável',
  category: 'Categoria',
  clientId: 'Cliente',
  collectionObjective: 'Objetivo da negociação',
  dueDate: 'Vencimento',
  displayName: 'Nome',
  email: 'E-mail',
  endsAt: 'Fim da vigência',
  feeModel: 'Modelo de honorários',
  fixedAmount: 'Honorários fixos',
  fullName: 'Nome',
  isActive: 'Ativo',
  name: 'Nome',
  number: 'Número',
  paymentDate: 'Data do pagamento',
  permissions: 'Permissões',
  phone: 'Telefone',
  position: 'Ordem',
  priority: 'Prioridade',
  role: 'Papel',
  status: 'Situação',
  taxIdNormalized: 'CPF/CNPJ',
  customFields: 'Qualificação e informações adicionais',
  successRate: 'Percentual de êxito',
  title: 'Título',
  type: 'Tipo',
};

type AuditRecord = {
  id: string;
  actorUserId: string | null;
  action: AuditAction;
  resource: string;
  resourceId: string | null;
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
  createdAt: Date;
};

type ActivityRecord = {
  id: string;
  actorUserId: string | null;
  type: string;
  subjectType: string;
  subjectId: string;
  summary: string;
  metadata: Prisma.JsonValue;
  occurredAt: Date;
};

function jsonRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeTargetLabel(before: Prisma.JsonValue | null, after: Prisma.JsonValue | null) {
  const keys = ['displayName', 'title', 'number', 'reference', 'name', 'fullName'];
  const records = [jsonRecord(after), jsonRecord(before)];
  for (const item of records) {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120);
    }
  }
  return undefined;
}

function changedFieldLabels(before: Prisma.JsonValue | null, after: Prisma.JsonValue | null) {
  const beforeRecord = jsonRecord(before);
  const afterRecord = jsonRecord(after);
  const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
  return [...keys]
    .filter((key) => JSON.stringify(beforeRecord[key]) !== JSON.stringify(afterRecord[key]))
    .slice(0, 8)
    .map((key) => fieldLabels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2'));
}

function localDateStart(value: string): Date {
  return new Date(`${value}T00:00:00-03:00`);
}

function localDateEndExclusive(value: string): Date {
  const end = localDateStart(value);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

@ApiTags('Auditoria')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('module-views')
  @AuthenticatedRoute()
  async recordModuleView(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(moduleViewSchema)) input: ModuleViewInput,
  ) {
    if (!actor.permissions.includes(modulePermissions[input.module]))
      throw new ForbiddenException('Acesso negado a esta área do sistema.');
    if (input.module === 'audit' && !actor.isAdministrator)
      throw new ForbiddenException('Apenas Administrador pode consultar as atividades do sistema.');
    if (input.module === 'portal' && !actor.clientId)
      throw new ForbiddenException('Esta área está disponível apenas para clientes.');
    await this.prisma.activityEvent.create({
      data: {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        type: 'MODULE_VIEW',
        subjectType: 'user',
        subjectId: actor.userId,
        summary: `Abriu ${moduleLabels[input.module]}`,
        metadata: { module: input.module },
      },
    });
    return { recorded: true };
  }

  @Post('client-views')
  @AuthenticatedRoute()
  async recordClientView(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(clientViewSchema)) input: ClientViewInput,
  ) {
    if (!actor.permissions.includes('clients:view'))
      throw new ForbiddenException('Acesso negado ao cadastro deste cliente.');
    if (actor.clientId && actor.clientId !== input.clientId)
      throw new NotFoundException('Cliente não encontrado.');
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, organizationId: actor.organizationId, deletedAt: null },
      select: { id: true, displayName: true },
    });
    if (!client) throw new NotFoundException('Cliente não encontrado.');
    await this.prisma.activityEvent.create({
      data: {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        type: 'CLIENT_VIEW',
        subjectType: 'client',
        subjectId: client.id,
        summary: `Abriu a ficha de cliente: ${client.displayName}`,
        metadata: {},
      },
    });
    return { recorded: true };
  }

  @Get('actors')
  @RequirePermission('audit:view')
  @RequireAdministrator()
  async actors(@CurrentActor() actor: AuthenticatedActor) {
    const items = await this.prisma.user.findMany({
      where: { organizationId: actor.organizationId },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: 'asc' },
      take: 1000,
    });
    return { items, total: items.length };
  }

  @Get()
  @RequirePermission('audit:view')
  @RequireAdministrator()
  async list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
  ) {
    const organizationId = actor.organizationId;
    const search = query.search?.trim();
    const actorSearch = search
      ? await this.prisma.user.findMany({
          where: {
            organizationId,
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
          take: 500,
        })
      : [];
    const actorIds = actorSearch.map(({ id }) => id);
    const searchIsUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        search ?? '',
      );
    const dateFilter = {
      ...(query.dateFrom ? { gte: localDateStart(query.dateFrom) } : {}),
      ...(query.dateTo ? { lt: localDateEndExclusive(query.dateTo) } : {}),
    };
    const auditSearch: Prisma.AuditLogWhereInput[] = search
      ? [
          { resource: { contains: search, mode: 'insensitive' } },
          ...(searchIsUuid ? [{ resourceId: search }] : []),
          ...(actorIds.length ? [{ actorUserId: { in: actorIds } }] : []),
        ]
      : [];
    const activitySearch: Prisma.ActivityEventWhereInput[] = search
      ? [
          { summary: { contains: search, mode: 'insensitive' } },
          { type: { contains: search, mode: 'insensitive' } },
          { subjectType: { contains: search, mode: 'insensitive' } },
          ...(searchIsUuid ? [{ subjectId: search }] : []),
          ...(actorIds.length ? [{ actorUserId: { in: actorIds } }] : []),
        ]
      : [];
    const auditWhere: Prisma.AuditLogWhereInput = {
      organizationId,
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
      ...(query.category === 'access' ? { action: { in: accessActions } } : {}),
      ...(query.category === 'changes' ? { action: { notIn: accessActions } } : {}),
      ...(query.category === 'navigation' ? { id: '__no_navigation_audit__' } : {}),
      ...(search ? { OR: auditSearch } : {}),
    };
    const activityWhere: Prisma.ActivityEventWhereInput = {
      organizationId,
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(Object.keys(dateFilter).length ? { occurredAt: dateFilter } : {}),
      ...(query.category === 'access' ? { type: 'SYSTEM_ACCESS' } : {}),
      ...(query.category === 'navigation' ? { type: { in: ['MODULE_VIEW', 'CLIENT_VIEW'] } } : {}),
      ...(query.category === 'changes' ? { type: '__no_activity_changes__' } : {}),
      ...(search ? { OR: activitySearch } : {}),
    };
    const offset = (query.page - 1) * query.pageSize;
    const take = offset + query.pageSize;
    const includeAudit = query.category !== 'navigation';
    const includeActivity = query.category !== 'changes';
    const [auditRecords, auditTotal, activityRecords, activityTotal] = await Promise.all([
      includeAudit
        ? this.prisma.auditLog.findMany({ where: auditWhere, take, orderBy: { createdAt: 'desc' } })
        : Promise.resolve([] as AuditRecord[]),
      includeAudit ? this.prisma.auditLog.count({ where: auditWhere }) : Promise.resolve(0),
      includeActivity
        ? this.prisma.activityEvent.findMany({
            where: activityWhere,
            take,
            orderBy: { occurredAt: 'desc' },
          })
        : Promise.resolve([] as ActivityRecord[]),
      includeActivity
        ? this.prisma.activityEvent.count({ where: activityWhere })
        : Promise.resolve(0),
    ]);
    const eventActorIds = [
      ...new Set(
        [...auditRecords, ...activityRecords]
          .map((item) => item.actorUserId)
          .filter((userId): userId is string => Boolean(userId)),
      ),
    ];
    const actors = eventActorIds.length
      ? await this.prisma.user.findMany({
          where: { organizationId, id: { in: eventActorIds } },
          select: { id: true, fullName: true, email: true },
        })
      : [];
    const actorById = new Map(actors.map((user) => [user.id, user]));
    const auditItems = auditRecords.map((item) => {
      const user = item.actorUserId ? actorById.get(item.actorUserId) : undefined;
      return {
        id: `audit:${item.id}`,
        kind: 'CHANGE' as const,
        action: item.action,
        resource: item.resource,
        resourceId: item.resourceId,
        summary: undefined,
        targetLabel: safeTargetLabel(item.before, item.after),
        changedFields: changedFieldLabels(item.before, item.after),
        occurredAt: item.createdAt,
        actorUserId: item.actorUserId,
        actorName: user?.fullName ?? (item.actorUserId ? 'Usuário sem cadastro ativo' : 'Sistema'),
        actorEmail: user?.email,
      };
    });
    const activityItems = activityRecords.map((item) => {
      const user = item.actorUserId ? actorById.get(item.actorUserId) : undefined;
      return {
        id: `activity:${item.id}`,
        kind:
          item.type === 'MODULE_VIEW' || item.type === 'CLIENT_VIEW'
            ? ('NAVIGATION' as const)
            : ('ACCESS' as const),
        action: item.type,
        resource: item.subjectType,
        resourceId: item.subjectId,
        summary: item.summary,
        targetLabel: undefined,
        changedFields: [],
        occurredAt: item.occurredAt,
        actorUserId: item.actorUserId,
        actorName: user?.fullName ?? (item.actorUserId ? 'Usuário sem cadastro ativo' : 'Sistema'),
        actorEmail: user?.email,
      };
    });
    const items = [...auditItems, ...activityItems]
      .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
      .slice(offset, offset + query.pageSize);
    return {
      items,
      total: auditTotal + activityTotal,
      page: query.page,
      pageSize: query.pageSize,
      pages: Math.ceil((auditTotal + activityTotal) / query.pageSize),
    };
  }
}
