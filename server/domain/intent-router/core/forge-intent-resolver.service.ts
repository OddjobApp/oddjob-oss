/**
 * Forge Intent Resolver Service
 *
 * Resolves an app-shaped request into the studio that should mount for it, the
 * view it should open on, and whatever the message already says about which app
 * is meant. It is the App Forge / App Builder counterpart to
 * scribe-intent-resolver.service.ts, and it exists for the same reason: the room
 * needs a decision it can act on in one turn, not a paragraph asking the author
 * which of their apps they meant.
 *
 * Two rules do most of the work here, and both come from the product principles
 * rather than from the keywords:
 *
 * 1. App Forge creates, App Builder evolves. So the mode is decided by whether
 *    an application is already in play, not by how the sentence is phrased.
 * 2. An existing scaffold is the fastest path. "Build me a dashboard" said while
 *    a scaffold is already open is a request to CONTINUE that scaffold, and
 *    resolves to Builder. Only an explicit rebuild ("start over", "from
 *    scratch") re-forges something that already exists — see `rebuildRequested`,
 *    which is the single switch that overrides rule 1.
 */

/** Which half of the studio should mount. */
export type ForgeStudioMode = "forge" | "builder";

/** The view the mounted studio should open on. */
export type ForgeStudioView = "preview" | "api" | "diagnostics" | "publish";

export type ForgeIntentKind =
    | "build_app"
    | "create_dashboard"
    | "create_api"
    | "modify_app"
    | "fix_app"
    | "continue_scaffold"
    | "restyle_app"
    | "add_surface"
    | "publish_app"
    | "revert_change";

/** What the message says about which app it means. Never a guess. */
export interface ForgeAppHint {
    appId?: number;
    slug?: string;
    name?: string;
    /** True when the message points at an app deictically ("this app") rather than naming one. */
    contextual: boolean;
}

export interface ForgeIntentResolution {
    /** null = this is not an app request; the caller should not mount a studio. */
    intent: ForgeIntentKind | null;
    mode: ForgeStudioMode | null;
    view: ForgeStudioView;
    /** Confidence that this is an app request of that kind (0-1). */
    confidence: number;
    appHint: ForgeAppHint | null;
    /** Author explicitly asked to regenerate an existing app rather than evolve it. */
    rebuildRequested: boolean;
    /** Restyle onto the Oddjob Component Gallery, rather than an arbitrary change. */
    galleryMigration: boolean;
    /** Title inferred for a NEW app. Null in builder mode — the app already has one. */
    inferredTitle: string | null;
    /** Why this resolution was reached, for the room to explain itself. */
    rationale: string;
}

interface IntentRule {
    intent: ForgeIntentKind;
    mode: ForgeStudioMode;
    view: ForgeStudioView;
    keywords: string[];
    /**
     * Shapes a keyword list cannot express.
     *
     * Real change requests rarely contain the word "change": people write "make
     * the header sticky" or "move the total to the top". A keyword list either
     * misses those or, if it grows to include "make" and "move", starts
     * swallowing ordinary conversation. A verb paired with a UI noun is the
     * distinction that actually separates the two.
     */
    patterns?: RegExp[];
    weight: number;
    /** Rules that only make sense against an app that already exists. */
    requiresExistingApp?: boolean;
}

/*
 * Ordered strongest-signal-first for readability; scoring picks the winner.
 * The builder rules carry the higher weights because their phrasings are far
 * more specific than the create rules — "publish this" means one thing, while
 * "build" appears in half of all app conversations including the modify ones.
 */
