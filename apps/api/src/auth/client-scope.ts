import { systemRoleKeys } from '@livio/shared';

// A custom role alone remains an explicitly assigned staff role. Adding an
// unclassified custom role to Client does not remove the portal boundary.
const professionalRoleKeys: readonly string[] = systemRoleKeys.filter((key) => key !== 'client');

export function requiresClientBinding(roleKeys: readonly string[]): boolean {
  return roleKeys.includes('client') && !roleKeys.some((key) => professionalRoleKeys.includes(key));
}

export function hasValidMembershipScope(membership: {
  organizationId: string;
  clientId: string | null;
  client: { organizationId: string; deletedAt: Date | null } | null;
  roles: Array<{ organizationId: string; role: { key: string; organizationId: string } }>;
}): boolean {
  return (
    membership.roles.length > 0 &&
    membership.roles.every(
      ({ organizationId, role }) =>
        organizationId === membership.organizationId &&
        role.organizationId === membership.organizationId,
    ) &&
    (!requiresClientBinding(membership.roles.map(({ role }) => role.key)) ||
      Boolean(membership.clientId)) &&
    (!membership.clientId ||
      Boolean(
        membership.client &&
        membership.client.organizationId === membership.organizationId &&
        membership.client.deletedAt === null,
      ))
  );
}
