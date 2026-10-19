import type { StudioDefinition, TemplateUpdate } from "@shared/form-studio";
import type { NamedDefinition } from "@shared/form-studio-merge";

/** A form as GET/PUT /api/form-studio/:id returns it. */
export interface FormStudioView {
  id: number;
  name: string;
  description: string | null;
  schema: StudioDefinition;
  revision: number;
  /** Structural problems that block publishing. A draft is saved with them. */
  checks: string[];
  /** A Form Builder, Org Forge or agent form the Studio has not saved yet. */
  legacy: boolean;
  published: { releaseNumber: number; revision: number; href: string; draftAhead: boolean; at?: string } | null;
  /** The public link's rules: requireOtp and tokenExpirationHours. */
  securityConfig?: Record<string, unknown> | null;
  templateUpdate: TemplateUpdate | null;
  updatedAt: string;
  createdBy: string | null;
}

export type DraftChange = (change: (draft: NamedDefinition) => NamedDefinition) => void;

export type FormUse =
  | { type: "pipeline_step"; via: "id"; jobId: number; name: string }
  | { type: "mission_template"; via: "name"; templateId: number; name: string; stepOrder: number | null }
  | { type: "org_forge"; via: "name"; templateKey: string };

export function describeUse(use: FormUse): string {
  if (use.type === "pipeline_step") return `Pipeline step “${use.name}”`;
  if (use.type === "mission_template") return `Mission template “${use.name}”${use.stepOrder != null ? `, step ${use.stepOrder}` : ""}`;
  return `Org Forge template form “${use.templateKey}”`;
}

export function publishStateLabel(published: FormStudioView["published"]): string {
  if (!published) return "Draft";
  if (published.draftAhead) return `Release ${published.releaseNumber} (draft ahead)`;
  return `Release ${published.releaseNumber}`;
}
