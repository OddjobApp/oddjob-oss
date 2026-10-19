import { describe, expect, it } from "vitest";
import { splitStudioScope } from "./studio-scope";
import {
  applyMediaChangeMessage, applyMediaStoryMessage, applyStyleBibleMessage, checkMediaEdits, checkSceneDrafts,
  describeMediaEdits, describeSceneDrafts, describeStyleBible, findMediaChangeProposal, findMediaStoryProposal,
  latestStoryDraft, latestStyleBibleDraft,
  mediaEditSchema, mediaSceneDraftSchema, mountedMediaProduction, parseFilmIntake, parseMediaChangeApproval,
  parseMediaStoryApproval, parseStyleBibleApproval, sceneEditableState,
} from "./media-studio-crew";
import { mediaStudioScopePrefix, type SceneView, type TakeView } from "./media-studio";

const selection = { productionId: 7, sceneId: 21, sceneKey: "SCENE-01", kind: "scene" as const, id: 21, label: "SCENE-01: Arrival" };
const marked = (text: string) => `${mediaStudioScopePrefix(selection)} ${text}`;

const take: TakeView = {
  id: 51, takeNumber: 1, prompt: "", negativePrompt: null, cameraMotion: null, seed: null, durationSeconds: 5, status: "simulated", mode: "simulation",
  costCents: 0, videoUrl: null, provider: null, request: {}, defectClass: null, notes: null, error: null, requestedBy: null, decidedBy: null, createdAt: "",
};

const scene: SceneView = {
  id: 21, position: 0, sceneKey: "SCENE-01", title: "Arrival", synopsis: "Elena reaches the roof.", scribeNodeId: null, station: null,
  location: "Archive rooftop", timeOfDay: "night", mood: "tense", assembly: null,
  plotPoints: [
    { id: 11, position: 0, title: "She reaches the roof", beat: "", keyframes: [] },
    {
      id: 12, position: 1, title: "She runs", beat: "",
      keyframes: [{ id: 41, prompt: "", status: "approved", mode: "live", costCents: 4, imageUrl: "/api/media-studio/assets/1", isSelected: true, error: null, references: [], createdAt: "" }],
    },
  ],
  shots: [
    {
      id: 31, position: 0, plotPointId: 11, prompt: "", negativePrompt: null, cameraMotion: "slow push-in", seed: null, durationSeconds: 5, transition: "cut",
      referenceKeyframeId: null, framing: null, lens: null, action: "Elena crouches behind the parapet", dialogue: [{ speaker: "Elena", line: "Not tonight." }], takes: [],
    },
    {
      id: 32, position: 1, plotPointId: null, prompt: "", negativePrompt: null, cameraMotion: null, seed: null, durationSeconds: 4, transition: "cut",
      referenceKeyframeId: null, framing: null, lens: null, action: "Wide on the stairwell", dialogue: [], takes: [take],
    },
  ],
};

const edits = (raw: unknown[]) => raw.map((edit) => mediaEditSchema.parse(edit));

describe("a studio marker", () => {
  it("reads back into the studio, the selection and what the author wrote", () => {
    expect(splitStudioScope(marked("Make the mood colder"))).toEqual({ studio: "Media Studio", selection, text: "Make the mood colder" });

    const awkward = { ...selection, label: 'He said "}] run"' };
    expect(splitStudioScope(`${mediaStudioScopePrefix(awkward)} tighten it`)).toMatchObject({ selection: awkward, text: "tighten it" });

    const form = '[Form Studio selection: {"formId":1,"revision":2,"kind":"field","key":"a","label":"A"}] make it required';
    expect(splitStudioScope(form)).toMatchObject({ studio: "Form Studio", text: "make it required" });
    expect(splitStudioScope(form, ["Media Studio"])).toEqual({ studio: null, selection: null, text: form });
    expect(splitStudioScope("[Media Studio selection: {oops] make it colder").selection).toBeNull();
  });
});

