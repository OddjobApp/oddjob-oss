import { createHash, randomBytes } from "crypto";
import { db } from "@server/database_service.js";
import {
    users,
    userOrgs,
    orgs,
    organizationInvites,
    organizationRoleAssignments,
    type OrganizationRoleType,
    organizationRoleTypes,
} from "@shared/schema/index.js";
import { eq, and, isNull } from "drizzle-orm";
import {
    BadRequestError,
    NotFoundError,
    ForbiddenError,
    ConflictError,
} from "@server/utils/errors.js";
import { type OrgContext } from "@server/utils/auth-context.js";
import { hashPassword } from "@server/domain/auth/core/password-service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("OrganizationInviteService");

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

function generateToken(): string {
    return randomBytes(32).toString("hex");
}

function assertAdminOf(orgId: number, context: OrgContext): void {
    if (context.isSuperAdmin) return;
    if (context.isOrgAdmin && context.organizationId === orgId) return;
    throw new ForbiddenError("You do not have permission to manage invites for this organization");
}

export interface CreateInviteInput {
    organizationId: number;
    email?: string;
    role?: OrganizationRoleType;
}

export interface AcceptInviteInput {
    token: string;
    username: string;
    password: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    tosAccepted?: boolean;
    privacyPolicyAccepted?: boolean;
}

export const organizationInviteService = {
    /**
     * Create an invitation to join an organization.
     * Returns the raw token (for the invite link) and a safe invite record.
     */
    async createInvite(input: CreateInviteInput, context: OrgContext) {
        assertAdminOf(input.organizationId, context);

        const [org] = await db.select().from(orgs).where(eq(orgs.id, input.organizationId)).limit(1);
        if (!org) throw new NotFoundError("Organization not found");

        if (input.role && !organizationRoleTypes.includes(input.role)) {
            throw new BadRequestError(`Invalid role: ${input.role}`);
        }

        const rawToken = generateToken();
        const tokenHash = hashToken(rawToken);
        const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);

        const [invite] = await db
            .insert(organizationInvites)
            .values({
                organizationId: input.organizationId,
                email: input.email?.toLowerCase().trim() || null,
                role: input.role || "operator",
                tokenHash,
                invitedBy: context.userId,
                expiresAt,
            })
            .returning();

        const [organization] = await db.select().from(orgs).where(eq(orgs.id, input.organizationId)).limit(1);

        return { rawToken, invite, organization };
    },

    /**
     * List pending (unused and not expired) invites for an organization.
     */
    async listInvites(organizationId: number, context: OrgContext) {
        assertAdminOf(organizationId, context);

        const invites = await db
            .select()
            .from(organizationInvites)
            .where(
                and(
                    eq(organizationInvites.organizationId, organizationId),
                    isNull(organizationInvites.usedAt),
                ),
            )
            .orderBy(organizationInvites.createdAt);

        const now = new Date();
        return invites.map((invite) => ({
            ...invite,
            expired: now > invite.expiresAt,
        }));
    },

    /**
     * Revoke (delete) an invitation.
     */
    async revokeInvite(inviteId: number, context: OrgContext) {
        const [invite] = await db
            .select()
            .from(organizationInvites)
            .where(eq(organizationInvites.id, inviteId))
            .limit(1);

        if (!invite) throw new NotFoundError("Invite not found");
        assertAdminOf(invite.organizationId, context);

        await db.delete(organizationInvites).where(eq(organizationInvites.id, inviteId));
        return { revoked: true };
    },

    /**
     * Validate a token and return the invite with organization info.
     * Does not consume the token.
     */
    async validateInviteToken(token: string) {
        const tokenHash = hashToken(token);

        const [invite] = await db
            .select()
            .from(organizationInvites)
            .where(eq(organizationInvites.tokenHash, tokenHash))
            .limit(1);

        if (!invite) return { valid: false, reason: "Invalid invite link" };
        if (invite.usedAt) return { valid: false, reason: "Invite already used" };
        if (new Date() > invite.expiresAt) return { valid: false, reason: "Invite expired" };

        const [org] = await db.select().from(orgs).where(eq(orgs.id, invite.organizationId)).limit(1);

        return {
            valid: true,
            invite,
            organization: org || null,
        };
    },

    /**
     * Accept an invitation: create the user, add them to the organization,
     * assign the invited role, and mark the invite consumed.
     */
    async acceptInvite(input: AcceptInviteInput) {
        const tokenHash = hashToken(input.token);

        const [invite] = await db
            .select()
            .from(organizationInvites)
            .where(eq(organizationInvites.tokenHash, tokenHash))
            .limit(1);

        if (!invite) throw new BadRequestError("Invalid invite link");
        if (invite.usedAt) throw new BadRequestError("Invite already used");
        if (new Date() > invite.expiresAt) throw new BadRequestError("Invite expired");

        if (invite.email && input.email?.toLowerCase().trim() !== invite.email) {
            throw new BadRequestError("This invite was sent to a different email address");
        }

        const normalizedUsername = input.username.toLowerCase().trim();
        const normalizedEmail = input.email?.toLowerCase().trim() || null;

        // Username and email must be unique across the platform.
        const [existingByUsername] = await db
            .select()
            .from(users)
            .where(eq(users.username, normalizedUsername))
            .limit(1);
        if (existingByUsername) {
            throw new ConflictError("Username is already taken");
        }

        if (normalizedEmail) {
            const [existingByEmail] = await db
                .select()
                .from(users)
                .where(eq(users.email, normalizedEmail))
                .limit(1);
            if (existingByEmail) {
                throw new ConflictError("An account with this email already exists");
            }
        }

        if (!input.tosAccepted || !input.privacyPolicyAccepted) {
            throw new BadRequestError("Terms of service and privacy policy must be accepted");
        }

        const hashedPassword = await hashPassword(input.password);
        const now = new Date();

        const result = await db.transaction(async (tx) => {
            // Claim the invite first, conditionally: two concurrent accepts of
            // the same link both pass the checks above, and only one may win.
            const [claimed] = await tx
                .update(organizationInvites)
                .set({ usedAt: now })
                .where(and(eq(organizationInvites.id, invite.id), isNull(organizationInvites.usedAt)))
                .returning({ id: organizationInvites.id });
            if (!claimed) throw new BadRequestError("Invite already used");

            const [newUser] = await tx
                .insert(users)
                .values({
                    username: normalizedUsername,
                    password: hashedPassword,
                    email: normalizedEmail,
                    firstName: input.firstName?.trim() || null,
                    lastName: input.lastName?.trim() || null,
                    defaultOrgId: invite.organizationId,
                    tosAccepted: true,
                    tosVersion: "1.0.0",
                    privacyPolicyAccepted: true,
                    privacyPolicyVersion: "1.0.0",
                    legalAcceptedAt: now,
                })
                .returning();

            await tx.insert(userOrgs).values({
                userId: newUser.id,
                orgId: invite.organizationId,
            });

            await tx.insert(organizationRoleAssignments).values({
                organizationId: invite.organizationId,
                userId: newUser.id,
                role: invite.role,
                createdBy: invite.invitedBy,
            });

            await tx
                .update(organizationInvites)
                .set({ usedBy: newUser.id })
                .where(eq(organizationInvites.id, invite.id));

            const { password: _, pin: _pin, ...safeUser } = newUser;
            return safeUser;
        });

        logger.info(`Invite accepted: user ${result.id} joined organization ${invite.organizationId}`);
        return result;
    },
};
