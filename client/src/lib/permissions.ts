
import type { User } from "@shared/schema/auth";

export const ALL_PERMISSIONS = [
  'user:view_all', 'user:manage_users', 'user:manage_roles', 'user:manage_active',
  'settings:view', 'settings:manage',
  'job:create_edit', 'job:test_sync', 'job:manage_credentials',
  'link:create_edit', 'link:test_sync',
  'exec:view_all', 'exec:view_own',
  'alert:view_all', 'alert:acknowledge_all',
  'credential:manage',
  'skill:import',
] as const;

export type Permission = typeof ALL_PERMISSIONS[number];

export const DEFAULT_USER_PERMISSIONS: Permission[] = [
  'exec:view_own',
  'alert:view_all',
  'link:create_edit' // Allow all users to create and manage pipelines
];

export const ADMIN_PERMISSIONS = ALL_PERMISSIONS;

// Admin role information (can be extended to fetch from API)
export interface AdminRoleInfo {
  isSuperAdmin?: boolean;
  isOrgAdmin?: boolean;
  organizationId?: number | null;
}

// Extended user type with role information
export interface UserWithRole extends User {
  adminRole?: AdminRoleInfo;
}

export function can(user: any | null, permission: Permission): boolean {
  if (!user) return false;

  // Super admin bypass
  if (user.username === 'admin' || user.adminRole?.isSuperAdmin) return true;

  // Org admin check (can be expanded based on permission)
  if (user.adminRole?.isOrgAdmin) {
    // For now, org admins get most permissions but maybe not user management of others
    if (['user:manage_roles'].includes(permission)) return false;
    return true;
  }

  if (user.username === 'manager') {
    return ALL_PERMISSIONS.filter(p => !p.includes('manage_roles')).includes(permission);
  }

  return DEFAULT_USER_PERMISSIONS.includes(permission);
}

export function isAuthorized(user: User | null, resource: any, ownerKey = 'createdBy'): boolean {
  if (!user) return false;
  if (user.username === 'admin' || user.username === 'manager') return true;
  return resource[ownerKey] === user.username; // Our schema uses username as the unique identifier for createdBy usually
}

/**
 * Check if user is a super admin
 * @param user - User object (may include adminRole info if fetched from API)
 * @param adminRole - Optional admin role info (can be fetched separately)
 */
export function isSuperAdmin(user: User | null, adminRole?: AdminRoleInfo): boolean {
  if (!user) return false;
  // Legacy check
  if (user.username === 'admin') return true;
  // Role-based check
  return adminRole?.isSuperAdmin === true;
}

/**
 * Check if user is an org admin for a specific organization
 * @param user - User object
 * @param orgId - Organization ID to check
 * @param adminRole - Optional admin role info
 */
export function isOrgAdmin(user: User | null, orgId: number, adminRole?: AdminRoleInfo): boolean {
  if (!user) return false;
  if (!adminRole) return false;
  return adminRole.isOrgAdmin === true && adminRole.organizationId === orgId;
}

/**
 * Check if user can manage a specific organization
 * @param user - User object
 * @param orgId - Organization ID to check
 * @param adminRole - Optional admin role info
 */
export function canManageOrganization(user: User | null, orgId: number, adminRole?: AdminRoleInfo): boolean {
  if (!user) return false;
  // Super admin can manage all organizations
  if (isSuperAdmin(user, adminRole)) return true;
  // Org admin can manage their own organization
  return isOrgAdmin(user, orgId, adminRole);
}

/**
 * Check if user can manage a target user
 * @param user - Current user
 * @param targetUser - Target user to check
 * @param userAdminRole - Current user's admin role info
 * @param targetUserAdminRole - Target user's admin role info (optional)
 */
export function canManageUser(
  user: User | null,
  targetUser: User | null,
  userAdminRole?: AdminRoleInfo,
  targetUserAdminRole?: AdminRoleInfo
): boolean {
  if (!user || !targetUser) return false;
  // Users can always manage themselves
  if (user.id === targetUser.id) return true;
  // Super admin can manage all users
  if (isSuperAdmin(user, userAdminRole)) return true;
  // Org admin can manage users in their organization
  if (userAdminRole?.isOrgAdmin && userAdminRole.organizationId) {
    // Check if target user belongs to the same organization
    // This would require checking userOrgs or targetUser.defaultOrgId
    // For now, we'll assume org admins can manage users in their org
    return targetUser.defaultOrgId === userAdminRole.organizationId;
  }
  return false;
}
