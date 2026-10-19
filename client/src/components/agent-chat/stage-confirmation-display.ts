/**
 * Keep the machine-readable half of a person's own turn available to the
 * server, out of chat. Form and stage cards post their answers as the person's
 * message with JSON attached (the agents read it); the room shows a readable
 * summary instead. Returns null for any message that is not one of these, so
 * the caller shows it as it was written.
 */
export function stageConfirmationDisplay(content: string): string | null {
  const text = content.trim();
  return stageMessage(text) ?? formMessage(text) ?? intakeMessage(text);
}

/** `I confirmed|completed stage "id" with configuration: {…}` */
function stageMessage(text: string): string | null {
  const match = text.match(/^I (confirmed|completed) stage\s+"([^"]{1,60})"\s+with configuration:\s*(\{[\s\S]*)$/i);
  if (!match) return null;
  const data = parseObject(match[3]);
  if (!data) return null;
  const verb = match[1].toLowerCase() === 'completed' ? 'Completed' : 'Confirmed';
  const packs = data.selectedPacks ?? data.selectedPackIds;
  if (Array.isArray(packs) && packs.every((pack: unknown) => typeof pack === 'string')) {
    return `${verb} architecture with ${packs.length} selected ${packs.length === 1 ? 'pack' : 'packs'}.`;
  }
  return `${verb} stage configuration.`;
}

/** `I submitted the "Title" [form] with: {…}[ trailing instruction]` */
function formMessage(text: string): string | null {
  const match = text.match(/^I submitted the\s+"([^"]{1,120})"(?:\s+form)?\s+with:\s*(\{[\s\S]*)$/i);
  if (!match) return null;
  const json = leadingObject(match[2]);
  if (!json) return null;
  const fields = summarizeFields(json.value);
  return fields ? `Submitted “${match[1]}”: ${fields}` : `Submitted “${match[1]}”.`;
}

/** The playbook launcher's `[DIVERSE PRIMITIVE INTAKE: LABEL]` directive. */
function intakeMessage(text: string): string | null {
  const match = text.match(/^\[DIVERSE PRIMITIVE INTAKE:\s*([^\]]{1,80})\]\s*\n•\s*Direction \(D\):\s*([^\n]*)/);
  if (!match) return null;
  const label = match[1].trim().toLowerCase().replace(/^\w/, c => c.toUpperCase());
  const direction = match[2].trim();
  return direction ? `Started ${label} setup: ${direction}` : `Started ${label} setup.`;
}

function parseObject(raw: string): Record<string, any> | null {
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * The JSON object at the start of `raw`, found by matching braces (strings
 * respected), so text after it — "Prepare the proposed action…" — is allowed.
 */
function leadingObject(raw: string): { value: Record<string, any>; rest: string } | null {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      const value = parseObject(raw.slice(0, i + 1));
      return value ? { value, rest: raw.slice(i + 1) } : null;
    }
  }
  return null;
}

const MAX_FIELDS = 4;
const MAX_VALUE = 60;

/** "Name: Acme · Email: a@b.io · +2 more"; internal keys (`_trace`, `body_format`) and nested objects are left out. */
function summarizeFields(data: Record<string, any>): string {
  const shown: string[] = [];
  let hidden = 0;
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('_') || key === 'body_format') continue;
    const text = Array.isArray(value)
      ? value.filter(v => v != null && typeof v !== 'object').join(', ')
      : value == null || typeof value === 'object' ? '' : String(value);
    if (!text.trim()) continue;
    if (shown.length >= MAX_FIELDS) { hidden++; continue; }
    const short = text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
    shown.push(`${fieldLabel(key)}: ${short}`);
  }
  return shown.join(' · ') + (hidden ? ` · +${hidden} more` : '');
}

function fieldLabel(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
