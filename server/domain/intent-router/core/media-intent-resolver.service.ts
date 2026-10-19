/**
 * Media Intent Resolver Service
 *
 * Resolves a film-shaped request into what the room should do about Media
 * Studio. It is the Media Studio counterpart to forge-intent-resolver.service.ts
 * and scribe-intent-resolver.service.ts, and it exists because the previous
 * decision was a single regex that required the message to BEGIN with a change
 * verb and to arrive with something clicked in the studio. Everything else — a
 * premise, a question about the look, "the second shot drags" — reached a crew
 * that had no idea a production was open.
 *
 * Three rules do most of the work, and all three come from how a film is
 * actually made rather than from the vocabulary:
 *
 * 1. A production in play changes what a message means. "Make it colder" with a
 *    storyboard on screen is a change to that storyboard; the same words with
 *    nothing open are conversation. So `productionInPlay` widens what is
 *    considered — never what is acted on.
 *
 * 2. Story before pictures. A production with no scenes cannot be changed, shot
 *    or cut, so a request against an empty production resolves to drafting its
 *    story whatever verb it used. This is the single most common failure the
 *    resolver exists to stop: a room that mounts an empty studio and then talks
 *    about something else forever.
 *
 * 3. Spending is the author's decision. Rendering keyframes, shooting takes and
 *    cutting a reel resolve to their own intents so the room can answer them,
 *    but they resolve to OPENING the studio where the control and its price sit.
 *    Nothing here ever reaches a provider.
 */

import type { MountedMediaProduction } from "@shared/media-studio-crew.js";
import { isMediaStudioSelection, parseFilmIntake, parseMediaChangeApproval, parseMediaStoryApproval, parseStyleBibleApproval, type FilmIntake } from "@shared/media-studio-crew.js";
import type { MediaStudioSelection } from "@shared/media-studio.js";
import { splitStudioScope } from "@shared/studio-scope.js";

export type MediaIntentKind =
    | "open_studio"
    | "start_film"
    | "draft_story"
    | "change_scene"
    | "style_bible"
    | "render_keyframes"
    | "shoot_takes"
    | "assemble_reel"
    | "review_dailies"
    | "review_production";

export interface MediaIntentResolution {
    /** null = this is not a Media Studio request; the caller must not act. */
    intent: MediaIntentKind | null;
    /** Confidence that this is a request of that kind (0-1). */
    confidence: number;
    /** A title inferred for a NEW production. Null once one exists. */
    inferredTitle: string | null;
    /** Why this resolution was reached, so the room can explain itself. */
    rationale: string;
}

interface IntentRule {
    intent: MediaIntentKind;
    keywords: string[];
    /**
     * Shapes a keyword list cannot express.
     *
     * Real change requests rarely contain the word "change": people write "her
     * coat should be red" or "the second shot drags". A keyword list either
     * misses those or, grown to include "should" and "drags", swallows ordinary
     * conversation. A verb or a judgement paired with a film noun is the
     * distinction that actually separates the two.
     */
    patterns?: RegExp[];
    weight: number;
    /** Rules that only make sense against a production that already exists. */
    requiresProduction?: boolean;
}

/**
 * The nouns that make a verb a film verb. Shared by several rules' patterns.
 *
 * The second group is wardrobe and appearance. They look out of place in a list
 * of film vocabulary until you read what people actually write about a
 * storyboard: "her coat should be red", "his hair is wrong in shot 3". Those are
 * notes on the film, and every rule using this list also requires a production
 * to be open, so the words cannot reach an ordinary conversation.
 */
const FILM_NOUN = String.raw`(?:scene|shot|take|beat|plot\s*point|storyboard|keyframe|frame|reel|cut|sequence|dialogue|line|character|location|camera|framing|lens|angle|mood|tone|look|style|lighting|palette|act|opening|ending|climax|montage|film|movie|video|production|trailer|advert|advertisement|commercial|spot|clip`
    + String.raw`|wardrobe|costume|coat|jacket|dress|shirt|uniform|hair|face|eyes|hands|voice|accent)`;

