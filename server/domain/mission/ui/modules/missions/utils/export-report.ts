/**
 * Mission Run Report Export Utility
 *
 * Extracts report generation and file-download logic from MissionRunDetail
 * to keep the page component focused on rendering.
 */

export interface ExportReportParams {
  format: "md" | "txt" | "json";
  run: any;
  missionId: number;
  plan: any;
  parsedMissionContext: any;
  mission: any;
  stepsData: any[] | undefined;
  suggestions: any[] | undefined;
  attachedAssets: any[];
  attachedTemplates: any[];
  fileAttachments: any[];
  timeline: any[];
}

/** Trigger a browser download for the given blob. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Build JSON report payload. */
function buildJsonReport(p: ExportReportParams) {
  const { run, missionId, plan, parsedMissionContext, mission, stepsData, suggestions, attachedAssets, attachedTemplates, fileAttachments } = p;
  return {
    missionId,
    runId: run.id,
    name: run.name || `Run ${run.id}`,
    status: run.status,
    launchedAt: run.createdAt,
    objective: plan?.intent || parsedMissionContext?.intent || parsedMissionContext?.plan?.intent || mission?.objective || "N/A",
    result: parsedMissionContext?.result || parsedMissionContext?.deliverable || null,
    strategicAssessment: plan?.statusUpdate || parsedMissionContext?.plan?.statusUpdate || null,
    operationalContext: plan?.currentContext || parsedMissionContext?.plan?.currentContext || null,
    tasks: plan?.tasks || parsedMissionContext?.plan?.tasks || [],
    blackboard: mission?.blackboard || {},
    team: mission?.members || [],
    executionTrace:
      mission?.executionStrategy === "dynamic_autonomous"
        ? run.dynamicTrace || []
        : Array.isArray(stepsData)
          ? stepsData.map((step: any) => ({
              phase: step.stepOrder,
              module: step.jobName,
              jobType: step.jobType,
              status: step.status,
              executedAt: step.executedAt,
              error: step.error || null,
              output: step.output || null,
            }))
          : [],
    suggestions: Array.isArray(suggestions)
      ? suggestions.map((s: any) => ({ type: s.type, title: s.title, content: s.content, status: s.status }))
      : [],
    resources: {
      ragAssets: Array.isArray(attachedAssets)
        ? attachedAssets.map((a: any) => ({ name: a.assetName, type: a.assetType, purpose: a.purpose }))
        : [],
      documentTemplates: Array.isArray(attachedTemplates)
        ? attachedTemplates.map((t: any) => ({ name: t.templateName, type: t.templateType, role: t.role }))
        : [],
      fileAttachments: Array.isArray(fileAttachments)
        ? fileAttachments.map((f: any) => ({ name: f.fileName, size: f.fileSize, purpose: f.purpose }))
        : [],
    },
  };
}

