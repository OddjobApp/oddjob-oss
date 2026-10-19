/**
 * Scribe Studio to Media Studio Script Breakdown & Ingestion Bridge.
 *
 * Automatically parses Scribe manuscript stations, extracting scene headings,
 * [SHOT n] direction blocks, camera motions, and character dialogue stems.
 */

export interface ParsedScribeShot {
  shotNumber: number;
  framing?: string;
  cameraMotion?: string;
  subject?: string;
  lighting?: string;
  seed?: number | string;
  durationSeconds?: number;
  prompt: string;
  dialogue?: {
    character: string;
    line: string;
    audioStemUrl?: string;
  };
}

export interface ParsedScribeScene {
  sceneId: string;
  sceneTitle: string;
  slugline?: string;
  setting?: string;
  timeOfDay?: string;
  shots: ParsedScribeShot[];
  characterAnchors: string[];
}

/**
 * Parses raw text from a Scribe manuscript station into a structured scene breakdown.
 */
export function parseScribeStationToScene(
  stationKey: string,
  stationTitle: string,
  content: string
): ParsedScribeScene {
  const lines = content.split(/\r?\n/);
  let slugline = "";
  let setting = "";
  let timeOfDay = "";
  const shots: ParsedScribeShot[] = [];
  const characterAnchors = new Set<string>();

  // 1. Detect slugline (e.g., "INT. CYBER LAB - NIGHT" or "EXT. ROOFTOP - DUSK")
  for (const line of lines) {
    const trimmed = line.trim();
    const slugMatch = /^(INT\.|EXT\.|INT\/EXT\.)\s+([^-]+)\s*-\s*(.+)$/i.exec(trimmed);
    if (slugMatch) {
      slugline = trimmed;
      setting = slugMatch[2].trim();
      timeOfDay = slugMatch[3].trim();
      break;
    }
  }

  // 2. Parse [SHOT n] blocks
  const shotBlocks = content.split(/\[SHOT\s+(\d+)\]/i);
  // shotBlocks[0] is pre-shot text, then [1] = shotNum, [2] = content, [3] = shotNum, etc.
  if (shotBlocks.length > 1) {
    for (let i = 1; i < shotBlocks.length; i += 2) {
      const shotNum = parseInt(shotBlocks[i], 10);
      const shotBody = shotBlocks[i + 1] || "";
      const shot = parseShotBlock(shotNum, shotBody);
      shots.push(shot);

      if (typeof shot.seed === "string" && shot.seed.startsWith("#")) {
        characterAnchors.add(shot.seed.replace("#", "char_").toLowerCase());
      }
      if (shot.dialogue?.character) {
        characterAnchors.add(`char_${shot.dialogue.character.toLowerCase().replace(/[^a-z0-9]/g, "")}`);
      }
    }
  } else {
    // If no explicit [SHOT n] blocks exist, create a default establishing shot from station content
    const cleanPrompt = lines
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"))
      .slice(0, 3)
      .join(" ");

    shots.push({
      shotNumber: 1,
      framing: "Wide",
      cameraMotion: "Static",
      prompt: cleanPrompt || stationTitle,
      durationSeconds: 4,
    });
  }

  return {
    sceneId: stationKey || "scene_01",
    sceneTitle: stationTitle || slugline || "Scene 1",
    slugline: slugline || undefined,
    setting: setting || undefined,
    timeOfDay: timeOfDay || undefined,
    shots,
    characterAnchors: Array.from(characterAnchors),
  };
}

function parseShotBlock(shotNumber: number, body: string): ParsedScribeShot {
  const lines = body.split(/\r?\n/);
  let framing = "Medium";
  let cameraMotion = "Static";
  let subject = "";
  let lighting = "";
  let seed: number | string | undefined = undefined;
  let durationSeconds = 4;
  let dialogue: ParsedScribeShot["dialogue"] = undefined;

  for (const line of lines) {
    const trimmed = line.trim().replace(/^[-*]\s*/, "");
    if (/^framing:\s*/i.test(trimmed)) {
      framing = trimmed.replace(/^framing:\s*/i, "").trim();
    } else if (/^camera:\s*/i.test(trimmed)) {
      cameraMotion = trimmed.replace(/^camera:\s*/i, "").trim();
    } else if (/^subject:\s*/i.test(trimmed)) {
      subject = trimmed.replace(/^subject:\s*/i, "").trim();
    } else if (/^lighting:\s*/i.test(trimmed)) {
      lighting = trimmed.replace(/^lighting:\s*/i, "").trim();
    } else if (/^seed:\s*/i.test(trimmed)) {
      const rawSeed = trimmed.replace(/^seed:\s*/i, "").trim();
      seed = isNaN(Number(rawSeed)) ? rawSeed : Number(rawSeed);
    } else if (/^duration:\s*/i.test(trimmed)) {
      const rawDur = trimmed.replace(/^duration:\s*/i, "").replace(/s$/i, "").trim();
      durationSeconds = parseFloat(rawDur) || 4;
    } else {
      // Check for dialogue e.g. ELENA: "We need to move."
      const dialogueMatch = /^([A-Z0-9_\s]+):\s*["“]([^"”]+)["”]/i.exec(trimmed);
      if (dialogueMatch) {
        dialogue = {
          character: dialogueMatch[1].trim(),
          line: dialogueMatch[2].trim(),
        };
      }
    }
  }

  const promptParts = [
    framing ? `${framing} shot` : null,
    subject || "Cinematic sequence",
    cameraMotion && cameraMotion !== "Static" ? `${cameraMotion} camera movement` : null,
    lighting ? `${lighting} lighting` : null,
  ].filter(Boolean);

  return {
    shotNumber,
    framing,
    cameraMotion,
    subject: subject || undefined,
    lighting: lighting || undefined,
    seed,
    durationSeconds,
    prompt: promptParts.join(", "),
    dialogue,
  };
}
