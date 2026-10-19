/**
 * App Forge and App Studio actions taken directly inside a crew room.
 *
 * These nine functions handled a different domain from the rest of the crew
 * orchestrator: starting a Forge build, mounting the studio, applying and
 * proposing gallery migrations, and the background scaffold assessment. They
 * were ~856 contiguous lines of CrewOrchestratorService and none of them is
 * about running a round.
 *
 * They take the round's RoundContext explicitly rather than reading it off an
 * instance, which is what made the move mechanical: not one referenced `this`
 * beyond the cluster itself.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { crewTurns, type AgentCardRecord } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import { forgeIntentResolver, decideStudioAction } from "@domain/intent-router/core/forge-intent-resolver.service.js";
import { crewStreamService } from "./crew-stream.service.js";
import { buildCrewToolContext } from "./crew-tool-context.js";
import { crewToolsService, type ResolvedCrewTool } from "./crew-tools.service.js";
import { roomForgeBrief, hasPendingForgeDraft, isDraftRefinement } from './crew-forge-brief.js';
import {
    CREATE_INTENTS,
    isAppOpenRequest,
    isAppStudioRequest,
    parseForgeConfirmation,
    parseMigrationApproval,
    type RoundContext,
} from "./crew-round-context.js";

const logger = createLogger("CrewAppStudio");

/**
 * The app a studio is already mounted for in this room, or null.
 *
 * Read from the last App Studio artifact rather than from a lookup, so the
 * room's own history is what says which app "this app" means.
 */
export function mountedStudioApp(ctx: RoundContext): { appId?: number; slug?: string; name?: string } | null {
    for (let i = ctx.priorTurns.length - 1; i >= 0; i--) {
        for (const art of ((ctx.priorTurns[i] as any).artifacts ?? []) as any[]) {
            const p = art?.payload ?? {};
            if (p.type === "app_studio_pod" && p.appId) {
                return { appId: p.appId, slug: p.appSlug, name: p.appName };
            }
            // A canvas-mounted app is a mounted studio too: the room showed it,
            // so "this app" follow-ups resolve to it through the change path.
            if (p.type === "assistant_app" && p.studioSurface === "cycle_canvas" && p.appId) {
                return { appId: p.appId, slug: p.publicSlug, name: p.title };
            }
            if (p.type === 'app_studio_pod' || p.type === 'forge_confirmation_card') return null;
        }
    }
    return null;
}

/**
 * Apply a change to an app whose studio is already open in this room.
 *
 * This is the half of the product principle that mounting alone does not
 * deliver: CREW is the orchestration surface, so a follow-up message is
 * meant to change the app, not to send the author into the studio's own chat
 * to say the same thing again.
 *
 * Three conditions gate it, and all three are required, because this WRITES
 * to an app's workspace and rebuilds its container:
 *
 *  1. A studio is already mounted for an app in this room. A change is never
 *     the first thing that happens to an app — it has to be on screen first.
 *  2. The message resolves to a change intent at usable confidence. Anything
 *     vaguer belongs to the room.
 *  3. The resolved app is the mounted one. A message naming a DIFFERENT app
 *     mounts that app instead; it does not edit it sight-unseen.
 *
 * apply_app_change and revert_app_change are deliberately absent from
 * UNIVERSAL_PRESENTATION_TOOLS and from every agent card, so no agent can
 * decide on its own to rewrite an application mid-conversation. They are
 * reachable only from here, where the conditions above are checked first.
 */
