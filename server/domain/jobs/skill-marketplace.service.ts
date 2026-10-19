import { db } from "@server/database_service.js";
import { pgTable, text, serial, integer, timestamp, varchar, decimal, jsonb } from "drizzle-orm/pg-core";
import { and, eq, desc, sql } from "drizzle-orm";

// Inline schemas for marketplace tables
export const skillsTable = pgTable('skills', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  content: text('content').notNull(),
  rating: decimal('rating', { precision: 3, scale: 2 }),
  ratingCount: integer('rating_count').default(0),
  downloads: integer('downloads').default(0),
  author: varchar('author', { length: 255 }),
  // tags and dependencies represented as jsonb for simplicity
  tags: jsonb('tags'),
  dependencies: jsonb('dependencies'),
  version: varchar('version', { length: 20 }),
  publishedAt: timestamp('published_at'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const skillReviews = pgTable('skill_reviews', {
  id: serial('id').primaryKey(),
  skillId: integer('skill_id').references(() => skillsTable.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 255 }),
  organizationId: integer('organization_id'),
  rating: integer('rating'),
  comment: text('comment'),
  createdAt: timestamp('created_at').defaultNow(),
});

export interface AnalyzedSkill {
  name: string;
  description: string;
  tools: string[];
  dependencies?: string[];
  [key: string]: any;
}

export class SkillMarketplaceService {
  async publishSkill(data: {
    userId: string;
    organizationId: number;
    skill: AnalyzedSkill;
    metadata: {
      author: string;
      tags: string[];
      version: string;
    };
  }): Promise<number> {
    const [skill] = await db.insert(skillsTable).values({
      name: data.skill.name,
      description: data.skill.description,
      content: JSON.stringify(data.skill),
      author: data.metadata.author,
      tags: data.metadata.tags,
      version: data.metadata.version,
      rating: '0',
      ratingCount: 0,
      downloads: 0,
      publishedAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    
    return skill.id;
  }
  
  async rateSkill(skillId: number, data: {
    userId: string;
    organizationId: number;
    rating: number;
    comment?: string;
  }): Promise<void> {
    await db.insert(skillReviews).values({
      skillId,
      ...data,
      createdAt: new Date(),
    });
    
    // Update skill rating
    await this.updateSkillRating(skillId);
  }
  
  private async updateSkillRating(skillId: number): Promise<void> {
    const reviews = await db.select().from(skillReviews)
      .where(eq(skillReviews.skillId, skillId));
    
    const avgRating = reviews.length > 0
      ? reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / reviews.length
      : 0;
    
    await db.update(skillsTable)
      .set({
        rating: avgRating.toString(),
        ratingCount: reviews.length,
        updatedAt: new Date(),
      })
      .where(eq(skillsTable.id, skillId));
  }
  
  async downloadSkill(skillId: number): Promise<AnalyzedSkill> {
    const [skill] = await db.select().from(skillsTable)
      .where(eq(skillsTable.id, skillId))
      .limit(1);
    
    if (!skill) {
      throw new Error('Skill not found');
    }
    
    // Increment download count
    await db.update(skillsTable)
      .set({ downloads: (skill.downloads || 0) + 1 })
      .where(eq(skillsTable.id, skillId));
    
    return JSON.parse(skill.content);
  }
  
  async searchSkills(query: string, filters?: {
    tags?: string[];
    minRating?: number;
    author?: string;
  }): Promise<any[]> {
    let conditions = [sql`name ILIKE ${'%' + query + '%'}`];
    
    if (filters?.minRating) {
      conditions.push(sql`${skillsTable.rating} >= ${filters.minRating}`);
    }
    
    if (filters?.author) {
      conditions.push(eq(skillsTable.author, filters.author));
    }
    
    return await db.select().from(skillsTable)
      .where(and(...conditions))
      .orderBy(desc(skillsTable.rating))
      .limit(50);
  }
}

export const skillMarketplaceService = new SkillMarketplaceService();
