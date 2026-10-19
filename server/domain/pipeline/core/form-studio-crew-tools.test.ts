/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asStudioDefinition } from "@shared/form-studio.js";
import { ConflictError } from "@server/utils/errors.js";

const list = vi.fn();
vi.mock("@domain/pipeline/core/form-studio-library.service.js", () => ({
    formStudioLibrary: { list: (...args: unknown[]) => list(...args) },
}));

const get = vi.fn();
const generate = vi.fn();
const generateNew = vi.fn();
const create = vi.fn();
const save = vi.fn();
vi.mock("@domain/pipeline/core/form-studio.service.js", () => ({
    formStudioService: {
        get: (...args: unknown[]) => get(...args),
        generate: (...args: unknown[]) => generate(...args),
        generateNew: (...args: unknown[]) => generateNew(...args),
        create: (...args: unknown[]) => create(...args),
        save: (...args: unknown[]) => save(...args),
    },
}));

import { FORM_STUDIO_TOOLS, describeNewForm, formNameFrom, resolveForm } from "@domain/tools/v1/capabilities/form-studio-tools.js";
import { detectArtifact } from "@domain/crew/core/crew-tools.service.js";
import { findFormChangeProposal } from "@shared/form-studio-crew.js";

const context = { organizationId: 7, userId: "user-1" } as any;
const before = asStudioDefinition({ fields: [{ key: "flight_risk", label: "Flight risk", type: "number" }] });
const after = { ...before, fields: [{ key: "flight_risk", label: "Flight risk (20%)", type: "number" }, { key: "notice_period", label: "Notice period", type: "text" }] };
const row = (id: number, name: string, extra = {}) => ({ id, name, isArchived: false, state: "draft", legacy: false, revision: 3, ...extra });

beforeEach(() => {
    list.mockReset();
    get.mockReset();
    generate.mockReset();
    generateNew.mockReset();
    create.mockReset();
    save.mockReset();
});

describe("new forms from a request", () => {
    it("names the form after what was asked for", () => {
        expect(formNameFrom("Build a mortgage calculator that saves the calculation to a dataset")).toBe("Mortgage calculator");
        expect(formNameFrom("Create an intake form for new vendors")).toBe("Intake form for new vendors");
        expect(formNameFrom("make me a quick employee engagement survey.")).toBe("Employee engagement survey");
        expect(formNameFrom("")).toBe("New form");
    });

    it("says what the draft holds, and that a named dataset is not written to yet", () => {
        const definition = asStudioDefinition({
            fields: [{ key: "principal", label: "Loan amount", type: "number" }, { key: "payment", label: "Monthly payment", type: "computed", formula: "principal / 12" }],
            studio: { version: 2, pages: [{ id: "p1", title: "Loan" }], dataset: { datasetId: 12 }, results: [{ id: "r1", title: "Payment", type: "score", field: "payment" }] },
        });
        expect(describeNewForm(definition)).toEqual([
            "Fields: Loan amount, Monthly payment",
            "Results: Payment",
            "Names dataset #12 for its responses; responses are not written there yet",
        ]);
    });

    it("drafts a new form as a card, writing nothing", async () => {
        generateNew.mockResolvedValue({ definition: after, checks: [] });
        const out = await FORM_STUDIO_TOOLS.propose_new_form.execute({ instruction: "Build a flight risk scorecard" }, context);
        const payload = detectArtifact("propose_new_form", out as string)?.payload as any;
        expect(generateNew).toHaveBeenCalledWith([], "Build a flight risk scorecard", expect.objectContaining({ organizationId: 7 }));
        expect(payload).toMatchObject({ type: "form_create_proposal", name: "Flight risk scorecard", definition: after, checks: [] });
        expect(payload.proposalId).toMatch(/^formnew_[a-f0-9]{32}$/);
        expect(create).not.toHaveBeenCalled();
    });

    it("does not offer a form with no questions", async () => {
        generateNew.mockResolvedValue({ definition: asStudioDefinition({ fields: [] }), checks: [] });
        const out = await FORM_STUDIO_TOOLS.propose_new_form.execute({ instruction: "Build a survey" }, context);
        expect(detectArtifact("propose_new_form", out as string)).toBeNull();
    });

    it("creates the carded draft and opens it", async () => {
        create.mockResolvedValue({ id: 31, name: "Flight risk scorecard", revision: 0 });
        const out = await FORM_STUDIO_TOOLS.create_form_from_proposal.execute(
            { proposalId: "formnew_0123456789abcdef", name: "Flight risk scorecard", instruction: "Build a flight risk scorecard", definition: after },
            context,
        );
        expect(create).toHaveBeenCalledWith("Flight risk scorecard", expect.objectContaining({ organizationId: 7 }), { schema: after, description: "Build a flight risk scorecard" });
        expect(detectArtifact("create_form_from_proposal", out as string)?.payload).toMatchObject({
            type: "form_studio_pod", formId: 31, revision: 0, proposalId: "formnew_0123456789abcdef", lastChange: { status: "created" },
        });
    });
});

