import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const panelSource = read('../src/ServiceAccountsPanel.tsx');
const definitionsSource = read('../src/serviceAccounts.ts');
const catalog = JSON.parse(read('./fixtures/service-account-catalog.json'));
const tick = () => new Promise(resolve => setImmediate(resolve));

// Existing dependency-free hook-harness approach. Each component has its own
// hooks; child elements remain descriptors, so modal DOM is not simulated.
function mount(name, props, confirm = () => true) {
  const slots = []; const effects = []; let cursor = 0;
  const context = vm.createContext({
    React: {createElement(type, props, ...children) {
      return {type, props: {...props, children: children.flat(Infinity)}, children: children.flat(Infinity)};
    }},
    useState(initial) {const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => {slots[i] = typeof value === 'function' ? value(slots[i]) : value;}];},
    useRef(initial) {const i = cursor++; return slots[i] ??= {current: initial};},
    useEffect(effect, deps) {const i = cursor++; if (!slots[i] || deps.some((d, n) => d !== slots[i][n])) {slots[i] = deps; effects.push(effect);}},
    window: {confirm},
    ServiceAccountStatus() {throw Error('Unexpected real bridge call');},
    SaveServiceAccount() {throw Error('Unexpected real bridge call');},
    DeleteServiceAccount() {throw Error('Unexpected real bridge call');},
  });
  const source = (definitionsSource + '\n' + panelSource).replace(/^import .*;\r?\n/gm, '').replace(/export default /g, '').replace(/export /g, '');
  vm.runInContext(ts.transpile(source, {target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React}), context);
  return {
    context,
    render() {cursor = 0; return context[name](props);},
    async flush() {effects.splice(0).forEach(effect => effect()); await tick();},
  };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flatMap(child => nodes(child, predicate))];
}
const text = tree => typeof tree === 'string' ? tree : (tree?.children || []).map(text).join('');
const button = (tree, label) => nodes(tree, n => n.type === 'button' && text(n) === label)[0];
const card = (tree, name) => nodes(tree, n => n.type === 'article' && text(n).startsWith(name))[0];
const service = id => vm.runInContext(`serviceDefinitions.find(s => s.id === '${id}')`, mount('ServiceAccountsPanel', {}).context);
const account = {id: 'fixture-one', service: 'gmail', label: 'Work', status: 'configured_unverified', allow_write: true};
const state = {services: [{service: 'gmail', server_id: 'nullbot-emails-mcp', status: 'disabled'}], accounts: [account]};
const noAPI = {status: async () => state, save: async () => {}, remove: async () => {}};
const submit = view => nodes(view.render(), n => n.type === 'form')[0].props.onSubmit({preventDefault() {}});
function change(view, label, value) {
  const node = nodes(view.render(), n => n.type === 'label' && text(n).startsWith(label))[0];
  nodes(node, n => n.type === 'input')[0].props.onChange({target: {value, checked: value}});
}
const credentialInputs = view => nodes(view.render(), n => n.type === 'input' && n.props.maxLength === 16384);

test('supported UI fields exactly match the shared backend catalog fixture', () => {
  const context = mount('ServiceAccountsPanel', {}).context;
  const actual = vm.runInContext(`serviceDefinitions.filter(s => !s.unavailable).map(s => ({id:s.id, server_id:s.packageID, fields:s.fields.map(f => ({key:f.key, secret:!!f.secret, required:!f.optional}))}))`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), catalog);
  for (const [status, expected] of Object.entries({not_installed: 'MCP not installed', disabled: 'MCP disabled', not_configured: 'No local credentials configured', configured_unverified: 'Configured locally — unverified', unexpected: 'Local status unavailable'})) {
    assert.equal(context.localStatus(status), expected);
  }
});

test('new providers explain their restricted integration contracts', () => {
  const help = id => service(id).detail + ' ' + service(id).help.join(' ');
  assert.match(help('gmail_imap'), /fixed TLS Gmail IMAP\/SMTP/);
  assert.match(help('gmail_imap'), /not your normal Google password/);
  assert.match(help('discord'), /No selfbot or personal account login/);
  assert.match(help('telegram'), /pending.*not.*history/i);
  assert.match(help('telegram'), /does not acknowledge updates or advance an offset/);
  assert.match(help('telegram'), /numeric chat IDs/);
  assert.match(help('signal'), /Unofficial/i);
  assert.match(help('signal'), /Outbound only/);
  assert.match(help('signal'), /separately installed.*signal-cli-rest-api/);
  assert.match(help('signal'), /does not install.*link a device/);
  assert.match(help('signal'), /http:\/\/127\.0\.0\.1:<port>/);
  assert.match(help('signal'), /no trailing slash/);
  assert.doesNotMatch(help('signal'), /optional trailing slash|at most a trailing slash/);
  assert.match(help('signal'), /7–15 digits/);
  assert.match(help('gmail_imap'), /254/);
  assert.match(help('gmail_imap'), /256/);
  assert.match(help('discord'), /20–256/);
  assert.match(help('telegram'), /30–128/);
  assert.match(help('signal'), /4096/);
  assert.match(help('signal'), /http:\/\/\[::1\]:<port>/);
});