const INTENT_RULES: IntentRule[] = [
    {
        /*
         * Weighted above every other builder rule. "Undo that change" also
         * contains "change", and resolving it as modify_app would apply a second
         * change in response to a request to remove the first.
         */
        intent: "revert_change",
        mode: "builder",
        view: "preview",
        keywords: ["undo", "revert", "roll back", "rolled back", "put it back", "take that back", "back it out"],
        weight: 1.0,
        requiresExistingApp: true,
    },
    {
        intent: "publish_app",
        mode: "builder",
        view: "publish",
        keywords: ["publish", "deploy", "go live", "ship it", "release it", "make it public", "put it live", "launch it"],
        weight: 1.0,
        requiresExistingApp: true,
    },
    {
        intent: "fix_app",
        mode: "builder",
        view: "diagnostics",
        keywords: ["fix", "broken", "not working", "debug", "failing", "crash", "crashing", "blank page", "diagnose", "throwing an error"],
        weight: 0.95,
        requiresExistingApp: true,
    },
    {
        intent: "restyle_app",
        mode: "builder",
        view: "preview",
        keywords: ["restyle", "re-style", "redesign", "re-skin", "reskin", "use the gallery", "component gallery", "design tokens", "match the design system", "on brand", "style it"],
        weight: 0.9,
        requiresExistingApp: true,
    },
    {
        intent: "add_surface",
        mode: "builder",
        view: "preview",
        keywords: ["add a page", "add a screen", "add an api", "add an endpoint", "add a component", "add a tab", "add a field", "add a button", "new page", "new endpoint", "another page"],
        weight: 0.9,
        requiresExistingApp: true,
    },
    {
        intent: "continue_scaffold",
        mode: "builder",
        view: "preview",
        keywords: ["continue", "carry on", "pick up where", "keep going", "finish the", "resume", "instant app"],
        weight: 0.85,
        requiresExistingApp: true,
    },
    {
        intent: "modify_app",
        mode: "builder",
        view: "preview",
        keywords: ["modify", "change", "update", "edit", "tweak", "adjust", "rename", "remove", "replace", "improve", "enhance"],
        patterns: [
            /\b(?:i want|i'd like|we need|users? should|let users?|allow users? to)\b[\s\S]{0,80}\b(?:filter|search|sort|export|save|validate|upload|download)\b/i,
            /\b(?:add|remove|change|update|enable|disable|improve|fix)\b[\s\S]{0,60}\b(?:filters?|search|sorting|pagination|exports?|validation|saved searches|data sources?)\b/i,
            /\b(?:make|set|move|resize|hide|show|swap|reorder|align|centre|center|colou?r|style|shrink|widen|sort|group|label|change|update|edit|rename|remove|replace|add|drop|fix)\b[\s\S]{0,60}\b(?:header|footer|button|table|form|page|card|column|row|nav|navigation|sidebar|title|label|field|chart|graph|modal|dialog|tab|list|menu|banner|layout|grid|filter|search|icon|logo|text|font)\b/i,
        ],
        weight: 0.8,
        requiresExistingApp: true,
    },
    {
        intent: "create_api",
        mode: "forge",
        view: "api",
        keywords: ["create an api", "build an api", "api service", "rest api", "backend service", "microservice", "api-only", "headless service", "endpoint service"],
        weight: 0.9,
    },
    {
        intent: "create_dashboard",
        mode: "forge",
        view: "preview",
        keywords: ["dashboard", "control panel", "command center", "analytics view", "metrics view", "kpi view", "console", "monitoring view"],
        weight: 0.85,
    },
    {
        intent: "build_app",
        mode: "forge",
        view: "preview",
        patterns: [/\b(?:build|create|develop|make|forge)\s+(?:me\s+)?(?:(?:a|an|the|my|our)\s+)?(?:[\w-]+\s+){0,7}(?:app|application|tool|portal)\b/i],
        keywords: [
            "build an app", "build me an app", "create an app", "make an app", "new app",
            "build a tool", "create a tool", "build a portal", "create a portal",
            "spin up an app", "forge an app", "application for",
            // The rebuild vocabulary belongs to the create rule, not the modify
            // one: "rebuild this app" has to be able to WIN a rule before the
            // rebuild override below can send it back to Forge. Listed here, a
            // rebuild against an existing app matches build_app and the override
            // simply declines to downgrade it.
            "rebuild", "re-build", "regenerate", "recreate", "re-create", "start over", "from scratch",
        ],
        weight: 0.8,
    },
];

/**
 * Phrases that mean "throw the current one away". These are the ONLY way an
 * existing app gets re-forged: principle 3 says an existing scaffold is the
 * fastest path, so ambiguity has to resolve toward evolving it.
 */
const REBUILD_PHRASES = [
    "rebuild",
    "re-build",
    "start over",
    "start again",
    "from scratch",
    "scrap it",
    "throw it away",
    "regenerate",
    "re-generate",
    "recreate",
    "re-create",
];

/**
 * Deictic reference to whatever app is already in context.
 *
 * A pattern rather than a phrase list, because a list of exact phrases misses
 * every qualifier an author actually types — "the instant app", "this new
 * dashboard", "my little admin tool" all mean the app on screen, and a fixed
 * list of "the app" / "this app" matches none of them.
 */
const CONTEXTUAL_APP_PATTERN =
    /\b(?:this|that|the|my|our)\s+(?:[a-z][a-z-]*\s+){0,2}(?:app|application|dashboard|tool|portal|api|service|build|change)\b/i;

/**
 * Bare deictics carry no noun, so on their own they could refer to anything the
 * room was just discussing — a pipeline, a dataset, a document. They count as an
 * app reference only alongside a verb that is unambiguously aimed at an app,
 * which is what makes "ship it" resolvable without making "explain it" resolve
 * to whatever app happens to be open.
 */
const BARE_CONTEXTUAL_PHRASES = ["this one", "it", "that"];
const APP_DIRECTED_VERBS = [
    "publish", "deploy", "ship", "go live", "launch", "fix", "rebuild", "restyle", "redesign", "preview",
    // Undo phrasings. "put it back" carries its deictic inside the phrase, so it
    // has to be listed whole — the bare-deictic check finds the "it" but would
    // otherwise find no verb beside it.
    "undo", "revert", "roll back", "put it back", "take that back", "back it out",
];

const GALLERY_PHRASES = [
    "gallery",
    "component gallery",
    "design system",
    "design tokens",
    "oddjob components",
    "platform blocks",
    "on brand",
    "match the platform",
    "consistent styling",
];

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Phrase hit test.
 *
 * Multi-word phrases are matched as substrings — a phrase already carries its
 * own boundaries. Single words get \b anchors so "fix" does not fire inside
 * "prefix" and "change" does not fire inside "exchange", which is exactly the
 * class of false positive that would mount a diagnostic studio over a normal
 * request.
 */
function hasPhrase(haystack: string, phrase: string): boolean {
    if (phrase.includes(" ")) return haystack.includes(phrase);
    return new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i").test(haystack);
}

function capitalizeWords(value: string): string {
    return value
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

/** Context the room already holds when the message arrives. */
export interface ForgeIntentContext {
    /** An app the session is already working on, if any. */
    activeApp?: { appId?: number; slug?: string; name?: string } | null;
    /** Apps in the org, used only to match a name the message states outright. */
    knownApps?: { appId?: number; slug?: string; name?: string }[];
    /**
     * An app is demonstrably on screen — a studio is mounted for it right now.
     *
     * Without this, a builder rule needs the MESSAGE to point at an app, and
     * nobody says "this app" once the app is in front of them: they say "make
     * the header sticky". That requirement is right when deciding whether to
     * mount a studio out of nowhere, and wrong once one is already open, so it
     * is a caller's declaration rather than a default.
     *
     * It only affects which rules are eligible. It never invents an appHint —
     * which app a message NAMES is still read from the message alone.
     */
    appInPlay?: boolean;
}

export class ForgeIntentResolverService {
    /**
     * Resolves a natural language message into the studio decision.
     *
     * Returns `intent: null` for anything that is not an app request. That is a
     * real answer, not a failure: the caller must not mount a studio over an
     * ordinary conversation, and a low-confidence guess is worse than none.
     */
    resolve(message: string, context: ForgeIntentContext = {}): ForgeIntentResolution {
        const clean = (message ?? "").trim();
        const lower = clean.toLowerCase();

        const appHint = this.resolveAppHint(clean, lower, context);
        const hasApp = Boolean(appHint) || context.appInPlay === true;
        const rebuildRequested = REBUILD_PHRASES.some((p) => hasPhrase(lower, p));

        let best: IntentRule | null = null;
        let bestScore = 0;
        let bestMatch = "";

        for (const rule of INTENT_RULES) {
            // A builder-only rule with no app in play is not a builder request;
            // it is usually a create request wearing modify vocabulary ("add a
            // page that shows orders" with nothing open yet). Skipping it lets
            // the create rules win rather than mounting Builder against nothing.
            if (rule.requiresExistingApp && !hasApp) continue;

            let matches = 0;
            let longest = "";
            for (const kw of rule.keywords) {
                if (!hasPhrase(lower, kw)) continue;
                matches++;
                if (kw.length > longest.length) longest = kw;
            }
            for (const pattern of rule.patterns ?? []) {
                const hit = clean.match(pattern);
                if (!hit) continue;
                matches++;
                // The matched span is the evidence, so it sets specificity the
                // same way a long keyword would.
                if (hit[0].length > longest.length) longest = hit[0];
            }
            if (matches === 0) continue;

            // Longer phrases are stronger evidence than more of them: one hit on
            // "add an endpoint" says more than three hits on "add". Weight scales
            // the whole score rather than being added to it, so a rule's ceiling
            // stays proportional to how trustworthy its vocabulary is — but the
            // 0.8 floor keeps a clean single-phrase match above the 0.7 the
            // orchestrator treats as actionable, which a 0.7 base did not.
            const specificity = Math.min(0.15, longest.length / 120);
            const score = Math.min(0.98, rule.weight * (0.8 + (matches - 1) * 0.05 + specificity));
            if (score > bestScore) {
                bestScore = score;
                best = rule;
                bestMatch = longest;
            }
        }

        if (!best) {
            return {
                intent: null,
                mode: null,
                view: "preview",
                confidence: 0,
                appHint,
                rebuildRequested,
                galleryMigration: false,
                inferredTitle: null,
                rationale: "No app-building intent found in the message.",
            };
        }

        let intent = best.intent;
        let mode = best.mode;
        let view = best.view;
        let rationale = `Matched "${bestMatch}".`;

        /*
         * Principle 3, applied. A create-shaped request against an app already
         * in play is a continuation, because regenerating what the author can
         * already see is the single most expensive way to be wrong. The explicit
         * rebuild phrases are the only thing that sends it back to Forge, and
         * when they appear the resolution says so out loud.
         */
        if (mode === "forge" && hasApp && !rebuildRequested) {
            intent = "continue_scaffold";
            mode = "builder";
            view = "preview";
            rationale =
                `Matched "${bestMatch}", but ${appHint?.name ?? "an app"} is already in play, ` +
                `so this continues it in Builder rather than forging a new one. ` +
                `Say "rebuild" or "start from scratch" to forge a replacement.`;
        } else if (mode === "builder" && rebuildRequested) {
            intent = "build_app";
            mode = "forge";
            view = "preview";
            rationale = `Matched "${bestMatch}" with an explicit rebuild request, so this re-forges from scratch.`;
        }

        const galleryMigration =
            intent === "restyle_app" || (mode === "builder" && GALLERY_PHRASES.some((p) => hasPhrase(lower, p)));

        return {
            intent,
            mode,
            view,
            confidence: bestScore,
            appHint,
            rebuildRequested,
            galleryMigration,
            inferredTitle: mode === "forge" ? this.inferTitle(clean, intent) : null,
            rationale,
        };
    }

    /**
     * Which app the message means.
     *
     * Order is strongest evidence first: a name stated outright, then a session's
     * active app behind a deictic reference. Returns null when neither applies —
     * "the app I made yesterday" is not resolvable from the text and must reach
     * the caller as unresolved rather than as the active app by default, because
     * silently editing the wrong app is the failure this ordering exists to
     * prevent.
     */
    private resolveAppHint(clean: string, lower: string, context: ForgeIntentContext): ForgeAppHint | null {
        for (const app of context.knownApps ?? []) {
            const name = app.name?.trim();
            if (name && name.length > 2 && lower.includes(name.toLowerCase())) {
                return { ...app, contextual: false };
            }
            const slug = app.slug?.trim();
            if (slug && slug.length > 2 && lower.includes(slug.toLowerCase())) {
                return { ...app, contextual: false };
            }
        }

        const quoted = clean.match(/(?:app|application|tool|dashboard)\s+(?:called|named)\s+["']?([^"'\n,.]+)["']?/i);
        if (quoted?.[1]) {
            return { name: quoted[1].trim(), contextual: false };
        }

        if (context.activeApp) {
            if (CONTEXTUAL_APP_PATTERN.test(lower)) {
                return { ...context.activeApp, contextual: true };
            }
            const bare = BARE_CONTEXTUAL_PHRASES.some((p) => hasPhrase(lower, p));
            if (bare && APP_DIRECTED_VERBS.some((v) => hasPhrase(lower, v))) {
                return { ...context.activeApp, contextual: true };
            }
        }

        return null;
    }

    /** A working title for a NEW app, or null when the message does not carry one. */
    private inferTitle(clean: string, intent: ForgeIntentKind): string | null {
        const explicit = clean.match(/(?:called|named|titled)\s+["']?([^"'\n,.]+)["']?/i);
        if (explicit?.[1]) return explicit[1].trim();

        const forPhrase = clean.match(
            /(?:app|dashboard|tool|portal|api|service)\s+(?:for|to)\s+([A-Za-z0-9\s&'-]{3,50}?)(?:\s+(?:that|which|with|so|and)\b|[,.\n]|$)/i,
        );
        if (forPhrase?.[1] && !/^(?:me|us|myself|our team)\??$/i.test(forPhrase[1].trim())) {
            const subject = capitalizeWords(forPhrase[1].trim());
            if (intent === "create_dashboard") return `${subject} Dashboard`;
            if (intent === "create_api") return `${subject} API`;
            return subject;
        }

        const described = clean.match(/\b(?:build|create|develop|make)\s+(?:me\s+)?(?:a|an)\s+((?:[\w-]+\s+){1,7}(?:app|application|tool|portal))\b/i);
        return described ? capitalizeWords(described[1]) : null;
    }
}

export const forgeIntentResolver = new ForgeIntentResolverService();

/** What a message should do to a studio that is already open. */
export type StudioAction =
    /*
     * A gallery migration is its own action, not a change request phrased about
     * the gallery. The two take different routes on purpose: an ordinary change
     * goes through the model, while a migration goes through the deterministic
     * mapper — so a styling pass cannot quietly rewrite business logic, and it
     * is proposed as a diff before anything is written.
     */
    | { kind: "migrate"; appId: number }
    | {
          kind: "apply";
          appId: number;
          instruction: string;
          view: ForgeStudioView;
          /** Carried so the change can be measured against a baseline, not just requested. */
          galleryMigration: boolean;
      }
    | { kind: "revert"; appId: number }
    | { kind: "none" };

/** Intents that mean "rewrite this app", as opposed to "show me this app". */
const CHANGE_INTENTS = new Set<ForgeIntentKind>([
    "modify_app",
    "fix_app",
    "restyle_app",
    "add_surface",
]);

/**
 * Whether a message should change the app whose studio is open, and how.
 *
 * Separated from the orchestrator that performs it because this decides whether
 * code gets written to a workspace, and that decision deserves to be readable
 * and testable on its own rather than only through a database.
 *
 * Returns `none` for everything it is not sure about. Four things must hold
 * before it says otherwise:
 *
 *  1. A studio is already mounted for an app. A change is never the first thing
 *     that happens to an app — it has to be on screen first.
 *  2. The message reaches a change intent at usable confidence.
 *  3. The message is not naming a DIFFERENT app. That case belongs to a mount of
 *     the app named, not to an edit of the one that happens to be open.
 *  4. `continue_scaffold` and `publish_app` are not changes. Continuing is too
 *     vague to write code from, and publishing opens a review.
 */
export function decideStudioAction(
    message: string,
    mounted: { appId?: number; slug?: string; name?: string } | null,
    resolver: ForgeIntentResolverService = forgeIntentResolver,
): StudioAction {
    if (!mounted?.appId) return { kind: "none" };
    // Questions about possible changes are discussion, not edit instructions.
    if (/^(?:what|why|how)\b/i.test(message.trim()) || /\b(?:do not|don't)\s+(?:change|edit|build|add|remove)\b/i.test(message)) return { kind: "none" };

    // appInPlay, because the app is on screen. Once a studio is open nobody
    // writes "this app" any more — they write "make the header sticky" — and
    // requiring the reference here would mean the room only ever acted on the
    // phrasings people use before the studio exists.
    const resolution = resolver.resolve(message, { activeApp: mounted, appInPlay: true });
    if (!resolution.intent || resolution.confidence < 0.7) return { kind: "none" };

    // Condition 3. resolveAppHint prefers a name stated outright over the room's
    // active app, so a hint pointing elsewhere is the author naming another app.
    if (resolution.appHint?.appId && resolution.appHint.appId !== mounted.appId) {
        return { kind: "none" };
    }

    if (resolution.intent === "revert_change") {
        return { kind: "revert", appId: mounted.appId };
    }

    if (!CHANGE_INTENTS.has(resolution.intent)) return { kind: "none" };

    /*
     * "Restyle this app" routes to the migration pipeline rather than to the
     * model. It is the one change request whose intent is fully mechanical —
     * map these controls onto those components — so it takes the path that can
     * show a diff first and put every file back afterwards.
     *
     * This is what the galleryMigration flag was always for. It previously
     * appended an instruction telling a model to migrate, which is a request
     * rather than a guarantee: nothing checked that it did, and nothing stopped
     * it changing something else on the way past.
     */
    if (resolution.intent === "restyle_app" || resolution.galleryMigration) {
        return { kind: "migrate", appId: mounted.appId };
    }

    const instruction = message;

    return {
        kind: "apply",
        appId: mounted.appId,
        instruction,
        view: resolution.view,
        galleryMigration: resolution.galleryMigration,
    };
}