describe("resolveForm", () => {
    const forms = [row(1, "Review"), row(2, "Succession review"), row(3, "Beta validation")];

    it("takes an id, an exact name, or the longest name the text contains", () => {
        expect(resolveForm(forms, 3)?.name).toBe("Beta validation");
        expect(resolveForm(forms, undefined, "  succession REVIEW ")?.id).toBe(2);
        expect(resolveForm(forms, undefined, "open the succession review form please")?.id).toBe(2);
    });

    it("finds nothing rather than guessing", () => {
        expect(resolveForm(forms, 99)).toBeNull();
        expect(resolveForm(forms, undefined, "open form studio")).toBeNull();
        expect(resolveForm(forms, undefined, "")).toBeNull();
    });
});

describe("mount_form_studio", () => {
    it("mounts the named form as a studio surface", async () => {
        list.mockResolvedValue([row(2, "Succession review", { revision: 5 })]);
        const out = await FORM_STUDIO_TOOLS.mount_form_studio.execute({ formName: "open the succession review form" }, context);
        const artifact = detectArtifact("mount_form_studio", out as string);
        expect(artifact?.payload).toMatchObject({ type: "form_studio_pod", formId: 2, formName: "Succession review", revision: 5, view: "structure", props: { formId: 2, view: "structure" } });
        expect(list.mock.calls[0][0]).toMatchObject({ organizationId: 7, isSuperAdmin: false });
    });

    it("names the forms that exist instead of opening an archived or unknown one", async () => {
        list.mockResolvedValue([row(1, "Old intake", { isArchived: true }), row(2, "Succession review")]);
        const out = await FORM_STUDIO_TOOLS.mount_form_studio.execute({ formName: "Old intake" }, context);
        expect(detectArtifact("mount_form_studio", out as string)).toBeNull();
        expect(out).toContain("Its forms are: Succession review.");
    });
});

describe("share_published_form", () => {
    it("shares a published form by its link token", async () => {
        list.mockResolvedValue([row(2, "Beta validation", { releaseNumber: 3 }), row(4, "Draft survey", { releaseNumber: null })]);
        get.mockResolvedValue({ id: 2, name: "Beta validation", published: { releaseNumber: 3, href: `/external/forms/${"a".repeat(48)}` } });
        const out = await FORM_STUDIO_TOOLS.share_published_form.execute({ formName: "beta validation" }, context);
        expect(JSON.parse(out as string)).toEqual({ type: "form_studio_form", token: "a".repeat(48), formName: "Beta validation", releaseNumber: 3 });
    });

    it("never shares an unpublished form, and names the published ones instead", async () => {
        list.mockResolvedValue([row(2, "Beta validation", { releaseNumber: 3 }), row(4, "Draft survey", { releaseNumber: null })]);
        const out = await FORM_STUDIO_TOOLS.share_published_form.execute({ formName: "Draft survey" }, context);
        expect(out).toBe('No published form matches "Draft survey". Published forms: Beta validation.');
        expect(get).not.toHaveBeenCalled();
    });
});

