import { ZodError } from "zod";
import { AppError } from "@server/utils/errors.js";
import { definitionIssues, parseStudioDefinition, type StudioDefinition } from "@shared/form-studio.js";

/**
 * A model's reply read as a definition with the checks it fails, or what stops it
 * being a definition at all, in words the model can act on.
 */
export type ProposalReading = { definition: StudioDefinition; issues: string[] } | { problems: string };

const MAX_ISSUES_IN_PROMPT = 40;

export function readProposal(reply: string | null | undefined): ProposalReading {
  if (!reply?.trim()) return { problems: "The reply was empty." };
  const text = reply.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { problems: `The reply was not JSON (${(error as Error).message}).` };
  }
  try {
    const definition = parseStudioDefinition(json);
    return { definition, issues: definitionIssues(definition) };
  } catch (error) {
    if (error instanceof ZodError) {
      return { problems: error.issues.slice(0, 20).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ") };
    }
    return { problems: (error as Error).message };
  }
}

/**
 * Generate a definition, giving the model one chance to correct a reply that is
 * not a valid definition or fails the checks that block publishing.
 *
 * A proposal used to be discarded whole when any part failed validation: a
 * result block naming a field by an invalid key threw away every question, rule
 * and test with it, and the author was shown "studio.results.0.field: Invalid".
 *
 * A reply that parsed was accepted even when it could never be published. The
 * first live proposal from a document put every page in both of its stages and
 * listed field keys where a stage names the earlier stages it may see: 38 checks,
 * so Publish refused it and the author had to repair every stage by hand. Those
 * checks now go back to the model too.
 *
 * Of the two replies, the one with fewer checks is kept, since a definition with
 * checks still opens in the studio for the author to finish. Only when neither
 * reply is a definition does the author get the problems, as a 422.
 */
export async function generateDefinition(
  generate: (prompt: string) => Promise<string | null | undefined>,
  prompt: string,
): Promise<StudioDefinition> {
  const first = await generate(prompt);
  if (!first?.trim()) throw new Error("AI generation failed to produce a response.");
  const reading = readProposal(first);
  if ("definition" in reading && reading.issues.length === 0) return reading.definition;

  const problems = "definition" in reading
    ? `Your previous reply is a definition, but it fails these checks, and a form that fails any of them cannot be published: ${reading.issues.slice(0, MAX_ISSUES_IN_PROMPT).join("; ")}`
    : `Your previous reply was not a valid definition. Problems: ${reading.problems}`;
  const retry = await generate(
    `${prompt}\n\n${problems}\n` +
    `Return ONLY the complete, corrected JSON definition.\n<previous_reply>${first.slice(0, 100_000)}</previous_reply>`,
  );
  const corrected = readProposal(retry);

  if ("definition" in corrected) {
    if (!("definition" in reading) || corrected.issues.length <= reading.issues.length) return corrected.definition;
    return reading.definition;
  }
  if ("definition" in reading) return reading.definition;
  throw new AppError(`The generated proposal is not a valid form definition, even after one correction. ${corrected.problems}`, 422, "PROPOSAL_INVALID");
}
