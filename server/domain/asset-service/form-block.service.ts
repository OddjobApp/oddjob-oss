/**
 * Form Block Service — Redis-cached, composable input blocks for asset triage.
 *
 * Wraps `chatFormResolver` with a Redis cache so the deterministic input forms
 * (intent selection, per-asset-type diagnostics, restock, feedback, escalation)
 * can be assembled and returned WITHOUT an LLM round-trip.
 *
 * Why: a QR-scan support bot's structured turns (pick intent → answer diagnostic
 * questions) are deterministic. Resolving them server-side from cached blocks lets
 * the first turn render in milliseconds instead of running the full ~3-min agent
 * loop on a throttled model. The agent is only invoked for free-text follow-ups.
 *
 * The frontend (AgentInputForm) renders any field that has `options` as a dropdown
 * and everything else as a text input, so the chatFormResolver field types map
 * cleanly onto its InputField contract.
 */

import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";
import { chatFormResolver, type ChatForm, type ChatFormField } from "./chat-form-resolver.service.js";

const logger = createLogger("FormBlockService");

// Static block definitions (diagnostic forms per asset type) are immutable, so a
// long TTL is safe. Dynamic options (e.g. restock items from live inventory) are
// resolved at request time and NOT served from cache.
const BLOCK_TTL_SECONDS = 60 * 60 * 6; // 6h

/** Frontend-compatible field shape (matches AgentInputForm.InputField). */
export interface ResolvedField {
    name: string;
    label: string;
    type: "text" | "number" | "email";
    required: boolean;
    options?: string[];
    placeholder?: string;
}

/** Shape the public chat route returns as an `input_request` payload. */
export interface ResolvedForm {
    formId: string;
    pipelineName: string;
    title: string;
    description?: string;
    fields: ResolvedField[];
}

// Bare-intent phrases the user can send (or pick) that map to a deterministic form.
const INTENT_ALIASES: Record<string, string> = {
    "report a problem": "Report a problem",
    "report problem": "Report a problem",
    "request a restock": "Request a restock",
    "request restock": "Request a restock",
    "restock": "Request a restock",
    "give feedback": "Give feedback",
    "feedback": "Give feedback",
    "check service status": "Check service status",
    "service status": "Check service status",
    "status": "Check service status",
};

function mapField(f: ChatFormField): ResolvedField {
    // The frontend renders a dropdown whenever `options` is present, regardless of
    // declared type, so button_group/select collapse to an options field, while
    // text/textarea/photo become plain text inputs.
    return {
        name: f.name,
        label: f.label,
        type: "text",
        required: !!f.required,
        ...(f.options && f.options.length > 0 ? { options: f.options } : {}),
        ...(f.placeholder ? { placeholder: f.placeholder } : {}),
    };
}

function toResolvedForm(form: ChatForm): ResolvedForm {
    return {
        formId: form.id,
        pipelineName: form.title,
        title: form.title,
        description: form.description,
        fields: form.fields.map(mapField),
    };
}

/**
 * Build a ResolvedForm from a deployment `formManifest` entry (the blueprint-owned
 * definition), binding dynamic options against the live asset where applicable.
 */
function fromManifestEntry(entry: any, formId: string, asset: any): ResolvedForm | null {
    if (!entry || !Array.isArray(entry.fields)) return null;
    const inventoryItems: string[] =
        (asset?.inventory && Array.isArray(asset.inventory))
            ? asset.inventory.map((i: any) => i.item || i.name).filter(Boolean)
            : [];

    const fields: ResolvedField[] = entry.fields.map((f: any) => {
        // Late-bind options from live data when the blueprint declares a dynamic source.
        let options: string[] | undefined = Array.isArray(f.options) && f.options.length ? f.options.map(String) : undefined;
        if (!options && (f.options_from === "asset.inventory[].item" || f.name === "item") && inventoryItems.length) {
            options = inventoryItems;
        }
        return {
            name: f.name,
            label: f.label || f.name,
            type: "text",
            required: !!f.required,
            ...(options ? { options } : {}),
            ...(f.placeholder ? { placeholder: f.placeholder } : {}),
        };
    });

    // The frontend renders `pipelineName` as the card title, so prefer the friendly
    // human title (e.g. "Let me help diagnose the issue") over the internal manifest
    // pipeline label (e.g. "Diagnostic (coffee_vending)").
    const displayTitle = entry.title || entry.pipelineName || formId;
    return {
        formId,
        pipelineName: displayTitle,
        title: displayTitle,
        description: entry.description,
        fields,
    };
}

/** Map an intent to the manifest/form key that defines its form. */
function formKeyForIntent(asset: any, intent: string): string | null {
    switch (intent) {
        case "Report a problem": return `diagnostic_${asset?.type || "other"}`;
        case "Request a restock": return "restock_request";
        case "Give feedback": return "feedback";
        case "Check service status": return null; // no form — LLM generates the report
        default: return null;
    }
}

/** Hardcoded chatFormResolver fallback for an asset-triage form key, used when the
 *  deployment's blueprint manifest has no entry (or no manifest at all) for that key. */
function fallbackForKey(key: string, asset: any): ChatForm | null {
    if (key === "intent_selection") return chatFormResolver.getIntentForm(asset);
    if (key === "restock_request") return chatFormResolver.getRestockForm(asset);
    if (key === "feedback") return chatFormResolver.getFeedbackForm(asset);
    if (key === "escalation_contact") return chatFormResolver.getEscalationForm(asset);
    if (key.startsWith("diagnostic_")) return chatFormResolver.getDiagnosticForm(key.slice("diagnostic_".length));
    return null;
}

