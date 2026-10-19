/**
 * Database connection and utilities
 * This file provides database connection utilities for the application.
 */

import { Pool, PoolClient } from 'pg';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export class Database {
  private pool: Pool;
  private config: DatabaseConfig;
  
  constructor(config: DatabaseConfig) {
    this.config = config;
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  async connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  async query(text: string, params?: any[]): Promise<any> {
    const client = await this.connect();
    try {
      const result = await client.query(text, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }
}

// Database singleton instance
let dbInstance: Database | null = null;

export function getDatabase(): Database {
  if (!dbInstance) {
    const config: DatabaseConfig = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'oddjob',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || ''
    };
    dbInstance = new Database(config);
  }
  return dbInstance;
}

// Database schema definitions
export const SCHEMAS = {
  procurement_requests: `
    CREATE TABLE IF NOT EXISTS procurement_requests (
      id SERIAL PRIMARY KEY,
      request_id VARCHAR(50) UNIQUE NOT NULL,
      requester_name VARCHAR(255) NOT NULL,
      department VARCHAR(255) NOT NULL,
      item_description TEXT NOT NULL,
      quantity VARCHAR(100) NOT NULL,
      estimated_cost VARCHAR(50) NOT NULL,
      urgency VARCHAR(50) NOT NULL,
      justification TEXT NOT NULL,
      status VARCHAR(50) DEFAULT 'Pending',
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `,
  
  procurement_approvals: `
    CREATE TABLE IF NOT EXISTS procurement_approvals (
      id SERIAL PRIMARY KEY,
      approval_id VARCHAR(50) UNIQUE NOT NULL,
      approval_status VARCHAR(255) NOT NULL,
      budget_approved VARCHAR(255) NOT NULL,
      vendor_selected VARCHAR(255) NOT NULL,
      comments TEXT,
      status VARCHAR(50) DEFAULT 'Processed',
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `,
  
  vendor_onboarding: `
    CREATE TABLE IF NOT EXISTS vendor_onboarding (
      id SERIAL PRIMARY KEY,
      vendor_id VARCHAR(50) UNIQUE NOT NULL,
      vendor_name VARCHAR(255) NOT NULL,
      vendor_type VARCHAR(100) NOT NULL,
      contact_name VARCHAR(255) NOT NULL,
      contact_email VARCHAR(255) NOT NULL,
      contact_phone VARCHAR(50),
      street_address VARCHAR(500) NOT NULL,
      city VARCHAR(100) NOT NULL,
      state VARCHAR(100) NOT NULL,
      postal_code VARCHAR(20) NOT NULL,
      country VARCHAR(100) NOT NULL,
      payment_terms VARCHAR(50) NOT NULL,
      msa_compliance VARCHAR(50) NOT NULL,
      procurement_type VARCHAR(50) NOT NULL,
      services_offered TEXT NOT NULL,
      estimated_annual_spend VARCHAR(50) NOT NULL,
      compliance_requirements TEXT[],
      status VARCHAR(50) DEFAULT 'Pending',
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `,
  
  vendor_reviews: `
    CREATE TABLE IF NOT EXISTS vendor_reviews (
      id SERIAL PRIMARY KEY,
      review_id VARCHAR(50) UNIQUE NOT NULL,
      approval_status VARCHAR(255) NOT NULL,
      risk_assessment VARCHAR(255) NOT NULL,
      compliance_verified VARCHAR(255) NOT NULL,
      comments TEXT,
      status VARCHAR(50) DEFAULT 'Processed',
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `,
  
  users: `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'user',
      permissions TEXT[],
      department VARCHAR(100),
      is_active BOOLEAN DEFAULT true,
      email_verified BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login TIMESTAMP
    );
  `,
  
  user_sessions: `
    CREATE TABLE IF NOT EXISTS user_sessions (
      id SERIAL PRIMARY KEY,
      session_id VARCHAR(255) UNIQUE NOT NULL,
      user_id VARCHAR(50) NOT NULL,
      token VARCHAR(255) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ip_address VARCHAR(45),
      user_agent TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
  `,
  
  audit_logs: `
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      log_id VARCHAR(50) UNIQUE NOT NULL,
      user_id VARCHAR(50),
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(100),
      entity_id VARCHAR(100),
      old_values JSONB,
      new_values JSONB,
      ip_address VARCHAR(45),
      user_agent TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
    );
  `,
  
  notifications: `
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      notification_id VARCHAR(50) UNIQUE NOT NULL,
      user_id VARCHAR(50) NOT NULL,
      type VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      data JSONB,
      is_read BOOLEAN DEFAULT false,
      priority VARCHAR(20) DEFAULT 'normal',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      read_at TIMESTAMP,
      expires_at TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
  `,
  
  documents: `
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      document_id VARCHAR(50) UNIQUE NOT NULL,
      user_id VARCHAR(50) NOT NULL,
      entity_type VARCHAR(100) NOT NULL,
      entity_id VARCHAR(100) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      file_path VARCHAR(500) NOT NULL,
      file_size BIGINT,
      mime_type VARCHAR(100),
      version INTEGER DEFAULT 1,
      is_current BOOLEAN DEFAULT true,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      workflow_execution_id VARCHAR(50),
      workflow_step_id VARCHAR(50),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
  `,
  
  performance_metrics: `
    CREATE TABLE IF NOT EXISTS performance_metrics (
      id SERIAL PRIMARY KEY,
      execution_id VARCHAR(50) UNIQUE NOT NULL,
      blueprint_id VARCHAR(50) NOT NULL,
      mission_id VARCHAR(50) NOT NULL,
      user_id VARCHAR(50) NOT NULL,
      start_time TIMESTAMP NOT NULL,
      end_time TIMESTAMP,
      duration_ms BIGINT,
      status VARCHAR(20) NOT NULL,
      step_metrics JSONB,
      memory_usage BIGINT,
      cpu_usage NUMERIC(5,2),
      error_count INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
  `,
  
  rate_limit_logs: `
    CREATE TABLE IF NOT EXISTS rate_limit_logs (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(50) NOT NULL,
      role VARCHAR(20) NOT NULL,
      endpoint VARCHAR(255) NOT NULL,
      timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
  `,
  
  blueprint_templates: `
    CREATE TABLE IF NOT EXISTS blueprint_templates (
      id SERIAL PRIMARY KEY,
      template_id VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      category VARCHAR(100) NOT NULL,
      blueprint_id VARCHAR(50) NOT NULL,
      mission_id VARCHAR(50) NOT NULL,
      form_schema JSONB NOT NULL,
      default_values JSONB,
      validation_rules JSONB,
      version INTEGER DEFAULT 1,
      is_active BOOLEAN DEFAULT true,
      created_by VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      tags TEXT[],
      FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE CASCADE
    );
  `,
  
  template_executions: `
    CREATE TABLE IF NOT EXISTS template_executions (
      id SERIAL PRIMARY KEY,
      template_id VARCHAR(50) NOT NULL,
      execution_id VARCHAR(50) NOT NULL,
      user_id VARCHAR(50) NOT NULL,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES blueprint_templates(template_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
  `
};

// Database initialization
export async function initializeDatabase(): Promise<void> {
  const db = getDatabase();
  await db.connect();
  
  // Create tables
  for (const [tableName, schema] of Object.entries(SCHEMAS)) {
    try {
      await db.query(schema);
      console.log(`Table ${tableName} created or already exists`);
    } catch (error) {
      console.error(`Error creating table ${tableName}:`, error);
    }
  }
  
  await db.disconnect();
}