describe("propose_form_change", () => {
    it("drafts against the current revision and describes the change", async () => {
        get.mockResolvedValue({ id: 2, name: "Succession review", revision: 5, schema: before });
        generate.mockResolvedValue({ definition: after, checks: ["Page page_1 is not in any stage."] });
        const out = await FORM_STUDIO_TOOLS.propose_form_change.execute({ formId: 2, instruction: "Weight flight risk at 20%" }, context);
        const payload = detectArtifact("propose_form_change", out as string)?.payload as any;

        expect(generate).toHaveBeenCalledWith(2, 5, [], "Weight flight risk at 20%", expect.objectContaining({ organizationId: 7 }));
        expect(payload).toMatchObject({ type: "form_change_proposal", formId: 2, baseRevision: 5, checks: ["Page page_1 is not in any stage."], definition: after });
        expect(payload.proposalId).toMatch(/^formchg_[a-f0-9]{32}$/);
        expect(payload.changes).toEqual(["Added field: Notice period", "Changed field: Flight risk (20%)"]);
        expect(findFormChangeProposal([{ artifacts: [{ payload }] }], payload.proposalId)?.applied).toBe(false);
    });

    it("says so when the draft changes nothing", async () => {
        get.mockResolvedValue({ id: 2, name: "Succession review", revision: 5, schema: before });
        generate.mockResolvedValue({ definition: before, checks: [] });
        const out = await FORM_STUDIO_TOOLS.propose_form_change.execute({ formId: 2, instruction: "Tidy it up" }, context);
        expect(out).toBe('That would not change "Succession review". Say more specifically what should change.');
    });

    it("reports a form that moved on while drafting", async () => {
        get.mockResolvedValue({ id: 2, name: "Succession review", revision: 5, schema: before });
        generate.mockRejectedValue(new ConflictError("stale", { reason: "stale_revision", currentRevision: 6 }));
        const out = await FORM_STUDIO_TOOLS.propose_form_change.execute({ formId: 2, instruction: "Weight flight risk at 20%" }, context);
        expect(out).toContain("it is at revision 6 now");
    });
});

describe("apply_form_change", () => {
    const params = { formId: 2, baseRevision: 5, proposalId: "formchg_0123456789abcdef", definition: after, summary: "Changed from CREW: Weight flight risk at 20%" };

    it("saves at the card's revision and marks the proposal applied", async () => {
        save.mockResolvedValue({ id: 2, name: "Succession review", revision: 6 });
        const out = await FORM_STUDIO_TOOLS.apply_form_change.execute(params, context);
        const payload = detectArtifact("apply_form_change", out as string)?.payload as any;

        expect(save).toHaveBeenCalledWith(2, 5, { schema: after }, expect.objectContaining({ organizationId: 7, userId: "user-1" }), params.summary);
        expect(payload).toMatchObject({ type: "form_studio_pod", formId: 2, revision: 6, proposalId: params.proposalId, lastChange: { status: "applied", revision: 6 } });
        expect(findFormChangeProposal([{ artifacts: [{ payload: { type: "form_change_proposal", proposalId: params.proposalId, formId: 2 } }] }, { artifacts: [{ payload }] }], params.proposalId)?.applied).toBe(true);
    });

    it("refuses a stale change in words, without saving over the newer form", async () => {
        save.mockRejectedValue(new ConflictError("stale", { reason: "stale_revision", currentRevision: 7 }));
        const out = await FORM_STUDIO_TOOLS.apply_form_change.execute(params, context);
        expect(out).toBe("Not applied: the form is at revision 7 now, and this change was drafted against revision 5. Ask again and I'll draft it against the current form.");
    });
});