describe("a drafted change", () => {
  it("keeps only edits that fit the scene, and says what it left out", () => {
    const checked = checkMediaEdits(scene, edits([
      { op: "update_scene", patch: { mood: "cold", location: "Archive rooftop" } },
      { op: "update_plot_point", plotPointId: 99, patch: { title: "x" } },
      { op: "remove_plot_point", plotPointId: 12 },
      { op: "remove_shot", shotId: 32 },
      { op: "add_shot", afterShotId: 77, action: "Close on the drone" },
      { op: "update_shot", shotId: 31, patch: { action: "Elena crouches behind the parapet", dialogue: [{ speaker: "Elena", line: "Not tonight.", delivery: null }] } },
    ]));
    expect(checked.edits).toEqual([
      { op: "update_scene", patch: { mood: "cold" } },
      { op: "add_shot", action: "Close on the drone" },
    ]);
    expect(checked.skipped).toEqual([
      "There is no plot point 99 in SCENE-01, so it was left out.",
      "Plot point 2 has rendered keyframes, so it is not removed here.",
      "Shot 2 has takes, so it is not removed here.",
      "There is no shot 77 in SCENE-01 to follow, so the new shot goes at the end.",
    ]);
  });

  // Fields are described in the schema's order, whatever order the model wrote them in.
  it("describes each edit against the scene as it was", () => {
    expect(describeMediaEdits(scene, edits([
      { op: "update_scene", patch: { mood: "cold, watchful", timeOfDay: "dawn" } },
      { op: "add_plot_point", title: "The drone spots her", afterPlotPointId: 11 },
      { op: "add_plot_point", title: "Opening", beat: "City at dusk.", afterPlotPointId: null },
      { op: "update_plot_point", plotPointId: 12, patch: { beat: "She sprints for the stairwell." } },
      { op: "remove_plot_point", plotPointId: 11 },
      { op: "add_shot", afterShotId: 31, action: "Close on the drone", dialogue: [{ speaker: "Marcus", line: "There!" }] },
      { op: "update_shot", shotId: 31, patch: { durationSeconds: 6, transition: "crossfade", cameraMotion: "handheld", dialogue: [{ speaker: "Elena", line: "Not tonight.", delivery: "whispering" }] } },
      { op: "remove_shot", shotId: 32 },
    ]))).toEqual([
      'Scene time of day: "night" → "dawn"',
      'Scene mood: "tense" → "cold, watchful"',
      'New plot point after plot point 1 ("She reaches the roof"): "The drone spots her"',
      'New plot point at the start: "Opening" — City at dusk.',
      'Plot point 2 beat: (empty) → "She sprints for the stairwell."',
      'Remove plot point 1: "She reaches the roof"',
      'New shot after shot 1: "Close on the drone", with dialogue Marcus: "There!"',
      'Shot 1 camera movement: "slow push-in" → "handheld"',
      "Shot 1 length: 5s → 6s",
      "Shot 1 transition: cut → crossfade",
      'Shot 1 dialogue: Elena: "Not tonight." → Elena (whispering): "Not tonight."',
      'Remove shot 2: "Wide on the stairwell"',
    ]);
  });

  it("digests the scene in one shape, whatever order stored dialogue keys come back in", () => {
    const reordered = { ...scene, shots: [{ ...scene.shots[0], dialogue: [JSON.parse('{"line":"Not tonight.","speaker":"Elena"}')] }, scene.shots[1]] };
    expect(JSON.stringify(sceneEditableState(reordered))).toBe(JSON.stringify(sceneEditableState(scene)));
  });

  it("is found by id, and known to be applied once the room reopened the studio with it", () => {
    const card = { artifacts: [{ tool: "propose_media_change", payload: { type: "media_change_proposal", proposalId: "mediachg_1234567890", sceneKey: "SCENE-01" } }] };
    expect(findMediaChangeProposal([card], "mediachg_1234567890")).toMatchObject({ applied: false, proposal: { sceneKey: "SCENE-01" } });
    const applied = { artifacts: [{ tool: "apply_media_change", payload: { type: "media_studio_pod", proposalId: "mediachg_1234567890" } }] };
    expect(findMediaChangeProposal([card, applied], "mediachg_1234567890")).toMatchObject({ applied: true });
    expect(findMediaChangeProposal([card], "mediachg_other00000")).toBeNull();
  });
});

