import { Router } from "express";
import { CycleCollaborationService } from "@domain/mission/core/cycle-collaboration.service.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../domain/core/auth/security.service.js";
import { db } from "../database_service.js";
import { teams, cycleTemplates } from "@shared/schema/index.js";
import { eq, sql, desc, and } from "drizzle-orm";

const router = Router();

// Middleware
router.use(requireAuth);

// Teams
router.get("/teams", asyncHandler(async (req: any, res: any) => {
    const orgId = req.organizationId;
    const result = await db.select().from(teams)
        .where(eq(teams.organizationId, orgId))
        .orderBy(desc(teams.createdAt));
    res.json(result);
}));

router.post("/teams", asyncHandler(async (req: any, res: any) => {
    const { name, organizationId, createdBy, description } = req.body;
    const team = await CycleCollaborationService.createTeam({
        name,
        organizationId: organizationId || req.organizationId,
        createdBy: createdBy || req.user.id,
        description
    });
    res.json(team);
}));

router.get("/teams/:teamId/members", asyncHandler(async (req: any, res: any) => {
    const { teamId } = req.params;
    const members = await CycleCollaborationService.getTeamMembers(parseInt(teamId));
    res.json(members);
}));

router.post("/teams/:teamId/members", asyncHandler(async (req: any, res: any) => {
    const { teamId } = req.params;
    const { userId, role, permissions } = req.body;
    await CycleCollaborationService.addMember(parseInt(teamId), userId, role, permissions);
    res.json({ message: "Member added successfully" });
}));

router.delete("/teams/:teamId/members/:userId", asyncHandler(async (req: any, res: any) => {
    const { teamId, userId } = req.params;
    await CycleCollaborationService.removeMember(parseInt(teamId), userId);
    res.json({ message: "Member removed successfully" });
}));

router.patch("/teams/:teamId/members/:userId/permissions", asyncHandler(async (req: any, res: any) => {
    const { teamId, userId } = req.params;
    const { permissions } = req.body;
    await CycleCollaborationService.updateMemberPermissions(parseInt(teamId), userId, permissions);
    res.json({ message: "Permissions updated" });
}));

// Cycle Sharing
router.post("/cycles/:cycleId/share/:teamId", asyncHandler(async (req: any, res: any) => {
    const { cycleId, teamId } = req.params;
    const sharedBy = req.user.id;
    await CycleCollaborationService.shareCycleWithTeam(parseInt(cycleId), parseInt(teamId), sharedBy);
    res.json({ message: "Cycle shared with team" });
}));

// Templates
router.get("/templates", asyncHandler(async (req: any, res: any) => {
    const orgId = req.organizationId;
    const result = await db.select().from(cycleTemplates)
        .where(and(eq(cycleTemplates.organizationId, orgId), eq(cycleTemplates.isPublic, true)))
        .orderBy(desc(cycleTemplates.usageCount), desc(cycleTemplates.rating));
    res.json(result);
}));

router.post("/templates", asyncHandler(async (req: any, res: any) => {
    const { name, description, objective, category, blueprints, tags, organizationId, createdBy, isPublic } = req.body;
    const template = await CycleCollaborationService.createTemplate({
        name,
        description,
        objective,
        category,
        blueprints,
        tags,
        organizationId: organizationId || req.organizationId,
        createdBy: createdBy || req.user.id,
        isPublic
    });
    res.json(template);
}));

router.post("/templates/:templateId/rate", asyncHandler(async (req: any, res: any) => {
    const { templateId } = req.params;
    const { rating } = req.body;
    const userId = req.user.id;
    await CycleCollaborationService.rateTemplate(parseInt(templateId), rating, userId);
    res.json({ message: "Template rated" });
}));

router.get("/teams/:teamId/templates", asyncHandler(async (req: any, res: any) => {
    const { teamId } = req.params;
    const templates = await CycleCollaborationService.getTeamTemplates(parseInt(teamId));
    res.json(templates);
}));

// Analytics
router.get("/teams/:teamId/analytics", asyncHandler(async (req: any, res: any) => {
    const orgId = req.organizationId;
    const analytics = await CycleCollaborationService.getCollaborationAnalytics(orgId);
    res.json(analytics);
}));

router.get("/teams/:teamId/cycles", asyncHandler(async (req: any, res: any) => {
    const { teamId } = req.params;
    const cycles = await CycleCollaborationService.getTeamCycles(parseInt(teamId));
    res.json(cycles);
}));

router.get("/teams/:teamId/activity", asyncHandler(async (req: any, res: any) => {
    const { teamId } = req.params;
    const limit = parseInt(String(req.query.limit || "50"));
    const activity = await CycleCollaborationService.getTeamActivityFeed(parseInt(teamId), limit);
    res.json(activity);
}));

// Permissions
router.get("/teams/:teamId/permissions", asyncHandler(async (req: any, res: any) => {
    const { teamId } = req.params;
    const permissions = await CycleCollaborationService.getTeamPermissions(parseInt(teamId));
    res.json(permissions);
}));

router.post("/teams/:teamId/permissions", asyncHandler(async (req: any, res: any) => {
    const { teamId } = req.params;
    const { resource, action, conditions } = req.body;
    await CycleCollaborationService.createTeamPermission(parseInt(teamId), resource, action, conditions);
    res.json({ message: "Permission created" });
}));

router.patch("/teams/:teamId/permissions/:permissionId", asyncHandler(async (req: any, res: any) => {
    const { permissionId } = req.params;
    const { conditions } = req.body;
    await CycleCollaborationService.updateTeamPermission(parseInt(permissionId), conditions);
    res.json({ message: "Permission updated" });
}));

router.delete("/teams/:teamId/permissions/:permissionId", asyncHandler(async (req: any, res: any) => {
    const { permissionId } = req.params;
    await CycleCollaborationService.deleteTeamPermission(parseInt(permissionId));
    res.json({ message: "Permission deleted" });
}));

export default router;
