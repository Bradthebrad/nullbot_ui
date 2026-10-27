import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const path = name => new URL('../src/' + name, import.meta.url);
const source = fs.readFileSync(path('skillMatching.ts'), 'utf8');
const context = vm.createContext({exports: {}});
vm.runInContext(ts.transpile(source, {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}), context);
const {matchSkills, highlightSkillWords} = context.exports;
const skills = [{name: 'mcp-skill', path: 'mcp/SKILL.md', description: 'Build and release MCP servers'}, {name: 'images', path: 'images/SKILL.md', description: 'Compose thumbnails and illustrations'}];
test('MCP keyword matches by whole word, case insensitive, not substrings', () => {
  assert.equal(matchSkills('Please use MCP', skills)[0].name, 'mcp-skill');
  assert.equal(matchSkills('xxmcp or mcpxx', skills).length, 0);
  assert.equal(matchSkills('the and please use skill files tools', skills).length, 0);
});
test('highlighting preserves exact editable text including whitespace and punctuation', () => {
  const text = 'MCP\n  mcp-skill <mcp> 🪄';
  const chunks = highlightSkillWords(text, matchSkills(text, skills));
  assert.equal(chunks.map(x => x.text).join(''), text);
  assert.equal(chunks.filter(x => x.highlighted).length, 3);
});
test('matches are path-deduplicated and capped, name match ranks before descriptions', () => {
  const many = Array.from({length: 9}, (_, i) => ({name: 'other' + i, path: String(i), description: 'MCP'}));
  const matches = matchSkills('mcp', [...many, ...skills, skills[0]]);
  assert.equal(matches.length, 5);
  assert.equal(matches[0].name, 'mcp-skill');
  assert.equal(new Set(matches.map(x => x.path)).size, 5);
});
test('settings owns opt-in and sending uses exactly the previewed automatic paths', () => {
  const composer = fs.readFileSync(path('features/chat/Composer.tsx'), 'utf8');
  const settings = fs.readFileSync(path('features/settings/AgentSettings.tsx'), 'utf8');
  assert.doesNotMatch(composer, /Suggest matching skills|Add skill context|selectedSkills/);
  assert.match(settings, /set\('ui.suggest_matching_skills', v\)/);
  assert.match(composer, /\.\.\.skillContext.paths/);
  assert.match(composer, /matches=\{skillContext.matches\}/);
  assert.match(composer, /!input.trim\(\).startsWith\('\/'\)/);
  assert.doesNotMatch(composer, /alsoMode|setAlsoMode/);
});
test('real textarea and reduced-motion/forced-color support remain available', () => {
  assert.match(fs.readFileSync(path('SkillComposer.tsx'), 'utf8'), /<textarea/);
  const css = fs.readFileSync(path('skill-composer.css'), 'utf8');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /forced-colors/);
});