/** Build markdown or plain-text report content. */
function buildTextReport(p: ExportReportParams): string {
  const { format, run, plan, parsedMissionContext, mission, stepsData, attachedAssets, attachedTemplates, fileAttachments, timeline } = p;
  const isMd = format === "md";
  const sep = isMd ? "---" : "================================================";
  const runName = run.name || `Run ${run.id}`;
  const timestamp = new Date(run.createdAt).toLocaleString();

  const objective = plan?.intent || parsedMissionContext?.intent || parsedMissionContext?.plan?.intent || mission?.objective || "N/A";
  const result = parsedMissionContext?.result || parsedMissionContext?.deliverable;
  const statusUpdate = plan?.statusUpdate || parsedMissionContext?.plan?.statusUpdate;
  const currentContext = plan?.currentContext || parsedMissionContext?.plan?.currentContext;

  let c = "";

  // Header
  if (isMd) {
    c += `---\nMISSION_ID: RUN-${run.id}\nSTATUS: ${run.status.toUpperCase()}\nLAUNCHED: ${timestamp}\nOBJECTIVE: ${objective}\n---\n\n`;
    c += `# INTELLIGENCE REPORT: ${runName}\n\n`;
  } else {
    c += `INTELLIGENCE REPORT: ${runName}\n${sep}\nMISSION ID: RUN-${run.id}\nSTATUS: ${run.status.toUpperCase()}\nLAUNCHED: ${timestamp}\nOBJECTIVE: ${objective}\n${sep}\n\n`;
  }

  // Deliverable
  if (result) {
    c += isMd ? `## FINAL DELIVERABLE\n${result}\n\n` : `FINAL DELIVERABLE\n${sep}\n${result}\n\n`;
  }

  // Assessment & Context
  if (statusUpdate) {
    c += isMd ? `## 01. Strategic Assessment\n${statusUpdate}\n\n` : `STRATEGIC ASSESSMENT\n${statusUpdate}\n\n`;
  }
  if (currentContext) {
    c += isMd ? `## 02. Operational Context\n${currentContext}\n\n` : `OPERATIONAL CONTEXT\n${currentContext}\n\n`;
  }

  // Blackboard
  const blackboard = (mission?.blackboard as Record<string, any>) || {};
  const relevantKeys = Object.keys(blackboard).filter(k =>
    !k.startsWith("tool_output_") && k !== "parent_mission_id" && k !== "viaAppSlug"
  );
  if (relevantKeys.length > 0) {
    c += isMd ? `## 03. Mission Knowledge (Blackboard)\n\n` : `MISSION KNOWLEDGE\n${sep}\n\n`;
    relevantKeys.forEach(key => {
      const val = blackboard[key];
      c += `- **${key}**: ${typeof val === "object" ? JSON.stringify(val) : String(val)}\n`;
    });
    c += "\n";
  }

  // Execution Trace
  c += isMd ? `## 04. Execution Trace\n\n` : `EXECUTION TRACE\n${sep}\n\n`;

  // Resources
  if (attachedAssets.length > 0 || attachedTemplates.length > 0) {
    c += isMd ? `## 05. Mission Resources\n\n` : `MISSION RESOURCES\n${sep}\n\n`;
    if (attachedAssets.length > 0) {
      c += isMd ? `### Knowledge Assets\n` : `Knowledge Assets:\n`;
      attachedAssets.forEach((a: any) => {
        c += `- ${a.assetName || "Unknown"} (${a.purpose})${a.assetType ? ` [${a.assetType}]` : ""}\n`;
      });
      c += "\n";
    }
    if (attachedTemplates.length > 0) {
      c += isMd ? `### Document Templates\n` : `Document Templates:\n`;
      attachedTemplates.forEach((t: any) => {
        c += `- ${t.templateName || "Unknown"} (${t.role})${t.templateType ? ` [${t.templateType}]` : ""}\n`;
      });
      c += "\n";
    }
    if (fileAttachments.length > 0) {
      c += isMd ? `### Direct Attachments\n` : `Direct Attachments:\n`;
      fileAttachments.forEach((f: any) => {
        c += `- ${f.fileName} (${f.purpose}) [${(f.fileSize / 1024).toFixed(1)} KB]\n`;
      });
      c += "\n";
    }
  }

  // Dynamic trace vs standard steps
  if (mission?.executionStrategy === "dynamic_autonomous" && Array.isArray(run?.dynamicTrace)) {
    run.dynamicTrace.forEach((trace: any, idx: number) => {
      c += isMd
        ? `### CYCLE EVENT ${idx + 1}: ${trace.event || "Unknown"}\n`
        : `CYCLE EVENT ${idx + 1}: ${trace.event || "Unknown"}\n`;
      c += `Type: ${trace.type}\nTimestamp: ${trace.timestamp ? new Date(trace.timestamp).toLocaleString() : "N/A"}\n\n`;
      if (trace.error) c += `Error: ${trace.error}\n\n`;
      if (trace.note) c += `${trace.note}\n\n`;
      if (trace.data) {
        c += isMd ? `#### Event Data\n` : `EVENT DATA:\n`;
        if (typeof trace.data === "string") {
          c += `${trace.data}\n\n`;
        } else {
          const json = JSON.stringify(trace.data, null, 2);
          c += isMd ? `\`\`\`json\n${json}\n\`\`\`\n\n` : `${json}\n\n`;
        }
      }
      c += isMd ? `---\n\n` : `${sep}\n\n`;
    });
  } else {
    stepsData?.forEach((step: any) => {
      c += isMd
        ? `### PHASE ${step.stepOrder}: ${step.jobName || "Unknown Module"}\n`
        : `PHASE ${step.stepOrder}: ${step.jobName || "Unknown Module"}\n`;
      c += `Status: ${step.status}\nTimestamp: ${step.executedAt ? new Date(step.executedAt).toLocaleString() : "N/A"}\n\n`;
      if (step.error) c += `Error: ${step.error}\n\n`;
      if (step.output) {
        if (typeof step.output === "string") {
          c += `${step.output}\n\n`;
        } else {
          const json = JSON.stringify(step.output, null, 2);
          c += isMd ? `\`\`\`json\n${json}\n\`\`\`\n\n` : `${json}\n\n`;
        }
      }
      c += isMd ? `---\n\n` : `${sep}\n\n`;
    });
  }

  // Approvals
  const approvalItems = (timeline || []).filter((t: any) => t.type === "approval");
  if (approvalItems.length > 0) {
    c += isMd ? `## 06. Approval & Decision History\n\n` : `APPROVAL & DECISION HISTORY\n${sep}\n\n`;
    approvalItems.forEach((a: any) => {
      c += `- **${a.formName || "Decision"}**: ${a.status.toUpperCase()} (${new Date(a.createdAt).toLocaleString()})\n`;
      if (a.decision) c += `  - Decision: ${a.decision}\n`;
      if (a.comments) c += `  - Comments: ${a.comments}\n`;
      c += "\n";
    });
  }

  return c;
}

/**
 * Generate and download a mission run report in the requested format.
 * Returns a human-readable label for toast notifications.
 */
export function exportMissionRunReport(params: ExportReportParams): string {
  const { format, run } = params;

  if (format === "json") {
    const data = buildJsonReport(params);
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      `ODDJOB_REPORT_RUN_${run.id}.json`
    );
  } else {
    const content = buildTextReport(params);
    const mimeType = format === "md" ? "text/markdown" : "text/plain";
    downloadBlob(
      new Blob([content], { type: mimeType }),
      `ODDJOB_REPORT_RUN_${run.id}.${format}`
    );
  }

  const labels: Record<string, string> = { md: "Markdown", txt: "Plain Text", json: "JSON" };
  return labels[format];
}
