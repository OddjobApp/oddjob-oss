/**
 * Audit Trail System
 * Provides comprehensive audit logging for compliance and security
 */

import { NextRequest } from 'next/server';
import { getDatabase } from './db';

export interface AuditLogEntry {
  log_id: string;
  user_id?: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  timestamp: string;
}

export interface AuditFilter {
  user_id?: string;
  action?: string;
  entity_type?: string;
  entity_id?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

/**
 * Audit Service
 * Handles audit logging and retrieval
 */
export class AuditService {
  /**
   * Create an audit log entry
   */
  async createLog(entry: Omit<AuditLogEntry, 'log_id' | 'timestamp'>): Promise<string> {
    const logId = `AUDIT-${Date.now()}`;
    
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      await client.query(
        `INSERT INTO audit_logs (log_id, user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [logId, entry.user_id, entry.action, entry.entity_type, entry.entity_id, JSON.stringify(entry.old_values), JSON.stringify(entry.new_values), entry.ip_address, entry.user_agent, new Date()]
      );
      
      console.log('[Audit Log]', JSON.stringify({ logId, ...entry, timestamp: new Date().toISOString() }, null, 2));
      
      return logId;
    } finally {
      client.release();
    }
  }

  /**
   * Get audit logs with optional filtering
   */
  async getLogs(filter: AuditFilter = {}): Promise<AuditLogEntry[]> {
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      let query = 'SELECT * FROM audit_logs WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;
      
      if (filter.user_id) {
        query += ` AND user_id = $${paramIndex++}`;
        params.push(filter.user_id);
      }
      if (filter.action) {
        query += ` AND action = $${paramIndex++}`;
        params.push(filter.action);
      }
      if (filter.entity_type) {
        query += ` AND entity_type = $${paramIndex++}`;
        params.push(filter.entity_type);
      }
      if (filter.entity_id) {
        query += ` AND entity_id = $${paramIndex++}`;
        params.push(filter.entity_id);
      }
      if (filter.start_date) {
        query += ` AND timestamp >= $${paramIndex++}`;
        params.push(filter.start_date);
      }
      if (filter.end_date) {
        query += ` AND timestamp <= $${paramIndex++}`;
        params.push(filter.end_date);
      }
      
      query += ` ORDER BY timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(filter.limit || 100, filter.offset || 0);
      
      const logs = await client.query(query, params);
      return logs.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get audit log by ID
   */
  async getLogById(logId: string): Promise<AuditLogEntry | null> {
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      const logs = await client.query('SELECT * FROM audit_logs WHERE log_id = $1', [logId]);
      return logs.rows.length > 0 ? logs.rows[0] : null;
    } finally {
      client.release();
    }
  }

  /**
   * Get audit logs for a specific entity
   */
  async getEntityHistory(entityType: string, entityId: string): Promise<AuditLogEntry[]> {
    return this.getLogs({ entity_type: entityType, entity_id: entityId });
  }

  /**
   * Get audit logs for a specific user
   */
  async getUserActivity(userId: string, limit: number = 50): Promise<AuditLogEntry[]> {
    return this.getLogs({ user_id: userId, limit });
  }
}

// Singleton instance
let auditServiceInstance: AuditService | null = null;

export function getAuditService(): AuditService {
  if (!auditServiceInstance) {
    auditServiceInstance = new AuditService();
  }
  return auditServiceInstance;
}

/**
 * Helper function to create audit logs from API routes
 */
export async function createAuditLog(params: {
  user_id?: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
}): Promise<string> {
  const auditService = getAuditService();
  return auditService.createLog(params);
}

/**
 * Helper to extract audit info from NextRequest
 */
export function extractAuditInfo(request: NextRequest): {
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
} {
  return {
    userId: request.headers.get('x-user-id') || undefined,
    ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  };
}

/**
 * Common audit action types
 */
export const AuditActions = {
  // User actions
  USER_REGISTERED: 'user.registered',
  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout',
  USER_PROFILE_UPDATED: 'user.profile_updated',
  USER_PASSWORD_CHANGED: 'user.password_changed',
  USER_ROLE_CHANGED: 'user.role_changed',
  
  // Procurement actions
  PROCUREMENT_REQUEST_CREATED: 'procurement.request_created',
  PROCUREMENT_REQUEST_UPDATED: 'procurement.request_updated',
  PROCUREMENT_REQUEST_DELETED: 'procurement.request_deleted',
  PROCUREMENT_APPROVAL_SUBMITTED: 'procurement.approval_submitted',
  PROCUREMENT_APPROVAL_APPROVED: 'procurement.approval_approved',
  PROCUREMENT_APPROVAL_REJECTED: 'procurement.approval_rejected',
  
  // Vendor actions
  VENDOR_ONBOARDING_SUBMITTED: 'vendor.onboarding_submitted',
  VENDOR_ONBOARDING_APPROVED: 'vendor.onboarding_approved',
  VENDOR_ONBOARDING_REJECTED: 'vendor.onboarding_rejected',
  VENDOR_REVIEW_SUBMITTED: 'vendor.review_submitted',
  VENDOR_REVIEW_COMPLETED: 'vendor.review_completed',
  
  // Document actions
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_DOWNLOADED: 'document.downloaded',
  DOCUMENT_DELETED: 'document.deleted',
  DOCUMENT_VERSION_CREATED: 'document.version_created',
  
  // Notification actions
  NOTIFICATION_SENT: 'notification.sent',
  NOTIFICATION_READ: 'notification.read',
  NOTIFICATION_DELETED: 'notification.deleted',
  
  // System actions
  SYSTEM_CONFIG_UPDATED: 'system.config_updated',
  SYSTEM_BACKUP_CREATED: 'system.backup_created',
  SYSTEM_BACKUP_RESTORED: 'system.backup_restored',
};
