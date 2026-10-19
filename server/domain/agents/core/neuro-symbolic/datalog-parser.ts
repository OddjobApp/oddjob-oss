import { randomUUID } from 'crypto';
import { type LogicAtom, type LogicTerm, type LogicRule, type SymbolicFact, NeuroSymbolicError, NeuroSymbolicErrorType } from './types.js';
function invalid(text: string): never { throw new NeuroSymbolicError(NeuroSymbolicErrorType.PARSING_FAILED, `Unsupported or malformed Datalog: ${text}`); }
/** Split only outside quoted strings and parentheses. */
function split(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === '\\') { i++; continue; } if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')' && --depth < 0) invalid(text);
    if (depth === 0 && ch === delimiter) {
      if (delimiter === '.' && /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '')) continue;
      parts.push(text.slice(start, i).trim()); start = i + 1;
    }
  }
  if (quote || depth !== 0) invalid(text);
  parts.push(text.slice(start).trim()); return parts;
}
function term(text: string): LogicTerm {
  text = text.trim();
  if (/^(?:\?[A-Za-z_]|[A-Z_])[A-Za-z0-9_]*$/.test(text)) return { type: 'variable', name: text === '_' ? `_${randomUUID()}` : text.replace(/^\?/, '') };
  if (/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(text)) {
    const value = Number(text); if (!Number.isFinite(value)) invalid(text); return { type: 'constant', value };
  }
  if (text === 'true' || text === 'false') return { type: 'constant', value: text === 'true' };
  if (/^"(?:[^"\\]|\\.)*"$/.test(text)) { try { return { type: 'constant', value: JSON.parse(text) }; } catch { return invalid(text); } }
  if (/^'(?:[^'\\]|\\.)*'$/.test(text)) return { type: 'constant', value: text.slice(1, -1).replace(/\\(['\\])/g, '$1') };
  if (/^[a-z][A-Za-z0-9_]*$/.test(text)) return { type: 'constant', value: text };
  return invalid(text);
}
function atom(text: string): LogicAtom {
  text = text.trim();
  let negated = false;
  if (/^not\s+/.test(text)) { negated = true; text = text.replace(/^not\s+/, ''); }
  const relation = text.match(/^([a-z][A-Za-z0-9_]*)\((.*)\)$/s);
  if (relation) return { predicate: relation[1], arguments: relation[2].trim() ? split(relation[2], ',').map(term) : [], negated };
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    const op = text.slice(i).match(/^(>=|<=|!=|=|>|<)/)?.[0];
    if (op && !negated) return { predicate: op, arguments: [term(text.slice(0, i)), term(text.slice(i + op.length))], negated: false };
  }
  return invalid(text);
}
function withoutComments(text: string): string {
  let result = '', quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { result += ch; if (ch === '\\' && i + 1 < text.length) result += text[++i]; else if (ch === quote) quote = ''; }
    else if (ch === '"' || ch === "'") { quote = ch; result += ch; }
    else if (ch === '%') { while (i < text.length && text[i] !== '\n') i++; result += '\n'; }
    else result += ch;
  }
  return result;
}
export function parseQuery(text: string): LogicAtom { return atom(text.trim().replace(/^\?-\s*/, '').replace(/[.?]\s*$/, '').trim()); }
export function parseProgram(text: string): { facts: SymbolicFact[]; rules: LogicRule[] } {
  const facts: SymbolicFact[] = [], rules: LogicRule[] = [];
  const source = withoutComments(text).split('\n').map(line => {
    if (/^\s*\?-/.test(line) || /\)\s*\?\s*$/.test(line)) { parseQuery(line); return ''; } return line;
  }).join('\n');
  const statements = split(source, '.');
  if (statements.pop()) invalid('Each fact or rule must end with a period');
  for (const statement of statements) {
    if (!statement) invalid('Empty statement');
    let separator = -1, quote = '';
    for (let i = 0; i < statement.length; i++) {
      const ch = statement[i];
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (statement.slice(i, i + 2) === ':-') { separator = i; break; }
    }
    if (separator >= 0) {
      const head = atom(statement.slice(0, separator)), body = split(statement.slice(separator + 2), ',').map(atom);
      rules.push({ id: randomUUID(), name: `${head.predicate}_rule`, head, body, defeasible: false, priority: 0, source: 'injected', explanationTemplate: `Derived ${head.predicate}` });
    } else {
      const value = atom(statement);
      if (value.negated || value.arguments.some(t => t.type !== 'constant') || !/^[a-z]/.test(value.predicate)) invalid(statement);
      facts.push({ id: randomUUID(), predicate: value.predicate, arguments: value.arguments.map(t => (t as Extract<LogicTerm, { type: 'constant' }>).value), negated: false, source: 'extracted', confidence: 1, timestamp: new Date() });
    }
  }
  return { facts, rules };
}