export async function runDirectAppStudioChange(ctx: RoundContext, card?: AgentCardRecord): Promise<boolean> {
    if (!card) return false;

    // Every gating condition lives in decideStudioAction, which is a pure
    // function precisely because it decides whether code gets written.
    const action = decideStudioAction(ctx.message, mountedStudioApp(ctx));
    if (action.kind === "none") return false;

    // An approval names the proposal it approves, so it is checked before
    // the resolver gets a chance to read it as another change request.
    const approval = parseMigrationApproval(ctx.message);
    if (approval) {
        return runGalleryMigrationApply(ctx, card, action.appId, approval.snapshotId);
    }

    // A migration proposes before it writes, so it does not take the
    // claim-lock-and-apply path the other two share.
    if (action.kind === "migrate") {
        return runGalleryMigrationProposal(ctx, card, action.appId);
    }

    const toolName = action.kind === "revert" ? "revert_app_change" : "apply_app_change";

    /*
     * The tool is resolved from the registry rather than from the card's
     * offered set. That is the point: it is not offered to anybody. Reaching
     * for it here is a decision this method made under the conditions above,
     * not one a model made mid-turn.
     */
    let allowed: ResolvedCrewTool[];
    try {
        const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
        const def = getAgentTools()[toolName];
        if (!def) return false;
        allowed = [{ definition: def, reason: "declared-agent-tool" }];
    } catch {
        return false;
    }

    /*
     * One change at a time per app. Two edits interleaving in one workspace
     * corrupt it, and queueing the second is worse than refusing it: by the
     * time it ran, the file it targeted may not exist.
     */
    const { claimAppChange } = await import("@domain/apps/core/app-change-lock.service.js");
    const lock = await claimAppChange(action.appId);
    if (!lock) {
        await postStudioTurn(ctx, card, {
            content: "A change is already being applied to this app. I'll wait for it to finish — ask again once it lands.",
        });
        return true;
    }

    /*
     * Applying a change runs a model, rewrites files and rebuilds a
     * container: minutes, not seconds. Awaiting it here held the whole round
     * open, so the room sat silent and the author had no idea their request
     * had even been understood.
     *
     * So the room answers now and the work continues after. The outcome
     * arrives as its own turn, published on the same stream the client
     * already appends from, which is why this needs no polling and no new
     * endpoint.
     */
    const started = await postStudioTurn(ctx, card, {
        content:
            action.kind === "revert"
                ? "Reverting the last change now. I'll confirm here when the app has restarted."
                : "Applying that now. I'll report back here when the app has rebuilt.",
        artifact: {
            tool: toolName,
            payload: {
                type: "app_studio_pod",
                module: "AppStudioPod",
                component: "AppStudioPod",
                mode: "builder",
                view: action.kind === "revert" ? "preview" : action.view,
                appId: action.appId,
                lastChange: {
                    status: "applying",
                    summary:
                        action.kind === "revert"
                            ? "Reverting the last change…"
                            : "Applying your change…",
                    canRevert: false,
                },
            },
        },
    });
    if (!started) {
        await lock.release();
        return false;
    }

    const toolArgs =
        action.kind === "revert"
            ? { appId: action.appId }
            : {
                  appId: action.appId,
                  instruction: action.instruction,
                  view: action.view,
                  galleryMigration: action.galleryMigration,
              };
    const toolContext = buildCrewToolContext({
        orgId: ctx.orgId,
        userId: ctx.userId,
        projectId: ctx.projectId,
        projectKey: ctx.projectKey,
        sessionKey: ctx.sessionKey,
        sessionId: ctx.session.id,
        message: ctx.message,
    });
    // Captured now: ctx is the round's, and the round ends before this runs.
    const { orgId, sessionKey, round, topic, intent } = ctx;
    const sessionId = ctx.session.id;
    const replyTo = ctx.replyTarget;

    setImmediate(async () => {
        try {
            const { record, artifact } = await crewToolsService.execute(toolName, toolArgs, allowed, toolContext);

            /*
             * Report the outcome the tool actually reported. "Applied" and
             * "nothing matched that request" are both successes to the
             * builder service, and collapsing them into "done" is how an
             * author ends up believing a change landed when no file was
             * touched.
             */
            const change = (artifact?.payload as any)?.lastChange ?? {};
            const summary = String(
                change.summary ?? record.error ?? "The change finished, but the studio reported nothing.",
            );
            const content = change.canRevert ? `${summary} Say "undo that" to put it back.` : summary;

            const [turn] = await db.insert(crewTurns).values({
                sessionId,
                organizationId: orgId,
                speakerType: "agent",
                agentCardId: card.id,
                speakerName: card.name,
                content,
                round,
                inReplyToTurnId: replyTo,
                topic,
                intent,
                toolsUsed: [record],
                artifacts: artifact ? [artifact] : [],
                latencyMs: record.ms,
            }).returning();

            void crewStreamService.publish({
                type: "turn-content",
                organizationId: orgId,
                sessionKey,
                payload: { turn, round },
            });
        } catch (err: any) {
            // The workspace may well have been modified before this threw.
            // Silence would leave the room showing "applying…" forever, so
            // say what happened rather than what we wish had happened.
            logger.error(`[AppStudio] Background change failed: ${err?.message ?? err}`);
            const [turn] = await db.insert(crewTurns).values({
                sessionId,
                organizationId: orgId,
                speakerType: "agent",
                agentCardId: card.id,
                speakerName: card.name,
                content: `The change stopped partway: ${err?.message ?? err}. Check the studio before asking for another.`,
                round,
                inReplyToTurnId: replyTo,
                topic,
                intent,
                toolsUsed: [],
                artifacts: [],
                latencyMs: 0,
            }).returning().catch(() => [null] as any);

            if (turn) {
                void crewStreamService.publish({
                    type: "turn-content",
                    organizationId: orgId,
                    sessionKey,
                    payload: { turn, round },
                });
            }
        } finally {
            await lock.release();
        }
    });

    ctx.cost.toolCalls++;
    return true;
}

