/**
 * Shared JSON diff utilities for both client and server/test usage.
 * Aligned with docs/specs/HIL_2_ACCOUNTABILITY_SPEC.md
 */

export type DiffLineType = 'add' | 'remove' | 'same';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

/**
 * Compute a line-by-line diff between two strings.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldNum = 1;
  let newNum = 1;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      result.push({ type: 'same', content: oldLines[i], oldLineNum: oldNum, newLineNum: newNum });
      i++;
      j++;
      oldNum++;
      newNum++;
    } else if (j < newLines.length && (i >= oldLines.length || !oldLines.slice(i).includes(newLines[j]))) {
      result.push({ type: 'add', content: newLines[j], newLineNum: newNum });
      j++;
      newNum++;
    } else if (i < oldLines.length && (j >= newLines.length || !newLines.slice(j).includes(oldLines[i]))) {
      result.push({ type: 'remove', content: oldLines[i], oldLineNum: oldNum });
      i++;
      oldNum++;
    } else {
      result.push({ type: 'remove', content: oldLines[i], oldLineNum: oldNum });
      result.push({ type: 'add', content: newLines[j], newLineNum: newNum });
      i++;
      j++;
      oldNum++;
      newNum++;
    }
  }

  return result;
}

export type ImpactLevel = 'none' | 'minor' | 'major' | 'structural';

/**
 * Compute impact level from diff for Shadow Mode indicator.
 */
export function computeImpactLevel(oldText: string, newText: string): ImpactLevel {
  if (oldText === newText) return 'none';

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const charDelta = Math.abs(newText.length - oldText.length);
  const lineDelta = Math.abs(newLines.length - oldLines.length);

  try {
    const oldObj = JSON.parse(oldText);
    const newObj = JSON.parse(newText);
    const oldKeys = Object.keys(flattenKeys(oldObj)).length;
    const newKeys = Object.keys(flattenKeys(newObj)).length;
    const keyDelta = Math.abs(newKeys - oldKeys);

    if (keyDelta > 0 || Array.isArray(oldObj) !== Array.isArray(newObj)) return 'structural';
    if (lineDelta > 10 || charDelta > 500 || keyDelta > 5) return 'major';
    if (lineDelta > 2 || charDelta > 50) return 'minor';
  } catch {
    if (lineDelta > 10 || charDelta > 500) return 'major';
  }

  return 'minor';
}

function flattenKeys(obj: any, prefix = ''): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (obj === null || typeof obj !== 'object') {
    out[prefix || 'value'] = true;
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => Object.assign(out, flattenKeys(v, `${prefix}[${i}]`)));
    return out;
  }
  for (const k of Object.keys(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out[p] = true;
    Object.assign(out, flattenKeys(obj[k], p));
  }
  return out;
}
