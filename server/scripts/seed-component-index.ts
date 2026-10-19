import { db } from "../database_service.js";
import { componentIndex } from "@shared/schema/index.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("SeedComponentIndex");

const SEED_COMPONENTS = [
  {
    componentName: "MetricSummaryCard",
    componentCategory: "ui-data-viz",
    exportType: "named",
    packageSource: "@oddjob/design-system",
    importPath: "@oddjob/design-system",
    propSchema: {
      title: "string",
      value: "string | number",
      trend: "string | undefined",
      status: "'healthy' | 'warning' | 'error' | undefined"
    },
    dependencies: ["@oddjob/design-system", "lucide-react"],
    codeSnippet: `<MetricSummaryCard title="System Throughput" value="1,240 req/s" trend="+12%" status="healthy" />`,
    blueprintTemplate: `<MetricSummaryCard title="{{title}}" value="{{value}}" {{#if trend}}trend="{{trend}}"{{/if}} {{#if status}}status="{{status}}"{{/if}} />`,
    effectivenessScore: "4.90",
    verificationSuccessRate: "100.00",
    isApprovedForAssembly: true,
  },
  {
    componentName: "DataTable",
    componentCategory: "ui-data-viz",
    exportType: "named",
    packageSource: "relative",
    importPath: "@domain-ui/core/ui/components/ui/data-table",
    propSchema: {
      columns: "ColumnDef[]",
      data: "TData[]",
      searchKey: "string | undefined"
    },
    dependencies: ["@tanstack/react-table", "lucide-react"],
    codeSnippet: `<DataTable columns={columns} data={records} searchKey="componentName" />`,
    blueprintTemplate: `<DataTable columns={columns} data={data} {{#if searchKey}}searchKey="{{searchKey}}"{{/if}} />`,
    effectivenessScore: "4.85",
    verificationSuccessRate: "98.50",
    isApprovedForAssembly: true,
  },
  {
    componentName: "PlatformAgentChatBlock",
    componentCategory: "ui-ai-workflow",
    exportType: "default",
    packageSource: "relative",
    importPath: "@domain-ui/core/ui/components/packaged/PlatformAgentChatBlock",
    propSchema: {
      agentId: "string",
      cycleId: "string",
      title: "string | undefined"
    },
    dependencies: ["framer-motion", "lucide-react"],
    codeSnippet: `<PlatformAgentChatBlock agentId="1" cycleId="global" title="Supervisor Intelligence" />`,
    blueprintTemplate: `<PlatformAgentChatBlock agentId="{{agentId}}" cycleId="{{cycleId}}" {{#if title}}title="{{title}}"{{/if}} />`,
    effectivenessScore: "4.95",
    verificationSuccessRate: "100.00",
    isApprovedForAssembly: true,
  },
  {
    componentName: "TacticalMap",
    componentCategory: "ui-data-viz",
    exportType: "default",
    packageSource: "relative",
    importPath: "@domain/rescue/ui/modules/rescue/components/TacticalMap",
    propSchema: {
      squads: "SquadMapItem[]",
      rescues: "RescueMapItem[]",
      providers: "ProviderMapItem[]"
    },
    dependencies: ["framer-motion", "lucide-react"],
    codeSnippet: `<TacticalMap squads={squads} rescues={rescues} providers={providers} />`,
    blueprintTemplate: `<TacticalMap squads={squads} rescues={rescues} providers={providers} />`,
    effectivenessScore: "4.75",
    verificationSuccessRate: "97.00",
    isApprovedForAssembly: true,
  },
  {
    componentName: "FastAPIHandler",
    componentCategory: "pattern-auth",
    exportType: "macro",
    packageSource: "server-domain",
    importPath: "fastapi",
    propSchema: {
      endpoint: "string",
      method: "'GET' | 'POST'",
      payloadType: "dict"
    },
    dependencies: ["fastapi", "uvicorn", "pydantic"],
    codeSnippet: `@app.post("/execute")\nasync def execute(payload: dict):\n    return {"status": "success", "data": payload}`,
    blueprintTemplate: `@app.{{method}}("{{endpoint}}")\nasync def {{handler_name}}(payload: dict):\n    result = {{process_fn}}(payload)\n    return {"status": "success", "data": result}`,
    effectivenessScore: "5.00",
    verificationSuccessRate: "100.00",
    isApprovedForAssembly: true,
  }
];

async function seedComponentIndex() {
  logger.info("[SeedComponentIndex] Seeding component library index...");
  
  for (const comp of SEED_COMPONENTS) {
    await db.insert(componentIndex)
      .values(comp as any)
      .onConflictDoUpdate({
        target: componentIndex.componentName,
        set: {
          componentCategory: comp.componentCategory,
          packageSource: comp.packageSource,
          importPath: comp.importPath,
          propSchema: comp.propSchema,
          dependencies: comp.dependencies,
          codeSnippet: comp.codeSnippet,
          blueprintTemplate: comp.blueprintTemplate,
          effectivenessScore: comp.effectivenessScore,
          updatedAt: new Date(),
        }
      });
    logger.info(`  [✓] Indexed: ${comp.componentName} (${comp.componentCategory})`);
  }
  
  logger.info("[SeedComponentIndex] Seeding complete.");
}

seedComponentIndex()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error(`[SeedComponentIndex] Failed: ${err.message}`);
    process.exit(1);
  });
