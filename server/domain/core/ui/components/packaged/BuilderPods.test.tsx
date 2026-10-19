import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import PipelineBuilderPod from "./PipelineBuilderPod.js";
import DatasetSchemaPod from "./DatasetSchemaPod.js";
import DocumentDeckPod from "./DocumentDeckPod.js";
import OntologyLinkTypePod, { type ObjectTypeView } from "./OntologyLinkTypePod.js";
import OntologyObjectTypePod from "./OntologyObjectTypePod.js";
import OntologyActionTypePod from "./OntologyActionTypePod.js";
import ProjectPlanningPod from "./ProjectPlanningPod.js";
import DecisionMatrixPod from "./DecisionMatrixPod.js";
import AgentUpskillingPod from "./AgentUpskillingPod.js";
import ToolScaffoldPod from "./ToolScaffoldPod.js";
import AgenticHRPod from "./AgenticHRPod.js";
import HILGovernancePod from "./HILGovernancePod.js";
import MissionBriefPod from "./MissionBriefPod.js";
import ScaffoldPackPod from "./ScaffoldPackPod.js";
import { dispatchPodEvent } from "./pod-event-bus.js";
import { packagedComponentNames } from "./registry.js";
import { ASSEMBLY_TOOLS } from "../../../../tools/v1/capabilities/assembly-tools.js";

