/**
 * Document Management System
 * Provides comprehensive file upload, storage, and versioning capabilities
 */

import { getDatabase } from './db';
import * as fs from 'fs';
import * as path from 'path';

export interface Document {
  document_id: string;
  user_id: string;
  entity_type: string;
  entity_id: string;
  filename: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  version: number;
  is_current: boolean;
  uploaded_at: string;
  workflow_execution_id?: string;
  workflow_step_id?: string;
}

export interface DocumentFilter {
  user_id?: string;
  entity_type?: string;
  entity_id?: string;
  mime_type?: string;
  is_current?: boolean;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
  workflow_execution_id?: string;
  workflow_step_id?: string;
}

export interface UploadResult {
  document_id: string;
  filename: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  version: number;
  uploaded_at: string;
  workflow_execution_id?: string;
  workflow_step_id?: string;
}

/**
 * Document Service
 * Handles document upload, storage, retrieval, and versioning
 */
export class DocumentService {
  private storagePath: string;

  constructor(storagePath: string = './uploads') {
    this.storagePath = storagePath;
  }

  /**
   * Upload a document
   */
  async uploadDocument(params: {
    user_id: string;
    entity_type: string;
    entity_id: string;
    filename: string;
    file_buffer: Buffer;
    mime_type: string;
    workflow_execution_id?: string;
    workflow_step_id?: string;
  }): Promise<UploadResult> {
    const documentId = `DOC-${Date.now()}`;
    
    // Generate file path
    const timestamp = new Date().toISOString().split('T')[0];
    const filePath = `${this.storagePath}/${params.entity_type}/${params.entity_id}/${timestamp}/${documentId}-${params.filename}`;
    
    // Create directory if it doesn't exist
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Write file to disk
    fs.writeFileSync(filePath, params.file_buffer);
    
    // Get current version
    const currentVersion = await this.getCurrentVersion(params.entity_type, params.entity_id);
    const newVersion = currentVersion + 1;
    
    // Archive previous versions
    if (currentVersion > 0) {
      await this.archivePreviousVersions(params.entity_type, params.entity_id);
    }
    
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      await client.query(
        `INSERT INTO documents (document_id, user_id, entity_type, entity_id, filename, file_path, file_size, mime_type, version, is_current, uploaded_at, workflow_execution_id, workflow_step_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [documentId, params.user_id, params.entity_type, params.entity_id, params.filename, filePath, params.file_buffer.length, params.mime_type, newVersion, true, new Date(), params.workflow_execution_id, params.workflow_step_id]
      );
      
      console.log('[Document Uploaded]', JSON.stringify({
        documentId,
        filename: params.filename,
        filePath,
        fileSize: params.file_buffer.length,
        mimeType: params.mime_type,
        uploadedAt: new Date().toISOString(),
        workflowExecutionId: params.workflow_execution_id,
        workflowStepId: params.workflow_step_id
      }, null, 2));
      
      return {
        document_id: documentId,
        filename: params.filename,
        file_path: filePath,
        file_size: params.file_buffer.length,
        mime_type: params.mime_type,
        version: newVersion,
        uploaded_at: new Date().toISOString(),
        workflow_execution_id: params.workflow_execution_id,
        workflow_step_id: params.workflow_step_id
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get documents with optional filtering
   */
  async getDocuments(filter: DocumentFilter): Promise<Document[]> {
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      let query = 'SELECT * FROM documents WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;
      
      if (filter.user_id) {
        query += ` AND user_id = $${paramIndex++}`;
        params.push(filter.user_id);
      }
      if (filter.entity_type) {
        query += ` AND entity_type = $${paramIndex++}`;
        params.push(filter.entity_type);
      }
      if (filter.entity_id) {
        query += ` AND entity_id = $${paramIndex++}`;
        params.push(filter.entity_id);
      }
      if (filter.mime_type) {
        query += ` AND mime_type = $${paramIndex++}`;
        params.push(filter.mime_type);
      }
      if (filter.is_current !== undefined) {
        query += ` AND is_current = $${paramIndex++}`;
        params.push(filter.is_current);
      }
      if (filter.workflow_execution_id) {
        query += ` AND workflow_execution_id = $${paramIndex++}`;
        params.push(filter.workflow_execution_id);
      }
      if (filter.workflow_step_id) {
        query += ` AND workflow_step_id = $${paramIndex++}`;
        params.push(filter.workflow_step_id);
      }
      if (filter.start_date) {
        query += ` AND uploaded_at >= $${paramIndex++}`;
        params.push(filter.start_date);
      }
      if (filter.end_date) {
        query += ` AND uploaded_at <= $${paramIndex++}`;
        params.push(filter.end_date);
      }
      
      query += ` ORDER BY uploaded_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(filter.limit || 50, filter.offset || 0);
      
      const documents = await client.query(query, params);
      return documents.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get document by ID
   */
  async getDocumentById(documentId: string): Promise<Document | null> {
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      const documents = await client.query('SELECT * FROM documents WHERE document_id = $1', [documentId]);
      return documents.rows.length > 0 ? documents.rows[0] : null;
    } finally {
      client.release();
    }
  }

  /**
   * Download document
   */
  async downloadDocument(documentId: string): Promise<Buffer | null> {
    const document = await this.getDocumentById(documentId);
    if (!document) return null;
    
    if (fs.existsSync(document.file_path)) {
      return fs.readFileSync(document.file_path);
    }
    
    console.log('[Document Downloaded]', documentId);
    return null;
  }

  /**
   * Delete document
   */
  async deleteDocument(documentId: string): Promise<boolean> {
    const document = await this.getDocumentById(documentId);
    if (!document) return false;
    
    if (fs.existsSync(document.file_path)) {
      fs.unlinkSync(document.file_path);
    }
    
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      await client.query('DELETE FROM documents WHERE document_id = $1', [documentId]);
      console.log('[Document Deleted]', documentId);
      return true;
    } finally {
      client.release();
    }
  }