/**
 * Apply a migration the author approved by name.
 *
 * Takes the per-app change lock, because a migration writes files the same
 * way an ordinary change does and the two must not interleave in one
 * workspace. Deferred like every other write so the room answers now.
 */
export async function runGalleryMigrationApply(
    ctx: RoundContext,
    card: AgentCardRecord,
    appId: number,
    snapshotId: string,
): Promise<boolean> {
    let allowed: ResolvedCrewTool[];
    try {
        const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
        const def = getAgentTools()["apply_gallery_migration"];
        if (!def) return false;
        allowed = [{ definition: def, reason: "declared-agent-tool" }];
    } catch {
        return false;
    }

    const { claimAppChange } = await import("@domain/apps/core/app-change-lock.service.js");
    const lock = await claimAppChange(appId);
    if (!lock) {
        await postStudioTurn(ctx, card, {
            content: "A change is already being applied to this app. Ask again once it lands.",
        });
        return true;
    }

    const started = await postStudioTurn(ctx, card, {
        content: "Applying the migration now. I'll confirm here, and put everything back if it does not verify.",
    });
    if (!started) {
        await lock.release();
        return false;
    }

    const toolContext = buildCrewToolContext({
        orgId: ctx.orgId,
        userId: ctx.userId,
        projectId: ctx.projectId,
        projectKey: ctx.projectKey,
        sessionKey: ctx.sessionKey,
        sessionId: ctx.session.id,
        message: ctx.message,
    });
    const { orgId, sessionKey, round, topic, intent } = ctx;
    const sessionId = ctx.session.id;
    const replyTo = ctx.replyTarget;

    setImmediate(async () => {
        try {
            const { record, artifact } = await crewToolsService.execute(
                "apply_gallery_migration",
                { appId, snapshotId },
                allowed,
                toolContext,
            );

            const change = (artifact?.payload as any)?.lastChange ?? {};
            const summary = String(change.summary ?? record.error ?? "The migration finished without a report.");

            const [turn] = await db.insert(crewTurns).values({
                sessionId,
                organizationId: orgId,
                speakerType: "agent",
                agentCardId: card.id,
                speakerName: card.name,
                content: change.canRevert
                    ? `${summary} Say "undo that" to put it back.`
                    : summary,
                round,
                inReplyToTurnId: replyTo,
                topic,
                intent,
                toolsUsed: [record],
                artifacts: artifact ? [artifact] : [],
                latencyMs: record.ms,
            }).returning();

            if (turn) {
                void crewStreamService.publish({
                    type: "turn-content",
                    organizationId: orgId,
                    sessionKey,
                    payload: { turn, round },
                });
            }
        } catch (err: any) {
            logger.error(`[AppStudio] Migration apply failed: ${err?.message ?? err}`);
        } finally {
            await lock.release();
        }
    });

    ctx.cost.toolCalls++;
    return true;
}

/**
 * Propose a gallery migration and show it as a diff.
 *
 * Writes nothing. The author sees which files would change, what the mapper
 * refused to touch and why, and confirms — which is the shape the spec asks
 * for ("show the proposed migration as a diff") and the reason a restyle no
 * longer goes through the model at all.
 */
