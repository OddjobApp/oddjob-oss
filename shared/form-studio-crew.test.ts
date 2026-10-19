// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  applyFormChangeMessage, decideFormStudioAction, findFormChangeProposal, isFormChangeRequest, isFormStudioRequest,
  mountedFormStudio, parseFormChangeApproval, splitFormStudioScope,
  createFormMessage, findFormCreateProposal, isFormCreateRequest, parseFormCreateApproval,
} from "./form-studio-crew";

describe("creating a form from the room", () => {
  it.each([
    "Build a mortgage calculator",
    "Can you build a mortgage calculator that save the calculation to a dataset",
    "Create an intake form for new vendors",
    "make me a quick employee engagement survey",
    "Design a new 9-box assessment for succession",
    "Create a form to collect expense receipts",
    "Build a tip calculator app",
  ])("drafts a new form for %s", (message) => expect(isFormCreateRequest(message)).toBe(true));

  it.each([
    "make the phone field required",
    "Build an app with a login form",
    "Fill in the onboarding form",
    "Create a dashboard for incidents",
    "What makes a good survey?",
    "Just review the checklist, don't change anything",
  ])("leaves %s alone", (message) => expect(isFormCreateRequest(message)).toBe(false));

  it("round-trips the card's create message and nothing looser", () => {
    expect(parseFormCreateApproval(createFormMessage("formnew_12345678"))).toEqual({ proposalId: "formnew_12345678" });
    expect(parseFormCreateApproval("yes create it")).toBeNull();
    expect(parseFormCreateApproval(applyFormChangeMessage("formnew_12345678"))).toBeNull();
  });

  it("finds a drafted form and whether it was created", () => {
    const card = { artifacts: [{ payload: { type: "form_create_proposal", proposalId: "formnew_12345678", name: "Mortgage calculator" } }] };
    const created = { artifacts: [{ payload: { type: "form_studio_pod", formId: 9, proposalId: "formnew_12345678" } }] };
    expect(findFormCreateProposal([card], "formnew_12345678")).toMatchObject({ created: false, proposal: { name: "Mortgage calculator" } });
    expect(findFormCreateProposal([card, created], "formnew_12345678")?.created).toBe(true);
  });

  it("decides a create approval, and a new form even with another form open", () => {
    const open = [{ artifacts: [{ payload: { type: "form_studio_pod", formId: 7 } }] }];
    expect(decideFormStudioAction(createFormMessage("formnew_12345678"), open)).toEqual({ kind: "create", proposalId: "formnew_12345678" });
    expect(decideFormStudioAction("Make a pulse survey for the beta cohort", open)).toEqual({ kind: "draft", instruction: "Make a pulse survey for the beta cohort" });
    expect(decideFormStudioAction("make the phone field required", open)).toMatchObject({ kind: "propose" });
  });
});

/**
 * The gate in front of changing a form from a CREW room. What makes it act, and
 * more importantly everything that must not.
 */

const mount = (formId: number, revision = 3) => ({ artifacts: [{ tool: "mount_form_studio", payload: { type: "form_studio_pod", formId, formName: "Succession review", revision } }] });
const proposal = (proposalId: string, formId = 7) => ({
  artifacts: [{ tool: "propose_form_change", payload: { type: "form_change_proposal", proposalId, formId, baseRevision: 3, instruction: "Weight flight risk at 20%", changes: [], checks: [], definition: {} } }],
});
const applied = (proposalId: string, formId = 7) => ({ artifacts: [{ tool: "apply_form_change", payload: { type: "form_studio_pod", formId, revision: 4, proposalId } }] });

describe("mountedFormStudio", () => {
  it("reads the latest Form Studio mount", () => {
    expect(mountedFormStudio([mount(5), { artifacts: [] }, mount(7, 9)])).toEqual({ formId: 7, formName: "Succession review", revision: 9, view: undefined });
  });

  it("is nothing once another studio has been mounted after it", () => {
    expect(mountedFormStudio([mount(7), { artifacts: [{ payload: { type: "app_studio_pod", appId: 1 } }] }])).toBeNull();
    expect(mountedFormStudio([{ artifacts: [{ payload: { type: "scribe_foundry_pod" } }] }])).toBeNull();
    expect(mountedFormStudio([])).toBeNull();
  });
});

