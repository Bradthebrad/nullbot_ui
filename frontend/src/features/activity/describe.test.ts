import {describe, expect, it} from 'vitest';
import {describeStep, resultLinks, stepDetail, stepSource} from './describe';
import type {Step} from './model';

const step = (patch: Partial<Step>): Step => ({key: 'k', kind: 'tool', state: 'done', seq: 1, agent: 'main', ...patch} as Step);

describe('describeStep', () => {
  it('turns known tools into plain sentences, with tense following state', () => {
    expect(describeStep(step({tool: 'web_search', state: 'running', args: {query: 'acme q3'}})).title).toBe('Searching the web for “acme q3”');
    expect(describeStep(step({tool: 'web_search', args: {query: 'acme q3'}})).title).toBe('Searched the web for “acme q3”');
    expect(describeStep(step({tool: 'read_file', state: 'error', args: {path: 'C:\\work\\acme\\runbooks\\escalation.md'}})).title).toBe('Couldn’t read …/runbooks/escalation.md');
  });

  it('never shows raw JSON for tools it does not know', () => {
    const title = describeStep(step({tool: 'get_issue', args: {key: 'OPS-2219', options: {deep: true}}})).title;
    expect(title).toMatch(/OPS-2219/);
    expect(title).not.toMatch(/[{}]/);
  });

  it('says what was blocked and why', () => {
    const blocked = step({tool: 'write_file', state: 'blocked', args: {path: 'D:\\docs\\status.md'}, permission: {allowed: false, capability: 'write', source: 'builtin', rule: 'builtin', reason: 'docs is read only'}});
    const description = describeStep(blocked);
    expect(description.title).toMatch(/^Blocked: writing/);
    expect(description.detail).toBe('docs is read only');
  });

  it('summarizes thinking by its first line', () => {
    expect(describeStep(step({kind: 'thinking', state: 'running', text: '**Plan.** Read the logs\nthen fix'}))).toMatchObject({title: 'Thinking', detail: 'Plan. Read the logs'});
  });
});

describe('stepDetail', () => {
  it('prefers counts from result metadata', () => {
    expect(stepDetail(step({tool: 'search_issues', resultMeta: {items: 3}}))).toBe('3 results');
    expect(stepDetail(step({tool: 'fetch', resultMeta: {links: ['https://a', 'https://b']}}))).toBe('2 links');
    expect(stepDetail(step({tool: 'x', resultMeta: {items: 1, content_types: {image: 2}}}))).toBe('1 item, 2 images');
  });

  it('falls back to the first line of an error', () => {
    expect(stepDetail(step({state: 'error', error: 'Error: timed out\nstack…'}))).toBe('timed out');
  });
});

describe('stepSource and links', () => {
  it('names the subagent and the server without prefixes', () => {
    expect(stepSource(step({server: 'nullbot-wiki-mcp'}))).toBe('wiki');
    expect(stepSource(step({agentName: 'researcher', serverTitle: 'Company Wiki', server: 'wiki'}))).toBe('researcher via Company Wiki');
    expect(stepSource(step({source: 'builtin'}))).toBe('NullBot');
  });

  it('surfaces links from metadata first', () => {
    expect(resultLinks(step({resultMeta: {links: ['https://status.example/1']}, result: 'see https://other.example'}))).toContain('https://status.example/1');
  });
});