describe("the production a room is working on", () => {
  const pod = (payload: Record<string, unknown>) => ({ artifacts: [{ tool: "mount_media_studio", payload }] });

  it("is the latest Media Studio surface in the transcript, until another studio takes over", () => {
    const turns = [
      pod({ type: "media_studio_pod", productionId: 8, productionTitle: "Rooftop chase", aspectRatio: "2.39:1", sceneId: "SCENE-02" }),
      { artifacts: [{ tool: "say", payload: { type: "text" } }] },
    ];
    expect(mountedMediaProduction(turns)).toEqual({
      productionId: 8, productionTitle: "Rooftop chase", aspectRatio: "2.39:1", sceneKey: "SCENE-02",
    });

    // A later production wins; a later OTHER studio ends it, because by then
    // "this" means that one.
    expect(mountedMediaProduction([...turns, pod({ type: "media_studio_pod", productionId: 9 })])).toMatchObject({ productionId: 9 });
    expect(mountedMediaProduction([...turns, { artifacts: [{ payload: { type: "form_studio_pod", formId: 3 } }] }])).toBeNull();
    expect(mountedMediaProduction([])).toBeNull();
  });

  it("is carried by a proposal card too, so a draft keeps the room anchored to it", () => {
    const card = { artifacts: [{ tool: "propose_media_story", payload: { type: "media_story_proposal", productionId: 8, productionTitle: "Rooftop chase" } }] };
    expect(mountedMediaProduction([card])).toMatchObject({ productionId: 8, productionTitle: "Rooftop chase" });
    // A pod with no production is the studio's own start form, not a production.
    expect(mountedMediaProduction([pod({ type: "media_studio_pod", title: "Media Studio" })])).toBeNull();
  });
});

describe("a drafted story", () => {
  const draft = (title: string, extra: Record<string, unknown> = {}) => mediaSceneDraftSchema.parse({ title, ...extra });

  it("keeps the scenes that fit the production, and says what it left out", () => {
    const full = Array.from({ length: 11 }, (_, i) => `SCENE-${String(i + 1).padStart(2, "0")}`);
    const checked = checkSceneDrafts(full, [draft("Arrival"), draft("arrival"), draft("Escape")]);
    expect(checked.scenes.map((s) => s.title)).toEqual(["Arrival"]);
    expect(checked.skipped).toEqual([
      'Two drafted scenes were both called "arrival", so only the first was kept.',
      '"Escape" was left out: a production takes 12 scenes at a time, and this would be past that.',
    ]);
  });

  it("numbers each scene as it will be added, after the ones already there", () => {
    expect(describeSceneDrafts(["SCENE-01"], [
      draft("The rooftop", { synopsis: "Elena reaches the roof.", location: "Archive rooftop", timeOfDay: "night", mood: "tense", plotPoints: [{ title: "She climbs" }, { title: "The drone finds her" }] }),
      draft("The stairwell"),
    ])).toEqual([
      'Scene 2 "The rooftop" (Archive rooftop · night · tense · 2 beats): Elena reaches the roof.',
      'Scene 3 "The stairwell"',
    ]);
  });

  it("is found by id, and known to be applied once the room reopened the studio with it", () => {
    const card = { artifacts: [{ tool: "propose_media_story", payload: { type: "media_story_proposal", proposalId: "mediastory_12345678", productionTitle: "Rooftop chase" } }] };
    expect(findMediaStoryProposal([card], "mediastory_12345678")).toMatchObject({ applied: false, proposal: { productionTitle: "Rooftop chase" } });
    const applied = { artifacts: [{ tool: "apply_media_story", payload: { type: "media_studio_pod", proposalId: "mediastory_12345678" } }] };
    expect(findMediaStoryProposal([card, applied], "mediastory_12345678")).toMatchObject({ applied: true });
  });
});

describe("a drafted Style Bible", () => {
  it("says what changes against the bible in force, and lists only anchors that are new", () => {
    const current = { look: "handheld 16mm", period: "1978", canonicalCharacters: [{ name: "Elena", kind: "character" as const }] };
    expect(describeStyleBible(current, {
      look: "anamorphic 2.39:1, sodium streetlight",
      period: "1978",
      negativePrompt: "text overlays, watermarks",
      canonicalCharacters: [
        { name: "elena", kind: "character" as const },
        { name: "The Archive", kind: "location" as const, description: "A concrete tower above the docks" },
      ],
    })).toEqual([
      'Look: "handheld 16mm" → "anamorphic 2.39:1, sodium streetlight"',
      'Never show: (empty) → "text overlays, watermarks"',
      'New location anchor "The Archive" — A concrete tower above the docks',
    ]);
  });
});

