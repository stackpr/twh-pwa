// yaml.js — a deliberately small YAML subset. No dependencies.
//
// This is NOT a general YAML implementation and does not try to be. It supports
// exactly what the settings file needs, and rejects everything else with a line
// number rather than guessing:
//
//   key: value                 mappings, nested by indentation
//   - item                     block sequences
//   []  {}                     empty inline collections
//   "quoted"  'quoted'         quoted scalars (needed for keys with punctuation)
//   123  4.56  true  false     typed scalars
//   null  ~  (or empty)        null
//   # comment                  whole-line or trailing
//
// Not supported, and rejected loudly: tabs for indentation, anchors and aliases,
// multi-document streams, block scalars (| and >), inline collections with
// content, and complex keys. A volunteer editing this file in Notepad will not
// reach for any of them, and silently mis-parsing a financial settings file is
// far worse than refusing to open it.

export class YamlError extends Error {
  constructor(message, line) {
    super(line ? `Line ${line}: ${message}` : message);
    this.line = line;
  }
}

/* ------------------------------ parsing ------------------------------ */

function tokenize(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const out = [];
  const lines = text.split(/\r\n|\n|\r/);
  lines.forEach((raw, ix) => {
    const line = ix + 1;
    if (/^\s*$/.test(raw)) return;
    if (/^\s*#/.test(raw)) return;
    if (/^ *\t/.test(raw) || /^\t/.test(raw)) {
      throw new YamlError('indentation uses a tab. Use spaces only — two per level.', line);
    }
    const indent = raw.length - raw.trimStart().length;
    if (indent % 2 !== 0) {
      throw new YamlError(`indented by ${indent} space${indent === 1 ? '' : 's'}. Use two spaces per level.`, line);
    }
    out.push({ indent, content: raw.trim(), line });
  });
  return out;
}

// A quote character only quotes when it OPENS the scalar — that is, at position
// zero. Anywhere else it is an ordinary character, which is what makes a name
// like "Ranger's Fund" or an account with an inch mark in it survive the round
// trip. Treating every apostrophe as an opening quote would swallow the rest of
// the line looking for a partner that is never coming, and the file the app
// itself had just written would refuse to load. parseScalar reads quotes the
// same way, so the three stay consistent.
const opensQuote = (c, i) => i === 0 && (c === '"' || c === "'");

/** Split "key: value" at the first colon that is outside quotes. */
function splitKey(content, line) {
  let quote = null;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (opensQuote(c, i)) { quote = c; continue; }
    if (c === ':' && (i === content.length - 1 || content[i + 1] === ' ')) {
      return [content.slice(0, i).trim(), content.slice(i + 1).trim()];
    }
  }
  throw new YamlError(`expected "key: value" but found "${content}". A colon inside a name must be quoted.`, line);
}

/** Strip a trailing " # comment" that is outside quotes. */
function stripComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (opensQuote(c, i)) { quote = c; continue; }
    if (c === '#' && i > 0 && s[i - 1] === ' ') return s.slice(0, i).trim();
  }
  return s;
}

