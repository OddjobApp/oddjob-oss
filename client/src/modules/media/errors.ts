import type { StudioLocation } from "./navigation";

/**
 * What went wrong in Media Studio, and what to do about it.
 *
 * The server's messages already say what happened ("This take would take Rooftop chase
 * past its budget…"); they rarely say what to do next, and a network or session failure
 * arrives as "Failed to fetch" or "Unauthorized". This adds the fix, and where one
 * exists a quick action that goes to the place that fixes it.
 */

export type StudioErrorAction = { label: string; location: StudioLocation } | { label: string; href: string };

export interface StudioErrorGuidance {
  message: string;
  fix: string;
  action?: StudioErrorAction;
  actions?: StudioErrorAction[];
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "";

const statusOf = (error: unknown, message: string): number | null => {
  // apiRequest throws a ClientAppError carrying statusCode; other callers may set status.
  const carried = error as { statusCode?: unknown; status?: unknown } | null;
  const status = carried?.statusCode ?? carried?.status;
  if (typeof status === "number") return status;
  const match = /^HTTP (\d{3})\b/.exec(message) ?? /^(\d{3}):/.exec(message);
  return match ? Number(match[1]) : null;
};

type Rule = {
  when: (message: string, status: number | null) => boolean;
  guide: Omit<StudioErrorGuidance, "message"> & { message?: string };
};

// First match wins, so specific messages come before status codes.
const RULES: Rule[] = [
  {
    when: (m, s) => s === 401 || /^unauthorized$/i.test(m),
    guide: { message: "You are signed out.", fix: "Sign in again, then retry.", action: { label: "Sign in", href: "/auth/login" } },
  },
  {
    when: (m) => /failed to fetch|networkerror|load failed|timed? ?out|the operation was aborted/i.test(m),
    guide: {
      message: "The server did not answer.",
      fix: "Check the dev server is running. If it is, close other Oddjob tabs, which can hold all of the browser's connections to it, then retry.",
    },
  },
  { when: (m) => /still starting/i.test(m), guide: { fix: "Wait a few seconds for the server to finish starting, then retry." } },
  {
    when: (m) => /past its budget/i.test(m),
    guide: {
      fix: "Raise the budget in Story, shorten the shot, or withdraw takes still waiting for approval.",
      action: { label: "Open the budget", location: { tab: "story" } },
    },
  },
  {
    when: (m) => /renders \d+ to \d+ seconds/i.test(m),
    guide: { fix: "Set the shot's length to 4–15 seconds in Shots, save it, and ask again.", action: { label: "Open Shots", location: { tab: "shots" } } },
  },
  {
    when: (m) => /describe what the shot shows/i.test(m),
    guide: { fix: "Write what the shot shows, its picture or its action, in Shots and save it.", action: { label: "Open Shots", location: { tab: "shots" } } },
  },
  {
    when: (m) => /keyframe to end on|approve this shot's keyframe/i.test(m),
    guide: { fix: "Approve the keyframes in Storyboard first, or ask for the take without an end frame.", action: { label: "Open Storyboard", location: { tab: "storyboard" } } },
  },
  {
    when: (m) => /comfyui is not (configured|set up)|no COMFYUI_BASE_URL/i.test(m),
    guide: { fix: "Set COMFYUI_BASE_URL in the server's .env to your ComfyUI address, for example http://127.0.0.1:8188, and restart the server. Until then, takes are simulations." },
  },
  {
    when: (m) => /comfyui is missing these nodes/i.test(m),
    guide: { fix: "Install the missing nodes on the ComfyUI server (ComfyUI-Manager can find them), or import a workflow exported from that server.", action: { label: "Open Story", location: { tab: "story" } } },
  },
  {
    when: (m) => /comfyui workflow|export \(api\)|editor format/i.test(m),
    guide: { fix: "In ComfyUI choose Workflow → Export (API), then import that file under Video engine in Story.", action: { label: "Open Story", location: { tab: "story" } } },
  },
  { when: (m) => /comfyui at .* could not be reached|comfyui refused/i.test(m), guide: { fix: "Check that ComfyUI is running and reachable from the Oddjob server at COMFYUI_BASE_URL, then ask for the take again." } },
  {
    when: (m) => /exhausted balance|user is locked|dashboard\/billing/i.test(m),
    guide: {
      message: "fal.ai credit balance is exhausted.",
      fix: "Your fal.ai account balance has run out. Top up your balance at fal.ai or switch the video engine to ComfyUI or simulation mode in Story.",
      action: { label: "Top up fal.ai balance", href: "https://fal.ai/dashboard/billing" },
      actions: [
        { label: "Top up fal.ai balance", href: "https://fal.ai/dashboard/billing" },
        { label: "Switch engine in Story", location: { tab: "story" } },
      ],
    },
  },
  {
    when: (m) => /fal\.ai returned 401|invalid fal_?key/i.test(m),
    guide: {
      message: "fal.ai API key is invalid.",
      fix: "Check that FAL_KEY in your server environment or .env file is valid, then restart the server.",
    },
  },
  {
    when: (m) => /fal\.ai returned 429|rate limit/i.test(m),
    guide: {
      message: "fal.ai rate limit reached.",
      fix: "The video provider is rate limiting requests. Wait a moment before asking for another take.",
    },
  },
  {
    when: (m) => /output audio has sensitive content|partner_validation_failed|cause.*copyright|audio.*copyright/i.test(m),
    guide: {
      message: "Generated audio flagged by fal.ai copyright filter.",
      fix: "fal.ai's partner validation flagged the synthesized audio for potential copyright sensitivity. Ask for a take without audio, or adjust the shot direction.",
      action: { label: "Open Shots", location: { tab: "shots" } },
    },
  },
  {
    when: (m) => /content policy|safety filter|nsfw|moderation/i.test(m),
    guide: {
      message: "Content flagged by safety filter.",
      fix: "The shot prompt or keyframe was flagged by fal.ai's safety filter. Adjust the shot's prompt or dialogue in Shots.",
      action: { label: "Open Shots", location: { tab: "shots" } },
    },
  },
  { when: (m) => /fal\.ai is not configured|no FAL_KEY/i.test(m), guide: { fix: "Add FAL_KEY to the server's .env and restart the server. Until then, takes are simulations." } },
  { when: (m) => /gemini[^.]*not configured|GEMINI_API_KEY/i.test(m), guide: { fix: "Add GEMINI_API_KEY to the server's .env and restart the server to render keyframes." } },
  { when: (m) => /only a take ready for review can be approved/i.test(m), guide: { fix: "Wait until the take has rendered and shows Ready for review, or pick another take." } },
  { when: (m) => /sent to .+, so it can't be withdrawn/i.test(m), guide: { fix: "That render is already paid for. Review it when it is ready, and reject it if it isn't right." } },
  { when: (m) => /second take of the same shot|already being re-shot in this batch/i.test(m), guide: { fix: "Select one take per shot and run the batch again." } },
  {
    when: (m) => /no approved take|approved take with no video|no shots to assemble/i.test(m),
    guide: { fix: "Approve a rendered take of every shot in Film, then assemble the reel.", action: { label: "Open Film", location: { tab: "film" } } },
  },
  { when: (m) => /no ffmpeg binary/i.test(m), guide: { fix: "Reinstall dependencies with install scripts enabled so ffmpeg-static downloads its binary, then restart the server." } },
  { when: (m) => /one scene assembles at a time/i.test(m), guide: { fix: "Wait for the other reel to finish, then assemble this one." } },
  { when: (m) => /has changed since|changed while|at the same moment/i.test(m), guide: { fix: "Someone changed it in the meantime. Refresh the studio and try again on the current version." } },
  { when: (m, s) => s === 403 || /forbidden|not allowed|permission/i.test(m), guide: { fix: "You don't have access to this production's Project Space. Ask a project owner to add you." } },
  { when: (m, s) => s === 404 || /not found\.?$/i.test(m), guide: { fix: "It may have been deleted, or it belongs to a production you can't open. Refresh the studio." } },
  { when: (_m, s) => s === 409, guide: { fix: "Something changed in the meantime. Refresh the studio and try again." } },
  { when: (m, s) => s === 400 || /^invalid /i.test(m), guide: { fix: "Check what you entered; the message names the value the server refused." } },
  { when: (_m, s) => s != null && s >= 500, guide: { fix: "The server hit an error. Retry, and if it keeps failing, check the server log for this request." } },
];

export function describeStudioError(error: unknown): StudioErrorGuidance {
  const raw = messageOf(error).trim();
  const status = statusOf(error, raw);
  const message = raw && !/^HTTP \d{3}:?\s*$/.test(raw) ? raw : "That did not work.";
  for (const rule of RULES) {
    if (rule.when(raw, status)) return { ...rule.guide, message: rule.guide.message ?? message };
  }
  return { message, fix: "Try again. If it keeps happening, refresh the studio." };
}