test('new provider forms submit exact fields and wipe secrets after success', async () => {
  // Valid synthetic connector credentials; no provider or bridge is contacted.
  const fixtures = {
    gmail_imap: {email: 'fixture@example.com', app_password: 'abcd efgh ijkl mnop'},
    discord: {bot_token: 'synthetic_discord.segment.signature'},
    telegram: {bot_token: '123456:synthetic_URL-safe-token_0123456789'},
    signal: {bridge_url: 'http://127.0.0.1:8080', number: '+15551234567'},
  };
  for (const id of ['gmail_imap', 'discord', 'telegram', 'signal']) {
    const definition = service(id);
    let request;
    const view = mount('ServiceAccountEditor', {editor: {service: definition}, onSave: async value => {request = value;}, onClose() {}});
    change(view, 'Account label', 'Synthetic fixture');
    for (const field of definition.fields) {
      if (!field.optional) change(view, field.label, fixtures[id][field.key]);
    }
    definition.fields.forEach((field, i) => {
      const input = credentialInputs(view)[i];
      assert.equal(input.props.required, !field.optional);
      assert.equal(input.props.autoComplete, field.secret ? 'new-password' : 'off');
    });
    await submit(view);
    assert.equal(request.service, id);
    assert.equal(request.allow_write, false);
    assert.deepEqual(Object.keys(request.fields), Array.from(definition.fields.filter(f => !f.optional), f => f.key));
    assert.ok(credentialInputs(view).every(input => input.props.value === ''));
  }
});

test('Signal replacement never preloads or retains optional API token', async () => {
  for (const blank of [false, true]) {
    let request;
    const prompts = [];
    const definition = service('signal');
    const view = mount('ServiceAccountEditor', {editor: {service: definition, account: {...account, service: 'signal', fields: {api_token: 'DO-NOT-PREFILL'}}}, onSave: async value => {request = value;}, onClose() {}}, prompt => {prompts.push(prompt); return true;});
    change(view, 'Loopback bridge URL', 'http://127.0.0.1:8080');
    change(view, 'Signal sender', '+15551234567');
    if (blank) change(view, 'Bridge API token', '');
    await submit(view);
    assert.equal(request.fields.api_token, blank ? '' : undefined);
    assert.equal(request.allow_write, false);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /Blank optional fields will be removed/);
    assert.doesNotMatch(JSON.stringify(request), /DO-NOT-PREFILL/);
  }
});

test('service accounts are mounted once, in Settings > Accounts', () => {
  const accounts = read('../src/features/settings/AccountsSettings.tsx');
  assert.equal((accounts.match(/<ServiceAccountsPanel \/>/g) || []).length, 1);
  for (const file of ['../src/App.tsx', '../src/features/settings/ModelsSettings.tsx', '../src/features/settings/SettingsView.tsx']) assert.doesNotMatch(read(file), /<ServiceAccountsPanel/);
});

test('offline status is metadata only; unavailable tiles have no add or replace', async () => {
  let reads = 0;
  const view = mount('ServiceAccountsPanel', {api: {...noAPI, status: async () => {reads++; return state;}}});
  assert.equal(button(card(view.render(), 'Gmail'), 'Add account').props.disabled, true);
  await view.flush();
  assert.equal(reads, 1);
  assert.match(text(card(view.render(), 'Gmail')), /MCP disabled/);
  assert.match(text(card(view.render(), 'Gmail')), /1 locally saved/);
  for (const name of ['Yahoo Mail', 'iCloud Mail', 'Skype', 'iMessage']) {
    const tile = card(view.render(), name);
    assert.match(text(tile), /Unavailable/);
    assert.equal(button(tile, 'Add account'), undefined);
    assert.equal(button(tile, 'Replace credentials'), undefined);
    assert.ok(button(tile, 'Setup help'));
  }
  await button(view.render(), 'Refresh local status').props.onClick();
  assert.equal(reads, 2);
  assert.match(text(view.render()), /Credentials were not verified/);
});