function parseScalar(raw, line) {
  const s = stripComment(raw).trim();
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === '[]') return [];
  if (s === '{}') return {};
  if (s[0] === '"' || s[0] === "'") {
    const q = s[0];
    if (s.length < 2 || s[s.length - 1] !== q) throw new YamlError(`unterminated ${q === '"' ? 'double' : 'single'} quote.`, line);
    const inner = s.slice(1, -1);
    return q === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner.replace(/''/g, "'");
  }
  if (s === 'true' || s === 'false') return s === 'true';
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  if (/^[[{]/.test(s)) throw new YamlError('inline lists and maps with content are not supported. Use one "- item" per line.', line);
  return s;
}

function parseBlock(toks, start, indent) {
  if (start >= toks.length) return [null, start];
  const isSeq = toks[start].content.startsWith('- ') || toks[start].content === '-';
  return isSeq ? parseSeq(toks, start, indent) : parseMap(toks, start, indent);
}

function parseMap(toks, i, indent) {
  const map = {};
  while (i < toks.length && toks[i].indent === indent) {
    const t = toks[i];
    if (t.content.startsWith('- ')) throw new YamlError('a list item appears where a "key: value" was expected.', t.line);
    const [rawKey, rawVal] = splitKey(t.content, t.line);
    const key = /^["']/.test(rawKey) ? parseScalar(rawKey, t.line) : rawKey;
    if (key === '') throw new YamlError('empty key.', t.line);
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      throw new YamlError(`duplicate key "${key}". Remove one of them.`, t.line);
    }
    const valueOnLine = stripComment(rawVal).trim();
    if (valueOnLine !== '') {
      map[key] = parseScalar(rawVal, t.line);
      i++;
    } else {
      const next = toks[i + 1];
      if (next && next.indent > indent) {
        const [child, ni] = parseBlock(toks, i + 1, next.indent);
        map[key] = child;
        i = ni;
      } else {
        map[key] = null;
        i++;
      }
    }
  }
  if (i < toks.length && toks[i].indent > indent) {
    throw new YamlError('unexpected extra indentation.', toks[i].line);
  }
  return [map, i];
}

function parseSeq(toks, i, indent) {
  const arr = [];
  while (i < toks.length && toks[i].indent === indent && (toks[i].content.startsWith('- ') || toks[i].content === '-')) {
    const t = toks[i];
    const rest = t.content === '-' ? '' : t.content.slice(2).trim();
    if (rest === '') {
      const next = toks[i + 1];
      if (next && next.indent > indent) {
        const [child, ni] = parseBlock(toks, i + 1, next.indent);
        arr.push(child);
        i = ni;
        continue;
      }
      arr.push(null); i++; continue;
    }
    arr.push(parseScalar(rest, t.line));
    i++;
  }
  return [arr, i];
}

export function parseYAML(text) {
  const toks = tokenize(text);
  if (!toks.length) return {};
  if (toks[0].indent !== 0) throw new YamlError('the file starts with an indented line.', toks[0].line);
  const [value, end] = parseBlock(toks, 0, 0);
  if (end < toks.length) throw new YamlError('unexpected content — check the indentation above this line.', toks[end].line);
  return value;
}

/* ------------------------------ emitting ------------------------------ */

/**
 * A pre-formatted scalar, written through verbatim. Used for currency so a
 * balance reads as 4925.50 rather than 4925.5 — YAML floats drop trailing
 * zeros, and this file is read by people, not just parsers. It still parses
 * back as a number on the way in.
 */
export class YamlRaw {
  constructor(text) { this.text = String(text); }
}
export const raw = text => new YamlRaw(text);

// Quote anything that would otherwise change meaning on the way back in.
const NEEDS_QUOTE = /^$|^[-?:,[\]{}#&*!|>'"%@`]|: |\s#|^\s|\s$|^(true|false|null|~)$|^-?\d+(\.\d+)?$/i;

function emitScalar(v) {
  if (v instanceof YamlRaw) return v.text;
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new YamlError(`cannot write a non-finite number (${v}).`);
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }
  const s = String(v);
  return NEEDS_QUOTE.test(s) ? '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : s;
}

const emitKey = k => (NEEDS_QUOTE.test(k) ? '"' + String(k).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : k);

/**
 * Emit a value as YAML lines. Objects and arrays nest; empty ones render inline
 * as {} / [] so a reader can see the key exists and is deliberately empty.
 */
export function stringifyYAML(value, depth = 0) {
  const pad = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (!value.length) return [];
    return value.flatMap(v => {
      if (v !== null && typeof v === 'object' && !(v instanceof YamlRaw)) {
        const kids = stringifyYAML(v, depth + 1);
        return kids.length ? [`${pad}-`, ...kids] : [`${pad}- {}`];
      }
      return [`${pad}- ${emitScalar(v)}`];
    });
  }
  if (value !== null && typeof value === 'object' && !(value instanceof YamlRaw)) {
    const lines = [];
    for (const [k, v] of Object.entries(value)) {
      if (v !== null && typeof v === 'object' && !(v instanceof YamlRaw)) {
        const empty = Array.isArray(v) ? !v.length : !Object.keys(v).length;
        if (empty) { lines.push(`${pad}${emitKey(k)}: ${Array.isArray(v) ? '[]' : '{}'}`); continue; }
        lines.push(`${pad}${emitKey(k)}:`);
        lines.push(...stringifyYAML(v, depth + 1));
      } else {
        lines.push(`${pad}${emitKey(k)}: ${emitScalar(v)}`);
      }
    }
    return lines;
  }
  return [`${pad}${emitScalar(value)}`];
}
