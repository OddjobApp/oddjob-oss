/**
 * Chat Form Resolver for Asset Service Dispatch
 * 
 * Resolves dynamic form schemas based on:
 * - Asset type (coffee_vending, vehicle, hvac, printer, elevator)
 * - Conversation state (intent selected, problem reported, etc.)
 * - Asset record data (inventory items for restock dropdowns)
 * 
 * Forms are rendered INSTANTLY in the chat UI without LLM calls.
 * The LLM is only invoked after form data is collected.
 */

import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ChatFormResolver");

export interface ChatFormField {
    name: string;
    label: string;
    type: "select" | "button_group" | "text" | "textarea" | "photo";
    required: boolean;
    options?: string[];
    options_from?: string; // Dynamic: e.g., "asset.inventory[].item"
    placeholder?: string;
}

export interface ChatForm {
    id: string;
    title: string;
    description?: string;
    fields: ChatFormField[];
}

// ─── Type-specific diagnostic forms ─────────────────────────────────────────

const DIAGNOSTIC_FORMS: Record<string, ChatFormField[]> = {
    coffee_vending: [
        { name: "problem_type", label: "What's the issue?", type: "select", required: true,
          options: ["Not dispensing", "Wrong drink made", "Payment not accepted", "Leak or overflow", "Cup jam", "Machine won't turn on"] },
        { name: "powered_on", label: "Is it powered on?", type: "button_group", required: true,
          options: ["Yes — lights are on", "No — completely dark", "Partially (flickering)"] },
        { name: "error_code", label: "Error code on display? (optional)", type: "text", required: false, placeholder: "e.g., E04, ERR-WATER" },
    ],
    vehicle: [
        { name: "problem_type", label: "What's the issue?", type: "select", required: true,
          options: ["Won't start", "Warning light on", "Flat tire", "Body damage", "Fluid leak", "AC/Heat not working", "Strange noise"] },
        { name: "can_drive", label: "Is the vehicle driveable?", type: "button_group", required: true,
          options: ["Yes", "No — immobile", "Unsafe to drive"] },
        { name: "warning_light", label: "Which warning light? (optional)", type: "text", required: false, placeholder: "e.g., Check Engine, Oil Pressure" },
    ],
    hvac: [
        { name: "problem_type", label: "What's the issue?", type: "select", required: true,
          options: ["Not cooling", "Not heating", "Strange noise", "Water dripping", "Bad smell", "Thermostat unresponsive", "Cycling on/off"] },
        { name: "current_temp", label: "Current room temperature?", type: "text", required: false, placeholder: "e.g., 82°F / feels very warm" },
        { name: "target_temp", label: "What's it set to?", type: "text", required: false, placeholder: "e.g., 72°F" },
    ],
    printer: [
        { name: "problem_type", label: "What's the issue?", type: "select", required: true,
          options: ["Paper jam", "Not printing", "Poor print quality", "Offline / Not found on network", "Toner/Ink low", "Scanner not working"] },
        { name: "error_display", label: "Error on the printer display?", type: "text", required: false, placeholder: "e.g., 'PC LOAD LETTER', Error 49" },
        { name: "tried_restart", label: "Have you tried turning it off and on?", type: "button_group", required: true,
          options: ["Yes, didn't help", "No, I'll try now"] },
    ],
    elevator: [
        { name: "problem_type", label: "What's the issue?", type: "select", required: true,
          options: ["Stuck / Won't move", "Doors won't open", "Doors won't close", "Strange noise", "Button not responding", "Display error"] },
        { name: "people_inside", label: "Are people trapped inside?", type: "button_group", required: true,
          options: ["Yes — emergency", "No"] },
        { name: "current_floor", label: "Which floor is it on?", type: "text", required: false, placeholder: "e.g., 3rd floor" },
    ],
    // Default for unknown types
    other: [
        { name: "problem_type", label: "Describe the issue briefly", type: "select", required: true,
          options: ["Not working at all", "Working incorrectly", "Physical damage", "Safety concern", "Other"] },
        { name: "powered_on", label: "Is it powered on?", type: "button_group", required: true,
          options: ["Yes", "No", "N/A"] },
        { name: "details", label: "Any additional details?", type: "text", required: false, placeholder: "Error codes, symptoms, etc." },
    ],
};