describe("Pre-Populated Builder Pods Suite", () => {
  it("renders PipelineBuilderPod with pre-populated custom steps from chat context", () => {
    const onComplete = vi.fn();
    const customSteps = [
      { id: "s-1", name: "Intake Tip Calculator Payload", type: "data_extract" as const, celCondition: "payload.bill > 0" },
      { id: "s-2", name: "Geocode Restaurant Venue", type: "custom_tool" as const, toolName: "geocoding_service" },
      { id: "s-3", name: "Insert Dataset Record", type: "action_dispatch" as const, toolName: "add_dataset_items" }
    ];

    render(
      <PipelineBuilderPod
        stageId="stage-pipeline-ingest"
        pipelineName="Tip Calculator Settlement Pipeline"
        steps={customSteps}
        trigger="webhook"
        onStageComplete={onComplete}
      />
    );

    expect(screen.getByText("Tip Calculator Settlement Pipeline")).toBeDefined();
    expect(screen.getByText("Intake Tip Calculator Payload")).toBeDefined();
    expect(screen.getByText("Geocode Restaurant Venue")).toBeDefined();
    expect(screen.getByText("Insert Dataset Record")).toBeDefined();

    // Confirm step configuration
    const confirmBtn = screen.getByTestId("pipeline-builder-confirm");
    fireEvent.click(confirmBtn);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].steps).toHaveLength(3);
    expect(onComplete.mock.calls[0][0].steps[0].name).toBe("Intake Tip Calculator Payload");
  });

  it("renders DatasetSchemaPod with pre-populated custom columns from intake form", () => {
    const onComplete = vi.fn();
    const customFields = [
      { id: "f-1", name: "id", type: "uuid" as const, isPrimary: true, isNullable: false },
      { id: "f-2", name: "bill_amount", type: "integer" as const, isNullable: false },
      { id: "f-3", name: "location_address", type: "text" as const, isNullable: false },
      { id: "f-4", name: "total_amount", type: "integer" as const, isNullable: false },
      { id: "f-5", name: "created_at", type: "timestamp" as const, isNullable: false }
    ];

    render(
      <DatasetSchemaPod
        stageId="stage-dataset-receipts"
        tableName="expense_receipt_records"
        fields={customFields}
        enableVectorSearch={true}
        onStageComplete={onComplete}
      />
    );

    expect(screen.getByDisplayValue("expense_receipt_records")).toBeDefined();
    expect(screen.getByText("location_address")).toBeDefined();
    expect(screen.getByText("total_amount")).toBeDefined();

    // Confirm dataset configuration
    const confirmBtn = screen.getByTestId("dataset-schema-confirm");
    fireEvent.click(confirmBtn);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].tableName).toBe("expense_receipt_records");
    expect(onComplete.mock.calls[0][0].fields).toHaveLength(5);
  });

  it("renders DocumentDeckPod prefilled from the archetype and returns the deck config", () => {
    const onComplete = vi.fn();
    render(
      <DocumentDeckPod
        stageId="stage-presentation_deck_studio"
        defaultMissionTitle="Q3 Platform Review"
        defaultDeliverables={["Executive Summary", "Metrics Appendix"]}
        onStageComplete={onComplete}
      />
    );

    // Prefills from the props the chat panel actually passes.
    expect(screen.getByDisplayValue("Q3 Platform Review")).toBeDefined();
    expect(screen.getByText(/Executive Summary/)).toBeDefined();
    expect(screen.getByText(/Metrics Appendix/)).toBeDefined();

    fireEvent.click(screen.getByTestId("document-deck-confirm"));

    expect(onComplete).toHaveBeenCalledTimes(1);
    const payload = onComplete.mock.calls[0][0];
    expect(payload.deckTitle).toBe("Q3 Platform Review");
    expect(payload.sections).toEqual(["Executive Summary", "Metrics Appendix"]);
    expect(payload.formats).toContain("slide_deck");
  });

  it("keeps at least one output format selected", () => {
    // An empty format set gives the room no deliverable to produce, so the
    // directive would read as a no-op.
    const onComplete = vi.fn();
    render(<DocumentDeckPod defaultFormats={["pdf"]} onStageComplete={onComplete} />);

    fireEvent.click(screen.getByText("PDF"));
    fireEvent.click(screen.getByTestId("document-deck-confirm"));

    expect(onComplete.mock.calls[0][0].formats).toEqual(["pdf"]);
  });

  describe("OntologyLinkTypePod", () => {
    const OBJECT_TYPES: ObjectTypeView[] = [
      {
        name: "App Deployment",
        properties: { id: "integer", appId: "integer", status: "string" },
      },
      { name: "App", properties: { id: "integer", name: "string", projectId: "integer" } },
    ];

    it("offers only properties the chosen source type actually has", () => {
      render(<OntologyLinkTypePod objectTypes={OBJECT_TYPES} onStageComplete={vi.fn()} />);

      fireEvent.change(screen.getByTestId("link-source-type"), { target: { value: "App Deployment" } });

      const propSelect = screen.getByTestId("link-source-property") as HTMLSelectElement;
      const offered = Array.from(propSelect.options).map((o) => o.value).filter(Boolean);
      // App Deployment's properties, and specifically NOT App's projectId — a link
      // declared on a property the source lacks resolves to nothing, forever.
      expect(offered).toEqual(["id", "appId", "status"]);
      expect(offered).not.toContain("projectId");
    });

    it("clears a property that the newly chosen source type does not have", () => {
      render(<OntologyLinkTypePod objectTypes={OBJECT_TYPES} onStageComplete={vi.fn()} />);

      fireEvent.change(screen.getByTestId("link-source-type"), { target: { value: "App Deployment" } });
      fireEvent.change(screen.getByTestId("link-source-property"), { target: { value: "appId" } });
      expect((screen.getByTestId("link-source-property") as HTMLSelectElement).value).toBe("appId");

      fireEvent.change(screen.getByTestId("link-source-type"), { target: { value: "App" } });
      expect((screen.getByTestId("link-source-property") as HTMLSelectElement).value).toBe("");
    });

    it("returns both directions of the relationship on confirm", () => {
      const onComplete = vi.fn();
      render(<OntologyLinkTypePod objectTypes={OBJECT_TYPES} onStageComplete={onComplete} />);

      fireEvent.change(screen.getByTestId("link-source-type"), { target: { value: "App Deployment" } });
      fireEvent.change(screen.getByTestId("link-target-type"), { target: { value: "App" } });
      fireEvent.change(screen.getByTestId("link-source-property"), { target: { value: "appId" } });
      fireEvent.change(screen.getByTestId("link-name"), { target: { value: "deploys" } });
      fireEvent.change(screen.getByTestId("link-inverse-name"), { target: { value: "deployed_by" } });

      expect(screen.getByTestId("link-preview").textContent).toContain("App Deployment --deploys--> App");

      fireEvent.click(screen.getByTestId("ontology-link-type-confirm"));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete.mock.calls[0][0]).toMatchObject({
        sourceType: "App Deployment",
        targetType: "App",
        sourceProperty: "appId",
        linkName: "deploys",
        inverseName: "deployed_by",
      });
    });

    it("cannot be confirmed as polymorphic until the discriminator and a mapping are given", () => {
      // defineLinkType REJECTS a link with no target type unless it is told which
      // property names the target's type and what its values mean. Leaving the
      // target blank without those produces a declaration the service can never
      // accept, so the pod must not let it be confirmed.
      const onComplete = vi.fn();
      render(<OntologyLinkTypePod objectTypes={OBJECT_TYPES} onStageComplete={onComplete} />);

      fireEvent.change(screen.getByTestId("link-source-type"), { target: { value: "App Deployment" } });
      fireEvent.change(screen.getByTestId("link-source-property"), { target: { value: "appId" } });
      fireEvent.change(screen.getByTestId("link-name"), { target: { value: "points_at" } });
      fireEvent.change(screen.getByTestId("link-inverse-name"), { target: { value: "pointed_at_by" } });

      // Target left blank => polymorphic, and nothing identifies the target's type yet.
      expect((screen.getByTestId("ontology-link-type-confirm") as HTMLButtonElement).disabled).toBe(true);

      fireEvent.change(screen.getByTestId("link-target-type-property"), { target: { value: "status" } });
      // Discriminator alone is still not enough — its values must map to real types.
      expect((screen.getByTestId("ontology-link-type-confirm") as HTMLButtonElement).disabled).toBe(true);

      fireEvent.change(screen.getByTestId("link-type-map-value-0"), { target: { value: "live" } });
      fireEvent.change(screen.getByTestId("link-type-map-type-0"), { target: { value: "App" } });

      const confirm = screen.getByTestId("ontology-link-type-confirm") as HTMLButtonElement;
      expect(confirm.disabled).toBe(false);
      fireEvent.click(confirm);

      expect(onComplete.mock.calls[0][0]).toMatchObject({
        targetType: null,
        targetTypeProperty: "status",
        targetTypeMap: { live: "App" },
      });
    });

    it("offers the discriminator only from the source type's own properties", () => {
      render(<OntologyLinkTypePod objectTypes={OBJECT_TYPES} onStageComplete={vi.fn()} />);
      fireEvent.change(screen.getByTestId("link-source-type"), { target: { value: "App Deployment" } });

      const select = screen.getByTestId("link-target-type-property") as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.value).filter(Boolean)).toEqual([
        "id",
        "appId",
        "status",
      ]);
    });

    it("drops the polymorphic fields once a concrete target type is chosen", () => {
      const onComplete = vi.fn();
      render(<OntologyLinkTypePod objectTypes={OBJECT_TYPES} onStageComplete={onComplete} />);

      fireEvent.change(screen.getByTestId("link-source-type"), { target: { value: "App Deployment" } });
      fireEvent.change(screen.getByTestId("link-source-property"), { target: { value: "appId" } });
      fireEvent.change(screen.getByTestId("link-target-type-property"), { target: { value: "status" } });
      fireEvent.change(screen.getByTestId("link-type-map-value-0"), { target: { value: "live" } });
      fireEvent.change(screen.getByTestId("link-type-map-type-0"), { target: { value: "App" } });

      // Picking a real target makes the link monomorphic; sending the leftover map
      // would have the service store a discriminator for a link that has none.
      fireEvent.change(screen.getByTestId("link-target-type"), { target: { value: "App" } });
      expect(screen.queryByTestId("link-polymorphic")).toBeNull();

      fireEvent.change(screen.getByTestId("link-name"), { target: { value: "deploys" } });
      fireEvent.change(screen.getByTestId("link-inverse-name"), { target: { value: "deployed_by" } });
      fireEvent.click(screen.getByTestId("ontology-link-type-confirm"));

      const payload = onComplete.mock.calls[0][0];
      expect(payload.targetType).toBe("App");
      expect(payload.targetTypeProperty).toBeUndefined();
      expect(payload.targetTypeMap).toBeUndefined();
    });

    it("cannot be confirmed until a source, property and both names are set", () => {
      const onComplete = vi.fn();
      render(<OntologyLinkTypePod objectTypes={OBJECT_TYPES} onStageComplete={onComplete} />);

      const confirm = screen.getByTestId("ontology-link-type-confirm") as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      fireEvent.click(confirm);
      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  it("every pod mount_builder_pod advertises resolves in the packaged registry", () => {
    // The registry globs ./*.tsx in THIS directory only. `presentation_deck_studio`
    // pointed at DocumentPresentationViewer, which lives elsewhere, so the unit
    // mounted "Component isn't available to render" — a silent dead end that no
    // test caught. Anything the tool names must exist here.
    const advertised = new Set(
      (ASSEMBLY_TOOLS.mount_builder_pod.description.match(/\b\w+Pod\b/g) ?? []),
    );
    const available = packagedComponentNames();

    expect(advertised.size).toBeGreaterThan(0);
    for (const pod of advertised) {
      expect(available, `${pod} is advertised by mount_builder_pod but not in packaged/`).toContain(pod);
    }
  });

  it("resolves CrewDecisionMatrixRail from the packaged registry for chat-inline instant app rendering", () => {
    const available = packagedComponentNames();
    expect(available).toContain("CrewDecisionMatrixRail");
    expect(available).toContain("DecisionMatrixPod");
  });

  it("mount_builder_pod tool accepts and preserves custom pre-populated props", async () => {
    const mountTool = ASSEMBLY_TOOLS.mount_builder_pod;
    const result = await mountTool.execute({
      podComponent: "PipelineBuilderPod",
      stageId: "stage-finance",
      title: "Finance Pipeline Builder",
      props: {
        pipelineName: "Tip Splitter Pipeline",
        steps: [
          { id: "step-1", name: "Extract Tip & Bill", type: "data_extract" },
          { id: "step-2", name: "Save to Dataset", type: "action_dispatch" }
        ]
      }
    }, {} as any);

    expect(result.success).toBe(true);
    expect(result.props.stageId).toBe("stage-finance");
    expect(result.props.pipelineName).toBe("Tip Splitter Pipeline");
    expect(result.props.steps).toHaveLength(2);
  });

  it("propose_app_draft saves application draft and returns approval request marker", async () => {
    const proposeAppTool = ASSEMBLY_TOOLS.propose_app_draft;
    const resultJson = await proposeAppTool.execute({
      name: "Tip Splitter & Location App",
      description: "Calculates tip with location mapping and sends to pipeline",
      blueprintSlug: "calculator-pipeline",
      components: ["PlatformFormBlock", "PlatformPipelineTriggerBlock"],
      pipelineIds: [12],
    }, { organizationId: 1, userId: "user-test" } as any);

    const parsed = JSON.parse(resultJson);
    expect(parsed.type).toBe("approval_request");
    expect(parsed.kind).toBe("app_draft");
    expect(parsed.appName).toBe("Tip Splitter & Location App");
    expect(parsed.pipelineIds).toEqual([12]);
    expect(parsed.status).toBe("draft_saved");
    expect(parsed.href).toContain("/apps/forge?draftId=");
  });

  it("refuses the retired FullStackAssemblyPod and points to Form Studio", async () => {
    const result = await ASSEMBLY_TOOLS.mount_builder_pod.execute({ podComponent: "FullStackAssemblyPod", props: {} } as any, { organizationId: 1 } as any);
    expect(result.success).toBe(false);
    expect(result.message).toContain("mount_form_studio");
  });

  it("synthesize_fullstack_spec infers 5-layer spec from fields", async () => {
    const synthTool = ASSEMBLY_TOOLS.synthesize_fullstack_spec;
    const result = await synthTool.execute({
      appName: "Expense Logger",
      description: "Logs travel expenses with GPS and receipts",
      fields: [
        { name: "amount", type: "number", label: "Expense Amount" },
        { name: "location", type: "location", label: "Store Location" },
        { name: "reimbursable", type: "boolean", label: "Is Reimbursable" }
      ],
      projectKey: "finance"
    }, {} as any);

    expect(result.success).toBe(true);
    expect(result.appName).toBe("Expense Logger");
    expect(result.tableName).toBe("expense_logger_records");
    expect(result.datasetFields.some((f: any) => f.name === "amount" && f.type === "numeric")).toBe(true);
    expect(result.datasetFields.some((f: any) => f.name === "location" && f.type === "jsonb")).toBe(true);
    expect(result.datasetFields.some((f: any) => f.name === "reimbursable" && f.type === "boolean")).toBe(true);
    expect(result.pipelineSteps).toHaveLength(3);
  });

  it("renders OntologyObjectTypePod and submits structured object type payload", () => {
    const onComplete = vi.fn();
    render(
      <OntologyObjectTypePod
        stageId="stage-obj-test"
        defaultName="IncidentReport"
        defaultDescription="Operational system incident"
        onStageComplete={onComplete}
      />
    );

    expect(screen.getByText("Define an Ontology Object Type")).toBeDefined();
    expect(screen.getAllByDisplayValue("IncidentReport").length).toBeGreaterThan(0);

    const declareBtn = screen.getByRole("button", { name: /Declare Object Type/i });
    fireEvent.click(declareBtn);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const payload = onComplete.mock.calls[0][0];
    expect(payload.objectTypeName).toBe("IncidentReport");
    expect(payload.primaryKeyProperty).toBe("id");
    expect(payload.properties.id).toBe("string");
    expect(payload.properties.name).toBe("string");
  });

  it("renders OntologyActionTypePod and submits structured action type payload with HIL governance", () => {
    const onComplete = vi.fn();
    render(
      <OntologyActionTypePod
        stageId="stage-action-test"
        defaultActionName="RestartKubernetesPod"
        defaultTargetObjectType="Microservice"
        onStageComplete={onComplete}
      />
    );

    expect(screen.getByText("Configure an Ontology Action Type")).toBeDefined();
    expect(screen.getAllByDisplayValue("RestartKubernetesPod").length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("Microservice")).toBeDefined();

    const declareBtn = screen.getByRole("button", { name: /Declare Action Type/i });
    fireEvent.click(declareBtn);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const payload = onComplete.mock.calls[0][0];
    expect(payload.actionName).toBe("RestartKubernetesPod");
    expect(payload.targetObjectType).toBe("Microservice");
    expect(payload.requiresApproval).toBe(true);
    expect(payload.approverRole).toBe("Security Officer");
  });

  it("renders ProjectPlanningPod with pre-populated custom waves and hybrid assignments", () => {
    const onComplete = vi.fn();
    const customWaves = [
      {
        id: "w-1",
        name: "Security Architecture Assessment",
        waveNumber: 1,
        objective: "Scan existing microservices and map X-Ray composition",
        isCriticalPath: true,
        estimatedDurationHours: 10,
        assignee: {
          type: "agent" as const,
          name: "Security Sentinel",
          role: "AppSec Bot",
          competency: "Static Analysis",
          estimatedCostUsd: 1.25,
        },
      },
      {
        id: "w-2",
        name: "CISO Review & Rollout",
        waveNumber: 2,
        objective: "Final human authorization and credential provisioning",
        isCriticalPath: true,
        estimatedDurationHours: 4,
        assignee: {
          type: "human" as const,
          name: "Chief Information Security Officer",
          role: "Executive Lead",
          competency: "Executive Oversight",
          estimatedCostUsd: 0.0,
        },
      },
    ];

    render(
      <ProjectPlanningPod
        stageId="stage-plan-test"
        title="Custom Hybrid Planning Pod"
        projectTitle="SOC2 Automated Enforcement"
        objective="Execute hybrid SOC2 migration"
        waves={customWaves}
        defaultBudgetLimitUsd={500.0}
        defaultTokenLimit={3000000}
        onStageComplete={onComplete}
      />
    );

    expect(screen.getByTestId("project-planning-pod")).toBeDefined();
    expect(screen.getByText("Custom Hybrid Planning Pod")).toBeDefined();
    expect(screen.getByText("Security Architecture Assessment")).toBeDefined();
    expect(screen.getByText("CISO Review & Rollout")).toBeDefined();
    expect(screen.getByText("$500.00 USD")).toBeDefined();

    // Trigger Commit & Launch Cycle
    const commitBtn = screen.getByText("Commit & Launch Cycle");
    fireEvent.click(commitBtn);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].waves).toHaveLength(2);
    expect(onComplete.mock.calls[0][0].projectTitle).toBe("SOC2 Automated Enforcement");
    expect(onComplete.mock.calls[0][0].budgetLimitUsd).toBe(500.0);
  });

  it("renders DecisionMatrixPod with candidates, computes weighted totals, and ratifies decision", () => {
    const onComplete = vi.fn();
    const customCandidates = [
      {
        id: "opt-1",
        name: "Option A: Event-Driven Kafka",
        scores: { latency: 9, cost: 6 },
        pros: ["High throughput"],
        cons: ["Complex operations"],
      },
      {
        id: "opt-2",
        name: "Option B: Synchronous REST",
        scores: { latency: 5, cost: 9 },
        pros: ["Simple DX"],
        cons: ["Bottleneck under load"],
      },
    ];
    const customCriteria = [
      { key: "latency", label: "Latency", weight: 2.0 },
      { key: "cost", label: "Cost Efficiency", weight: 1.0 },
    ];
    const customStances = [
      {
        agentName: "Infra-Lead",
        preferredCandidateId: "opt-1",
        confidence: 95,
        rationale: "Option A scales reliably under high volume.",
      },
    ];

    render(
      <DecisionMatrixPod
        stageId="stage-architecture-decide"
        topic="Ingestion Message Bus Evaluation"
        candidates={customCandidates}
        criteria={customCriteria}
        personaStances={customStances}
        consensusPercentage={85}
        onStageComplete={onComplete}
      />
    );

    // Verify title, candidates, and stances rendered
    expect(screen.getByText("Decision Matrix: Ingestion Message Bus Evaluation")).toBeDefined();
    expect(screen.getAllByText("Option A: Event-Driven Kafka").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Option B: Synchronous REST").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Infra-Lead")).toBeDefined();
    expect(screen.getByText("95% Confidence")).toBeDefined();

    // Option A weighted score: (9*2 + 6*1) / 3 = 24 / 3 = 8.0
    // Option B weighted score: (5*2 + 9*1) / 3 = 19 / 3 = 6.3
    expect(screen.getAllByText("8 / 10").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("6.3 / 10").length).toBeGreaterThanOrEqual(1);

    // Click confirm button
    const ratifyBtn = screen.getByTestId("decision-matrix-confirm");
    fireEvent.click(ratifyBtn);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0][0];
    expect(result.selectedCandidateId).toBe("opt-1");
    expect(result.selectedCandidateName).toBe("Option A: Event-Driven Kafka");
    expect(result.topic).toBe("Ingestion Message Bus Evaluation");
    expect(result.consensusPercentage).toBe(85);
  });

  it("renders AgentUpskillingPod with error trajectory and ratifies competency promotion", () => {
    const onComplete = vi.fn();
    const customErrors = [
      {
        id: "err-test-1",
        toolName: "custom_parser",
        errorPattern: "Unexpected EOF in streaming token response",
        occurredCount: 5,
        severity: "high" as const,
      },
    ];

    render(
      <AgentUpskillingPod
        stageId="stage-upskill-test"
        agentId="agent-parser-09"
        agentName="Stream Parser Bot"
        targetCompetency="Resilient Streaming Ingestion"
        currentProficiency={3}
        recentErrors={customErrors}
        canaryScore={98.0}
        onStageComplete={onComplete}
      />
    );

    expect(screen.getByTestId("agent-upskilling-pod")).toBeDefined();
    expect(screen.getByText("Agent Upskilling: Stream Parser Bot")).toBeDefined();
    expect(screen.getByText("Target: Resilient Streaming Ingestion")).toBeDefined();
    expect(screen.getByText("Unexpected EOF in streaming token response")).toBeDefined();
    expect(screen.getByText("98%")).toBeDefined();

    // Switch strategy to Tier 2: Golden Samples
    const samplesStrategy = screen.getByTestId("strategy-samples");
    fireEvent.click(samplesStrategy);

    // Click confirm button
    const ratifyBtn = screen.getByTestId("agent-upskilling-confirm");
    fireEvent.click(ratifyBtn);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const payload = onComplete.mock.calls[0][0];
    expect(payload.agentId).toBe("agent-parser-09");
    expect(payload.agentName).toBe("Stream Parser Bot");
    expect(payload.targetCompetency).toBe("Resilient Streaming Ingestion");
    expect(payload.promotedProficiency).toBe(4); // 3 + 1 = 4
    expect(payload.strategy).toBe("golden_samples");
    expect(payload.canaryScore).toBe(98.0);
  });

  it("renders ToolScaffoldPod with custom parameters and publishes new tool payload", () => {
    const onComplete = vi.fn();
    const customParams = [
      {
        id: "p-test-1",
        name: "incident_id",
        type: "string" as const,
        required: true,
        description: "Primary incident ticket ID",
      },
      {
        id: "p-test-2",
        name: "severity_code",
        type: "number" as const,
        required: false,
        description: "Numeric severity level 1-5",
      },
    ];

    render(
      <ToolScaffoldPod
        stageId="stage-tool-test"
        initialToolName="pagerduty_incident_escalate"
        initialDescription="Escalates critical production incidents to on-call duty engineer."
        initialMethod="POST"
        initialEndpointUrl="https://api.pagerduty.com/v2/escalations"
        initialAuthType="vault_ref"
        initialParameters={customParams}
        onStageComplete={onComplete}
      />
    );

    expect(screen.getByTestId("tool-scaffold-pod")).toBeDefined();
    expect(screen.getByText("Tool Forge: pagerduty_incident_escalate")).toBeDefined();
    expect(screen.getByDisplayValue("https://api.pagerduty.com/v2/escalations")).toBeDefined();
    expect(screen.getByDisplayValue("incident_id")).toBeDefined();
    expect(screen.getByDisplayValue("severity_code")).toBeDefined();

    // Run sandbox test
    const sandboxBtn = screen.getByTestId("tool-sandbox-run");
    fireEvent.click(sandboxBtn);
    expect(screen.getByText("HTTP 200 OK")).toBeDefined();

    // Click publish button
    const publishBtn = screen.getByTestId("tool-scaffold-confirm");
    fireEvent.click(publishBtn);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const payload = onComplete.mock.calls[0][0];
    expect(payload.toolName).toBe("pagerduty_incident_escalate");
    expect(payload.method).toBe("POST");
    expect(payload.endpointUrl).toBe("https://api.pagerduty.com/v2/escalations");
    expect(payload.parameters).toHaveLength(2);
    expect(payload.parameters[0].name).toBe("incident_id");
  });

  it("renders AgenticHRPod and allocates roster with autonomy tiers and W3C tracing", () => {
    const onComplete = vi.fn();
    render(
      <AgenticHRPod
        stageId="stage-test-hr"
        defaultRoster={["agent-sentinel", "agent-copilot"]}
        onStageComplete={onComplete}
      />
    );

    expect(screen.getByTestId("agentic-hr-pod")).toBeDefined();
    expect(screen.getByText("Sentinel Custodian")).toBeDefined();
    expect(screen.getByText("Oddjob Copilot")).toBeDefined();

    // Toggle another agent via two-way event bus
    act(() => {
      dispatchPodEvent("stage-test-hr", "toggle-agent", { agentId: "agent-forensic" }, "CrewChat");
    });

    // Confirm roster
    const confirmBtn = screen.getByTestId("agentic-hr-confirm");
    fireEvent.click(confirmBtn);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0][0];
    expect(result.stageId).toBe("stage-test-hr");
    expect(result.assignedRoster.length).toBeGreaterThanOrEqual(3);
    expect(result._trace).toBeDefined();
    expect(result._trace.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it("renders HILGovernancePod and enforces SLA escalation and WebAuthn gates", () => {
    const onComplete = vi.fn();
    render(
      <HILGovernancePod
        stageId="stage-test-hil"
        defaultApproverRole="security_lead"
        defaultQuorum="multi_sig_2_of_3"
        defaultSlaMinutes={30}
        onStageComplete={onComplete}
      />
    );

    expect(screen.getByTestId("hil-governance-pod")).toBeDefined();
    expect(screen.getByText("Multi-Signature (2 of 3 Approvers)")).toBeDefined();
    expect(screen.getByText("Auto-Quarantine Execution (Fail-Safe)")).toBeDefined();

    // Update role via event bus
    act(() => {
      dispatchPodEvent("stage-test-hil", "set-role", { role: "compliance_officer" }, "CrewChat");
    });

    const confirmBtn = screen.getByTestId("hil-governance-confirm");
    fireEvent.click(confirmBtn);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0][0];
    expect(result.approverRole).toBe("compliance_officer");
    expect(result.quorum).toBe("multi_sig_2_of_3");
    expect(result.requireWebAuthn).toBe(true);
    expect(result._trace?.traceparent).toBeDefined();
  });

  it("renders MissionBriefPod with typed deliverables, suggested chips, and spend caps", () => {
    const onComplete = vi.fn();
    render(
      <MissionBriefPod
        stageId="stage-test-brief"
        defaultMissionTitle="Incident Triage & Hotfix Deploy"
        defaultDeliverables={["Audit Telemetry", "Deploy Container"]}
        defaultBudgetUsd={45.0}
        onStageComplete={onComplete}
      />
    );

    expect(screen.getByTestId("mission-brief-pod")).toBeDefined();
    expect(screen.getByDisplayValue("Incident Triage & Hotfix Deploy")).toBeDefined();
    expect(screen.getByText(/\$45.*USD/)).toBeDefined();

    // Add deliverable via prompt suggestion chip or event
    act(() => {
      dispatchPodEvent("stage-test-brief", "add-deliverable", {
        title: "Verify W3C Lineage",
        verificationMethod: "automated_test"
      }, "CrewChat");
    });

    expect(screen.getByText("Verify W3C Lineage")).toBeDefined();

    const confirmBtn = screen.getByTestId("mission-brief-confirm");
    fireEvent.click(confirmBtn);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0][0];
    expect(result.missionTitle).toBe("Incident Triage & Hotfix Deploy");
    expect(result.deliverables).toHaveLength(3);
    expect(result.maxBudgetUsd).toBe(45.0);
    expect(result._trace?.traceparent).toBeDefined();
  });

  it("renders ScaffoldPackPod with dependency auto-resolution and telemetry footprint", () => {
    const onComplete = vi.fn();
    render(
      <ScaffoldPackPod
        stageId="stage-test-packs"
        defaultSelectedPacks={["core-fastapi-python"]}
        onStageComplete={onComplete}
      />
    );

    expect(screen.getByTestId("scaffold-pack-pod")).toBeDefined();
    expect(screen.getByText("Python FastAPI Core")).toBeDefined();

    // Selecting agent-langgraph should auto-resolve core-fastapi-python requirement
    act(() => {
      dispatchPodEvent("stage-test-packs", "toggle-pack", { packId: "agent-langgraph" }, "CrewChat");
    });

    const confirmBtn = screen.getByTestId("scaffold-pack-confirm");
    fireEvent.click(confirmBtn);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0][0];
    expect(result.selectedPackIds).toContain("agent-langgraph");
    expect(result.selectedPackIds).toContain("core-fastapi-python");
    expect(result.telemetryFootprint?.estimatedRamMb).toBeGreaterThan(0);
    expect(result._trace?.traceparent).toBeDefined();
  });

  it("renders OntologyLinkTypePod with M2M junction table scaffolding", () => {
    const onComplete = vi.fn();
    const objectTypes: ObjectTypeView[] = [
      { name: "Project", properties: { id: "integer", title: "string" } },
      { name: "Collaborator", properties: { id: "integer", email: "string", projectId: "integer" } }
    ];

    render(
      <OntologyLinkTypePod
        stageId="stage-test-link"
        objectTypes={objectTypes}
        onStageComplete={onComplete}
      />
    );

    fireEvent.change(screen.getByTestId("link-source-type"), { target: { value: "Project" } });
    fireEvent.change(screen.getByTestId("link-target-type"), { target: { value: "Collaborator" } });
    fireEvent.change(screen.getByTestId("link-source-property"), { target: { value: "id" } });
    fireEvent.change(screen.getByTestId("link-name"), { target: { value: "has_collaborators" } });
    fireEvent.change(screen.getByTestId("link-inverse-name"), { target: { value: "collaborates_on" } });

    // Set cardinality to M:N
    act(() => {
      dispatchPodEvent("stage-test-link", "set-cardinality", { cardinality: "many_to_many" }, "CrewChat");
    });

    expect(screen.getByText(/Scaffolding Junction Table:/i)).toBeDefined();

    const confirmBtn = screen.getByTestId("ontology-link-type-confirm");
    fireEvent.click(confirmBtn);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0][0];
    expect(result.cardinality).toBe("many_to_many");
    expect(result.junctionTable).toBe("project_collaborator_links");
    expect(result._trace?.traceparent).toBeDefined();
  });
});

