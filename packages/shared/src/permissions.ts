export const permissionActions = [
  'view',
  'create',
  'update',
  'delete',
  'export',
  'approve',
  'manage',
] as const;

export const permissionResources = [
  'organization',
  'users',
  'roles',
  'clients',
  'matters',
  'pipelines',
  'contracts',
  'receivables',
  'payments',
  'receipts',
  'expenses',
  'documents',
  'notes',
  'messages',
  'tasks',
  'calendar',
  'notifications',
  'audit',
  'reports',
] as const;

export type PermissionAction = (typeof permissionActions)[number];
export type PermissionResource = (typeof permissionResources)[number];
export type PermissionCode = `${PermissionResource}:${PermissionAction}`;

export const systemRoleKeys = [
  'administrator',
  'lawyer',
  'secretary',
  'finance',
  'client',
] as const;

export type SystemRoleKey = (typeof systemRoleKeys)[number];

const codes = (resource: PermissionResource, actions: readonly PermissionAction[]) =>
  actions.map((action) => `${resource}:${action}` as PermissionCode);

const allActions = permissionActions;
const workActions = ['view', 'create', 'update', 'export'] as const;
const viewOnly = ['view'] as const;

export const initialRolePermissions: Readonly<Record<SystemRoleKey, readonly PermissionCode[]>> = {
  administrator: permissionResources.flatMap((resource) => codes(resource, allActions)),
  lawyer: [
    ...codes('clients', workActions),
    ...codes('matters', workActions),
    ...codes('pipelines', viewOnly),
    ...codes('contracts', ['view', 'create', 'update']),
    ...codes('receivables', viewOnly),
    ...codes('receipts', ['view', 'create']),
    ...codes('documents', workActions),
    ...codes('notes', workActions),
    ...codes('messages', workActions),
    ...codes('tasks', workActions),
    ...codes('calendar', workActions),
    ...codes('notifications', ['view', 'update']),
    ...codes('reports', ['view']),
  ],
  secretary: [
    ...codes('clients', workActions),
    ...codes('matters', ['view', 'create', 'update']),
    ...codes('pipelines', viewOnly),
    ...codes('documents', ['view', 'create', 'update']),
    ...codes('receipts', ['view', 'create']),
    ...codes('notes', workActions),
    ...codes('messages', workActions),
    ...codes('tasks', workActions),
    ...codes('calendar', workActions),
    ...codes('notifications', ['view', 'update']),
    ...codes('reports', ['view']),
  ],
  finance: [
    ...codes('clients', viewOnly),
    ...codes('matters', viewOnly),
    ...codes('contracts', ['view', 'create', 'update', 'approve', 'export']),
    ...codes('receivables', ['view', 'create', 'update', 'approve', 'export']),
    ...codes('payments', ['view', 'create', 'update', 'approve', 'export']),
    ...codes('receipts', ['view', 'create', 'approve']),
    ...codes('expenses', ['view', 'create', 'update', 'approve', 'export']),
    ...codes('documents', viewOnly),
    ...codes('messages', ['view', 'create']),
    ...codes('tasks', workActions),
    ...codes('calendar', viewOnly),
    ...codes('notifications', ['view', 'update']),
    ...codes('reports', ['view']),
  ],
  client: [
    ...codes('clients', viewOnly),
    ...codes('matters', viewOnly),
    ...codes('contracts', viewOnly),
    ...codes('receivables', viewOnly),
    ...codes('payments', viewOnly),
    ...codes('receipts', ['view', 'create']),
    ...codes('documents', viewOnly),
    ...codes('messages', ['view', 'create']),
    ...codes('calendar', viewOnly),
    ...codes('notifications', ['view', 'update']),
  ],
};
