import { parse } from 'acorn';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const input = 'assets/index-BzuZHiF7.js';
export function literal(node) {
  if (node.type === 'Literal') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node.type === 'ArrayExpression') return node.elements.map(literal);
  if (node.type === 'UnaryExpression' && node.operator === '!') return !literal(node.argument);
  if (node.type === 'UnaryExpression' && node.operator === '-') return -literal(node.argument);
  if (node.type === 'ObjectExpression') {
    const value = {};
    for (const p of node.properties) {
      if (p.type !== 'Property' || p.computed || p.method || p.kind !== 'init') throw Error('Nonliteral property');
      const key = p.key.type === 'Identifier' ? p.key.name : literal(p.key);
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw Error('Unsafe data key');
      value[key] = literal(p.value);
    }
    return value;
  }
  throw Error(`Not literal-only: ${node.type}`);
}
export function extract(source = readFileSync(input, 'utf8')) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const nodes = [];
  function visit(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'VariableDeclarator' && n.init?.type === 'ObjectExpression' &&
      n.init.properties.some(p => p.key?.name === 'pack') && n.init.properties.some(p => p.key?.name === 'tracks')) nodes.push(n.init);
    for (const [k, v] of Object.entries(n)) if (k !== 'start' && k !== 'end') {
      if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object') visit(v);
    }
  }
  visit(ast);
  if (nodes.length !== 1) throw Error(`Expected one course literal, got ${nodes.length}`);
  const node = nodes[0], original = literal(node), course = structuredClone(original);
  let count = 0;
  for (const t of course.tracks) for (const s of t.sections) for (const u of s.units) for (const l of u.lessons) for (const item of l.items) {
    if (item.say === 'Welche Richtung?' && item.lang === 'eu = oy.') {
      const expected = { hear: null, say: 'Welche Richtung?', en: 'Richtung Kreuzberg.', es: 'Direction Kreuzberg.', ph: 'Dirección Kreuzberg.', why: 'RIKH-toong KROYTS-berg', lang: 'eu = oy.' };
      if (JSON.stringify(item) !== JSON.stringify(expected) || t.id !== 'de' || l.id !== 'a1') throw Error('Unexpected corrupt item');
      Object.assign(item, { say: 'Richtung Kreuzberg.', en: 'Direction Kreuzberg.', es: 'Dirección Kreuzberg.', ph: 'RIKH-toong KROYTS-berg', why: 'eu = oy.', lang: 'de' });
      count++;
    }
  }
  if (count !== 1) throw Error('Expected exactly one reviewed correction');
  const replacement = JSON.stringify(course), patched = source.slice(0, node.start) + replacement + source.slice(node.end);
  if (patched.slice(0, node.start) !== source.slice(0, node.start) || patched.slice(node.start + replacement.length) !== source.slice(node.end)) throw Error('Executable code changed');
  return { original, course, patched, node, replacement, source };
}
export const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