  /**
   * Get document versions
   */
  async getDocumentVersions(entityType: string, entityId: string): Promise<Document[]> {
    return this.getDocuments({ entity_type: entityType, entity_id: entityId });
  }

  /**
   * Get current version number
   */
  private async getCurrentVersion(entityType: string, entityId: string): Promise<number> {
    const documents = await this.getDocuments({ 
      entity_type: entityType, 
      entity_id: entityId, 
      is_current: true 
    });
    return documents.length > 0 ? Math.max(...documents.map(d => d.version)) : 0;
  }

  /**
   * Archive previous versions
   */
  private async archivePreviousVersions(entityType: string, entityId: string): Promise<void> {
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      await client.query(
        'UPDATE documents SET is_current = false WHERE entity_type = $1 AND entity_id = $2 AND is_current = true',
        [entityType, entityId]
      );
    } finally {
      client.release();
    }
  }
}

// Singleton instance
let documentServiceInstance: DocumentService | null = null;

export function getDocumentService(): DocumentService {
  if (!documentServiceInstance) {
    documentServiceInstance = new DocumentService(process.env.DOCUMENT_STORAGE_PATH || './uploads');
  }
  return documentServiceInstance;
}

/**
 * Helper to validate file type
 */
export function validateFileType(mimeType: string, allowedTypes: string[]): boolean {
  return allowedTypes.includes(mimeType);
}

/**
 * Helper to validate file size
 */
export function validateFileSize(fileSize: number, maxSize: number): boolean {
  return fileSize <= maxSize;
}

/**
 * Common allowed file types
 */
export const AllowedFileTypes = {
  IMAGES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  DOCUMENTS: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  SPREADSHEETS: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ARCHIVES: ['application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed'],
};

/**
 * Common file size limits (in bytes)
 */
export const FileSizeLimits = {
  SMALL: 5 * 1024 * 1024, // 5MB
  MEDIUM: 25 * 1024 * 1024, // 25MB
  LARGE: 100 * 1024 * 1024, // 100MB
};