export async function runGalleryMigrationProposal(
    ctx: RoundContext,
    card: AgentCardRecord,
    appId: number,
): Promise<boolean> {
    let allowed: ResolvedCrewTool[];
    try {
        const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
        const def = getAgentTools()["propose_gallery_migration"];
        if (!def) return false;
        allowed = [{ definition: def, reason: "declared-read-safe" }];
    } catch {
        return false;
    }

    const { record, output } = await crewToolsService.execute(
        "propose_gallery_migration",
        { appId },
        allowed,
        buildCrewToolContext({
            orgId: ctx.orgId,
            userId: ctx.userId,
            projectId: ctx.projectId,
            projectKey: ctx.projectKey,
            sessionKey: ctx.sessionKey,
            sessionId: ctx.session.id,
            message: ctx.message,
        }),
    );
    ctx.cost.toolCalls++;
    if (!record.ok) return false;

    // A refusal — unhealthy app, nothing to migrate, bespoke UI — comes back
    // as prose. It is the answer, so say it rather than dropping the turn.
    let proposal: any;
    try {
        proposal = JSON.parse(output);
    } catch {
        await postStudioTurn(ctx, card, { content: output });
        return true;
    }

    if (!proposal?.snapshotId || proposal.filesChanged === 0) {
        await postStudioTurn(ctx, card, {
            content: `Nothing in ${proposal?.appName ?? "this app"} maps onto the gallery automatically.` +
                (proposal?.reviewNotes?.length
                    ? ` ${proposal.reviewNotes.length} thing(s) need a person: ${proposal.reviewNotes.map((n: any) => n.detail).slice(0, 3).join(" ")}`
                    : ""),
        });
        return true;
    }

    const reviewLine = proposal.reviewNotes?.length
        ? ` ${proposal.reviewNotes.length} control(s) need restructuring rather than renaming, so I left them alone: ` +
          proposal.reviewNotes.map((n: any) => n.detail).slice(0, 3).join(" ")
        : "";
    const preservedLine = proposal.preserved?.length
        ? ` ${proposal.preserved.length} bespoke file(s) were held back.`
        : "";

    await postStudioTurn(ctx, card, {
        content:
            `${proposal.appName} is ${proposal.classification}. I can move ${proposal.filesChanged} file(s) onto the ` +
            `gallery — the diff is in the studio.${reviewLine}${preservedLine} ` +
            `Say “apply migration "${proposal.snapshotId}"” to apply it; everything is restorable afterwards.`,
        artifact: {
            tool: "propose_gallery_migration",
            payload: {
                type: "app_studio_pod",
                module: "AppStudioPod",
                component: "AppStudioPod",
                mode: "builder",
                view: "preview",
                appId: proposal.appId,
                appName: proposal.appName,
                migration: {
                    snapshotId: proposal.snapshotId,
                    classification: proposal.classification,
                    filesChanged: proposal.filesChanged,
                    diffs: proposal.diffs,
                    reviewNotes: proposal.reviewNotes,
                    preserved: proposal.preserved,
                },
            },
        },
    });
    return true;
}

/**
 * Insert an agent turn into the running round and announce it.
 *
 * Shared by the studio paths because they all do the same four things in
 * the same order, and a turn that is inserted but not published leaves the
 * room silent until the next refresh.
 */
export async function postStudioTurn(
    ctx: RoundContext,
    card: AgentCardRecord,
    opts: { content: string; artifact?: { tool: string; payload: Record<string, unknown> } },
): Promise<boolean> {
    const [turn] = await db.insert(crewTurns).values({
        sessionId: ctx.session.id,
        organizationId: ctx.orgId,
        speakerType: "agent",
        agentCardId: card.id,
        speakerName: card.name,
        content: opts.content,
        round: ctx.round,
        inReplyToTurnId: ctx.replyTarget,
        topic: ctx.topic,
        intent: ctx.intent,
        toolsUsed: [],
        artifacts: opts.artifact ? [opts.artifact] : [],
        latencyMs: 0,
    }).returning();

    if (!turn) return false;

    ctx.roundTurns.push(turn);
    ctx.replyTarget = turn.id;
    void crewStreamService.publish({
        type: "turn-content",
        organizationId: ctx.orgId,
        sessionKey: ctx.sessionKey,
        payload: { turn, round: ctx.round },
    });
    return true;
}

/**
 * Mount the App Studio for an explicit app gesture, on the same terms as
 * runDirectScribeMount: the routing decision is made here rather than being
 * handed to a model that would have to re-derive it, and a card without the
 * tool falls back to ordinary agent execution.
 *
 * The resolver needs to know what already exists before it can honour
 * "existing scaffolds are the fastest path", so this gathers two things
 * first: the app this room has already mounted a studio for, and the org's
 * installed apps for a name stated outright. Returning false is a normal
 * outcome — an ambiguous message belongs to the room, not to a studio that
 * mounted itself over the conversation.
 */
/**
 * Propose a build rather than starting one.
 *
 * Emits the confirmation card and stops. Nothing is provisioned until the
 * author presses Build it, which comes back through runDirectForgeStart.
 */
