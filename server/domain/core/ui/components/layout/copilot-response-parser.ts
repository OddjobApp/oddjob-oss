import { parseAgentResponse, type InputRequest } from '@domain-ui/ai/ui/modules/agent-ai';
import { fractionDigitsFor } from '@domain-ui/core/ui/components/shared/fraction-digits';
import type {
  AssistantRichResponse,
  AssistantFormResponse,
  AssistantAppResponse,
  AssistantInstantAppResponse,
  AssistantInstantAppSurfaceResponse,
  ModeSwitchRequest,
  IntentClarificationResponse,
} from './copilot-chat-types';

/**
 * Find every balanced `{ ... }` span in `text` that mentions a "type" key.
 *
 * Balanced-brace scanning is the ONLY correct way to locate these payloads: the
 * rich-response envelopes nest (a form's schema.fields[], a surface's blocks[]),
 * so any regex ending in `\}` matches the first INNER closing brace and both
 * mis-parses and mis-strips the payload.
 */
export function findBalancedJsonSpans(text: string): Array<{ start: number; end: number; raw: string }> {
  const spans: Array<{ start: number; end: number; raw: string }> = [];
  let depth = 0;
  let startIdx = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    // Braces inside a JSON string literal must not move the depth counter.
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }

    if (ch === '{') {
      if (depth === 0) startIdx = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && startIdx !== -1) {
          const raw = text.slice(startIdx, i + 1);
          if (raw.includes('"type"')) spans.push({ start: startIdx, end: i + 1, raw });
          startIdx = -1;
        }
      }
    }
  }
  return spans;
}

/** The payload `type` values the chat renders as a rich (non-prose) response. */
export const RICH_RESPONSE_TYPES = [
  'assistant_form',
  'assistant_app',
  'instant_app',
  'instant_app_surface',
  'mode_switch_request',
  'input_request',
  'launch_tutorial',
  'intent_clarification',
];

export function extractJsonPayloadWithSpan(content: string): { payload: any; raw: string } | null {
  const trimmed = content.trim();
  const candidates: Array<{ text: string; raw: string }> = [];

  if (trimmed.startsWith('{') && trimmed.includes('"type"')) {
    candidates.push({ text: trimmed, raw: trimmed });
  }

  // A fenced block: parse the inner JSON but strip the WHOLE fence, so the
  // stray ``` markers don't survive into the prose.
  const fencedMatches = trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi);
  for (const match of fencedMatches) {
    if (match[1] && match[1].includes('"type"')) {
      candidates.push({ text: match[1].trim(), raw: match[0] });
    }
  }

  for (const span of findBalancedJsonSpans(trimmed)) {
    candidates.push({ text: span.raw, raw: span.raw });
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.text);
      if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
        return { payload: parsed, raw: candidate.raw };
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

export function extractJsonPayload(content: string): any | null {
  return extractJsonPayloadWithSpan(content)?.payload ?? null;
}

/**
 * Strip internal agent-loop bookkeeping that is not meant for a human reader.
 *
 * The orchestrator annotates observations with verification markers, and rich
 * responses are surfaced to the user VERBATIM as an interruption — so a failed
 * verification put `[Verification: FAILED] … Context: Verification tool
 * render_instant_app returned failure: Error: Invalid parameters …` on screen
 * above the app. The server-side fix keeps this out of rich payloads; this is
 * the display-side backstop for history already persisted with the markers.
 */