test('every add/replacement editor has blank credential inputs and write off', () => {
  for (const definition of catalog) {
    for (const replacing of [false, true]) {
      const view = mount('ServiceAccountEditor', {editor: {service: service(definition.id), account: replacing ? {...account, service: definition.id, fields: {access_token: 'DO-NOT-PREFILL'}} : undefined}, onSave: async () => {}, onClose() {}});
      const inputs = credentialInputs(view);
      assert.equal(inputs.length, definition.fields.length);
      assert.ok(inputs.every(input => input.props.value === ''));
      assert.equal(nodes(view.render(), n => n.type === 'input' && n.props.type === 'checkbox')[0].props.checked, false);
      assert.doesNotMatch(text(view.render()), /DO-NOT-PREFILL/);
      definition.fields.forEach((field, i) => assert.equal(inputs[i].props.type, field.secret ? 'password' : 'text'));
    }
  }
});

test('replacement and write escalation require independent explicit confirmations', async () => {
  for (const answers of [[false], [true, false], [true, true]]) {
    const calls = []; const prompts = [];
    const view = mount('ServiceAccountEditor', {editor: {service: service('gmail'), account}, onSave: async request => calls.push(request), onClose() {}}, prompt => {prompts.push(prompt); return answers[prompts.length - 1];});
    change(view, 'Access token', 'dummy-token');
    change(view, 'Allow write', true);
    await submit(view);
    assert.match(prompts[0], /Allow write\/send/);
    if (answers[0]) assert.match(prompts[1], /Replace all saved credentials/);
    assert.equal(calls.length, answers.every(Boolean) ? 1 : 0);
    if (calls.length) {
      assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {id: account.id, service: 'gmail', label: 'Work', fields: {access_token: 'dummy-token'}, allow_write: true});
      assert.ok(credentialInputs(view).every(input => input.props.value === ''));
    }
  }
});

test('read-only replacement still requires confirmation; add uses empty backend-generated ID', async () => {
  let saves = 0;
  const replacement = mount('ServiceAccountEditor', {editor: {service: service('gmail'), account}, onSave: async () => {saves++;}, onClose() {}}, () => false);
  change(replacement, 'Access token', 'dummy-token');
  await submit(replacement);
  assert.equal(saves, 0);
  let request;
  const add = mount('ServiceAccountEditor', {editor: {service: service('gmail')}, onSave: async value => {request = value;}, onClose() {}}, () => {throw Error('Read-only add needs no replacement confirmation');});
  change(add, 'Account label', '  Personal  ');
  change(add, 'Access token', 'dummy-token');
  await submit(add);
  assert.equal(request.id, ''); assert.equal(request.label, 'Personal'); assert.equal(request.allow_write, false);
});

test('save failure never echoes backend exceptions and clears credentials', async () => {
  const view = mount('ServiceAccountEditor', {editor: {service: service('twilio')}, onSave: async () => {throw Error('SENSITIVE-ERROR');}, onClose() {}});
  change(view, 'Account label', 'Fixture');
  for (const field of service('twilio').fields) change(view, field.label, 'dummy-secret');
  await submit(view);
  assert.match(text(view.render()), /Could not save this account/);
  assert.doesNotMatch(text(view.render()), /SENSITIVE-ERROR|dummy-secret/);
  assert.ok(credentialInputs(view).every(input => input.props.value === ''));
});

test('delete cancellation is side-effect free; confirmed delete is local only', async () => {
  for (const accepted of [false, true]) {
    const calls = []; const prompts = [];
    const view = mount('ServiceAccountsPanel', {api: {...noAPI, remove: async id => calls.push(id)}}, prompt => {prompts.push(prompt); return accepted;});
    view.render(); await view.flush();
    await button(view.render(), 'Delete account').props.onClick();
    assert.deepEqual(calls, accepted ? [account.id] : []);
    assert.match(prompts[0], /does not revoke provider tokens/);
    if (accepted) assert.match(text(view.render()), /Local account deleted/);
  }
});

