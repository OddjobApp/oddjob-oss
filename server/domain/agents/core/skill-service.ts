import { db } from "@server/database_service.js";
import { skills, type Skill, type NewSkill, jobs } from "@shared/schema/index.js";
import { eq, or, ilike } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import vm from "node:vm";
import { queueService } from "@domain/core/infrastructure/queue/queue-service.js";

const logger = createLogger("SkillService");

export const skillService = {
  /**
   * Get all available skills, optionally filtered by visibility.
   */
  async listSkills(includePrivate = false): Promise<Skill[]> {
    if (includePrivate) {
      return await db.select().from(skills);
    }
    return await db.select().from(skills).where(eq(skills.isPublic, true));
  },

  /**
   * Find skills relevant to a specific objective or set of keywords.
   */
  async findRelevantSkills(objective: string): Promise<Skill[]> {
    const keywords = objective.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (keywords.length === 0) return [];

    // Simple keyword matching for MVP
    const conditions = keywords.map(k => or(
      ilike(skills.name, `%${k}%`),
      ilike(skills.description, `%${k}%`)
    ));

    return await db.select().from(skills).where(or(...conditions));
  },

  /**
   * Create a new skill.
   */
  async createSkill(data: NewSkill): Promise<Skill> {
    const [skill] = await db.insert(skills).values(data).returning();
    logger.info(`[SkillService] Created new skill: ${skill.name} (id: ${skill.id})`);
    return skill;
  },

  /**
   * Provision a specialized agent draft from a Registry Skill.
   */
  async provisionAgentFromSkill(skillId: number, organizationId: number, userId: number): Promise<any> {
    const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1);
    if (!skill) throw new Error(`Skill ${skillId} not found`);

    // Dynamic import to avoid circular dependency with JobService
    const { jobService } = await import("../../jobs/job.service.js");

    const jobInput = {
      name: `${skill.name.charAt(0).toUpperCase() + skill.name.slice(1).replace(/_/g, ' ')} Specialist`,
      description: `Autonomous agent specialized in: ${skill.description || skill.name}`,
      type: "ai_agent",
      config: {
        goal: skill.description || `Execute tasks using ${skill.name}`,
        systemPrompt: `You are a specialist agent for ${skill.name}.\n\nDESCRIPTION: ${skill.description || "N/A"}\n\nCORE CAPABILITY: Use the provided '${skill.name}' tool to solve user requests.`,
        allowedTools: [skill.name],
        organizationId: organizationId
      },
      isActive: false, 
      lifecycleStatus: 'draft',
      organizationId: organizationId,
      skillId: skillId // Link the job to the source skill for autonomous evolution
    };

    const job = await jobService.create(jobInput as any, { userId: userId.toString(), organizationId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false });
    logger.info(`[SkillService] Provisioned agent ${job.id} from skill ${skill.name}`);
    return job;
  },

  /**
   * Execute a skill in a sandboxed environment.
   * - JavaScript: vm.runInNewContext with a strict allowlist and 5s timeout.
   * - Python: dispatched to the system queue for the Python consumer pod.
   */
  async executeSkill(skillId: number, args: Record<string, any>): Promise<any> {
    const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1);
    if (!skill) throw new Error(`Skill ${skillId} not found`);

    logger.info(`[SkillService] Executing skill ${skill.name} (id: ${skillId}, lang: ${skill.language})`);

    const lang = (skill.language || "javascript").toLowerCase();

    if (lang === "javascript" || lang === "js" || lang === "typescript") {
      return skillService._executeJS(skill.name, skill.code, args);
    }

    if (lang === "python" || lang === "py") {
      return skillService._executePythonViaQueue(skill.name, skill.code, args);
    }

    throw new Error(`Unsupported skill language: ${skill.language}. Supported: javascript, python.`);
  },

  /**
   * Run a JavaScript skill in a locked-down vm sandbox.
   * The sandbox exposes only: args, console (log only), and Math/JSON/Date.
   */
  async _executeJS(name: string, code: string, args: Record<string, any>): Promise<any> {
    const TIMEOUT_MS = 5_000;
    const logs: string[] = [];

    // Safe Proxy Creator to intercept prototype pollution and sandbox escape patterns
    const createSafeProxy = (obj: any): any => {
      if (obj === null || typeof obj !== "object") {
        return obj;
      }
      if (obj instanceof Date || obj instanceof RegExp) {
        return obj;
      }
      return new Proxy(obj, {
        get(target, prop) {
          if (typeof prop === "string") {
            const p = prop.toLowerCase();
            if (p === "constructor" || p === "__proto__" || p === "prototype") {
              throw new Error("Security Exception: Access to constructor/prototype is blocked");
            }
          }
          const val = Reflect.get(target, prop);
          if (typeof val === "function") {
            return val.bind(target);
          }
          return createSafeProxy(val);
        },
        set(target, prop, value) {
          if (typeof prop === "string") {
            const p = prop.toLowerCase();
            if (p === "constructor" || p === "__proto__" || p === "prototype") {
              throw new Error("Security Exception: Modifying constructor/prototype is blocked");
            }
          }
          return Reflect.set(target, prop, value);
        }
      });
    };

    const sandbox = {
      args: createSafeProxy(args),
      result: undefined as any,
      console: createSafeProxy({
        log: (...a: any[]) => logs.push(a.map(String).join(" ")),
        warn: (...a: any[]) => logs.push("[warn] " + a.map(String).join(" ")),
        error: (...a: any[]) => logs.push("[error] " + a.map(String).join(" ")),
      }),
      Math,
      JSON,
      Date,
      // Temporal Algebra Helpers
      temporal: createSafeProxy({
        isBefore: (d1: any, d2: any) => new Date(d1) < new Date(d2),
        isAfter: (d1: any, d2: any) => new Date(d1) > new Date(d2),
        isBetween: (d: any, s: any, e: any) => {
          const dt = new Date(d);
          return dt >= new Date(s) && dt <= new Date(e);
        },
        daysBetween: (d1: any, d2: any) => {
          const diff = Math.abs(new Date(d1).getTime() - new Date(d2).getTime());
          return Math.floor(diff / (1000 * 60 * 60 * 24));
        },
        addDays: (d: any, days: number) => {
          const dt = new Date(d);
          dt.setDate(dt.getDate() + days);
          return dt.toISOString();
        }
      }),
      validator: createSafeProxy({
        validate: (data: any, schema: Record<string, string>) => {
          if (!data || typeof data !== "object") {
            throw new Error("Validation target must be a non-null object");
          }
          for (const [key, type] of Object.entries(schema)) {
            const val = data[key];
            if (type.endsWith("?")) {
              const baseType = type.slice(0, -1);
              if (val !== undefined && typeof val !== baseType) {
                throw new Error(`Field '${key}' has invalid type: expected optional ${baseType}, got ${typeof val}`);
              }
            } else {
              if (val === undefined) {
                throw new Error(`Missing required field: '${key}'`);
              }
              if (typeof val !== type) {
                throw new Error(`Field '${key}' has invalid type: expected ${type}, got ${typeof val}`);
              }
            }
          }
          return true;
        }
      }),
      telemetry: createSafeProxy({
        record: (metricName: string, value: any) => {
          logs.push(`[telemetry] ${metricName}: ${JSON.stringify(value)}`);
        }
      })
    };

    // Lock prototype properties on the root sandbox object to prevent "this.constructor" style escapes
    Object.defineProperty(sandbox, "constructor", {
      get() { throw new Error("Security Exception: Access to constructor is blocked"); },
      configurable: false
    });
    Object.defineProperty(sandbox, "__proto__", {
      get() { throw new Error("Security Exception: Access to __proto__ is blocked"); },
      configurable: false
    });
    Object.defineProperty(sandbox, "prototype", {
      get() { throw new Error("Security Exception: Access to prototype is blocked"); },
      configurable: false
    });

    const wrappedCode = `
(function(args) {
  "use strict";
  ${code}
})(args);
    `.trim();

    try {
      vm.runInNewContext(wrappedCode, vm.createContext(sandbox), {
        timeout: TIMEOUT_MS,
        filename: `skill:${name}`,
      });

      logger.info(`[SkillService] JS skill ${name} executed. Logs: ${logs.length}`);
      return {
        success: true,
        skillName: name,
        result: sandbox.result,
        logs,
      };
    } catch (err: any) {
      logger.error(`[SkillService] JS skill ${name} execution failed: ${err.message}`);
      return {
        success: false,
        skillName: name,
        error: err.message,
        logs,
      };
    }
  },

  /**
   * Dispatch a Python skill to the system queue for execution by a Python consumer.
   * Waits up to 30s for the result.
   */
  async _executePythonViaQueue(name: string, code: string, args: Record<string, any>): Promise<any> {
    const TIMEOUT_MS = 30_000;
    try {
      const job = await queueService.addJobWithTrace(
        queueService.systemQueue,
        "execute-python-skill",
        { skillName: name, code, args },
        { attempts: 1 }
      );

      const result = await queueService.waitForJob(
        queueService.stepsEvents,
        job,
        TIMEOUT_MS
      );

      logger.info(`[SkillService] Python skill ${name} completed via queue.`);
      return { success: true, skillName: name, result };
    } catch (err: any) {
      logger.error(`[SkillService] Python skill ${name} queue execution failed: ${err.message}`);
      return { success: false, skillName: name, error: err.message };
    }
  },
  /**
   * Find a skill by its unique name.
   */
  async getSkillByName(name: string): Promise<Skill | undefined> {
    const [skill] = await db.select().from(skills).where(eq(skills.name, name)).limit(1);
    return skill;
  },
  /**
   * Register or update a dynamic skill by name.
   */
  async registerDynamicSkill(
    name: string,
    description: string,
    code: string,
    language = "javascript",
    orgId?: number
  ): Promise<Skill> {
    const existing = await this.getSkillByName(name);
    if (existing) {
      const [updated] = await db
        .update(skills)
        .set({
          description,
          code,
          language,
          updatedAt: new Date(),
        })
        .where(eq(skills.id, existing.id))
        .returning();
      logger.info(`[SkillService] Updated dynamic skill: ${name} (id: ${updated.id})`);
      return updated;
    } else {
      const [created] = await db
        .insert(skills)
        .values({
          name,
          description,
          code,
          language,
          isPublic: true,
          organizationId: orgId || null,
        })
        .returning();
      logger.info(`[SkillService] Registered new dynamic skill: ${name} (id: ${created.id})`);
      return created;
    }
  },
  /**
   * Delete a skill.
   */
  async deleteSkill(id: number): Promise<void> {
    await db.delete(skills).where(eq(skills.id, id));
    logger.info(`[SkillService] Deleted skill id: ${id}`);
  }
};


