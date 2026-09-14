import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/skillMatching.ts', import.meta.url), 'utf8');
const exports = {};
const context = vm.createContext({exports});
vm.runInContext(ts.transpile(source, {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}), context);
const {matchSkills, highlightSkillWords} = exports;
const skills = [
  {name: 'mcp-skill', path: 'mcp/SKILL.md', description: 'Build MCP servers in Go'},
  {name: 'images', path: 'images/SKILL.md', description: 'Generate images and thumbnails'},
];
test('whole-word matching recognizes skill-name tokens without substring false positives', () => {
  assert.equal(matchSkills('MCP', skills)[0].name, 'mcp-skill');
  assert.equal(matchSkills('notmcp', skills).length, 0);
  assert.equal(matchSkills('please use the skill', skills).length, 0);
});
test('metadata matches are deduplicated and removed when keyword disappears', () => {
  assert.equal(matchSkills('mcp mcp', [...skills, skills[0]]).length, 1);
  assert.equal(matchSkills('', skills).length, 0);
  assert.equal(matchSkills('thumbnails', skills)[0].name, 'images');
});
test('highlight mirror preserves draft verbatim including Unicode, whitespace and punctuation', () => {
  const text = 'Hi! MCP\n\t<mcp> café 😀';
  const parts = highlightSkillWords(text, matchSkills(text, skills));
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(Array.from(parts.filter(part => part.highlighted), part => part.text), ['MCP', 'mcp']);
});
test('skill-name matches rank before incidental description matches', () => {
  const candidates = [{name: 'other', path: 'other', description: 'mcp'}, ...skills];
  assert.equal(matchSkills('mcp', candidates, 1)[0].name, 'mcp-skill');
});
