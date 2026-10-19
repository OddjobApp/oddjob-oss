/**
 * Notification System
 * Provides comprehensive notification management for in-app and email notifications
 */

import { getDatabase } from './db';

export interface Notification {
  notification_id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  is_read: boolean;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  created_at: string;
  read_at?: string;
  expires_at?: string;
}

export interface NotificationFilter {
  user_id?: string;
  type?: string;
  is_read?: boolean;
  priority?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

export interface EmailNotification {
  to: string;
  subject: string;
  body: string;
  html?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

/**
 * Notification Service
 * Handles notification creation, delivery, and management
 */
export class NotificationService {
  /**
   * Create a notification
   */
  async createNotification(params: {
    user_id: string;
    type: string;
    title: string;
    message: string;
    data?: Record<string, any>;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    expires_at?: string;
  }): Promise<string> {
    const notificationId = `NOTIF-${Date.now()}`;
    
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      await client.query(
        `INSERT INTO notifications (notification_id, user_id, type, title, message, data, priority, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [notificationId, params.user_id, params.type, params.title, params.message, JSON.stringify(params.data), params.priority || 'normal', params.expires_at, new Date()]
      );
      
      console.log('[Notification Created]', JSON.stringify({ notificationId, ...params, created_at: new Date().toISOString() }, null, 2));
      
      return notificationId;
    } finally {
      client.release();
    }
  }

  /**
   * Get notifications for a user
   */
  async getNotifications(filter: NotificationFilter): Promise<Notification[]> {
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      let query = 'SELECT * FROM notifications WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;
      
      if (filter.user_id) {
        query += ` AND user_id = $${paramIndex++}`;
        params.push(filter.user_id);
      }
      if (filter.type) {
        query += ` AND type = $${paramIndex++}`;
        params.push(filter.type);
      }
      if (filter.is_read !== undefined) {
        query += ` AND is_read = $${paramIndex++}`;
        params.push(filter.is_read);
      }
      if (filter.priority) {
        query += ` AND priority = $${paramIndex++}`;
        params.push(filter.priority);
      }
      if (filter.start_date) {
        query += ` AND created_at >= $${paramIndex++}`;
        params.push(filter.start_date);
      }
      if (filter.end_date) {
        query += ` AND created_at <= $${paramIndex++}`;
        params.push(filter.end_date);
      }
      
      query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(filter.limit || 50, filter.offset || 0);
      
      const notifications = await client.query(query, params);
      return notifications.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string): Promise<boolean> {
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      await client.query('UPDATE notifications SET is_read = true, read_at = NOW() WHERE notification_id = $1', [notificationId]);
      console.log('[Notification Marked Read]', notificationId);
      return true;
    } finally {
      client.release();
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<number> {
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      const result = await client.query('UPDATE notifications SET is_read = true, read_at = NOW() WHERE user_id = $1 AND is_read = false RETURNING *', [userId]);
      console.log('[All Notifications Marked Read]', userId, result.rowCount);
      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId: string): Promise<boolean> {
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      await client.query('DELETE FROM notifications WHERE notification_id = $1', [notificationId]);
      console.log('[Notification Deleted]', notificationId);
      return true;
    } finally {
      client.release();
    }
  }

  /**
   * Send email notification
   */
  async sendEmail(email: EmailNotification): Promise<boolean> {
    // TODO: Implement actual email sending (using SendGrid, AWS SES, or nodemailer)
    // For now, log the email for development
    console.log('[Email Sent]', JSON.stringify(email, null, 2));
    
    // Example implementation with nodemailer:
    // const nodemailer = require('nodemailer');
    // const transporter = nodemailer.createTransport({
    //   host: process.env.SMTP_HOST,
    //   port: process.env.SMTP_PORT || 587,
    //   secure: false,
    //   auth: {
    //     user: process.env.SMTP_USER,
    //     pass: process.env.SMTP_PASS,
    //   },
    // });
    // 
    // await transporter.sendMail({
    //   from: process.env.SMTP_FROM || 'noreply@oddjob.com',
    //   to: email.to,
    //   subject: email.subject,
    //   text: email.body,
    //   html: email.html,
    // });
    
    return true;
  }

  /**
   * Get unread count for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      const result = await client.query('SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false', [userId]);
      return parseInt(result.rows[0].count);
    } finally {
      client.release();
    }
  }
}

// Singleton instance
let notificationServiceInstance: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!notificationServiceInstance) {
    notificationServiceInstance = new NotificationService();
  }
  return notificationServiceInstance;
}

/**
 * Helper function to create a notification with common patterns
 */
export async function notifyUser(params: {
  user_id: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  sendEmail?: boolean;
  email?: string;
}): Promise<string> {
  const notificationService = getNotificationService();
  const notificationId = await notificationService.createNotification(params);
  
  if (params.sendEmail && params.email) {
    await notificationService.sendEmail({
      to: params.email,
      subject: params.title,
      body: params.message,
      priority: params.priority,
    });
  }
  
  return notificationId;
}

/**
 * Common notification types
 */
export const NotificationTypes = {
  // User notifications
  USER_WELCOME: 'user.welcome',
  USER_PASSWORD_RESET: 'user.password_reset',
  USER_ROLE_CHANGED: 'user.role_changed',
  
  // Procurement notifications
  PROCUREMENT_REQUEST_SUBMITTED: 'procurement.request_submitted',
  PROCUREMENT_REQUEST_APPROVED: 'procurement.request_approved',
  PROCUREMENT_REQUEST_REJECTED: 'procurement.request_rejected',
  PROCUREMENT_APPROVAL_NEEDED: 'procurement.approval_needed',
  PROCUREMENT_ORDER_PLACED: 'procurement.order_placed',
  PROCUREMENT_ORDER_DELIVERED: 'procurement.order_delivered',
  
  // Vendor notifications
  VENDOR_ONBOARDING_SUBMITTED: 'vendor.onboarding_submitted',
  VENDOR_ONBOARDING_APPROVED: 'vendor.onboarding_approved',
  VENDOR_ONBOARDING_REJECTED: 'vendor.onboarding_rejected',
  VENDOR_REVIEW_NEEDED: 'vendor.review_needed',
  VENDOR_PERFORMANCE_ALERT: 'vendor.performance_alert',
  
  // System notifications
  SYSTEM_MAINTENANCE: 'system.maintenance',
  SYSTEM_UPDATE: 'system.update',
  SYSTEM_ALERT: 'system.alert',
  
  // Document notifications
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_APPROVED: 'document.approved',
  DOCUMENT_REJECTED: 'document.rejected',
};