/*
 * Ordered strongest-signal-first for readability; scoring picks the winner. The
 * approval-shaped and production-scoped rules carry the higher weights because
 * their phrasings are far more specific than "make a video", which appears in
 * half of all film conversations including the change ones.
 */
const INTENT_RULES: IntentRule[] = [
    {
        /*
         * Weighted top. The Style Bible is a real Media Studio feature — the
         * look, period, wardrobe, negative prompt and character anchors added to
         * every render — and a room that does not recognise the request builds a
         * document about it instead, which is exactly what happened before this
         * rule existed.
         */
        intent: "style_bible",
        keywords: [
            "style bible", "style guide", "look book", "lookbook", "mood board", "moodboard", "visual identity",
            "art direction", "colour palette", "color palette", "continuity anchor", "character anchor",
            "wardrobe", "costume", "period accuracy", "visual style", "house style", "negative prompt",
        ],
        patterns: [
            /\b(?:keep|hold|lock|pin|stay)\b[\s\S]{0,40}\b(?:consistent|the same|on model|continuity)\b/i,
            /\b(?:look|style|palette|lighting|grade|tone)\b[\s\S]{0,30}\b(?:for (?:the|this|every)|across (?:the|all|every))\b/i,
        ],
        weight: 1.0,
    },
    {
        intent: "assemble_reel",
        keywords: ["assemble", "cut the scene", "cut it together", "stitch", "reel", "rough cut", "final cut", "edit together", "put it together"],
        weight: 0.95,
        requiresProduction: true,
    },
    {
        intent: "review_dailies",
        keywords: ["dailies", "review the takes", "approve the takes", "which takes", "watch the takes", "take review", "reshoot"],
        weight: 0.95,
        requiresProduction: true,
    },
    {
        intent: "shoot_takes",
        keywords: ["shoot", "shoot it", "render the video", "render the shots", "generate the video", "seedance", "take a take", "roll camera", "animate"],
        patterns: [/\b(?:render|generate|make|produce)\b[\s\S]{0,24}\b(?:takes?|clips?|videos?|footage)\b/i],
        weight: 0.9,
        requiresProduction: true,
    },
    {
        intent: "render_keyframes",
        keywords: ["keyframe", "key frame", "storyboard it", "render the storyboard", "draw the", "visualise", "visualize", "concept art"],
        patterns: [/\b(?:render|generate|make|draw|produce)\b[\s\S]{0,24}\b(?:keyframes?|stills?|images?|frames?|boards?)\b/i],
        weight: 0.9,
        requiresProduction: true,
    },
    {
        /*
         * The rule that stops a room drifting. A production with no scenes has
         * nothing to change, render or cut, so anything substantive said about
         * it is a request for its story — see the empty-production override
         * below, which is what turns any of them into one.
         */
        intent: "draft_story",
        keywords: [
            "write the story", "draft the story", "write a story", "story for", "plot it out", "outline the",
            "screenplay", "script it", "write the script", "treatment", "synopsis", "storyline", "narrative",
            "scene breakdown", "break it into scenes", "beat sheet",
        ],
        patterns: [
            /*
             * An indefinite or plural story noun, never a numbered one. "add a
             * scene where she runs" is story work; "make scene 1 colder" is a
             * change to a scene that already exists, and a pattern matching bare
             * "scene" reads the second as the first — which, with this rule
             * weighted above change_scene, meant every numbered edit drafted a
             * new scene instead.
             */
            /\b(?:add|write|draft|create|make|give\s+me|sketch|outline|plot)\b[\s\S]{0,30}\b(?:scenes|an?\s+scene|another\s+scene|more\s+scenes|(?:the|a|its)\s+(?:story|plot|script|screenplay|treatment)|acts|beats)\b/i,
            /\bit(?:'s| is)\s+about\b/i,
            /\b(?:a|the)\s+(?:film|movie|video|advert|advertisement|commercial|trailer|spot)\s+about\b/i,
        ],
        weight: 0.9,
        requiresProduction: true,
    },
    {
        intent: "change_scene",
        keywords: [
            "rewrite", "reword", "tighten", "shorten", "lengthen", "trim", "reorder", "swap", "replace",
            "drop the", "cut the line", "delete the", "remove the",
        ],
        patterns: [
            // A verb aimed at a film noun. The workhorse: "make the mood colder",
            // "move the reveal earlier", "give Elena a line".
            new RegExp(String.raw`\b(?:add|insert|remove|delete|drop|cut|rename|retitle|change|update|edit|set|make|move|reorder|swap|replace|rewrite|reword|tighten|shorten|lengthen|extend|trim|split|merge|combine|give|put|turn|switch|use|have|end|start|slow|speed|darken|brighten|soften|harden)\b[\s\S]{0,40}\b${FILM_NOUN}\b`, "i"),
            // A judgement about a film noun. People report a problem far more
            // often than they issue an instruction: "the second shot drags",
            // "her coat should be red", "scene two feels flat".
            new RegExp(String.raw`\b${FILM_NOUN}\b[\s\S]{0,40}\b(?:should|needs?|has to|ought to|must|feels?|looks?|reads?|drags?|is too|are too|isn't|aren't|doesn't)\b`, "i"),
            new RegExp(String.raw`\b(?:should|needs? to|ought to)\b[\s\S]{0,30}\b${FILM_NOUN}\b`, "i"),
            /*
             * A bare deictic: "make it darker", "tighten it up". No film noun at
             * all, so the two patterns above cannot see it — and it is what
             * people write once the storyboard is on screen and the thing they
             * mean is the only thing in front of them.
             *
             * Anchored at the start and bounded at forty characters after the
             * deictic, which is the guard that keeps it honest: "make it darker
             * and more tense" is a note on the film, while "make it clear to the
             * team that we ship on Friday" runs past the bound and is left to the
             * room. A length bound rather than a list of excluded words, because
             * a deny-list here would only ever catch the spellings we thought of.
             */
            /^(?:(?:ok(?:ay)?|now|then|also|and|please|can you|could you|would you|let'?s)[,\s]+)*(?:make|keep|turn|tighten|shorten|lengthen|trim|slow|speed|darken|brighten|soften|warm|cool|punch|push|pull)\s+(?:it|this|that|them)\b[\s\S]{0,40}$/i,
            /^(?:it|this|that)\s+(?:should|needs? to|ought to|has to|must)\s+(?:be|feel|look|read|run|end|start|open|close)\b[\s\S]{0,40}$/i,
        ],
        weight: 0.85,
        requiresProduction: true,
    },
    {
        intent: "start_film",
        keywords: [
            "make a film", "make a movie", "make a video", "make an advert", "make an ad", "make a commercial",
            "shoot a film", "shoot a movie", "create a film", "create a video", "produce a video",
            "i want a video", "i want a film", "i want to make a video", "i want to make a film",
            "short film", "new production", "new film", "new movie", "start a film", "start a production",
        ],
        patterns: [
            /\b(?:make|create|produce|shoot|build|start|film)\b[\s\S]{0,24}\b(?:films?|movies?|videos?|adverts?|advertisements?|commercials?|trailers?|animations?|clips?|productions?)\b/i,
        ],
        weight: 0.85,
    },
    {
        intent: "open_studio",
        /*
         * Named surfaces only — never a bare "studio". The room runs this
         * resolver before App Studio's and Form Studio's, so a rule matching
         * "open the studio" on its own would answer "open App Studio" by
         * mounting a storyboard. Every target below belongs to Media Studio and
         * to nothing else on the platform.
         */
        keywords: ["media studio", "film studio", "video studio", "the storyboard", "shot list", "dailies"],
        patterns: [
            /\b(?:open|show|mount|bring\s+up|pull\s+up|go\s+(?:back\s+)?to|take\s+me\s+to|back\s+to|switch\s+to)\b[\s\S]{0,30}\b(?:storyboard|shot\s*list|dailies|the\s+production|the\s+film|the\s+scenes?)\b/i,
        ],
        weight: 0.8,
    },
];

/**
 * Messages that are asking, not instructing.
 *
 * Deliberately excludes "can", "could", "would" and "should", which the regex
 * this replaces treated as questions. In this domain they almost never open one:
 * "can we make a short film", "could you make the mood colder" and "would you
 * tighten the opening" are all requests, phrased politely. Reading them as
 * questions is why a room could be asked to make a film and do nothing at all.
 *
 * And a question no longer suppresses resolution outright. What it means depends
 * on the intent, which `questionPolicy` decides.
 */
const QUESTION = /^(?:what|why|how|which|who|when|where|does|do|is|are|was|were|explain|tell me|summari[sz]e|describe)\b/i;

/**
 * What a question does to each intent.
 *
 * "suppress" — the question is about the thing, not a request for it. "What can
 * Media Studio do?" is answered by the room, not by mounting a studio.
 *
 * "lower" — a real request, but not an instruction, so it lands below the
 * confidence a WRITE takes. "What does scene 2 need?" gets discussed; it does
 * not silently redraft the scene.
 *
 * "none" — the question IS the request. "What would a good style bible look
 * like?" and "How should this story go?" are asking to be shown one, and
 * answering them with prose about style bibles is exactly what the room did for
 * six rounds while the real Style Bible sat empty beside it.
 */
function questionPolicy(intent: MediaIntentKind): "suppress" | "lower" | "none" {
    if (intent === "open_studio") return "suppress";
    if (intent === "draft_story" || intent === "style_bible" || intent === "start_film") return "none";
    return "lower";
}

/**
 * An explicit instruction NOT to act. Unlike a question this does suppress:
 * "just review it, don't change anything" is unambiguous, and the cost of
 * ignoring it is an edit nobody asked for.
 */
const REVIEW_ONLY = /\b(?:only|just)\s+(?:review|discuss|suggest|explain|talk|think)\b|\b(?:do not|don't|dont|no need to)\s+(?:edit|change|apply|touch|save|write|render|shoot)\b/i;

/** Phrases that mean "start a new one" rather than "carry on with this one". */
const RESTART_PHRASES = ["start over", "start again", "from scratch", "scrap it", "throw it away", "a different film", "another film", "another video", "a new film", "a new video", "a new production"];

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Phrase hit test.
 *
 * Multi-word phrases match as substrings — a phrase carries its own boundaries.
 * Single words get \b anchors so "cut" does not fire inside "haircut" and
 * "shoot" does not fire inside "shooting range", which is the class of false
 * positive that would otherwise spend money.
 */
function hasPhrase(haystack: string, phrase: string): boolean {
    if (phrase.includes(" ")) return haystack.includes(phrase);
    return new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i").test(haystack);
}

function capitalizeFirst(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** Context the room already holds when the message arrives. */
export interface MediaIntentContext {
    /** The production a studio is mounted for in this room, if any. */
    production?: MountedMediaProduction | null;
    /** How many scenes that production holds. 0 means there is nothing to change yet. */
    sceneCount?: number;
}

export class MediaIntentResolverService {
    /**
     * Resolves a message into what it asks of Media Studio.
     *
     * Returns `intent: null` for anything that is not a film request. That is a
     * real answer, not a failure: the room must not mount a studio over an
     * ordinary conversation, and a low-confidence guess is worse than none.
     */
    resolve(message: string, context: MediaIntentContext = {}): MediaIntentResolution {
        const clean = (message ?? "").trim();
        const lower = clean.toLowerCase();
        const none = (rationale: string): MediaIntentResolution => ({ intent: null, confidence: 0, inferredTitle: null, rationale });

        if (!clean) return none("The message is empty.");

        const hasProduction = Boolean(context.production?.productionId);

        /*
         * An explicit "just review it, don't change anything" used to end here.
         * That was right about not writing and wrong about everything else: the
         * round fell through to a crew with no idea the production existed, so
         * asking for an opinion got a WORSE answer than asking for a change. It
         * is still never a write — it resolves to its own read-only intent.
         */
        if (REVIEW_ONLY.test(clean)) {
            return hasProduction
                ? { intent: "review_production", confidence: 0.9, inferredTitle: null, rationale: "The author asked to be told, not to have it changed." }
                : none("The author asked for discussion rather than a change.");
        }
        const sceneCount = context.sceneCount ?? 0;
        const restart = RESTART_PHRASES.some((p) => hasPhrase(lower, p));

        let best: IntentRule | null = null;
        let bestScore = 0;
        let bestMatch = "";

        for (const rule of INTENT_RULES) {
            // A rule about an existing production is not a request against one
            // that does not exist; it is usually a create request wearing change
            // vocabulary ("add a scene where she runs" with nothing open yet).
            // Skipping it lets start_film and draft_story win instead.
            if (rule.requiresProduction && !hasProduction) continue;

            let matches = 0;
            let longest = "";
            for (const keyword of rule.keywords) {
                if (!hasPhrase(lower, keyword)) continue;
                matches++;
                if (keyword.length > longest.length) longest = keyword;
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
            // "break it into scenes" says more than three hits on "make". Weight
            // scales the whole score rather than adding to it, so a rule's
            // ceiling stays proportional to how trustworthy its vocabulary is,
            // and the 0.8 floor keeps a clean single-phrase match above the 0.7
            // the caller treats as actionable.
            const specificity = Math.min(0.15, longest.length / 120);
            const score = Math.min(0.98, rule.weight * (0.8 + (matches - 1) * 0.05 + specificity));
            if (score > bestScore) {
                bestScore = score;
                best = rule;
                bestMatch = longest;
            }
        }

        if (!best) return none("No Media Studio intent found in the message.");

        let intent = best.intent;
        let rationale = `Matched "${bestMatch}".`;

        /*
         * Rule 2, applied. A production with no scenes cannot be changed, shot or
         * cut — and a room that answers "make it moodier" against an empty
         * storyboard by discussing mood is how seven rounds produce nothing. Any
         * substantive request against an empty production is a request for its
         * story.
         */
        if (hasProduction && sceneCount === 0 && intent !== "open_studio" && intent !== "style_bible" && intent !== "start_film") {
            intent = "draft_story";
            rationale = `Matched "${bestMatch}", and "${context.production?.productionTitle ?? "the production"}" has no scenes yet, so this drafts its story first.`;
        }

        /*
         * Rule 1, applied. A create-shaped request with a production already open
         * continues that production, because starting a second one leaves the
         * author's work behind on a surface they can still see. Only an explicit
         * restart overrides it.
         */
        if (intent === "start_film" && hasProduction && !restart) {
            intent = sceneCount === 0 ? "draft_story" : "change_scene";
            rationale =
                `Matched "${bestMatch}", but "${context.production?.productionTitle ?? "a production"}" is already open, ` +
                `so this continues it rather than starting another. Say "start over" or "a new film" to begin a second one.`;
        }

        const question = QUESTION.test(clean);
        const policy = question ? questionPolicy(intent) : "none";
        if (policy === "suppress") return none(`Matched "${bestMatch}", but as a question about Media Studio rather than a request to open it.`);
        const confidence = policy === "lower" ? Math.min(bestScore, 0.65) : bestScore;
        if (policy === "lower") rationale += " Asked as a question, so it is answered rather than acted on.";

        return {
            intent,
            confidence,
            inferredTitle: hasProduction && !restart ? null : this.inferTitle(clean),
            rationale,
        };
    }

    /**
     * A working title for a NEW production, or null when the message does not
     * carry one.
     *
     * Never invents one. "New Video Production" — what a model called the film in
     * the conversation that prompted all of this — is worse than no title: it
     * looks like a decision was made when nothing was learned, and the author
     * then has to rename it. With no title the caller asks for the brief instead.
     */
    private inferTitle(clean: string): string | null {
        const explicit = clean.match(/(?:called|named|titled)\s+["“']?([^"”'\n,.]{2,60})["”']?/i);
        if (explicit?.[1]) return capitalizeFirst(explicit[1].trim());

        const about = clean.match(
            /(?:film|movie|video|advert|advertisement|commercial|trailer|spot|animation|clip|short)\s+(?:about|on|for)\s+([A-Za-z0-9\s&'-]{3,60}?)(?:\s+(?:that|which|with|where|so|and|in which)\b|[,.\n]|$)/i,
        );
        // "a video about a rooftop chase" titles the production "Rooftop chase",
        // not "A rooftop chase": the article belongs to the sentence that
        // described it, not to the name it gets in the studio.
        if (about?.[1]) return capitalizeFirst(about[1].trim().replace(/^(?:an?|the)\s+/i, ""));

        return null;
    }
}

export const mediaIntentResolver = new MediaIntentResolverService();

/** What a message does to Media Studio in this room. */
export type MediaStudioAction =
    | { kind: "none" }
    /** Apply the change, story or bible a card of that id holds. */
    | { kind: "apply"; proposalId: string }
    | { kind: "apply_story"; proposalId: string }
    | { kind: "apply_bible"; proposalId: string }
    /** Draft a change to one scene. `selection` is what it is about, resolved or marked. */
    | { kind: "propose"; selection: MediaStudioSelection; instruction: string }
    /** Draft scenes for the open production from what the author described. */
    | { kind: "draft_story"; productionId: number; premise: string }
    /** Draft the look the production is shot in. */
    | { kind: "propose_bible"; productionId: number; instruction: string }
    /** Open the studio, optionally starting the film the brief describes. */
    | { kind: "open"; start?: FilmIntake; note?: MediaIntentKind }
    /** Ask for the film's brief: the author wants a film but has not said which. */
    | { kind: "brief" }
    /** Say what the production needs, and change nothing. */
    | { kind: "review"; productionId: number; question: string };

/** The confidence a decision that WRITES requires. Below it, the round is the room's. */
const ACTIONABLE = 0.7;

/**
 * Which scene a message is about, when the author did not mark one.
 *
 * Order is strongest evidence first: a scene named outright ("scene 2",
 * "SCENE-02"), then the scene the studio is open on, then the production's only
 * scene. Returns null when none applies, because drafting a change against the
 * wrong scene is the failure this ordering exists to prevent — and a room that
 * asks which scene is meant is better than one that rewrites the wrong one.
 */
export function resolveSceneTarget(
    message: string,
    production: MountedMediaProduction,
    scenes: Array<{ id: number; sceneKey: string; title: string }>,
): MediaStudioSelection | null {
    if (!scenes.length) return null;
    const lower = message.toLowerCase();

    const asSelection = (scene: { id: number; sceneKey: string; title: string }): MediaStudioSelection => ({
        productionId: production.productionId,
        sceneId: scene.id,
        sceneKey: scene.sceneKey,
        kind: "scene",
        id: scene.id,
        label: `${scene.sceneKey}: ${scene.title}`,
    });

    // "SCENE-02", "scene 2", "scene two", and the ordinals people actually type.
    const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
    const keyed = lower.match(/\bscene[\s-]*(\d{1,2})\b/);
    if (keyed) {
        const number = Number(keyed[1]);
        const byKey = scenes.find((s) => s.sceneKey.toLowerCase() === `scene-${String(number).padStart(2, "0")}`);
        if (byKey) return asSelection(byKey);
        if (number >= 1 && number <= scenes.length) return asSelection(scenes[number - 1]);
    }
    const ordinal = ORDINALS.findIndex((word) => new RegExp(`\\b${word}\\s+scene\\b`, "i").test(lower));
    if (ordinal >= 0 && ordinal < scenes.length) return asSelection(scenes[ordinal]);
    if (/\b(?:last|final|closing)\s+scene\b/i.test(lower)) return asSelection(scenes[scenes.length - 1]);
    if (/\b(?:opening|first)\s+scene\b/i.test(lower)) return asSelection(scenes[0]);

    // A scene named by its title, when the title is distinctive enough to mean it.
    const byTitle = scenes.find((s) => s.title.trim().length > 3 && lower.includes(s.title.trim().toLowerCase()));
    if (byTitle) return asSelection(byTitle);

    // The scene the studio is open on. This is what "make it colder" means: the
    // one in front of them.
    const open = production.sceneKey ? scenes.find((s) => s.sceneKey.toLowerCase() === production.sceneKey!.toLowerCase()) : undefined;
    if (open) return asSelection(open);

    // A production with one scene has no ambiguity to resolve.
    if (scenes.length === 1) return asSelection(scenes[0]);

    return null;
}

/**
 * What a message does to Media Studio in this room.
 *
 * Separated from the service that performs it because this decides whether a
 * storyboard gets rewritten, and that decision deserves to be readable and
 * testable on its own rather than only through a database.
 *
 * Order matters. The card approvals come first and are exact, because a surface
 * emitted them and nothing else should get to reinterpret them. Then a film
 * started from a brief. Then the resolver, whose result is only acted on above
 * ACTIONABLE — and a `propose` additionally needs a scene it is confident the
 * message is about, which `scenes` supplies and the caller looks up.
 *
 * `scenes` is empty when the caller has not looked them up. That is deliberate:
 * the caller pays for a production read only once the resolver says the message
 * is worth one.
 */
export function decideMediaStudioAction(
    message: string,
    turnsOrProduction: MountedMediaProduction | null,
    scenes: Array<{ id: number; sceneKey: string; title: string }> = [],
    resolver: MediaIntentResolverService = mediaIntentResolver,
): MediaStudioAction {
    const approval = parseMediaChangeApproval(message);
    if (approval) return { kind: "apply", proposalId: approval.proposalId };
    const story = parseMediaStoryApproval(message);
    if (story) return { kind: "apply_story", proposalId: story.proposalId };
    const bible = parseStyleBibleApproval(message);
    if (bible) return { kind: "apply_bible", proposalId: bible.proposalId };

    const start = parseFilmIntake(message);
    if (start) return { kind: "open", start };

    const production = turnsOrProduction;
    // Something marked in the studio travels as a prefix; the request is what
    // follows it. A marked message still carries its own selection, which is
    // better evidence than anything resolveSceneTarget can infer.
    const scope = splitStudioScope(message, ["Media Studio"]);
    const marked = scope.studio && isMediaStudioSelection(scope.selection) ? scope.selection : null;
    const text = scope.studio ? scope.text : message.trim();

    const resolution = resolver.resolve(text, { production, sceneCount: scenes.length });
    if (!resolution.intent) return { kind: "none" };

    // Opening a studio writes nothing, so it does not need a writer's
    // confidence. Everything below does.
    if (resolution.intent === "open_studio") return { kind: "open" };
    if (resolution.confidence < ACTIONABLE) return { kind: "none" };

    switch (resolution.intent) {
        case "start_film":
            // A title the author actually said starts the film; without one the
            // room asks for the brief rather than inventing "New Video
            // Production" and calling that a decision.
            return resolution.inferredTitle
                ? { kind: "open", start: { productionTitle: resolution.inferredTitle } }
                : { kind: "brief" };

        case "draft_story":
            return production ? { kind: "draft_story", productionId: production.productionId, premise: text } : { kind: "brief" };

        case "style_bible":
            return production ? { kind: "propose_bible", productionId: production.productionId, instruction: text } : { kind: "none" };

        case "review_production":
            return production ? { kind: "review", productionId: production.productionId, question: text } : { kind: "none" };

        case "change_scene": {
            if (!production) return { kind: "none" };
            const selection = marked ?? resolveSceneTarget(text, production, scenes);
            return selection ? { kind: "propose", selection, instruction: text } : { kind: "none" };
        }

        // Rule 3. These are real intents, and the room should say so — but what
        // they ask for costs money, so they resolve to opening the studio on the
        // control that does it rather than to doing it.
        case "render_keyframes":
        case "shoot_takes":
        case "assemble_reel":
        case "review_dailies":
            return { kind: "open", note: resolution.intent };

        default:
            return { kind: "none" };
    }
}
