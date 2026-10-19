/**
 * Persona-type constants shared by the server and the browser.
 *
 * Deliberately a dependency-free leaf module: shared/schema/agent-cards.ts pulls
 * in drizzle-orm/pg-core and drizzle-zod, so a value import of it from client
 * code would bundle the ORM into the browser. Types from the schema erase at
 * compile time and are safe; a runtime constant is not.
 */

/**
 * The persona type identifying the platform Copilot's agent card.
 *
 * Both ends depend on it: the seed provisioner writes it, and the Crew Room
 * reads it to pin the Copilot first in the roster and select it by default.
 * Matching on personaType rather than on the name means an organization that
 * renames its Copilot keeps the behaviour.
 */
export const COPILOT_PERSONA_TYPE = "copilot";

/**
 * The tools the Copilot's seed card declares.
 *
 * Lives here, beside the persona type, so the crew's admission gate can be
 * tested against the real list. A crew agent's declared tools are a ceiling, and
 * anything the gate rejects is simply absent at runtime with no error — a
 * silently mute Copilot. The test asserts every name below still passes.
 *
 * Ordered as used: resolve the app, then hand it over.
 */
export const COPILOT_TOOLS = [
    "list_installed_apps",
    "list_blueprints",
    "render_app_surface",
    "discover_capabilities",
    "list_pending_cycles",
    "list_recent_executions",
    "search_knowledge_base",
    "resolve_assembly_dag",
    "render_workflow_diagram",
    "mount_builder_pod",
    "mount_signal_studio",
    "evaluate_functional_gaps",
    "propose_studio_contribution",
] as const;
