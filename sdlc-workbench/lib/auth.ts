/**
 * Authentication and Authorization Middleware
 * This file provides authentication utilities for the application.
 */

import { NextRequest } from 'next/server';
import { getDatabase } from './db';

export interface User {
  user_id: string;
  email: string;
  name: string;
  department: string;
  role: 'admin' | 'manager' | 'user' | 'vendor';
  permissions: string[];
  created_at: string;
  last_login?: string;
}

export interface Session {
  session_id: string;
  user_id: string;
  token: string;
  expires_at: string;
  ip_address: string;
  user_agent: string;
}

export interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
}

/**
 * Blueprint permission requirements
 */
export const BLUEPRINT_PERMISSIONS: Record<string, Record<string, string[]>> = {
  'procurement-management': {
    'mission-process-request': ['read', 'procurement.create'],
    'mission-approval-review': ['read', 'procurement.approve'],
  },
  'vendor-management': {
    'mission-onboard-vendor': ['read', 'vendor.create'],
    'mission-performance-review': ['read', 'vendor.review'],
  },
};

/**
 * Check if user has required permissions for blueprint execution
 */
export function hasBlueprintPermission(
  user: User,
  blueprintId: string,
  missionId: string
): boolean {
  const blueprintPerms = BLUEPRINT_PERMISSIONS[blueprintId];
  if (!blueprintPerms) return false;

  const missionPerms = blueprintPerms[missionId];
  if (!missionPerms) return false;

  // Admin users have all permissions
  if (user.role === 'admin') return true;

  // Check if user has all required permissions
  return missionPerms.every((perm: string) => user.permissions.includes(perm));
}

/**
 * Authenticate user from session token
 */
export async function authenticateUser(token: string): Promise<User | null> {
  const db = getDatabase();
  const client = await db.getClient();
  
  try {
    const session = await client.query(
      'SELECT * FROM user_sessions WHERE token = $1 AND expires_at > NOW()',
      [token]
    );
    
    if (session.rows.length === 0) return null;
    
    const user = await client.query(
      'SELECT user_id, email, name, department, role, permissions, created_at, last_login FROM users WHERE user_id = $1',
      [session.rows[0].user_id]
    );
    
    return user.rows.length > 0 ? user.rows[0] : null;
  } finally {
    client.release();
  }
}

/**
 * Middleware to protect API routes
 */
export async function protectRoute(request: NextRequest): Promise<{ user: User; token: string } | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;

  const token = authHeader.replace('Bearer ', '');
  const user = await authenticateUser(token);
  
  if (!user) return null;
  
  return { user, token };
}

/**
 * Check if user has specific permission
 */
export function hasPermission(user: User, permission: string): boolean {
  if (user.role === 'admin') return true;
  return user.permissions.includes(permission);
}

/**
 * Check if user has any of the specified permissions
 */
export function hasAnyPermission(user: User, permissions: string[]): boolean {
  if (user.role === 'admin') return true;
  return permissions.some(perm => user.permissions.includes(perm));
}

/**
 * Check if user has all of the specified permissions
 */
export function hasAllPermissions(user: User, permissions: string[]): boolean {
  if (user.role === 'admin') return true;
  return permissions.every(perm => user.permissions.includes(perm));
}

/**
 * Role-based access control helper
 */
export function hasRole(user: User, roles: string[]): boolean {
  return roles.includes(user.role);
}

/**
 * Department-based access control helper
 */
export function hasDepartmentAccess(user: User, allowedDepartments: string[]): boolean {
  if (user.role === 'admin') return true;
  return allowedDepartments.includes(user.department);
}