describe("the approvals a card sends", () => {
  it("are exact and anchored, so agreeing in prose cannot write a storyboard", () => {
    expect(parseMediaChangeApproval(applyMediaChangeMessage("mediachg_0123456789"))).toEqual({ proposalId: "mediachg_0123456789" });
    expect(parseMediaStoryApproval(applyMediaStoryMessage("mediastory_12345678"))).toEqual({ proposalId: "mediastory_12345678" });
    expect(parseStyleBibleApproval(applyStyleBibleMessage("mediabible_12345678"))).toEqual({ proposalId: "mediabible_12345678" });

    expect(parseMediaChangeApproval('Sure, apply media change "mediachg_0123456789".')).toBeNull();
    expect(parseMediaStoryApproval("yes, apply the story")).toBeNull();
    expect(parseStyleBibleApproval('Apply style bible "short".')).toBeNull();
    // Each approval is read only by its own parser: one card's Apply must never
    // be able to trigger another card's write.
    expect(parseMediaChangeApproval(applyMediaStoryMessage("mediastory_12345678"))).toBeNull();
    expect(parseStyleBibleApproval(applyMediaChangeMessage("mediachg_0123456789"))).toBeNull();
  });
});

describe("the film brief, read back", () => {
  const diverse = (inputs: unknown, pod = "FilmBriefPod") =>
    `[DIVERSE PRIMITIVE INTAKE: MAKE A FILM (MEDIA STUDIO)]\n• Direction (D): Plan a short film\n• Intent (I): Configured through ${pod} Module Surface\n` +
    `• Variables & Inputs (V): ${JSON.stringify(inputs)}\n• Expectations (E): Realize configured Make a Film artifact`;

  it("reads the playbook card's block and the pod's own stage completion", () => {
    expect(parseFilmIntake(diverse({ productionTitle: "Rooftop chase", aspectRatio: "2.39:1" })))
      .toEqual({ productionTitle: "Rooftop chase", aspectRatio: "2.39:1" });
    expect(parseFilmIntake(diverse({ productionTitle: "  ", aspectRatio: "70mm" }))).toEqual({ productionTitle: "Untitled production" });
    expect(parseFilmIntake(diverse({ productionTitle: "Deck" }, "DocumentDeckPod"))).toBeNull();

    // The shape TurnRow's generic pod wiring sends when the brief is mounted
    // inside a turn. Reading only the block above is why that did nothing.
    expect(parseFilmIntake('I completed stage "film-brief" with configuration: {"productionTitle":"Rooftop chase","aspectRatio":"9:16"}'))
      .toEqual({ productionTitle: "Rooftop chase", aspectRatio: "9:16" });
    expect(parseFilmIntake('I confirmed stage "film-brief" with configuration: {"productionTitle":"Rooftop chase"}'))
      .toEqual({ productionTitle: "Rooftop chase" });
    expect(parseFilmIntake('I completed stage "stage-intake" with configuration: {"productionTitle":"Not a film"}')).toBeNull();
    expect(parseFilmIntake("Make a film about a rooftop chase")).toBeNull();
  });
});

describe("a card the room is still looking at", () => {
  const storyCard = (proposalId: string) => ({
    artifacts: [{ tool: "propose_media_story", payload: { type: "media_story_proposal", proposalId, productionId: 8, scenes: [{ title: "Arrival" }] } }],
  });
  const applied = (proposalId: string) => ({
    artifacts: [{ tool: "apply_media_story", payload: { type: "media_studio_pod", proposalId, productionId: 8 } }],
  });

  it("is the newest unapplied one, so a follow-up refines it instead of starting over", () => {
    expect(latestStoryDraft([storyCard("mediastory_11111111")])).toMatchObject({ proposalId: "mediastory_11111111" });
    // A later card supersedes an earlier one.
    expect(latestStoryDraft([storyCard("mediastory_11111111"), storyCard("mediastory_22222222")]))
      .toMatchObject({ proposalId: "mediastory_22222222" });
  });

  it("is gone once applied, because the saved production is then the thing to refine", () => {
    expect(latestStoryDraft([storyCard("mediastory_11111111"), applied("mediastory_11111111")])).toBeNull();
    // Applying the older card still leaves the newer one open.
    expect(latestStoryDraft([storyCard("mediastory_11111111"), applied("mediastory_11111111"), storyCard("mediastory_22222222")]))
      .toMatchObject({ proposalId: "mediastory_22222222" });
    expect(latestStoryDraft([])).toBeNull();
  });

  it("keeps the two kinds of card apart", () => {
    const bible = { artifacts: [{ tool: "propose_style_bible", payload: { type: "media_style_bible_proposal", proposalId: "mediabible_1234567", productionId: 8, bible: { look: "noir" } } }] };
    expect(latestStyleBibleDraft([bible])).toMatchObject({ proposalId: "mediabible_1234567" });
    expect(latestStoryDraft([bible])).toBeNull();
    expect(latestStyleBibleDraft([storyCard("mediastory_11111111")])).toBeNull();
  });
});
