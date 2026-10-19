import "dotenv/config";
import { db } from "../../server/database_service.js";
import { apps } from "../../shared/schema/apps.js";
import { eq } from "drizzle-orm";

async function updatePlan() {
  const plan = {
    overview: "Oddjob Tactical Rescue Dispatch & Spatial Telemetry Fabric. Assembled from modular Oddjob Component Gallery blocks with autonomous Eulerian H3 route breach prediction, real-time incident queue, and contractor management.",
    techStack: [
      "Next.js 14",
      "Tailwind CSS",
      "Oddjob Component Gallery",
      "Eulerian H3 Mesh",
      "PostgreSQL",
      "Framer Motion"
    ],
    integrationStrategy: "Direct integration with Oddjob Platform Datasets (/api/oddjob/datasets) and real-time incident event streaming.",
    uxDescription: "Industrial dark mode aesthetic with high-contrast surfaces, radar scanner overlays, and responsive metric cards.",
    phases: [
      {
        name: "Phase 1: Component Gallery Assembly",
        description: "Decompose monolithic dashboard into modular Component Gallery blocks.",
        tasks: [
          "Create TacticalDispatchQueueBlock with priority triage pills",
          "Create TacticalSquadStatusBlock with live integrity bars",
          "Create TacticalServiceProviderBlock with ETA counters",
          "Create TacticalCommsBroadcastBlock for emergency alerts",
          "Create TacticalSimulationControlBlock for What-If route matrix"
        ]
      },
      {
        name: "Phase 2: Live Proxy & Stylesheet Hardening",
        description: "Ensure Next.js preview proxy rewrites asset paths and delivers full CSS without referrer drop.",
        tasks: [
          "Prepend /forged/:slug/ to root-relative CSS links",
          "Set Referrer-Policy to no-referrer-when-downgrade",
          "Inject standard HSL theme tokens into globals.css"
        ]
      },
      {
        name: "Phase 3: Operational Fleet Telemetry",
        description: "Enable live container scaling and heartbeat monitoring on port 10009.",
        tasks: [
          "Bind Next.js daemon to assigned port",
          "Stream telemetry events to App Studio bridge",
          "Verify 10/10 target components in Component Gallery index"
        ]
      }
    ],
    waves: [
      {
        id: "wave-1",
        name: "Tactical Core Mesh",
        objective: "Radar scan, spatial coordinates, and industrial hero status bar",
        focus: ["IndustrialDashboardHero", "MetricGrid", "TacticalMapControl"]
      },
      {
        id: "wave-2",
        name: "Incident Triage & Operations",
        objective: "Priority incident queue, squad readiness, and contractor network",
        focus: ["TacticalDispatchQueueBlock", "TacticalSquadStatusBlock", "TacticalServiceProviderBlock"]
      },
      {
        id: "wave-3",
        name: "Emergency Broadcast & Forensics",
        objective: "Encrypted communications channel and sequential event log",
        focus: ["TacticalCommsBroadcastBlock", "StatusTimeline"]
      }
    ]
  };

  await db.update(apps).set({
    developmentPlan: plan,
    planReviewStatus: "approved"
  }).where(eq(apps.id, 824));

  console.log("✅ Successfully updated App 824 developmentPlan in database!");
  process.exit(0);
}

updatePlan().catch((err) => {
  console.error("Error updating plan:", err);
  process.exit(1);
});