export const chatFormResolver = {
    /**
     * Get the intent selection form (always the first form shown).
     * Adapts options based on whether the asset has inventory (shows restock option).
     */
    getIntentForm(asset: any): ChatForm {
        const hasInventory = asset?.inventory && Array.isArray(asset.inventory) && asset.inventory.length > 0;
        
        const options = ["Report a problem"];
        if (hasInventory) options.push("Request a restock");
        options.push("Give feedback", "Check service status");

        return {
            id: "intent_selection",
            title: `Hi! I'm ServiceBot. How can I help with ${asset?.name || 'this asset'}?`,
            description: asset ? `📍 ${asset.building || ''} · ${asset.floor || ''} · ${asset.room || ''}` : undefined,
            fields: [
                { name: "intent", label: "What would you like to do?", type: "button_group", required: true, options }
            ]
        };
    },

    /**
     * Get the diagnostic form based on asset type.
     */
    getDiagnosticForm(assetType: string): ChatForm {
        const fields = DIAGNOSTIC_FORMS[assetType] || DIAGNOSTIC_FORMS.other;
        
        return {
            id: `diagnostic_${assetType}`,
            title: "Let me help diagnose the issue",
            fields,
        };
    },

    /**
     * Get the restock form. Populates item options from asset inventory if available.
     */
    getRestockForm(asset: any): ChatForm {
        const inventoryItems = asset?.inventory?.map((i: any) => i.item || i.name) || [];
        
        const fields: ChatFormField[] = [];
        
        if (inventoryItems.length > 0) {
            fields.push({
                name: "item",
                label: "Which item needs restocking?",
                type: "select",
                required: true,
                options: inventoryItems,
            });
        } else {
            fields.push({
                name: "item",
                label: "What item would you like restocked?",
                type: "text",
                required: true,
                placeholder: "e.g., Oat Milk Latte, Paper Towels",
            });
        }

        fields.push({
            name: "urgency",
            label: "How urgent?",
            type: "button_group",
            required: true,
            options: ["Low — whenever convenient", "Normal — within a day", "Urgent — empty/critical"],
        });

        fields.push({
            name: "photo",
            label: "Photo of current stock? (optional)",
            type: "photo",
            required: false,
        });

        return {
            id: "restock_request",
            title: "Restock Request",
            description: asset?.name ? `For: ${asset.name}` : undefined,
            fields,
        };
    },

    /**
     * Get the escalation/contact form for dispatching a service provider.
     */
    getEscalationForm(asset: any): ChatForm {
        return {
            id: "escalation_contact",
            title: "I'll dispatch a technician for you",
            description: `Confirmed location: ${asset?.address || 'Unknown'}`,
            fields: [
                { name: "confirm_location", label: "Is this address correct?", type: "button_group", required: true,
                  options: ["Yes, correct", "No, different address"] },
                { name: "contact_method", label: "How should we send updates?", type: "button_group", required: true,
                  options: ["Email", "SMS"] },
                { name: "contact_value", label: "Your email or phone number", type: "text", required: true,
                  placeholder: "name@company.com or +1-555-0123" },
            ],
        };
    },

    /**
     * Get the feedback form.
     */
    getFeedbackForm(asset: any): ChatForm {
        return {
            id: "feedback",
            title: "We'd love your feedback",
            description: `About: ${asset?.name || 'this asset'}`,
            fields: [
                { name: "category", label: "What's your feedback about?", type: "select", required: true,
                  options: ["Cleanliness", "Reliability", "Selection/Options", "Location/Access", "Other"] },
                { name: "comment", label: "Your feedback", type: "textarea", required: true,
                  placeholder: "Tell us what's on your mind..." },
                { name: "photo", label: "Attach a photo? (optional)", type: "photo", required: false },
            ],
        };
    },

    /**
     * Resolve the next form to show based on conversation state.
     * Called by the chat handler to determine what to render.
     */
    resolveNextForm(state: {
        asset: any;
        intent?: string;
        diagnosticCompleted?: boolean;
        selfServiceFailed?: boolean;
    }): ChatForm | null {
        // No intent yet → show intent selection
        if (!state.intent) {
            return this.getIntentForm(state.asset);
        }

        // Intent: Report a problem → show diagnostic form
        if (state.intent === "Report a problem" && !state.diagnosticCompleted) {
            const assetType = state.asset?.type || "other";
            return this.getDiagnosticForm(assetType);
        }

        // Diagnostic done, self-service failed → show escalation
        if (state.intent === "Report a problem" && state.selfServiceFailed) {
            return this.getEscalationForm(state.asset);
        }

        // Intent: Restock
        if (state.intent === "Request a restock") {
            return this.getRestockForm(state.asset);
        }

        // Intent: Feedback
        if (state.intent === "Give feedback") {
            return this.getFeedbackForm(state.asset);
        }

        // Intent: Status → no form needed, LLM generates the report
        return null;
    },

    /**
     * Build the full form manifest for a deployment (all forms for all types).
     * Used during orgForge install to pre-cache on the deployment record.
     *
     * @param assetForms Optional blueprint-owned form definitions. When provided,
     *   each section OVERRIDES the corresponding hardcoded default, making the
     *   blueprint the source of truth. Shape:
     *     { intent?: { fields }, diagnostics?: { [type]: fields },
     *       restock?: { fields }, feedback?: { fields }, escalation?: { fields } }
     */
    buildFullManifest(assetForms?: any): Record<string, any> {
        const manifest: Record<string, any> = {};
        const bp = assetForms || {};

        // Intent form (blueprint override → default)
        manifest["intent_selection"] = bp.intent?.fields ? {
            pipelineName: bp.intent.pipelineName || "Intent Selection",
            title: bp.intent.title || "How can I help?",
            fields: bp.intent.fields,
        } : {
            pipelineName: "Intent Selection",
            title: "How can I help?",
            fields: [
                { name: "intent", label: "What would you like to do?", type: "button_group",
                  options: ["Report a problem", "Request a restock", "Give feedback", "Check service status"] }
            ],
        };

        // Type-specific diagnostics (blueprint override per type → default)
        const bpDiagnostics = bp.diagnostics || {};
        const allTypes = new Set([...Object.keys(DIAGNOSTIC_FORMS), ...Object.keys(bpDiagnostics)]);
        for (const type of allTypes) {
            manifest[`diagnostic_${type}`] = {
                pipelineName: `Diagnostic (${type})`,
                title: "Let me help diagnose the issue",
                fields: bpDiagnostics[type] || DIAGNOSTIC_FORMS[type] || DIAGNOSTIC_FORMS.other,
            };
        }

        // Restock (blueprint override → default)
        manifest["restock_request"] = {
            pipelineName: "Restock Request",
            title: "Restock Request",
            fields: bp.restock?.fields || [
                { name: "item", label: "Which item needs restocking?", type: "text", options_from: "asset.inventory[].item" },
                { name: "urgency", label: "How urgent?", type: "button_group", options: ["Low", "Normal", "Urgent"] },
            ],
        };

        // Escalation (blueprint override → default)
        manifest["escalation_contact"] = {
            pipelineName: "Service Dispatch",
            title: "Connect you with a technician",
            fields: bp.escalation?.fields || [
                { name: "confirm_location", label: "Is this address correct?", type: "button_group", options: ["Yes, correct", "No, different address"] },
                { name: "contact_method", label: "How should we send updates?", type: "button_group", options: ["Email", "SMS"] },
                { name: "contact_value", label: "Your email or phone number", type: "text" },
            ],
        };

        // Feedback (blueprint override → default)
        manifest["feedback"] = {
            pipelineName: "Feedback",
            title: "We'd love your feedback",
            fields: bp.feedback?.fields || [
                { name: "category", label: "What's your feedback about?", type: "select", options: ["Cleanliness", "Reliability", "Selection/Options", "Location/Access", "Other"] },
                { name: "comment", label: "Your feedback", type: "textarea" },
            ],
        };

        return manifest;
    },
};
