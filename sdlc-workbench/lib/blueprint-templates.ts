/**
 * Blueprint Template System
 * Manages blueprint templates for common workflow patterns
 */

import { getDatabase } from './db';

export interface BlueprintTemplate {
  template_id: string;
  name: string;
  description: string;
  category: string;
  blueprint_id: string;
  mission_id: string;
  form_schema: Record<string, any>;
  default_values: Record<string, any>;
  validation_rules: Record<string, any>;
  version: number;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  tags: string[];
}

export interface TemplateFilter {
  category?: string;
  blueprint_id?: string;
  mission_id?: string;
  is_active?: boolean;
  tags?: string[];
  created_by?: string;
  limit?: number;
  offset?: number;
}

/**
 * Blueprint Template Service
 */
export class BlueprintTemplateService {
  /**
   * Create a new blueprint template
   */
  async createTemplate(params: {
    name: string;
    description: string;
    category: string;
    blueprint_id: string;
    mission_id: string;
    form_schema: Record<string, any>;
    default_values?: Record<string, any>;
    validation_rules?: Record<string, any>;
    created_by: string;
    tags?: string[];
  }): Promise<BlueprintTemplate> {
    const templateId = `TPL-${Date.now()}`;
    const db = getDatabase();
    const client = await db.getClient();

    try {
      await client.query(
        `INSERT INTO blueprint_templates 
         (template_id, name, description, category, blueprint_id, mission_id, form_schema, default_values, validation_rules, version, is_active, created_by, created_at, updated_at, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          templateId,
          params.name,
          params.description,
          params.category,
          params.blueprint_id,
          params.mission_id,
          JSON.stringify(params.form_schema),
          JSON.stringify(params.default_values || {}),
          JSON.stringify(params.validation_rules || {}),
          1,
          true,
          params.created_by,
          new Date(),
          new Date(),
          params.tags || [],
        ]
      );

      console.log('[Template Created]', JSON.stringify({
        templateId,
        name: params.name,
        category: params.category,
      }, null, 2));

      return {
        template_id: templateId,
        name: params.name,
        description: params.description,
        category: params.category,
        blueprint_id: params.blueprint_id,
        mission_id: params.mission_id,
        form_schema: params.form_schema,
        default_values: params.default_values || {},
        validation_rules: params.validation_rules || {},
        version: 1,
        is_active: true,
        created_by: params.created_by,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: params.tags || [],
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get a template by ID
   */
  async getTemplate(templateId: string): Promise<BlueprintTemplate | null> {
    const db = getDatabase();
    const client = await db.getClient();

    try {
      const result = await client.query(
        'SELECT * FROM blueprint_templates WHERE template_id = $1',
        [templateId]
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        template_id: row.template_id,
        name: row.name,
        description: row.description,
        category: row.category,
        blueprint_id: row.blueprint_id,
        mission_id: row.mission_id,
        form_schema: JSON.parse(row.form_schema),
        default_values: JSON.parse(row.default_values),
        validation_rules: JSON.parse(row.validation_rules),
        version: row.version,
        is_active: row.is_active,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        tags: row.tags,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get templates with optional filtering
   */
  async getTemplates(filter: TemplateFilter): Promise<BlueprintTemplate[]> {
    const db = getDatabase();
    const client = await db.getClient();

    try {
      let query = 'SELECT * FROM blueprint_templates WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      if (filter.category) {
        query += ` AND category = $${paramIndex++}`;
        params.push(filter.category);
      }
      if (filter.blueprint_id) {
        query += ` AND blueprint_id = $${paramIndex++}`;
        params.push(filter.blueprint_id);
      }
      if (filter.mission_id) {
        query += ` AND mission_id = $${paramIndex++}`;
        params.push(filter.mission_id);
      }
      if (filter.is_active !== undefined) {
        query += ` AND is_active = $${paramIndex++}`;
        params.push(filter.is_active);
      }
      if (filter.created_by) {
        query += ` AND created_by = $${paramIndex++}`;
        params.push(filter.created_by);
      }
      if (filter.tags && filter.tags.length > 0) {
        query += ` AND tags && $${paramIndex++}`;
        params.push(filter.tags);
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(filter.limit || 50, filter.offset || 0);

      const result = await client.query(query, params);
      return result.rows.map(row => ({
        template_id: row.template_id,
        name: row.name,
        description: row.description,
        category: row.category,
        blueprint_id: row.blueprint_id,
        mission_id: row.mission_id,
        form_schema: JSON.parse(row.form_schema),
        default_values: JSON.parse(row.default_values),
        validation_rules: JSON.parse(row.validation_rules),
        version: row.version,
        is_active: row.is_active,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        tags: row.tags,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Update a template
   */
  async updateTemplate(
    templateId: string,
    updates: Partial<{
      name: string;
      description: string;
      category: string;
      form_schema: Record<string, any>;
      default_values: Record<string, any>;
      validation_rules: Record<string, any>;
      is_active: boolean;
      tags: string[];
    }>
  ): Promise<BlueprintTemplate | null> {
    const db = getDatabase();
    const client = await db.getClient();

    try {
      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.name !== undefined) {
        setClauses.push(`name = $${paramIndex++}`);
        values.push(updates.name);
      }
      if (updates.description !== undefined) {
        setClauses.push(`description = $${paramIndex++}`);
        values.push(updates.description);
      }
      if (updates.category !== undefined) {
        setClauses.push(`category = $${paramIndex++}`);
        values.push(updates.category);
      }
      if (updates.form_schema !== undefined) {
        setClauses.push(`form_schema = $${paramIndex++}`);
        values.push(JSON.stringify(updates.form_schema));
      }
      if (updates.default_values !== undefined) {
        setClauses.push(`default_values = $${paramIndex++}`);
        values.push(JSON.stringify(updates.default_values));
      }
      if (updates.validation_rules !== undefined) {
        setClauses.push(`validation_rules = $${paramIndex++}`);
        values.push(JSON.stringify(updates.validation_rules));
      }
      if (updates.is_active !== undefined) {
        setClauses.push(`is_active = $${paramIndex++}`);
        values.push(updates.is_active);
      }
      if (updates.tags !== undefined) {
        setClauses.push(`tags = $${paramIndex++}`);
        values.push(updates.tags);
      }

      setClauses.push(`updated_at = $${paramIndex++}`);
      values.push(new Date());
      setClauses.push(`version = version + 1`);

      values.push(templateId);

      const query = `UPDATE blueprint_templates SET ${setClauses.join(', ')} WHERE template_id = $${paramIndex}`;
      await client.query(query, values);

      return this.getTemplate(templateId);
    } finally {
      client.release();
    }
  }

  /**
   * Delete a template
   */
  async deleteTemplate(templateId: string): Promise<boolean> {
    const db = getDatabase();
    const client = await db.getClient();

    try {
      await client.query(
        'DELETE FROM blueprint_templates WHERE template_id = $1',
        [templateId]
      );
      return true;
    } catch (error) {
      console.error('Failed to delete template:', error);
      return false;
    } finally {
      client.release();
    }
  }

  /**
   * Apply a template to create a blueprint execution request
   */
  async applyTemplate(
    templateId: string,
    overrides: Record<string, any> = {}
  ): Promise<{
    blueprintId: string;
    missionId: string;
    formData: Record<string, any>;
  }> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error('Template not found');
    }

    const formData = {
      ...template.default_values,
      ...overrides,
    };

    return {
      blueprintId: template.blueprint_id,
      missionId: template.mission_id,
      formData,
    };
  }

  /**
   * Validate form data against template validation rules
   */
  validateFormData(
    formData: Record<string, any>,
    validationRules: Record<string, any>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [field, rules] of Object.entries(validationRules)) {
      const value = formData[field];

      // Required check
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
      }

      // Type check
      if (value !== undefined && rules.type) {
        if (rules.type === 'string' && typeof value !== 'string') {
          errors.push(`${field} must be a string`);
        }
        if (rules.type === 'number' && typeof value !== 'number') {
          errors.push(`${field} must be a number`);
        }
        if (rules.type === 'boolean' && typeof value !== 'boolean') {
          errors.push(`${field} must be a boolean`);
        }
      }

      // Min/max check
      if (value !== undefined && rules.min !== undefined && value < rules.min) {
        errors.push(`${field} must be at least ${rules.min}`);
      }
      if (value !== undefined && rules.max !== undefined && value > rules.max) {
        errors.push(`${field} must be at most ${rules.max}`);
      }

      // Pattern check
      if (value !== undefined && rules.pattern && !new RegExp(rules.pattern).test(value)) {
        errors.push(`${field} does not match the required pattern`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get template categories
   */
  async getCategories(): Promise<string[]> {
    const db = getDatabase();
    const client = await db.getClient();

    try {
      const result = await client.query(
        'SELECT DISTINCT category FROM blueprint_templates WHERE is_active = true ORDER BY category'
      );
      return result.rows.map(row => row.category);
    } finally {
      client.release();
    }
  }

  /**
   * Get popular templates
   */
  async getPopularTemplates(limit: number = 10): Promise<BlueprintTemplate[]> {
    const db = getDatabase();
    const client = await db.getClient();

    try {
      const result = await client.query(
        `SELECT bt.*, COUNT(te.execution_id) as usage_count
         FROM blueprint_templates bt
         LEFT JOIN template_executions te ON bt.template_id = te.template_id
         WHERE bt.is_active = true
         GROUP BY bt.template_id
         ORDER BY usage_count DESC, bt.created_at DESC
         LIMIT $1`,
        [limit]
      );

      return result.rows.map(row => ({
        template_id: row.template_id,
        name: row.name,
        description: row.description,
        category: row.category,
        blueprint_id: row.blueprint_id,
        mission_id: row.mission_id,
        form_schema: JSON.parse(row.form_schema),
        default_values: JSON.parse(row.default_values),
        validation_rules: JSON.parse(row.validation_rules),
        version: row.version,
        is_active: row.is_active,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        tags: row.tags,
      }));
    } finally {
      client.release();
    }
  }
}

// Singleton instance
let templateServiceInstance: BlueprintTemplateService | null = null;

export function getBlueprintTemplateService(): BlueprintTemplateService {
  if (!templateServiceInstance) {
    templateServiceInstance = new BlueprintTemplateService();
  }
  return templateServiceInstance;
}