export async function proposeForgeRun(
    ctx: RoundContext,
    card: AgentCardRecord,
    resolution: { inferredTitle: string | null },
): Promise<boolean> {
    const brief = roomForgeBrief(ctx.message, ctx.priorTurns);
    const artifact = {
        tool: "propose_app_forge",
        payload: {
            type: "forge_confirmation_card",
            name: resolution.inferredTitle || brief.name,
            // The author's own words, carried to the generator verbatim. A
            // summary here would quietly become the spec.
            requirements: brief.requirements,
        } as Record<string, unknown>,
    };

    const [turn] = await db.insert(crewTurns).values({
        sessionId: ctx.session.id,
        organizationId: ctx.orgId,
        speakerType: "agent",
        agentCardId: card.id,
        speakerName: card.name,
        content:
            `I've prepared the app requirements from this conversation. Check the name and choose Review and build to open App Forge. ` +
            `That opens setup; the build starts when you select Ignition in the studio.`,
        round: ctx.round,
        inReplyToTurnId: ctx.replyTarget,
        topic: ctx.topic,
        intent: ctx.intent,
        toolsUsed: [],
        artifacts: [artifact],
        latencyMs: 0,
    }).returning();

    ctx.roundTurns.push(turn);
    ctx.replyTarget = turn.id;
    void crewStreamService.publish({
        type: "turn-content",
        organizationId: ctx.orgId,
        sessionKey: ctx.sessionKey,
        payload: { turn, round: ctx.round },
    });
    return true;
}

/**
 * Start the build the author just confirmed.
 *
 * The parameters come from the CARD's artifact, never from the message that
 * confirmed it. The message only has to be recognisable as this room's
 * confirmation — what gets built is what the author was looking at when they
 * pressed the button, which is the property that makes the gate meaningful
 * rather than decorative.
 */
export async function runDirectForgeStart(ctx: RoundContext, card?: AgentCardRecord): Promise<boolean> {
    if (!card) return false;

    const confirmed = parseForgeConfirmation(ctx.message);
    if (!confirmed) return false;

    // The card must be the most recent forge proposal in this room, and it
    // must not already have produced a build.
    let proposal: { name: string; requirements: string } | null = null;
    for (let i = ctx.priorTurns.length - 1; i >= 0 && !proposal; i--) {
        for (const art of ((ctx.priorTurns[i] as any).artifacts ?? []) as any[]) {
            const p = art?.payload ?? {};
            if (p.type === "app_studio_pod" && p.jobId) return false; // already building
            if (p.type === "forge_confirmation_card") {
                proposal = { name: String(p.name ?? ""), requirements: String(p.requirements ?? "") };
                break;
            }
            if (p.type === "app_studio_pod" && (p.title || p.requirements)) {
                proposal = { name: String(p.title || p.appName || "New Application"), requirements: String(p.requirements || "") };
                break;
            }
        }
    }
    if (!proposal?.requirements) {
        for (let i = ctx.priorTurns.length - 1; i >= 0; i--) {
            const t = ctx.priorTurns[i] as any;
            if (t.speakerType === "user" && isAppStudioRequest(t.content || "")) {
                proposal = { name: "New Application", requirements: t.content };
                break;
            }
        }
    }
    if (!proposal?.requirements) return false;

    // Old scaffold buttons may follow newer human refinements. A stage
    // confirmation opens setup, so retain those refinements instead of reviving
    // a stale, generic draft. Explicit named-card confirmations keep its brief.
    if (!confirmed.name) {
        const brief = roomForgeBrief(ctx.message, ctx.priorTurns);
        proposal = { name: brief.name, requirements: brief.requirements };
    }

    let allowed: ResolvedCrewTool[];
    try {
        const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
        const def = getAgentTools()["mount_app_studio"] || getAgentTools()["start_app_forge"];
        if (!def) return false;
        allowed = [{ definition: def, reason: "declared-agent-tool" }];
    } catch {
        return false;
    }

    const appTitle = confirmed.name || proposal.name || "New Application";
    const { record, artifact } = await crewToolsService.execute(
        "mount_app_studio",
        {
            mode: "forge",
            title: appTitle,
            requirements: proposal.requirements,
            ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
        },
        allowed,
        buildCrewToolContext({
            orgId: ctx.orgId,
            userId: ctx.userId,
            projectId: ctx.projectId,
            projectKey: ctx.projectKey,
            sessionKey: ctx.sessionKey,
            sessionId: ctx.session.id,
            message: ctx.message,
        }),
    );
    ctx.cost.toolCalls++;
    if (!record.ok) return false;

    const [turn] = await db.insert(crewTurns).values({
        sessionId: ctx.session.id,
        organizationId: ctx.orgId,
        speakerType: "agent",
        agentCardId: card.id,
        speakerName: card.name,
        // The studio opens in walkthrough mode so the author reviews Architecture & Steps, Specs & Requirements, and Pre-Flight & Ignition.
        content: artifact
            ? `I have opened App Forge for "${appTitle}". Please review Architecture & Steps, Specs & Requirements, and Pre-Flight & Ignition before igniting the build.`
            : String(record.error || "The studio could not be opened."),
        round: ctx.round,
        inReplyToTurnId: ctx.replyTarget,
        topic: ctx.topic,
        intent: ctx.intent || "direct_action",
        resolvedModelId: null,
        toolsUsed: [record],
        artifacts: artifact ? [artifact] : [],
        latencyMs: record.ms,
    }).returning();

    ctx.roundTurns.push(turn);
    ctx.replyTarget = turn.id;
    void crewStreamService.publish({
        type: "turn-content",
        organizationId: ctx.orgId,
        sessionKey: ctx.sessionKey,
        payload: { turn, round: ctx.round },
    });
    return true;
}

