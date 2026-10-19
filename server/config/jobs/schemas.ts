
// ============================================================================
// JOB CONFIGURATION SCHEMAS
// Comprehensive reference for the copilot to understand job configurations
// ============================================================================

export const JOB_SCHEMAS = {
    folder_import: {
        description: "Import and process files from a directory",
        requiredFields: ["folderPath"],
        optionalFields: ["pattern", "recursive", "mode", "encoding", "extractArchives", "postProcessAction", "moveDestination", "maxBatchSize"],
        config: {
            folderPath: { type: "string", required: true, description: "Path to folder (e.g., 'incoming' or 'reports/2024')" },
            pattern: { type: "string", default: "**/*", description: "Glob pattern for files (e.g., '*.json', '*.csv')" },
            recursive: { type: "boolean", default: false, description: "Search subdirectories" },
            mode: { type: "enum", values: ["list_only", "read_content", "ingest_dataset"], default: "list_only", description: "list_only=paths, read_content=file contents, ingest_dataset=parse into dataset" },
            encoding: { type: "enum", values: ["utf8", "base64", "data_uri"], default: "utf8" },
            extractArchives: { type: "boolean", default: false, description: "Extract zip/tar files" },
            postProcessAction: { type: "enum", values: ["none", "move", "delete"], default: "none" },
            moveDestination: { type: "string", description: "Destination folder if postProcessAction is 'move'" },
            maxBatchSize: { type: "number", default: 100, description: "Max files per batch" },
        },
        example: {
            folderPath: "incoming/orders",
            pattern: "*.json",
            mode: "read_content",
            recursive: true,
        },
        outputFormat: "Array of {path, content, size, mimeType} objects",
    },
    transformer: {
        description: "Transform data structure and optionally extract knowledge graph entities",
        requiredFields: ["rules"],
        optionalFields: ["inputSource", "entityExtraction"],
        config: {
            rules: { type: "array", required: true, description: "Array of transformation rules" },
            inputSource: { type: "enum", values: ["previous_step", "provided"], default: "previous_step" },
            entityExtraction: { type: "object", description: "Optional entity extraction config" },
        },
        ruleSchema: {
            id: { type: "string", required: true, description: "Unique rule ID" },
            sourcePath: { type: "string", required: true, description: "JSONPath to source field (e.g., '$.data.name')" },
            targetPath: { type: "string", required: true, description: "JSONPath to target field" },
            type: { type: "enum", values: ["direct", "wrap_object", "map_value", "parse_json", "to_string", "extract_field"], required: true },
        },
        example: {
            rules: [
                { id: "r1", sourcePath: "$.name", targetPath: "$.customer_name", type: "direct" },
                { id: "r2", sourcePath: "$.amount", targetPath: "$.order_amount", type: "direct" },
            ],
        },
        outputFormat: "Transformed JSON object",
    },
    file_writer: {
        description: "Write content to a file in storage or cloud (AWS S3, etc.).",
        requiredFields: ["destination", "path", "content"],
        optionalFields: ["format", "encoding", "credentialId", "bucket", "onConflict", "createDirs", "acl"],
        config: {
            destination: { type: "enum", values: ["local", "aws_s3", "google_cloud_storage", "azure_blob", "google_drive", "onedrive"], default: "local" },
            path: { type: "string", required: true, description: "File path or object key" },
            content: { type: "string", required: true, description: "Content to write (supports variables)" },
            format: { type: "enum", values: ["raw", "json", "csv"], default: "raw" },
            encoding: { type: "enum", values: ["utf8", "base64"], default: "utf8" },
            credentialId: { type: "number", description: "Cloud credential ID (not required for local)" },
            bucket: { type: "string", description: "S3 Bucket Name" },
            onConflict: { type: "enum", values: ["overwrite", "append", "fail", "rename"], default: "overwrite" },
        },
        example: {
            destination: "aws_s3",
            credentialId: 1,
            bucket: "my-reports-bucket",
            path: "reports/daily_summary.json",
            content: "{{steps.1.output}}",
            format: "json",
        },
        outputFormat: "Success message",
    },
    file_export: {
        description: "Write content to a file in storage",
        requiredFields: ["destinationPath", "content"],
        optionalFields: ["encoding", "format", "onConflict"],
        config: {
            destinationPath: { type: "string", required: true, description: "Path to write file (e.g., 'exports/report.json')" },
            content: { type: "string", required: true, description: "Content to write. Use {{steps.N.output}} for previous step data" },
            encoding: { type: "enum", values: ["utf8", "base64"], default: "utf8" },
            format: { type: "enum", values: ["raw", "json", "csv"], default: "raw", description: "raw=as-is, json=stringify, csv=convert array" },
            onConflict: { type: "enum", values: ["overwrite", "append", "fail", "rename"], default: "overwrite" },
        },
        example: {
            destinationPath: "exports/processed_orders.json",
            content: "{{steps.1.output}}",
            format: "json",
            onConflict: "overwrite",
        },
        outputFormat: "Success message with file path",
    },
    curl: {
        description: "Make HTTP requests to REST APIs",
        requiredFields: ["url", "method"],
        optionalFields: ["headers", "body", "queryParams", "requestType", "responseType", "authType", "credentialId"],
        config: {
            url: { type: "string", required: true, description: "Full URL or relative path" },
            method: { type: "enum", values: ["GET", "POST", "PUT", "PATCH", "DELETE"], required: true },
            headers: { type: "object", description: "Key-value headers (e.g., {'Authorization': 'Bearer xxx'})" },
            body: { type: "string", description: "Request body (JSON stringified)" },
            queryParams: { type: "object", description: "URL query parameters" },
            requestType: { type: "enum", values: ["json", "text", "form-data", "xml", "custom"], default: "json" },
            responseType: { type: "enum", values: ["json", "text", "auto"], default: "auto" },
            authType: { type: "enum", values: ["none", "bearer", "basic"], default: "none" },
            credentialId: { type: "number", description: "Credential ID for auth token" },
        },
        example: {
            url: "https://api.example.com/orders",
            method: "GET",
            headers: { "Accept": "application/json" },
            authType: "bearer",
            credentialId: 1,
        },
        outputFormat: "API response (parsed JSON if json response)",
    },
    ai_api_call: {
        description: "Single-turn AI/LLM completion",
        requiredFields: ["credentialId", "model", "userPrompt"],
        optionalFields: ["systemPrompt", "temperature", "maxTokens", "retrievalSettings"],
        config: {
            credentialId: { type: "number", required: true, description: "AI provider credential ID" },
            model: { type: "string", required: true, description: "Model name (e.g., 'gpt-4', 'claude-3-opus', 'gemini-pro')" },
            userPrompt: { type: "string", required: true, description: "User prompt. Use {{steps.N.output}} for context" },
            systemPrompt: { type: "string", description: "System prompt for AI behavior" },
            temperature: { type: "number", default: 0.7, description: "0-2, lower = more deterministic" },
            maxTokens: { type: "number", description: "Max response tokens" },
        },
        example: {
            credentialId: 1,
            model: "gpt-4",
            systemPrompt: "You are a data analyst. Analyze the provided data and return insights as JSON.",
            userPrompt: "Analyze this order data and identify trends: {{steps.0.output}}",
            temperature: 0.3,
        },
        outputFormat: "AI response text",
    },
    ai_agent: {
        description: "Multi-turn AI agent with tool use and reasoning",
        requiredFields: ["credentialId", "model", "goal"],
        optionalFields: ["maxIterations", "allowedTools", "systemPrompt"],
        config: {
            credentialId: { type: "number", required: true },
            model: { type: "string", required: true },
            goal: { type: "string", required: true, description: "High-level goal for the agent" },
            maxIterations: { type: "number", default: 10, description: "Max reasoning loops" },
            allowedTools: { type: "array", description: "Tool names the agent can use" },
            systemPrompt: { type: "string" },
        },
        example: {
            credentialId: 1,
            model: "gpt-4",
            goal: "Analyze the ticket data and create a summary report with recommendations",
            maxIterations: 5,
            allowedTools: ["search_knowledge_base", "sql_query"],
        },
        outputFormat: "Agent's final response",
    },
    sql_query: {
        description: "Execute SQL query against external database",
        requiredFields: ["credentialId", "query"],
        optionalFields: ["outputMode"],
        config: {
            credentialId: { type: "number", required: true, description: "Database credential ID" },
            query: { type: "string", required: true, description: "SQL query. Use {{steps.N.output}} for dynamic values" },
            outputMode: { type: "enum", values: ["list", "single"], default: "list" },
        },
        example: {
            credentialId: 2,
            query: "SELECT * FROM orders WHERE status = 'pending' LIMIT 100",
            outputMode: "list",
        },
        outputFormat: "Array of row objects (list) or single object (single)",
    },
    iterator: {
        description: "Loop over a collection, running a job or pipeline for each item",
        requiredFields: ["targetId", "inputArray"],
        optionalFields: ["mode", "itemVarName", "concurrency", "aggregateOutputs"],
        config: {
            mode: { type: "enum", values: ["job", "pipeline"], default: "job", description: "Run a job or pipeline per item" },
            targetId: { type: "number", required: true, description: "Job ID or Pipeline ID to run" },
            inputArray: { type: "string", required: true, description: "Variable ref: {{steps.0.output.items}}" },
            itemVarName: { type: "string", default: "item", description: "Variable name for current item" },
            concurrency: { type: "number", default: 1, description: "Parallel execution count (1-50)" },
            aggregateOutputs: { type: "boolean", default: true, description: "Collect all outputs into array" },
        },
        example: {
            mode: "job",
            targetId: 15,
            inputArray: "{{steps.0.output.files}}",
            itemVarName: "file",
            concurrency: 5,
        },
        outputFormat: "Array of all job outputs (if aggregateOutputs=true)",
    },
    decision: {
        description: "Conditional branching based on expression",
        requiredFields: ["condition"],
        config: {
            condition: { type: "string", required: true, description: "Boolean expression (e.g., 'steps.0.output.count > 10')" },
        },
        example: {
            condition: "steps.0.output.status == 'success' && steps.0.output.count > 0",
        },
        outputFormat: "Boolean (true/false) - routes to trueStepId or falseStepId",
        stepNote: "In pipeline step, set decisionNodeConfig: {condition, trueStepId, falseStepId}",
    },
    repeater: {
        description: "Loop over array, execute nested API call for each item",
        requiredFields: ["inputSource", "nestedJobType", "nestedJobConfig"],
        optionalFields: ["itemVariable", "maxIterations", "stopOnError", "executionMode", "concurrency"],
        config: {
            inputSource: { type: "string", required: true, description: "Variable ref: {{steps.0.output}}" },
            nestedJobType: { type: "enum", values: ["curl", "api"], required: true },
            nestedJobConfig: { type: "object", required: true, description: "CURL config with {{item}} variable" },
            itemVariable: { type: "string", default: "item", description: "Variable name for current item" },
            maxIterations: { type: "number", description: "Safety limit" },
            executionMode: { type: "enum", values: ["sequential", "parallel"], default: "sequential" },
            concurrency: { type: "number", default: 5, description: "For parallel mode" },
        },
        example: {
            inputSource: "{{steps.0.output.orders}}",
            nestedJobType: "curl",
            nestedJobConfig: {
                url: "https://api.example.com/orders/{{item.id}}/process",
                method: "POST",
            },
            executionMode: "parallel",
            concurrency: 10,
        },
        outputFormat: "Array of all API responses",
    },
    shell: {
        description: "Execute shell command",
        requiredFields: ["executable"],
        optionalFields: ["parameters", "workingDirectory"],
        config: {
            executable: { type: "string", required: true, description: "Command to run" },
            parameters: { type: "string", description: "Command arguments" },
            workingDirectory: { type: "string", description: "Working directory path" },
        },
        example: {
            executable: "python",
            parameters: "scripts/process_data.py --input={{steps.0.output}}",
            workingDirectory: "/app/scripts",
        },
        outputFormat: "Command stdout",
    },
    python: {
        description: "Execute Python script",
        requiredFields: ["scriptContent"],
        optionalFields: ["requirements"],
        config: {
            scriptContent: { type: "string", required: true, description: "Python code to execute" },
            requirements: { type: "string", description: "pip requirements (one per line)" },
        },
        example: {
            scriptContent: `import json
data = json.loads('''{{steps.0.output}}''')
result = {"count": len(data), "processed": True}
print(json.dumps(result))`,
        },
        outputFormat: "Script stdout (usually JSON)",
    },
    node_script: {
        description: "Execute Node.js script",
        requiredFields: [],
        optionalFields: ["script", "inputs", "timeoutMs"],
        config: {
            script: { type: "string", default: "return { result: 'done' };", description: "JavaScript code" },
            inputs: { type: "object", description: "Map of variable -> input name" },
            timeoutMs: { type: "number", default: 5000 },
        },
        example: {
            script: `const data = inputs.previousStep;
const processed = data.map(item => ({...item, processed: true}));
return { items: processed, count: processed.length };`,
            inputs: { previousStep: "{{steps.0.output}}" },
        },
        outputFormat: "Return value from script",
    },
    slack_post: {
        description: "Send Slack message",
        requiredFields: ["credentialId", "channelId", "message"],
        config: {
            credentialId: { type: "number", required: true },
            channelId: { type: "string", required: true, description: "Slack channel ID (e.g., 'C0123456789')" },
            message: { type: "string", required: true },
        },
        example: {
            credentialId: 3,
            channelId: "C0123456789",
            message: "Pipeline completed! Processed {{steps.1.output.count}} items.",
        },
        outputFormat: "Slack API response",
    },
    email_send: {
        description: "Send email via SMTP",
        requiredFields: ["credentialId", "to", "subject", "body"],
        optionalFields: ["isHtml"],
        config: {
            credentialId: { type: "number", required: true },
            to: { type: "string", required: true, description: "Recipient email(s), comma-separated" },
            subject: { type: "string", required: true },
            body: { type: "string", required: true },
            isHtml: { type: "boolean", default: false },
        },
        example: {
            credentialId: 4,
            to: "team@example.com",
            subject: "Daily Report - {{steps.0.output.date}}",
            body: "Report attached. Summary: {{steps.1.output.summary}}",
        },
        outputFormat: "Email sent confirmation",
    },
    human_approval: {
        description: "Pause pipeline and wait for human approval",
        requiredFields: ["formId"],
        optionalFields: ["assigneeEmail", "timeoutHours"],
        config: {
            formId: { type: "number", required: true, description: "Approval form ID" },
            assigneeEmail: { type: "string", description: "Email of approver" },
            timeoutHours: { type: "number", default: 24 },
        },
        example: {
            formId: 1,
            assigneeEmail: "manager@example.com",
            timeoutHours: 48,
        },
        outputFormat: "Form submission data when approved",
    },
    selenium: {
        description: "Browser automation for web scraping and testing",
        requiredFields: ["steps"],
        optionalFields: ["browserType", "headless", "timeout", "viewport"],
        config: {
            mode: { type: "enum", values: ["local", "grid", "firecrawl", "scrapegraph", "auto_pilot"], default: "local", description: "Scraping engine: firecrawl (markdown), scrapegraph (structured), local (playwright)" },
            browserType: { type: "enum", values: ["chromium", "firefox", "webkit"], default: "chromium" },
            headless: { type: "boolean", default: true },
            stealth: { type: "boolean", default: true, description: "Enable advanced bot evasion (Canvas masking, battery spoofing, etc.)" },
            timeout: { type: "number", default: 30000 },
            steps: { type: "array", required: true, description: "Array of browser actions" },
        },
        stepSchema: {
            action: { type: "enum", values: ["goto", "click", "type", "extract", "screenshot", "wait", "waitForSelector"], required: true },
            selector: { type: "string", description: "CSS selector for element" },
            value: { type: "string", description: "Value for type action or URL for goto" },
            extractAs: { type: "string", description: "Variable name for extracted data" },
        },
        example: {
            browserType: "chromium",
            headless: true,
            steps: [
                { action: "goto", value: "https://example.com/data" },
                { action: "waitForSelector", selector: ".data-table" },
                { action: "extract", selector: ".data-table", extractAs: "tableData", format: "text" },
            ],
        },
        outputFormat: "Object with extracted data by extractAs names",
    },
    openapi: {
        description: "Execute API call using OpenAPI spec",
        requiredFields: ["specId", "operationId"],
        optionalFields: ["parameters", "credentialId"],
        config: {
            specId: { type: "number", required: true, description: "OpenAPI spec ID" },
            operationId: { type: "string", required: true, description: "Operation ID from spec" },
            parameters: { type: "object", description: "Operation parameters" },
            credentialId: { type: "number", description: "For authentication" },
        },
        example: {
            specId: 1,
            operationId: "getUsers",
            parameters: { limit: 100, status: "active" },
            credentialId: 1,
        },
        outputFormat: "API response",
    },
    airflow_dag_run: {
        description: "Trigger Apache Airflow DAG",
        requiredFields: ["connectionId", "dagId"],
        optionalFields: ["dagRunConf", "waitForCompletion", "timeoutSeconds"],
        config: {
            connectionId: { type: "string", required: true },
            dagId: { type: "string", required: true },
            dagRunConf: { type: "object", description: "DAG run configuration" },
            waitForCompletion: { type: "boolean", default: true },
            timeoutSeconds: { type: "number", default: 3600 },
        },
        example: {
            connectionId: "airflow-prod",
            dagId: "etl_daily_pipeline",
            dagRunConf: { date: "2024-01-01" },
            waitForCompletion: true,
        },
        outputFormat: "DAG run status and XCom values",
    },
    reranker: {
        description: "Semantic reranking for RAG results",
        requiredFields: ["credentialId", "query", "documents"],
        optionalFields: ["model", "topK"],
        config: {
            credentialId: { type: "number", required: true },
            model: { type: "string", default: "BAAI/bge-reranker-v2-m3" },
            query: { type: "string", required: true },
            documents: { type: "string", required: true, description: "Variable ref to document array" },
            topK: { type: "number", default: 5 },
        },
        example: {
            credentialId: 1,
            query: "{{input.userQuery}}",
            documents: "{{steps.0.output.documents}}",
            topK: 10,
        },
        outputFormat: "Reranked documents with scores",
    },
    file_ops: {
        description: "Perform file system operations (Safe Copy, Move, Delete, List, Checksum)",
        requiredFields: ["operation", "sourcePath"],
        optionalFields: ["destinationPath", "force", "recursive", "preChecks", "postChecks", "allowUnsafePaths"],
        config: {
            operation: { type: "enum", values: ["copy", "move", "delete", "list", "create_dir", "get_metadata", "calculate_checksum"], required: true },
            sourcePath: { type: "string", required: true, description: "Source file/directory path" },
            destinationPath: { type: "string", description: "Target path for copy/move" },
            force: { type: "boolean", default: false, description: "Overwrite existing files or force delete" },
            recursive: { type: "boolean", default: false, description: "Recursive operation for directories" },
            allowUnsafePaths: { type: "boolean", default: false, description: "Allow paths outside project root (Advanced)" },
            preChecks: { type: "array", description: "List of checks to run BEFORE operation" },
            postChecks: { type: "array", description: "List of checks to run AFTER operation" },
        },
        example: {
            operation: "copy",
            sourcePath: "data/input/file.csv",
            destinationPath: "data/processed/file_v1.csv",
            force: true,
            preChecks: [
                { type: "exists", path: "data/input/file.csv" },
                { type: "checksum_equals", path: "data/input/file.csv", value: "a1b2c3d4...", algorithm: "sha256" }
            ],
            postChecks: [
                { type: "exists", path: "data/processed/file_v1.csv" }
            ]
        },
        outputFormat: "Operation result object (e.g. { message: 'Copied...', path: '...' })",
    },
};

