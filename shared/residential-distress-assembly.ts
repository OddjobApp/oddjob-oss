import {
  AssemblyBlueprintSchema,
  type AssemblyBlueprint,
  type AssemblyBlueprintInput,
} from "./schema/assembly-blueprint.js";

/**
 * 🏡 Residential Real Estate Distress Assembly Blueprint
 *
 * An autonomous 4-stage acquisition assembly running inside CREW:
 * 1. Spatial H3 Distress Radar: Filter by ZIP codes and multi-select distress signals (NOD, Auction, Tax Delinquent, Substandard, Probate).
 * 2. Mortgage Underwriting Loan Tape: Analyze note rates, remaining principal balances, and filter Subject-To viability (ANY/ALL match modes).
 * 3. Property Dossier & Zillow Photos: Synthesize public records, loan vintage, and listing imagery into Scribe Studio.
 * 4. Human-In-The-Loop (HIL) Sign-off Gate: Executive signoff before dispatching purchase offers.
 */
const rawBlueprint: AssemblyBlueprintInput = {
  id: "app-residential-distress-acquisition",
  name: "Residential Real Estate Distress Assembly",
  version: "1.0.0",
  category: "forged_app",
  description: "Autonomous 4-stage acquisition assembly across spatial discovery, mortgage note underwriting, and HIL offer governance.",
  capabilities: ["spatial_radar", "mortgage_tape", "property_dossier", "hil_governance"],
  layout: {
    type: "modal_wizard",
    defaultVisualization: "mermaid_flowchart",
  },
  stages: [
    {
      id: "spatial_radar",
      name: "Residential Distress Radar",
      description: "Interactive Uber H3 hexagonal map scanning Notice of Default (NOD), Scheduled Trustee Auctions, Tax Liens, Substandard housing, and Probate filings across target ZIP codes.",
      type: "screen_step",
      requires: [],
      provides: ["distressed_parcels"],
      conflicts: [],
      podComponent: "SignalStudioPod",
      responsibleAgentRole: "Acquisitions Director",
      defaultConfig: {},
      inputs: {},
      outputsSchema: {
        selectedZipCodes: { type: "array", items: { type: "string" } },
        activeCriteria: { type: "array", items: { type: "string" } },
        matchedParcelCount: { type: "number" },
        matchedParcels: { type: "array" },
      },
      transitions: [
        { targetStageId: "mortgage_tape", label: "Proceed to Mortgage Underwriting" },
      ],
      completionCriteria: {
        type: "form_submitted",
      },
    },
    {
      id: "mortgage_tape",
      name: "Mortgage Note Underwriting & Loan Tape",
      description: "Analyze primary note interest rates, remaining balances, loan vintages, and filter for Subject-To candidates with compound ANY/ALL matching.",
      type: "pipeline",
      requires: ["spatial_radar"],
      provides: ["underwritten_tape"],
      conflicts: [],
      podComponent: "MultiStepScreenContainer",
      responsibleAgentRole: "Underwriting Specialist",
      defaultConfig: {},
      inputs: {
        sourceParcels: {
          sourceStageId: "spatial_radar",
          outputKey: "matchedParcels",
        },
      },
      outputsSchema: {
        eligibleSubjectToCount: { type: "number" },
        averageInterestRate: { type: "number" },
        totalPrincipalBalance: { type: "number" },
        loanTapeCsv: { type: "string" },
      },
      transitions: [
        { targetStageId: "property_dossier", label: "Synthesize Property Dossiers" },
      ],
      completionCriteria: {
        type: "pipeline_valid",
      },
    },
    {
      id: "property_dossier",
      name: "Property Dossier & Zillow Photo Comps",
      description: "Synthesize APN, public recorded notes, Zillow listing photos, and market comparables into Scribe Studio investment memorandum.",
      type: "screen_step",
      requires: ["mortgage_tape"],
      provides: ["investment_dossier"],
      conflicts: [],
      podComponent: "ScribeStudioPod",
      responsibleAgentRole: "Foreclosure Researcher",
      defaultConfig: {},
      inputs: {
        loanTape: {
          sourceStageId: "mortgage_tape",
          outputKey: "loanTapeCsv",
        },
      },
      outputsSchema: {
        dossierMarkdown: { type: "string" },
        targetAddress: { type: "string" },
        apn: { type: "string" },
        estimatedMarketValue: { type: "number" },
      },
      transitions: [
        { targetStageId: "hil_signoff", label: "Submit for Human-in-the-Loop Sign-off" },
      ],
      completionCriteria: {
        type: "form_submitted",
      },
    },
    {
      id: "hil_signoff",
      name: "HIL Acquisition Sign-off Gate",
      description: "Human-in-the-loop executive signoff before dispatching purchase contract, subject-to takeover offer, or field researcher.",
      type: "hil_governance",
      requires: ["property_dossier"],
      provides: ["acquisition_approved"],
      conflicts: [],
      podComponent: "HILGovernancePod",
      responsibleAgentRole: "Special Situations Lead",
      defaultConfig: {},
      inputs: {
        dossier: {
          sourceStageId: "property_dossier",
          outputKey: "dossierMarkdown",
        },
      },
      outputsSchema: {
        approved: { type: "boolean" },
        maxOfferAmount: { type: "number" },
        signedBy: { type: "string" },
        timestamp: { type: "string" },
      },
      transitions: [],
      completionCriteria: {
        type: "hil_gate_configured",
      },
    },
  ],
  scaffoldPacks: [],
  variables: {},
};

export const RESIDENTIAL_DISTRESS_ASSEMBLY_BLUEPRINT: AssemblyBlueprint =
  AssemblyBlueprintSchema.parse(rawBlueprint);

export function validateResidentialDistressBlueprint() {
  return AssemblyBlueprintSchema.safeParse(RESIDENTIAL_DISTRESS_ASSEMBLY_BLUEPRINT);
}

export function generateResidentialDistressMermaid(): string {
  return `graph TD
    classDef ready fill:#10b981,stroke:#059669,stroke-width:2px,color:#fff;
    classDef active fill:#f59e0b,stroke:#d97706,stroke-width:3px,color:#fff;
    classDef hil fill:#6366f1,stroke:#4f46e5,stroke-width:2px,color:#fff;

    S1["1. Spatial Radar & Discovery\\n(SignalStudioPod / SpatialH3MapPanel)"]:::ready
    S2["2. Mortgage Underwriting Tape\\n(Note Rate, LTV, Sub-To Filtering)"]:::ready
    S3["3. Property Dossier & Zillow Comps\\n(Title, APN, Valuation in Scribe)"]:::active
    S4["4. HIL Acquisition Sign-Off\\n(Governance Gate & Letter of Intent)"]:::hil

    S1 --> S2 --> S3 --> S4`;
}
