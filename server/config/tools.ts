/**
 * Oddjob Tool Configuration
 * Central registry for tool categories and metadata
 */

export const READ_ONLY_TOOLS = [
    'search',
    'read_file',
    'list_dir',
    'get_code_context',
    'grep_search',
    'fetch_url',
    'get_health',
    'list_design_systems',
    'get_project',
    'get_screen',
    'list_screens',
    'list_projects'
];

export const RESERVED_STEP_TOOLS = [
    'reflection',
    'vibe_audit',
    'critic_review',
    'critic_audit',
    'wave_reflection',
    'synthesis'
];

export function isReadOnlyTool(toolName: string): boolean {
    const normalizedName = toolName.toLowerCase();
    return READ_ONLY_TOOLS.some(t => normalizedName.includes(t));
}

export function isReservedTool(toolName: string): boolean {
    const normalizedName = toolName.toLowerCase();
    return RESERVED_STEP_TOOLS.some(t => normalizedName.includes(t));
}
