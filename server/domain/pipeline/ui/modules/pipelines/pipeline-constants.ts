/**
 * Canonical pipeline status and edge-type constants.
 * Use these instead of hardcoded strings throughout the pipeline UI.
 */

export const PIPELINE_STATUS = {
    SUCCESS:       'success',
    FAILURE:       'failure',
    RUNNING:       'running',
    WAITING_ASYNC: 'waiting_async',
    SKIPPED:       'skipped',
    COMPLETED:     'completed',
    FAILED:        'failed',
    PENDING:       'pending',
} as const;

export type PipelineStatusValue = typeof PIPELINE_STATUS[keyof typeof PIPELINE_STATUS];

/** Edge condition values used in step configuration */
export const STEP_CONDITION_VALUES = {
    ON_SUCCESS: 'on_success',
    ON_FAILURE: 'on_failure',
    ALWAYS:     'always',
} as const;

/** Module types used in step configuration */
export const MODULE_TYPES = {
    LOGIC_GATEKEEPER: 'logic_gatekeeper',
    TRANSFORMER:      'transformer',
} as const;