describe("findFormChangeProposal", () => {
  it("finds a drafted change and whether it was applied", () => {
    expect(findFormChangeProposal([mount(7), proposal("prop_12345678")], "prop_12345678")).toMatchObject({ applied: false, proposal: { formId: 7, baseRevision: 3 } });
    expect(findFormChangeProposal([proposal("prop_12345678"), applied("prop_12345678")], "prop_12345678")?.applied).toBe(true);
    expect(findFormChangeProposal([proposal("prop_12345678")], "prop_other_1")).toBeNull();
  });
});

describe("approvals", () => {
  it("round-trips the card's message and nothing looser", () => {
    expect(parseFormChangeApproval(applyFormChangeMessage("prop_12345678"))).toEqual({ proposalId: "prop_12345678" });
    for (const message of ["yes apply it", "Please apply form change \"prop_12345678\".", "Apply form change prop_12345678", "Apply form change \"x\"."]) {
      expect(parseFormChangeApproval(message)).toBeNull();
    }
  });
});

describe("isFormStudioRequest", () => {
  it.each([
    "Open form studio",
    "open the succession review form",
    "Can you show me the beta validation questionnaire?",
    "Review the compliance checklist in Form Studio",
    "update the 9-box assessment",
  ])("opens the studio for %s", (message) => expect(isFormStudioRequest(message)).toBe(true));

  it.each([
    "Fill in the onboarding form",
    "Submit the expense form for me",
    "Run the pipeline with the intake form",
    "Build a mortgage calculator",
    "Create an intake form for new vendors",
    "update the dashboard",
  ])("leaves %s to the room", (message) => expect(isFormStudioRequest(message)).toBe(false));
});

describe("isFormChangeRequest", () => {
  it.each([
    "Weight flight risk at 20%",
    "Add a question about notice period",
    "please make the phone field required",
    "Can you rename the Review page to Calibration",
    "ok, hide the salary field from respondents",
  ])("changes the form for %s", (message) => expect(isFormChangeRequest(message)).toBe(true));

  it.each([
    "What does flight risk measure?",
    "Should flight risk be weighted 20%?",
    "Just review the scoring, don't change anything",
    "Explain the decision rules",
    "Looks good to me",
    "",
  ])("leaves %s to the room", (message) => expect(isFormChangeRequest(message)).toBe(false));
});

describe("decideFormStudioAction", () => {
  it("applies an approval before reading anything else into it", () => {
    expect(decideFormStudioAction(applyFormChangeMessage("prop_12345678"), [mount(7)])).toEqual({ kind: "apply", proposalId: "prop_12345678" });
  });

  it("drafts a change to the open form", () => {
    expect(decideFormStudioAction("Weight flight risk at 20%", [mount(7)])).toEqual({
      kind: "propose", form: { formId: 7, formName: "Succession review", revision: 3, view: undefined }, instruction: "Weight flight risk at 20%",
    });
  });

  it("does not draft a change with no form open", () => {
    expect(decideFormStudioAction("Weight flight risk at 20%", [])).toEqual({ kind: "none" });
    expect(decideFormStudioAction("Weight flight risk at 20%", [mount(7), { artifacts: [{ payload: { type: "app_studio_pod", appId: 3 } }] }])).toEqual({ kind: "none" });
  });

  it("reads a change past a studio selection, and names the unit it is about", () => {
    const message = `[Form Studio selection: ${JSON.stringify({ formId: 7, revision: 3, kind: "field", key: "flight_risk", label: "Flight risk [0-10] {score}" })}] Weight it at 20%`;
    expect(splitFormStudioScope(message)).toEqual({ selection: expect.objectContaining({ key: "flight_risk" }), text: "Weight it at 20%" });
    expect(decideFormStudioAction(message, [mount(7)])).toMatchObject({ kind: "propose", instruction: 'Weight it at 20% (about the field "Flight risk [0-10] {score}")' });
  });

  it("leaves an unscoped or malformed message whole", () => {
    expect(splitFormStudioScope("Weight flight risk at 20%")).toEqual({ selection: null, text: "Weight flight risk at 20%" });
    expect(splitFormStudioScope("[Form Studio selection: {oops] add a page").selection).toBeNull();
  });

  it("mounts for an authoring request, including a different form while one is open", () => {
    expect(decideFormStudioAction("open form studio", [])).toEqual({ kind: "mount" });
    expect(decideFormStudioAction("Open the beta validation questionnaire", [mount(7)])).toEqual({ kind: "mount" });
  });
});
