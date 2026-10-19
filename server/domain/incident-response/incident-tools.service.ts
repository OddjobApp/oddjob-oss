/** Retired demonstration handlers. Never fabricate operational evidence.
 * Real incident coordination uses the scoped, durable /incidents app gateway.
 * Provider writes remain unavailable until a governed provider adapter is implemented.
 */
function unavailable(tool: string) {
  return async (_params: unknown) => ({ success: false, simulated: false,
    error: `Incident tool '${tool}' has no verified provider implementation. No external action was performed. Use the incident workbench for durable coordination and CREW's connected provider tools for reviewed actions.`,
    message: 'Provider action unavailable; no action was performed.' });
}
const fetchRecentLogs = unavailable('fetch_recent_logs');
const queryKnowledgeBase = unavailable('query_knowledge_base');
const compileDiagnosisReport = unavailable('compile_diagnosis_report');
const developCodeFix = unavailable('develop_code_fix');
const createPullRequest = unavailable('create_pull_request');
const runRegressionTests = unavailable('run_regression_tests');
const mergeAndDeploy = unavailable('merge_and_deploy');
const compileDeploymentReport = unavailable('compile_deployment_report');
const retrieveIncidentLogs = unavailable('retrieve_incident_logs');
const perform5WhysRca = unavailable('perform_5_whys_rca');
const writePostmortemReport = unavailable('write_postmortem_report');
const fileRemediationTickets = unavailable('file_remediation_tickets');
export const incidentToolsService = {
    fetch_recent_logs: fetchRecentLogs,
    query_knowledge_base: queryKnowledgeBase,
    compile_diagnosis_report: compileDiagnosisReport,
    develop_code_fix: developCodeFix,
    create_pull_request: createPullRequest,
    run_regression_tests: runRegressionTests,
    merge_and_deploy: mergeAndDeploy,
    compile_deployment_report: compileDeploymentReport,
    retrieve_incident_logs: retrieveIncidentLogs,
    perform_5_whys_rca: perform5WhysRca,
    write_postmortem_report: writePostmortemReport,
    file_remediation_tickets: fileRemediationTickets,

    /** No demonstration-only actions are advertised to the tool registry. */
    getToolDefinitions() { return []; },
};
