import { knowledgePackService } from "../server/domain/knowledge-packs/knowledge-pack.service.js";
import { SYNTHETIC_FINANCE_PACK } from "../server/domain/knowledge-packs/synthetic-finance.pack.js";

const args = new Map(process.argv.slice(2).map(value => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw];
}));
const organizationId = Number(args.get("org"));
if (!Number.isInteger(organizationId) || organizationId <= 0) throw new Error("Provide --org=<positive organization id>");

const pack = await knowledgePackService.publish(SYNTHETIC_FINANCE_PACK);
const installation = await knowledgePackService.install(organizationId, pack.packKey, pack.version, {
  legalEntity: args.get("legal-entity") || "DEMO_ENTITY",
  complianceOwner: args.get("compliance-owner") || "demo-compliance-owner",
});

let result: unknown = installation;
if (args.get("activate") === "true") {
  result = await knowledgePackService.certifyAndActivate(organizationId, installation.id, {
    complianceApproved: true,
    evaluationPassRate: 1,
    certifiedBy: args.get("certified-by") || "synthetic-demo-installer",
  });
}

console.log(JSON.stringify({ synthetic: true, legalDisclaimer: "Architecture demonstration only; not regulatory advice or coverage.", pack: `${pack.packKey}@${pack.version}`, installation: result }, null, 2));