export const formBlockService = {
    /**
     * Normalize a free-text message to a known intent, or null if it isn't a bare intent.
     */
    matchIntent(message: string): string | null {
        const norm = (message || "").trim().toLowerCase().replace(/[.!?]+$/, "");
        if (!norm) return null;
        if (INTENT_ALIASES[norm]) return INTENT_ALIASES[norm];
        // Tolerate the leading-number menu format ("1. Report a problem" / "1")
        const stripped = norm.replace(/^\s*\d+[).\s-]*/, "").trim();
        return INTENT_ALIASES[stripped] || null;
    },

    /**
     * The intent-selection form for an asset.
     *
     * Source-of-truth order: the deployment's blueprint-owned `formManifest`
     * (entry "intent_selection"), then the hardcoded chatFormResolver fallback.
     * The asset-specific title/description and dynamic options are bound at runtime.
     */
    async getIntentForm(orgId: number, asset: any, manifest?: Record<string, any> | null): Promise<ResolvedForm> {
        let resolved: ResolvedForm | null = manifest?.intent_selection
            ? fromManifestEntry(manifest.intent_selection, "intent_selection", asset)
            : null;

        if (!resolved) {
            const hasInventory = !!(asset?.inventory && Array.isArray(asset.inventory) && asset.inventory.length > 0);
            const cacheKey = `formblock:${orgId}:intent:${asset?.type || "other"}:${hasInventory ? "inv" : "noinv"}`;
            try {
                const cached = await redis.get(cacheKey);
                if (cached) resolved = JSON.parse(cached) as ResolvedForm;
            } catch { /* cache miss is non-fatal */ }
            if (!resolved) {
                resolved = toResolvedForm(chatFormResolver.getIntentForm(asset));
                try { await redis.set(cacheKey, JSON.stringify(resolved), "EX", BLOCK_TTL_SECONDS); } catch { /* non-fatal */ }
            }
        }

        // Asset-specific framing is always bound fresh.
        resolved.title = `Hi! I'm ServiceBot. How can I help with ${asset?.name || "this asset"}?`;
        resolved.description = asset ? `📍 ${asset.building || ""} · ${asset.floor || ""} · ${asset.room || ""}` : resolved.description;
        resolved.pipelineName = resolved.title;
        return resolved;
    },

    /**
     * Assemble the deterministic form for a given intent on a given asset.
     *
     * Prefers the deployment's blueprint-owned `formManifest` entry for the intent;
     * falls back to chatFormResolver. Returns null when the intent needs no form
     * (e.g. "Check service status").
     */
    async assembleForm(orgId: number, asset: any, intent: string, manifest?: Record<string, any> | null): Promise<ResolvedForm | null> {
        const key = formKeyForIntent(asset, intent);

        // 1. Blueprint-owned definition from the deployment manifest.
        if (key && manifest?.[key]) {
            const fromManifest = fromManifestEntry(manifest[key], key, asset);
            if (fromManifest && fromManifest.fields.length > 0) return fromManifest;
        }

        // 2. Hardcoded resolver fallback.
        const form = chatFormResolver.resolveNextForm({ asset, intent });
        if (!form) return null;

        const isStaticDiagnostic = form.id.startsWith("diagnostic_");
        if (isStaticDiagnostic) {
            const cacheKey = `formblock:${orgId}:${form.id}`;
            try {
                const cached = await redis.get(cacheKey);
                if (cached) return JSON.parse(cached) as ResolvedForm;
            } catch { /* non-fatal */ }
            const resolved = toResolvedForm(form);
            try { await redis.set(cacheKey, JSON.stringify(resolved), "EX", BLOCK_TTL_SECONDS); } catch { /* non-fatal */ }
            return resolved;
        }

        return toResolvedForm(form);
    },

    /**
     * Resolve a form directly by its asset-triage key (e.g. "intent_selection",
     * "restock_request", "escalation_contact", "diagnostic_hvac"), as opposed to
     * by intent string. This is what `show_pipeline_input_form` needs: the LLM
     * calls it with these exact key names (per the asset-triage-agent prompt),
     * none of which exist as real rows in the `pipelines` table — they only
     * exist as keys in the deployment's blueprint-owned `formManifest`.
     *
     * Returns null if `key` isn't a recognized asset-triage form key.
     */
    resolveByKey(asset: any, key: string, manifest?: Record<string, any> | null): ResolvedForm | null {
        if (manifest?.[key]) {
            const fromManifest = fromManifestEntry(manifest[key], key, asset);
            if (fromManifest && fromManifest.fields.length > 0) return fromManifest;
        }
        const form = fallbackForKey(key, asset);
        return form ? toResolvedForm(form) : null;
    },

    /**
     * Invalidate all cached blocks for an org (call when forms/blueprints change).
     */
    async invalidate(orgId: number): Promise<void> {
        try {
            const keys = await redis.keys(`formblock:${orgId}:*`);
            if (keys.length) await redis.del(...keys);
            logger.info(`[FormBlock] Invalidated ${keys.length} cached blocks for org ${orgId}`);
        } catch (err: any) {
            logger.warn(`[FormBlock] Invalidate failed for org ${orgId}: ${err.message}`);
        }
    },
};
