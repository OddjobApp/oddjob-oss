/**
 * Canonical job type groups used in the CreateAgent wizard.
 * Keep in sync with SPECIALIZED_TYPES in UniversalJobEditor.tsx.
 */
export const AGENT_TYPE_GROUPS = [
    {
        name: "Agents & Intelligence",
        types: [
            { id: "ai_agent",    label: "Autonomous Agent", description: "Multi-tool reasoning agent (GPT-4/Gemini)" },
            { id: "ai_api_call", label: "LLM Completion",   description: "Structured AI extraction or text generation" },
            { id: "form_agent",  label: "Form Handler",     description: "Agent tailored for HIL form processing" },
            { id: "supervisor",  label: "Supervisor",       description: "Multi-agent coordination & delegation" },
            { id: "dispatcher",  label: "Dispatcher",       description: "Job dispatch and queue management" },
        ]
    },
    {
        name: "Code & Automation",
        types: [
            { id: "shell",         label: "Shell Script",        description: "Execute local bash/powershell commands" },
            { id: "python",        label: "Python Runtime",       description: "Isolated python script execution" },
            { id: "node_script",   label: "Node.js Function",     description: "Dynamic Javascript logic" },
            { id: "git_op",        label: "Git Operation",        description: "Clone, Commit, Push workflows" },
            { id: "selenium",      label: "Browser Automation",   description: "Selenium-based web scraping" },
            { id: "computer_use",  label: "Computer Use",         description: "Agent-driven desktop automation via Trycua" },
            { id: "curl",          label: "cURL Request",         description: "Raw cURL command execution" },
        ]
    },
    {
        name: "Integration & Data",
        types: [
            { id: "openapi",            label: "OpenAPI / Tool",     description: "Call any REST API using Swagger/OpenAPI" },
            { id: "sql_query",          label: "SQL Execution",      description: "Query Postgres, Snowflake, or BigQuery" },
            { id: "slack_post",         label: "Slack Notification", description: "Send alerts to channels" },
            { id: "email_send",         label: "Email Dispatch",     description: "Send transaction emails via SMTP/SendGrid" },
            { id: "confluence_sync",    label: "Confluence Sync",    description: "Synchronize with Confluence pages" },
            { id: "jira_sync",          label: "Jira Sync",          description: "Synchronize with Jira issues" },
            { id: "google_drive_sync",  label: "Google Drive Sync",  description: "Sync files with Google Drive" },
        ]
    },
    {
        name: "Flow Control",
        types: [
            { id: "transformer",    label: "Data Transformer",    description: "Apply Jolt/Mapping rules to JSON" },
            { id: "human_approval", label: "Human-in-the-loop",   description: "Wait for manual verification" },
            { id: "decision",       label: "Branching Logic",     description: "Simple If/Else routing" },
            { id: "repeater",       label: "Loop / Repeater",     description: "Iterate over datasets" },
            { id: "iterator",       label: "Iterator",            description: "Iterate over collections with sub-jobs" },
            { id: "reranker",       label: "Reranker",            description: "Re-rank and filter results with AI" },
            { id: "airflow_dag_run",label: "Airflow DAG",         description: "Trigger Apache Airflow DAG runs" },
        ]
    },
    {
        name: "File Operations",
        types: [
            { id: "folder_import", label: "Folder Import",    description: "Import and process folder contents" },
            { id: "file_writer",   label: "File Writer",       description: "Write content to files" },
            { id: "file_export",   label: "File Export",       description: "Export data to various formats" },
            { id: "file_ops",      label: "File Operations",   description: "Copy, move, delete file operations" },
        ]
    },
    {
        name: "Utilities",
        types: [
            { id: "static_response", label: "Static Response", description: "Return static JSON/text responses" },
        ]
    },
];

/** Materialize visual defaults so submitted config matches what the editor shows. */
export function getDefaultJobConfig(type: string): Record<string, any> {
    switch (type) {
        case "ai_agent":
            return {
                model: "gemini-2.0-flash",
                goal: "",
                persona: "generic",
                maxIterations: 10,
                allowedTools: [],
                temperature: 0.7,
                dryRun: false,
                saveOutputToFile: false,
                supervision: "full",
                notificationChannels: ["copilot"],
            };
        case "form_agent":
            return {
                formSchema: { fields: [] },
                variableMappings: {},
                timeoutMinutes: 15,
                retryOnFailure: false,
            };
        case "dispatcher":
            return {
                serviceType: "",
                userLocationSource: "variable",
                isDemoMode: false,
            };
        case "computer_use":
            return {
                goal: "",
                os: "windows",
                maxActions: 50,
                maxIterations: 20,
                model: "gemini-2.0-flash",
            };
        default:
            return {};
    }
}

/** Preset CRON expressions for the schedule builder UI. */
export const CRON_TEMPLATES = [
    { value: '0 * * * *',     label: 'Every Hour'                    },
    { value: '*/15 * * * *',  label: 'Every 15 Minutes'              },
    { value: '*/30 * * * *',  label: 'Every 30 Minutes'              },
    { value: '0 9 * * *',     label: 'Daily at 9:00 AM'              },
    { value: '0 0 * * *',     label: 'Daily at Midnight'             },
    { value: '0 12 * * *',    label: 'Daily at Noon'                 },
    { value: '0 0 * * 1',     label: 'Every Monday at Midnight'      },
    { value: '0 9 * * 1',     label: 'Every Monday at 9:00 AM'       },
    { value: '0 0 * * 1-5',   label: 'Every Weekday at Midnight'     },
    { value: '0 9 * * 1-5',   label: 'Every Weekday at 9:00 AM'      },
    { value: '0 0 1 * *',     label: 'First of Month at Midnight'    },
    { value: '0 0 1,15 * *',  label: 'First and 15th of Month'       },
];