export function stripInternalScaffolding(text: string): string {
  return text
    .replace(/^\s*\[Verification:\s*(?:PASSED|FAILED)\]\s*/i, '')
    .replace(/^\s*Context:\s*Verification tool .*?(?:\n|$)/gim, '')
    .replace(/^\s*\[Self-Corrected from previous error:[\s\S]*?\]\s*/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Remove the rich-response payload from a message so only the human prose is
 * rendered. Strips the EXACT balanced span the parser matched — never a regex,
 * which truncated at the first nested `}` and left the payload's tail
 * (`,{"key":"annualRate",…]}}`) on screen as prose.
 */
export function stripRichPayloadFromProse(content: string): string {
  let text = content.trim();

  // Repeat: a message may carry a fenced payload AND a bare one.
  for (let pass = 0; pass < 4; pass++) {
    const found = extractJsonPayloadWithSpan(text);
    if (!found || !RICH_RESPONSE_TYPES.includes(found.payload.type)) break;
    const idx = text.indexOf(found.raw);
    if (idx === -1) break;
    text = (text.slice(0, idx) + text.slice(idx + found.raw.length)).trim();
  }

  return text
    // A payload that was truncated mid-flight leaves an unparseable tail; drop
    // any line that is nothing but JSON punctuation and key/value noise.
    .replace(/^\s*[\]\}],?\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseAssistantRichResponse(content: string): AssistantRichResponse | null {
  const agentParsed = parseAgentResponse(content);
  if (agentParsed.type === 'input_request') {
    return { type: 'input_request', data: agentParsed.data as InputRequest };
  }

  const payload = extractJsonPayload(content);
  if (!payload || typeof payload !== 'object') return null;

  if (payload.type === 'assistant_form' && payload.schema?.fields && Array.isArray(payload.schema.fields)) {
    return { type: 'assistant_form', data: payload as AssistantFormResponse };
  }

  if (payload.type === 'assistant_app' && (payload.slug || payload.href) && payload.title) {
    return { type: 'assistant_app', data: payload as AssistantAppResponse };
  }

  if (payload.type === 'instant_app') {
    const moduleName = payload.module || payload.componentName || payload.component;
    if (typeof moduleName === 'string' && moduleName.trim().length > 0) {
      const normalizedData: AssistantInstantAppResponse = {
        type: 'instant_app',
        module: moduleName.trim(),
        componentName: payload.componentName || moduleName.trim(),
        title: payload.title || payload.componentName || moduleName.trim(),
        note: payload.note || '',
        props: payload.props && typeof payload.props === 'object' ? payload.props : {},
      };
      return { type: 'instant_app', data: normalizedData };
    }
  }

  if (payload.type === 'instant_app_surface' && Array.isArray(payload.blocks)) {
    return { type: 'instant_app_surface', data: payload as AssistantInstantAppSurfaceResponse };
  }

  if (payload.type === 'mode_switch_request') {
    return { type: 'mode_switch_request', data: payload as ModeSwitchRequest };
  }

  // Without this branch the sheet's clarification card was unreachable and the
  // envelope rendered as raw JSON prose.
  if (payload.type === 'intent_clarification' && (payload.question || payload.headline)) {
    return { type: 'intent_clarification', data: payload as IntentClarificationResponse };
  }

  if (payload.type === 'launch_tutorial' && typeof payload.trackId === 'string' && payload.trackId.trim().length > 0) {
    return {
      type: 'launch_tutorial',
      data: {
        trackId: payload.trackId.trim(),
        title: payload.title || `Guided Tour: ${payload.trackId.trim()}`,
        description: payload.description || payload.reason || '',
      },
    };
  }

  return null;
}

const SUBMISSION_ECHO_PREFIXES: Array<{ re: RegExp; title: string }> = [
  { re: /^Submitted assistant form:\s*/i, title: 'Form submitted' },
  { re: /^Submitted \*\*[^*]+\*\*:\s*/i, title: 'Form submitted' },
  { re: /^Submitted form:\s*/i, title: 'Form submitted' },
  { re: /^Submitted inputs:\s*/i, title: 'Inputs submitted' },
  { re: /^Submitted requested inputs for [^\s:]+:\s*/i, title: 'Inputs submitted' },
];

export function parseSubmissionEcho(content: string): { title: string; values: Record<string, any> } | null {
  for (const { re, title } of SUBMISSION_ECHO_PREFIXES) {
    const match = content.match(re);
    if (!match) continue;
    try {
      const parsed = JSON.parse(content.slice(match[0].length).trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { title, values: parsed };
      }
    } catch {
      // Not parseable — fall through and let it render as ordinary text.
    }
  }
  return null;
}

/**
 * "annualRate" / "loan_term_years" → "Annual Rate" / "Loan Term Years".
 * A schema label is used when one is available; this is the fallback so a raw
 * camelCase key is never shown shouting in uppercase.
 */
export function humanizeFieldKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Render a submitted value the way a person wrote it, not the way JSON stores it. */
export function formatSubmittedValue(value: any): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  // Precision scales with magnitude (shared with FormRenderer): a fixed 2 digits
  // printed a 0.00375 monthly rate as "0", which reads as a failed calculation.
  if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: fractionDigitsFor(value) });
  if (Array.isArray(value)) return value.map(formatSubmittedValue).join(', ');
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([k, v]) => `${humanizeFieldKey(k)}: ${formatSubmittedValue(v)}`).join(', ');
  }
  // Numeric strings arrive from number inputs; group them so 1600000 reads as 1,600,000.
  const asNumber = typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (Number.isFinite(asNumber) && String(value).trim().match(/^-?\d+(\.\d+)?$/)) {
    return asNumber.toLocaleString(undefined, { maximumFractionDigits: fractionDigitsFor(asNumber) });
  }
  return String(value);
}