export async function runDirectAppStudioMount(ctx: RoundContext, card?: AgentCardRecord): Promise<boolean> {
    if (!card) return false;
    const availableTools = ctx.prefetch.toolsMap.get(card.id) ?? [];
    if (!availableTools.some((tool) => tool.definition.name === "mount_app_studio")) return false;

    // The app this room is already working on, read from the last studio
    // mount rather than from a lookup. This is what makes "fix this app"
    // resolve without asking the author which app they mean.
    const activeApp = mountedStudioApp(ctx);

    let knownApps: { appId?: number; slug?: string; name?: string }[] = [];
    try {
        const { appRegistryService } = await import("@domain/apps/app-registry.service.js");
        const rows = await appRegistryService.listOrgDeployments(ctx.orgId);
        knownApps = rows.map((r: any) => ({ appId: r.app?.id, slug: r.app?.slug, name: r.app?.name }));
    } catch {
        // A name stated outright stops being resolvable, which costs this
        // round a mount. Failing the whole turn would cost the conversation.
    }

    const resolution = forgeIntentResolver.resolve(ctx.message, { activeApp, knownApps });
    // A draft has no appId yet, but still owns app requirement follow-ups.
    // Otherwise "the app should ..." falls back to an unrelated builder pod.
    const hasDraft = !activeApp && hasPendingForgeDraft(ctx.priorTurns);
    if (hasDraft && isDraftRefinement(ctx.message)) {
        return proposeForgeRun(ctx, card, { inferredTitle: null });
    }
    // Below this the message is app-shaped but not app-decisive. The room
    // answers it, and can still mount the studio on a later turn.
    if (!resolution.intent || !resolution.mode || resolution.confidence < 0.7) return false;

    /*
     * A create request proposes a build; it does not start one, and it no
     * longer mounts an empty studio that silently attaches to whatever run
     * the org happens to have going. Forging provisions a container and
     * takes minutes, so the asymmetry with mounting — which is free — is
     * what the confirmation card exists to hold.
     */
    if (CREATE_INTENTS.has(resolution.intent)) {
        return proposeForgeRun(ctx, card, resolution);
    }

    const { record, artifact } = await crewToolsService.execute(
        "mount_app_studio",
        {
            mode: resolution.mode,
            view: resolution.view,
            ...(resolution.appHint?.appId ? { appId: resolution.appHint.appId } : {}),
            ...(resolution.appHint?.name ? { appName: resolution.appHint.name } : {}),
            ...(resolution.inferredTitle ? { title: resolution.inferredTitle } : {}),
            ...(resolution.mode === "forge" ? { requirements: ctx.message } : {}),
        },
        availableTools,
        buildCrewToolContext({
            orgId: ctx.orgId,
            userId: ctx.userId,
            projectId: ctx.projectId,
            projectKey: ctx.projectKey,
            sessionKey: ctx.sessionKey,
            sessionId: ctx.session.id,
            message: ctx.message,
        }),
    );
    ctx.cost.toolCalls++;
    if (!record.ok || !artifact) return false;

    /*
     * Say which mode mounted and why. A studio that appears with no
     * explanation reads as the room having ignored the request — and when
     * the resolver declined to re-forge an existing app, the author needs to
     * know that continuing was a decision they can reverse.
     */
    const content =
        resolution.mode === "builder"
            ? `App Builder is open on ${resolution.appHint?.name ?? "your app"}. ${resolution.rationale} Tell me what to change and I will apply it here.`
            : `App Forge is ready. ${resolution.rationale} I will stream the build into this studio as it assembles.`;

    const [turn] = await db.insert(crewTurns).values({
        sessionId: ctx.session.id,
        organizationId: ctx.orgId,
        speakerType: "agent",
        agentCardId: card.id,
        speakerName: card.name,
        content,
        round: ctx.round,
        inReplyToTurnId: ctx.replyTarget,
        topic: ctx.topic,
        intent: ctx.intent || "direct_action",
        resolvedModelId: null,
        toolsUsed: [record],
        artifacts: [artifact],
        latencyMs: record.ms,
    }).returning();

    ctx.roundTurns.push(turn);
    ctx.replyTarget = turn.id;
    void crewStreamService.publish({
        type: "turn-content",
        organizationId: ctx.orgId,
        sessionKey: ctx.sessionKey,
        payload: { turn, round: ctx.round },
    });

    /*
     * The preview mounts now; the assessment follows. Reading a workspace
     * and classifying it takes long enough to be worth deferring, and an
     * author waiting to see their app should not wait on a verdict about it.
     */
    if (resolution.mode === "builder" && resolution.appHint?.appId) {
        assessScaffoldInBackground(ctx, card, resolution.appHint.appId);
    }

    return true;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * First slug segments that say nothing about which app is meant — "open the
 * portal" must not mount whichever deployment happens to slug "portal-*".
 */
const OPEN_MATCH_STOPWORDS = new Set([
    "app", "apps", "application", "studio", "portal", "tool", "tools",
    "console", "dashboard", "workspace", "workbench", "the", "new",
]);

/**
 * Whether an installed-app target is literally named in the message.
 *
 * Three tries: the full title ("Wayfare Field Ops"), the full slug or public
 * slug ("wayfare-field-ops"), then the slug's first segment when it is
 * distinctive enough to carry the name alone ("wayfare-"). The last is what
 * lets "open Wayfare" find a deployment titled "Wayfare Field Ops".
 */
export function appTargetNamedIn(
    text: string,
    target: { title?: string; slug?: string; publicSlug?: string | null },
): boolean {
    const lower = text.toLowerCase();
    for (const name of [target.title, target.slug, target.publicSlug]) {
        const n = String(name ?? "").toLowerCase().trim();
        if (n.length >= 3 && new RegExp(`\\b${escapeRegExp(n)}\\b`).test(lower)) return true;
    }
    const segment = String(target.publicSlug || target.slug || "").toLowerCase().split("-")[0];
    return segment.length >= 4 && !OPEN_MATCH_STOPWORDS.has(segment) &&
        new RegExp(`\\b${escapeRegExp(segment)}\\b`).test(lower);
}

/**
 * Open an installed app on the room's App Studio canvas, without a model call.
 *
 * render_app_surface already validates the target against the org catalog and
 * marks the artifact for the canvas — executing it here keeps one definition
 * of the payload instead of a second one that can drift. The check afterward
 * is the contract that matters: if the artifact is not marked, the client
 * would render an ungoverned transcript iframe, which is exactly what this
 * path exists to prevent — so it declines and the speaker loop can still
 * answer.
 */
export async function runDirectCycleAppMount(ctx: RoundContext, card?: AgentCardRecord): Promise<boolean> {
    if (!card) return false;
    if (!isAppOpenRequest(ctx.message)) return false;

    let targets: import("@domain/tools/v1/capabilities/app-forge-tools.js").OrgAppTarget[];
    try {
        const { listOrgAppTargets } = await import("@domain/tools/v1/capabilities/app-forge-tools.js");
        targets = await listOrgAppTargets(ctx.orgId, ctx.projectKey ?? undefined);
    } catch {
        // The catalog being unavailable must not cost the round an answer.
        return false;
    }

    // Only a real deployment mounts the canvas — platform surfaces
    // (/signal-intelligence, documentation) and agent deployments carry no
    // publicSlug and stay on the ordinary card path.
    const match = targets.find((t) => t.source === "app" && t.publicSlug && appTargetNamedIn(ctx.message, t));
    if (!match) return false;

    let allowed: ResolvedCrewTool[];
    try {
        const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
        const def = getAgentTools()["render_app_surface"];
        if (!def) return false;
        allowed = [{ definition: def, reason: "declared-agent-tool" }];
    } catch {
        return false;
    }

    const { record, artifact } = await crewToolsService.execute(
        "render_app_surface",
        {
            title: match.title,
            description: `Open ${match.title}`,
            source: "app",
            slug: match.slug,
            href: match.href,
            mode: "embed",
        },
        allowed,
        buildCrewToolContext({
            orgId: ctx.orgId,
            userId: ctx.userId,
            projectId: ctx.projectId,
            projectKey: ctx.projectKey,
            sessionKey: ctx.sessionKey,
            sessionId: ctx.session.id,
            message: ctx.message,
        }),
    );
    ctx.cost.toolCalls++;
    if (!record.ok) return false;

    if (!artifact || artifact.payload?.type !== "assistant_app" || artifact.payload?.studioSurface !== "cycle_canvas") return false;

    const [turn] = await db.insert(crewTurns).values({
        sessionId: ctx.session.id,
        organizationId: ctx.orgId,
        speakerType: "agent",
        agentCardId: card.id,
        speakerName: card.name,
        content: `${match.title} is open in App Studio — the canvas beside the chat is hosting it.`,
        round: ctx.round,
        inReplyToTurnId: ctx.replyTarget,
        topic: ctx.topic,
        intent: ctx.intent || "direct_action",
        resolvedModelId: null,
        toolsUsed: [record],
        artifacts: [artifact],
        latencyMs: record.ms,
    }).returning();

    ctx.roundTurns.push(turn);
    ctx.replyTarget = turn.id;
    void crewStreamService.publish({
        type: "turn-content",
        organizationId: ctx.orgId,
        sessionKey: ctx.sessionKey,
        payload: { turn, round: ctx.round },
    });
    return true;
}

/**
 * Classify an app's scaffold and report it, after its studio is already up.
 *
 * What the verdict is FOR: a legacy scaffold can be migrated onto the
 * gallery, a custom one must not be, and an unhealthy one needs fixing
 * before either. Saying so before the author asks for a change is the
 * difference between an informed request and a surprise.
 */
export function assessScaffoldInBackground(ctx: RoundContext, card: AgentCardRecord, appId: number): void {
    const { orgId, sessionKey, round, topic, intent } = ctx;
    const sessionId = ctx.session.id;
    const replyTo = ctx.replyTarget;
    const toolContext = buildCrewToolContext({
        orgId,
        userId: ctx.userId,
        projectId: ctx.projectId,
        projectKey: ctx.projectKey,
        sessionKey,
        sessionId,
        message: ctx.message,
    });

    setImmediate(async () => {
        try {
            const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
            const def = getAgentTools()["inspect_app_scaffold"];
            if (!def) return;

            const { record, output } = await crewToolsService.execute(
                "inspect_app_scaffold",
                { appId },
                [{ definition: def, reason: "declared-read-safe" }],
                toolContext,
            );
            if (!record.ok) return;

            let verdict: any;
            try {
                verdict = JSON.parse(output);
            } catch {
                return; // A refusal comes back as prose; there is nothing to report.
            }
            if (!verdict?.classification) return;

            // A clean scaffold needs no announcement. Saying "this is fine"
            // after every mount is noise the author did not ask for.
            if (verdict.classification === "gallery-native") return;

            const lines: string[] = [];
            if (verdict.classification === "unhealthy") {
                lines.push(`Heads up — this app looks unhealthy. ${verdict.reasons.join(" ")}`);
            } else if (verdict.classification === "custom") {
                lines.push(
                    `This app has bespoke UI, so I'll leave it alone rather than migrate it. ` +
                    `${verdict.preserveFiles.length} file(s) are held back; tell me explicitly if you want them changed.`,
                );
            } else {
                lines.push(
                    `This scaffold is ${verdict.classification}: ${verdict.reasons.join(" ")} ` +
                    `${verdict.migratableFiles.length} file(s) could move onto the gallery — say "restyle this app" and I'll do it.`,
                );
            }

            const [turn] = await db.insert(crewTurns).values({
                sessionId,
                organizationId: orgId,
                speakerType: "agent",
                agentCardId: card.id,
                speakerName: card.name,
                content: lines.join(" "),
                round,
                inReplyToTurnId: replyTo,
                topic,
                intent,
                toolsUsed: [record],
                artifacts: [],
                latencyMs: record.ms,
            }).returning();

            if (turn) {
                void crewStreamService.publish({
                    type: "turn-content",
                    organizationId: orgId,
                    sessionKey,
                    payload: { turn, round },
                });
            }
        } catch (err: any) {
            // An assessment is an extra, not the mount. Losing it costs a
            // message; failing loudly here would cost the studio.
            logger.warn(`[AppStudio] Scaffold assessment failed: ${err?.message ?? err}`);
        }
    });
}
