export const EVENT_TYPES = [
  { 
    value: "job.completed", 
    label: "Job Completed", 
    category: "Jobs", 
    description: "Fires when any job in the system finishes successfully.",
    schema: {
      schemaDef: {
        "payload.jobId": { type: "number", label: "Job ID" },
        "payload.jobName": { type: "string", label: "Job Name" },
        "payload.output": { type: "object", label: "Output Content" },
        "payload.status": { type: "string", label: "Status" }
      }
    }
  },
  { 
    value: "job.failed", 
    label: "Job Failed", 
    category: "Jobs", 
    description: "Fires when a job encounters an error.",
    schema: {
      schemaDef: {
        "payload.jobId": { type: "number", label: "Job ID" },
        "payload.jobName": { type: "string", label: "Job Name" },
        "payload.error": { type: "string", label: "Error Message" }
      }
    }
  },
  { 
    value: "job.drift_detected", 
    label: "Drift Detected", 
    category: "Reactive", 
    description: "Fires when job output deviates significantly from its baseline.",
    schema: {
      schemaDef: {
        "payload.jobId": { type: "number", label: "Job ID" },
        "payload.driftScore": { type: "number", label: "Drift Score" },
        "payload.baselineId": { type: "number", label: "Baseline ID" },
        "payload.diff": { type: "object", label: "Changes Detected" }
      }
    }
  },
  { 
    value: "knowledge.updated", 
    label: "Knowledge Graph Updated", 
    category: "Knowledge", 
    description: "Fires when the global knowledge graph is modified.",
    schema: {
      schemaDef: {
        "payload.nodeId": { type: "number", label: "Node ID" },
        "payload.changeType": { type: "string", label: "Change Type" }
      }
    }
  },
  { 
    value: "webhook.received", 
    label: "Webhook Received", 
    category: "External", 
    description: "Fires when an external POST request hits the trigger endpoint.",
    schema: {
      schemaDef: {
        "payload.body": { type: "object", label: "Request Body" },
        "payload.headers": { type: "object", label: "Headers" }
      }
    }
  },
  { 
    value: "hil.decision_made", 
    label: "HIL Decision Made", 
    category: "Governance", 
    description: "Fires when a human approves or rejects a drift.",
    schema: {
      schemaDef: {
        "payload.requestId": { type: "number", label: "Request ID" },
        "payload.decision": { type: "string", label: "Decision (approve/reject)" },
        "payload.comment": { type: "string", label: "Comment" }
      }
    }
  },
];

export const CATEGORIES = ["Jobs", "Reactive", "Knowledge", "Governance", "External"];