test('read and delete failures are sanitized; failed refresh disables mutation', async () => {
  let failRead = true;
  const view = mount('ServiceAccountsPanel', {api: {...noAPI, status: async () => {if (failRead) throw Error('SENSITIVE-ERROR'); return state;}, remove: async () => {throw Error('SENSITIVE-ERROR');}}});
  view.render(); await view.flush();
  assert.match(text(view.render()), /Could not read local/);
  assert.equal(button(card(view.render(), 'Gmail'), 'Add account').props.disabled, true);
  failRead = false;
  await button(view.render(), 'Refresh local status').props.onClick();
  await button(view.render(), 'Delete account').props.onClick();
  assert.match(text(view.render()), /Account could not be deleted/);
  assert.doesNotMatch(text(view.render()), /SENSITIVE-ERROR/);
  failRead = true;
  await button(view.render(), 'Refresh local status').props.onClick();
  assert.equal(button(card(view.render(), 'Gmail'), 'Add account').props.disabled, true);
  assert.equal(button(view.render(), 'Delete account'), undefined);
});

test('successful save with failed status reload does not report save failure or permit blind retry', async () => {
  let reads = 0; let saves = 0;
  const view = mount('ServiceAccountsPanel', {api: {...noAPI, status: async () => {if (++reads > 1) throw Error('SENSITIVE-ERROR'); return state;}, save: async () => {saves++;}}});
  view.render(); await view.flush();
  button(card(view.render(), 'Gmail'), 'Replace credentials').props.onClick();
  const editor = nodes(view.render(), n => n.type?.name === 'ServiceAccountEditor')[0];
  await editor.props.onSave({id: account.id, service: 'gmail', label: 'Work', fields: {access_token: 'dummy'}, allow_write: false});
  assert.equal(saves, 1);
  assert.match(text(view.render()), /Saved locally — unverified/);
  assert.match(text(view.render()), /Local status could not be refreshed/);
  assert.doesNotMatch(text(view.render()), /SENSITIVE-ERROR|Could not save/);
  assert.equal(nodes(view.render(), n => n.type?.name === 'ServiceAccountEditor').length, 0);
  assert.equal(button(card(view.render(), 'Gmail'), 'Add account').props.disabled, true);
});

test('local Wails bindings forward only their exact arguments and return no secret status fields', async () => {
  const calls = [];
  const context = vm.createContext({window: {go: {main: {App: Object.fromEntries(['ServiceAccountStatus', 'ServiceAccountCatalog', 'SaveServiceAccount', 'DeleteServiceAccount'].map(name => [name, (...args) => {calls.push([name, ...args]); return Promise.resolve(name === 'ServiceAccountStatus' ? state : undefined);}]))}}}});
  vm.runInContext(read('../wailsjs/go/main/App.js').replace(/export /g, ''), context);
  assert.equal(await context.ServiceAccountStatus(), state);
  await context.ServiceAccountCatalog();
  const request = {id: '', service: 'gmail', fields: {access_token: 'dummy'}, allow_write: false};
  await context.SaveServiceAccount(request); await context.DeleteServiceAccount('fixture-one');
  assert.deepEqual(calls, [['ServiceAccountStatus'], ['ServiceAccountCatalog'], ['SaveServiceAccount', request], ['DeleteServiceAccount', 'fixture-one']]);
  assert.doesNotMatch(panelSource + definitionsSource, /fetch\(|localStorage|sessionStorage|console\.|MarketInstall|EnableMCP/);
  const models = vm.createContext({exports: {}});
  vm.runInContext(ts.transpile(read('../wailsjs/go/models.ts'), {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}), models);
  const converted = models.exports.app.ServiceAccountState.createFrom({services: state.services, accounts: [{...account, fields: {access_token: 'SHOULD-BE-DROPPED'}}]});
  assert.deepEqual(JSON.parse(JSON.stringify(converted)), state);
  assert.doesNotMatch(JSON.stringify(converted), /SHOULD-BE-DROPPED|access_token|fields/);
});

test('pending saves disable editor and duplicate submit; closing discards unsaved values', async () => {
  let finish; let saves = 0;
  const props = {editor: {service: service('gmail')}, onSave: () => {saves++; return new Promise(resolve => {finish = resolve;});}, onClose() {}};
  const view = mount('ServiceAccountEditor', props);
  change(view, 'Account label', 'Work'); change(view, 'Access token', 'dummy');
  const pending = submit(view);
  assert.equal(view.render().props.busy, true);
  assert.equal(nodes(view.render(), n => n.type === 'fieldset')[0].props.disabled, true);
  await submit(view);
  assert.equal(saves, 1);
  finish(); await pending;
  assert.equal(view.render().props.busy, false);
  change(view, 'Access token', 'unsaved-dummy');
  view.render().props.onClose();
  const reopened = mount('ServiceAccountEditor', props);
  assert.ok(credentialInputs(reopened).every(input => input.props.value === ''));
});
