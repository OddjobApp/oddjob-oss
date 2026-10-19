import { db } from "@server/database_service.js";
import { mcpApiTokens, mcpPermissions, orgSettings, McpPermission } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { generateApiToken } from "../../../mcp/auth.js";
import { ValidationError, NotFoundError } from "@server/utils/errors.js";
import { z } from "zod";

// Validation Schemas
export const createTokenSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    permissions: z.array(z.string()).default([]),
    expiresAt: z.string().datetime().optional().nullable(),
    metadata: z.object({ runnerScope: z.enum(["local"]).optional() }).optional(),
});

export const updateTokenSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    permissions: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
    expiresAt: z.string().datetime().optional().nullable(),
});

export const mcpService = {
    listPermissions() {
        return {
            permissions: mcpPermissions,
            groups: {
                knowledge: mcpPermissions.filter(p => p.startsWith("knowledge:")),
                pipeline: mcpPermissions.filter(p => p.startsWith("pipeline:")),
                job: mcpPermissions.filter(p => p.startsWith("job:")),
                document: mcpPermissions.filter(p => p.startsWith("document:")),
                dataset: mcpPermissions.filter(p => p.startsWith("dataset:")),
                schedule: mcpPermissions.filter(p => p.startsWith("schedule:")),
                template: mcpPermissions.filter(p => p.startsWith("template:")),
                saas: mcpPermissions.filter(p => p.startsWith("saas:")),
                admin: mcpPermissions.filter(p => p.startsWith("admin:")),
            }
        };
    },

    async listTokens(organizationId: number) {
        return await db
            .select({
                id: mcpApiTokens.id,
                name: mcpApiTokens.name,
                description: mcpApiTokens.description,
                tokenPrefix: mcpApiTokens.tokenPrefix,
                userId: mcpApiTokens.userId,
                organizationId: mcpApiTokens.organizationId,
                permissions: mcpApiTokens.permissions,
                isActive: mcpApiTokens.isActive,
                expiresAt: mcpApiTokens.expiresAt,
                lastUsedAt: mcpApiTokens.lastUsedAt,
                usageCount: mcpApiTokens.usageCount,
                createdAt: mcpApiTokens.createdAt,
            })
            .from(mcpApiTokens)
            .where(eq(mcpApiTokens.organizationId, organizationId))
            .orderBy(desc(mcpApiTokens.createdAt));
    },

    async createToken(input: z.infer<typeof createTokenSchema>, userId: string | number, organizationId: number) {
        const { name, description, permissions, expiresAt, metadata } = input;
        const validPermissions = permissions.filter(p =>
            mcpPermissions.includes(p as McpPermission)
        ) as McpPermission[];
        const { token, hash, prefix } = generateApiToken();
        const [created] = await db.insert(mcpApiTokens).values({
            name,
            description,
            tokenHash: hash,
            tokenPrefix: prefix,
            userId: String(userId),
            organizationId,
            permissions: validPermissions,
            isActive: true,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            metadata: metadata ?? undefined,
        }).returning();

        return {
            token: {
                id: created.id,
                name: created.name,
                description: created.description,
                tokenPrefix: created.tokenPrefix,
                permissions: created.permissions,
                isActive: created.isActive,
                expiresAt: created.expiresAt,
                createdAt: created.createdAt,
            },
            rawToken: token,
        };
    },

    async getToken(tokenId: number, organizationId: number) {
        const [token] = await db
            .select()
            .from(mcpApiTokens)
            .where(
                and(
                    eq(mcpApiTokens.id, tokenId),
                    eq(mcpApiTokens.organizationId, organizationId)
                )
            )
            .limit(1);

        if (!token) {
            throw new NotFoundError("Token not found");
        }

        return {
            id: token.id,
            name: token.name,
            description: token.description,
            tokenPrefix: token.tokenPrefix,
            userId: token.userId,
            organizationId: token.organizationId,
            permissions: token.permissions,
            isActive: token.isActive,
            expiresAt: token.expiresAt,
            lastUsedAt: token.lastUsedAt,
            usageCount: token.usageCount,
            createdAt: token.createdAt,
            updatedAt: token.updatedAt,
        };
    },

    async updateToken(tokenId: number, organizationId: number, input: z.infer<typeof updateTokenSchema>) {
        const updates: any = { updatedAt: new Date() };
        if (input.name !== undefined) updates.name = input.name;
        if (input.description !== undefined) updates.description = input.description;
        if (input.permissions !== undefined) {
            updates.permissions = input.permissions.filter(p =>
                mcpPermissions.includes(p as McpPermission)
            );
        }
        if (input.isActive !== undefined) updates.isActive = input.isActive;
        if (input.expiresAt !== undefined) {
            updates.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
        }

        const [updated] = await db
            .update(mcpApiTokens)
            .set(updates)
            .where(
                and(
                    eq(mcpApiTokens.id, tokenId),
                    eq(mcpApiTokens.organizationId, organizationId)
                )
            )
            .returning();

        if (!updated) {
            throw new NotFoundError("Token not found");
        }

        return {
            id: updated.id,
            name: updated.name,
            description: updated.description,
            tokenPrefix: updated.tokenPrefix,
            permissions: updated.permissions,
            isActive: updated.isActive,
            expiresAt: updated.expiresAt,
            updatedAt: updated.updatedAt,
        };
    },

    async deleteToken(tokenId: number, organizationId: number) {
        const [deleted] = await db
            .delete(mcpApiTokens)
            .where(
                and(
                    eq(mcpApiTokens.id, tokenId),
                    eq(mcpApiTokens.organizationId, organizationId)
                )
            )
            .returning();

        if (!deleted) {
            throw new NotFoundError("Token not found");
        }
    },

    async revokeToken(tokenId: number, organizationId: number) {
        const [revoked] = await db
            .update(mcpApiTokens)
            .set({ isActive: false, updatedAt: new Date() })
            .where(
                and(
                    eq(mcpApiTokens.id, tokenId),
                    eq(mcpApiTokens.organizationId, organizationId)
                )
            )
            .returning();

        if (!revoked) {
            throw new NotFoundError("Token not found");
        }
    },

    async getOrgSettings(organizationId: number) {
        const [settings] = await db
            .select()
            .from(orgSettings)
            .where(eq(orgSettings.organizationId, organizationId))
            .limit(1);

        return {
            mcpHttpEnabled: settings?.mcpHttpEnabled ?? false,
        };
    },

    async updateOrgSettings(organizationId: number, mcpHttpEnabled: boolean) {
        const [existing] = await db
            .select()
            .from(orgSettings)
            .where(eq(orgSettings.organizationId, organizationId))
            .limit(1);

        if (existing) {
            await db
                .update(orgSettings)
                .set({ mcpHttpEnabled, updatedAt: new Date() })
                .where(eq(orgSettings.organizationId, organizationId));
        } else {
            await db.insert(orgSettings).values({
                organizationId,
                mcpHttpEnabled,
            });
        }
        return { mcpHttpEnabled };
    }
};

export default mcpService;


