/**
 * Shared validation utilities
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function validateRequired(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function validateNumber(value: any, min?: number, max?: number): boolean {
  if (typeof value !== 'number') return false;
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

// Zod schemas for API validation
import { z } from 'zod';

export const purchaseRequestSchema = z.object({
  requester_name: z.string().min(1, 'Requester name is required'),
  department: z.string().min(1, 'Department is required'),
  item_description: z.string().min(1, 'Item description is required'),
  quantity: z.string().min(1, 'Quantity is required'),
  estimated_cost: z.string().min(1, 'Estimated cost is required'),
  urgency: z.string().min(1, 'Urgency is required'),
  justification: z.string().min(1, 'Justification is required'),
});

export const procurementApprovalSchema = z.object({
  approval_status: z.string().min(1, 'Approval status is required'),
  budget_approved: z.string().min(1, 'Budget approval is required'),
  vendor_selected: z.string().min(1, 'Vendor selection is required'),
  comments: z.string().optional(),
});

export const vendorOnboardingSchema = z.object({
  vendor_name: z.string().min(1, 'Vendor name is required'),
  vendor_type: z.string().min(1, 'Vendor type is required'),
  contact_name: z.string().min(1, 'Contact name is required'),
  contact_email: z.string().email('Invalid email address'),
  contact_phone: z.string().optional(),
  street_address: z.string().min(1, 'Street address is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  postal_code: z.string().min(1, 'Postal code is required'),
  country: z.string().min(1, 'Country is required'),
  payment_terms: z.string().min(1, 'Payment terms are required'),
  msa_compliance: z.string().min(1, 'MSA compliance is required'),
  procurement_type: z.string().min(1, 'Procurement type is required'),
  services_offered: z.string().min(1, 'Services offered is required'),
  estimated_annual_spend: z.string().min(1, 'Estimated annual spend is required'),
  compliance_requirements: z.array(z.string()).optional(),
});

export const vendorReviewSchema = z.object({
  approval_status: z.string().min(1, 'Approval status is required'),
  risk_assessment: z.string().min(1, 'Risk assessment is required'),
  compliance_verified: z.string().min(1, 'Compliance verification is required'),
  comments: z.string().optional(),
});

// User management schemas
export const userRegistrationSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
  department: z.string().optional(),
});

export const userLoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const userUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  department: z.string().optional(),
  role: z.enum(['admin', 'manager', 'user']).optional(),
  permissions: z.array(z.string()).optional(),
});

export const passwordChangeSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string().min(8, 'Password must be at least 8 characters'),
});

// Notification schemas
export const notificationCreateSchema = z.object({
  user_id: z.string().min(1, 'User ID is required'),
  type: z.string().min(1, 'Notification type is required'),
  title: z.string().min(1, 'Title is required'),
  message: z.string().min(1, 'Message is required'),
  data: z.any().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

// Document schemas
export const documentUploadSchema = z.object({
  entity_type: z.string().min(1, 'Entity type is required'),
  entity_id: z.string().min(1, 'Entity ID is required'),
  filename: z.string().min(1, 'Filename is required'),
  file_size: z.number().positive('File size must be positive'),
  mime_type: z.string().min(1, 'MIME type is required'),
});

// Audit log schemas
export const auditLogSchema = z.object({
  user_id: z.string().optional(),
  action: z.string().min(1, 'Action is required'),
  entity_type: z.string().optional(),
  entity_id: z.string().optional(),
  old_values: z.any().optional(),
  new_values: z.any().optional(),
  ip_address: z.string().optional(),
  user_agent: z.string().optional(),
});
