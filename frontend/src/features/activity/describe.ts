// Turns a tool step into a sentence a person can read at a glance:
// "Searching the web for “acme q3”" → "Searched the web for “acme q3”" (8 results).
import type {Step} from './model';
import {basename, formatBytes, formatTokens, shorten} from '../../lib/format';
import {classifyHref, hostOf} from '../../lib/links';

export type StepCategory = 'search' | 'web' | 'browser' | 'email' | 'drive' | 'message' | 'document' | 'image' | 'file' | 'edit' | 'delete' | 'command' | 'agent' | 'skill' | 'nullbot' | 'tool';

export type StepDescription = {
  title: string;
  detail?: string;
  category: StepCategory;
};

type Phrase = {verb: [string, string, string]; object?: string; category: StepCategory};
type Args = Record<string, unknown>;

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');
const pick = (args: Args, ...keys: string[]) => {
  for (const key of keys) {
    const value = str(args[key]);
    if (value) return value;
  }
  return '';
};
const quoted = (value: string, limit = 48) => (value ? `“${shorten(value, limit)}”` : '');
const fileLabel = (value: string) => (value ? basename(value) : '');
const pathLabel = (value: string) => {
  if (!value || value === '.' || value === './') return 'the project folder';
  const parts = value.split(/[\\/]+/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : parts.join('/') || value;
};
const urlLabel = (value: string) => {
  if (!value) return '';
  try {
    const url = new URL(value);
    const path = url.pathname.length > 1 ? shorten(url.pathname, 28) : '';
    return `${url.host.replace(/^www\./, '')}${path}`;
  } catch {
    return shorten(value, 40);
  }
};
const account = (args: Args) => pick(args, 'account', 'account_id', 'label');
const v = (running: string, done: string, failed: string): [string, string, string] => [running, done, failed];

type Describer = (args: Args, step: Step) => Phrase;

const registry: Record<string, Describer> = {
  // nullbot-web-mcp
  web_search: a => ({verb: v('Searching', 'Searched', 'Couldn’t search'), object: `the web for ${quoted(pick(a, 'query', 'q', 'search'))}`.trim(), category: 'search'}),
  fetch_url: a => ({verb: v('Opening', 'Opened', 'Couldn’t open'), object: urlLabel(pick(a, 'url', 'href')) || 'a page', category: 'web'}),
  list_search_providers: () => ({verb: v('Checking', 'Checked', 'Couldn’t check'), object: 'available search providers', category: 'search'}),
  web_workspace_info: () => ({verb: v('Checking', 'Checked', 'Couldn’t check'), object: 'web tool settings', category: 'web'}),
  browser_status: () => ({verb: v('Checking', 'Checked', 'Couldn’t check'), object: 'the browser', category: 'browser'}),
  browser_attach: () => ({verb: v('Connecting to', 'Connected to', 'Couldn’t connect to'), object: 'the browser', category: 'browser'}),
  browser_launch: () => ({verb: v('Starting', 'Started', 'Couldn’t start'), object: 'a browser', category: 'browser'}),
  browser_navigate: a => ({verb: v('Browsing to', 'Browsed to', 'Couldn’t browse to'), object: urlLabel(pick(a, 'url')) || 'a page', category: 'browser'}),
  browser_read: () => ({verb: v('Reading', 'Read', 'Couldn’t read'), object: 'the page', category: 'browser'}),
  browser_query: a => ({verb: v('Finding', 'Found', 'Couldn’t find'), object: `${quoted(pick(a, 'selector', 'query', 'text'), 32) || 'elements'} on the page`, category: 'browser'}),
  browser_click: a => ({verb: v('Clicking', 'Clicked', 'Couldn’t click'), object: quoted(pick(a, 'text', 'selector', 'label'), 32) || 'an element', category: 'browser'}),
  browser_type: a => ({verb: v('Typing into', 'Typed into', 'Couldn’t type into'), object: quoted(pick(a, 'selector', 'field', 'label'), 32) || 'the page', category: 'browser'}),
  browser_screenshot: () => ({verb: v('Taking', 'Took', 'Couldn’t take'), object: 'a screenshot', category: 'browser'}),
  browser_tabs: () => ({verb: v('Listing', 'Listed', 'Couldn’t list'), object: 'browser tabs', category: 'browser'}),
  browser_eval: () => ({verb: v('Running', 'Ran', 'Couldn’t run'), object: 'a script in the page', category: 'command'}),

  // nullbot-emails-mcp
  email_accounts: () => ({verb: v('Listing', 'Listed', 'Couldn’t list'), object: 'email accounts', category: 'email'}),
  email_list: a => {
    const who = account(a);
    const filter = pick(a, 'query', 'search', 'folder', 'label', 'mailbox');
    return {verb: v('Checking', 'Checked', 'Couldn’t check'), object: `${who ? `${who} ` : ''}mail${filter ? ` for ${quoted(filter, 32)}` : ''}`, category: 'email'};
  },
  email_get: a => ({verb: v('Reading', 'Read', 'Couldn’t read'), object: pick(a, 'subject') ? `email ${quoted(pick(a, 'subject'))}` : 'an email', category: 'email'}),
  email_send: a => ({verb: v('Sending', 'Sent', 'Couldn’t send'), object: `email to ${shorten(listOf(a.to) || pick(a, 'recipient') || 'a recipient', 40)}`, category: 'email'}),

  // nullbot-drives-mcp
  drives_accounts: () => ({verb: v('Listing', 'Listed', 'Couldn’t list'), object: 'connected drives', category: 'drive'}),
  drives_list: a => ({verb: v('Listing', 'Listed', 'Couldn’t list'), object: `${pathLabel(pick(a, 'path', 'folder', 'folder_id')) === 'the project folder' ? 'files' : pathLabel(pick(a, 'path', 'folder'))}${account(a) ? ` in ${account(a)}` : ''}`, category: 'drive'}),
  drives_search: a => ({verb: v('Searching', 'Searched', 'Couldn’t search'), object: `${account(a) || 'drives'} for ${quoted(pick(a, 'query', 'q', 'name'))}`, category: 'drive'}),
  drives_read: a => ({verb: v('Opening', 'Opened', 'Couldn’t open'), object: fileLabel(pick(a, 'name', 'path', 'item_id')) || 'a file', category: 'drive'}),
  drives_download: a => ({verb: v('Downloading', 'Downloaded', 'Couldn’t download'), object: fileLabel(pick(a, 'name', 'path', 'item_id')) || 'a file', category: 'drive'}),

  // nullbot-messages-mcp
  message_accounts: () => ({verb: v('Listing', 'Listed', 'Couldn’t list'), object: 'messaging accounts', category: 'message'}),
  message_list: a => ({verb: v('Reading', 'Read', 'Couldn’t read'), object: `${pick(a, 'channel', 'channel_id', 'chat_id', 'provider') ? `${pick(a, 'channel', 'channel_id', 'chat_id', 'provider')} ` : ''}messages`, category: 'message'}),
  message_send: a => ({verb: v('Sending', 'Sent', 'Couldn’t send'), object: `a message to ${shorten(pick(a, 'to', 'channel', 'channel_id', 'chat_id') || 'a recipient', 40)}`, category: 'message'}),

  // nullbot-parsers-mcp
  parser_workspace_info: () => ({verb: v('Checking', 'Checked', 'Couldn’t check'), object: 'document tools', category: 'document'}),
  detect_file_type: a => ({verb: v('Checking', 'Checked', 'Couldn’t check'), object: `the type of ${fileLabel(pick(a, 'path', 'file')) || 'a file'}`, category: 'document'}),
  parse_file: a => ({verb: v('Parsing', 'Parsed', 'Couldn’t parse'), object: fileLabel(pick(a, 'path', 'file')) || 'a file', category: 'document'}),
  extract_text: a => ({verb: v('Extracting text from', 'Extracted text from', 'Couldn’t extract text from'), object: fileLabel(pick(a, 'path', 'file')) || 'a file', category: 'document'}),
  extract_tables: a => ({verb: v('Extracting tables from', 'Extracted tables from', 'Couldn’t extract tables from'), object: fileLabel(pick(a, 'path', 'file')) || 'a file', category: 'document'}),
  extract_metadata: a => ({verb: v('Reading metadata of', 'Read metadata of', 'Couldn’t read metadata of'), object: fileLabel(pick(a, 'path', 'file')) || 'a file', category: 'document'}),
  list_document_parts: a => ({verb: v('Listing parts of', 'Listed parts of', 'Couldn’t list parts of'), object: fileLabel(pick(a, 'path', 'file')) || 'a document', category: 'document'}),
  extract_part: a => ({verb: v('Extracting', 'Extracted', 'Couldn’t extract'), object: `${pick(a, 'part', 'name') ? quoted(pick(a, 'part', 'name'), 24) : 'a part'} from ${fileLabel(pick(a, 'path', 'file')) || 'a document'}`, category: 'document'}),
  vision_extract: a => ({verb: v('Reading', 'Read', 'Couldn’t read'), object: `${fileLabel(pick(a, 'path', 'file', 'image')) || 'an image'} with vision`, category: 'image'}),
  parse_archive: a => ({verb: v('Opening archive', 'Opened archive', 'Couldn’t open archive'), object: fileLabel(pick(a, 'path', 'file')), category: 'document'}),

  // nullbot-imagetools-mcp
  list_image_models: () => ({verb: v('Listing', 'Listed', 'Couldn’t list'), object: 'image models', category: 'image'}),
  image_workspace_info: () => ({verb: v('Checking', 'Checked', 'Couldn’t check'), object: 'image tool settings', category: 'image'}),
  generate_image_openai: a => ({verb: v('Generating', 'Generated', 'Couldn’t generate'), object: `an image of ${quoted(pick(a, 'prompt'), 40)}`, category: 'image'}),
  generate_image_openrouter: a => ({verb: v('Generating', 'Generated', 'Couldn’t generate'), object: `an image of ${quoted(pick(a, 'prompt'), 40)}`, category: 'image'}),
  edit_image_openai: a => ({verb: v('Editing', 'Edited', 'Couldn’t edit'), object: fileLabel(pick(a, 'path', 'image', 'input_path')) || 'an image', category: 'image'}),
  inspect_image: a => ({verb: v('Inspecting', 'Inspected', 'Couldn’t inspect'), object: fileLabel(pick(a, 'path', 'image')) || 'an image', category: 'image'}),
  resize_image: a => ({verb: v('Resizing', 'Resized', 'Couldn’t resize'), object: fileLabel(pick(a, 'path', 'input_path', 'image')) || 'an image', category: 'image'}),
  crop_image: a => ({verb: v('Cropping', 'Cropped', 'Couldn’t crop'), object: fileLabel(pick(a, 'path', 'input_path', 'image')) || 'an image', category: 'image'}),
  add_title_text: a => ({verb: v('Adding a title to', 'Added a title to', 'Couldn’t add a title to'), object: fileLabel(pick(a, 'path', 'input_path', 'image')) || 'an image', category: 'image'}),
  compose_thumbnail: () => ({verb: v('Composing', 'Composed', 'Couldn’t compose'), object: 'a thumbnail', category: 'image'}),
  make_contact_sheet: () => ({verb: v('Making', 'Made', 'Couldn’t make'), object: 'a contact sheet', category: 'image'}),
  make_image_pdf: () => ({verb: v('Building', 'Built', 'Couldn’t build'), object: 'a PDF from images', category: 'image'}),

  // nullbot-code-mcp
  workspace_info: () => ({verb: v('Checking', 'Checked', 'Couldn’t check'), object: 'the workspace', category: 'file'}),
  list_dir: a => ({verb: v('Listing', 'Listed', 'Couldn’t list'), object: pathLabel(pick(a, 'path', 'dir')), category: 'file'}),
  file_info: a => ({verb: v('Checking', 'Checked', 'Couldn’t check'), object: pathLabel(pick(a, 'path')), category: 'file'}),
  read_file: a => ({verb: v('Reading', 'Read', 'Couldn’t read'), object: pathLabel(pick(a, 'path', 'file')), category: 'file'}),
  write_file: a => ({verb: v('Writing', 'Wrote', 'Couldn’t write'), object: pathLabel(pick(a, 'path', 'file')), category: 'edit'}),
  edit_file: a => ({verb: v('Editing', 'Edited', 'Couldn’t edit'), object: pathLabel(pick(a, 'path', 'file')), category: 'edit'}),
  apply_patch: a => ({verb: v('Applying', 'Applied', 'Couldn’t apply'), object: `a patch${pick(a, 'path') ? ` to ${pathLabel(pick(a, 'path'))}` : ''}`, category: 'edit'}),
  make_dir: a => ({verb: v('Creating folder', 'Created folder', 'Couldn’t create folder'), object: pathLabel(pick(a, 'path')), category: 'edit'}),
  delete_path: a => ({verb: v('Deleting', 'Deleted', 'Couldn’t delete'), object: pathLabel(pick(a, 'path')), category: 'delete'}),
  search_files: a => ({verb: v('Finding', 'Found', 'Couldn’t find'), object: `files matching ${quoted(pick(a, 'pattern', 'glob', 'query'), 32)}`, category: 'search'}),
  search_text: a => ({verb: v('Searching for', 'Searched for', 'Couldn’t search for'), object: `${quoted(pick(a, 'query', 'pattern', 'text'), 32)}${pick(a, 'path') ? ` in ${pathLabel(pick(a, 'path'))}` : ''}`, category: 'search'}),
  run_command: a => ({verb: v('Running', 'Ran', 'Couldn’t run'), object: shorten(pick(a, 'command', 'cmd') || 'a command', 48), category: 'command'}),
  command_status: () => ({verb: v('Checking', 'Checked', 'Couldn’t check'), object: 'a running command', category: 'command'}),
  command_output: () => ({verb: v('Reading', 'Read', 'Couldn’t read'), object: 'command output', category: 'command'}),
  command_kill: () => ({verb: v('Stopping', 'Stopped', 'Couldn’t stop'), object: 'a command', category: 'command'}),

  // NullBot built-ins
  visualize: a => ({verb: v('Showing you', 'Showed you', 'Couldn’t show you'), object: quoted(pick(a, 'title'), 48) || 'a visual', category: 'image'}),
  visualize_results: () => ({verb: v('Reading', 'Read', 'Couldn’t read'), object: 'your responses to visuals', category: 'nullbot'}),
  spawn_subagent: a => ({verb: v('Starting', 'Started', 'Couldn’t start'), object: `subagent ${quoted(pick(a, 'name', 'task_name'), 28) || ''}`.trim(), category: 'agent'}),
  subagent_status: () => ({verb: v('Checking', 'Checked', 'Couldn’t check'), object: 'subagents', category: 'agent'}),
  subagent_wait: () => ({verb: v('Waiting for', 'Waited for', 'Stopped waiting for'), object: 'subagent results', category: 'agent'}),
  skills_list: () => ({verb: v('Listing', 'Listed', 'Couldn’t list'), object: 'skills', category: 'skill'}),
  skill_read: a => ({verb: v('Reading skill', 'Read skill', 'Couldn’t read skill'), object: quoted(pick(a, 'name', 'skill'), 32), category: 'skill'}),
  skill_references: a => ({verb: v('Reading references for', 'Read references for', 'Couldn’t read references for'), object: quoted(pick(a, 'name', 'skill'), 32) || 'a skill', category: 'skill'}),
  create_skill: a => ({verb: v('Writing skill', 'Wrote skill', 'Couldn’t write skill'), object: quoted(pick(a, 'name'), 32), category: 'skill'}),
  project_read_file: a => ({verb: v('Reading', 'Read', 'Couldn’t read'), object: pathLabel(pick(a, 'path')), category: 'file'}),
  project_write_file: a => ({verb: v('Writing', 'Wrote', 'Couldn’t write'), object: pathLabel(pick(a, 'path')), category: 'edit'}),
  history_recent: () => ({verb: v('Reading', 'Read', 'Couldn’t read'), object: 'recent chat history', category: 'nullbot'}),
  history_sessions: () => ({verb: v('Listing', 'Listed', 'Couldn’t list'), object: 'saved sessions', category: 'nullbot'}),
  history_session_read: () => ({verb: v('Reading', 'Read', 'Couldn’t read'), object: 'a saved session', category: 'nullbot'}),
  logs_recent: () => ({verb: v('Reading', 'Read', 'Couldn’t read'), object: 'NullBot logs', category: 'nullbot'}),
  plans_list: () => ({verb: v('Listing', 'Listed', 'Couldn’t list'), object: 'plans', category: 'nullbot'}),
  plan_read: () => ({verb: v('Reading', 'Read', 'Couldn’t read'), object: 'a plan', category: 'nullbot'}),
  plan_update_step: a => ({verb: v('Updating', 'Updated', 'Couldn’t update'), object: `plan step ${pick(a, 'step_id', 'step')}`.trim(), category: 'nullbot'}),
  config_dir_list: () => ({verb: v('Listing', 'Listed', 'Couldn’t list'), object: 'NullBot settings files', category: 'nullbot'}),
  config_dir_read: a => ({verb: v('Reading', 'Read', 'Couldn’t read'), object: fileLabel(pick(a, 'path')) || 'a settings file', category: 'nullbot'}),
  market_list: () => ({verb: v('Listing', 'Listed', 'Couldn’t list'), object: 'marketplace packages', category: 'nullbot'}),
  market_list_available: () => ({verb: v('Listing', 'Listed', 'Couldn’t list'), object: 'marketplace packages', category: 'nullbot'}),
  market_refresh: () => ({verb: v('Refreshing', 'Refreshed', 'Couldn’t refresh'), object: 'the marketplace', category: 'nullbot'}),
  market_read_package: a => ({verb: v('Reading', 'Read', 'Couldn’t read'), object: `package ${quoted(pick(a, 'id', 'name'), 28)}`, category: 'nullbot'}),
  market_install_package: a => ({verb: v('Installing', 'Installed', 'Couldn’t install'), object: quoted(pick(a, 'id', 'name'), 28) || 'a package', category: 'nullbot'}),
  mcp_list_servers: () => ({verb: v('Listing', 'Listed', 'Couldn’t list'), object: 'tool servers', category: 'nullbot'}),
  mcp_list: () => ({verb: v('Listing', 'Listed', 'Couldn’t list'), object: 'tool servers', category: 'nullbot'}),
  mcp_enable_server: a => ({verb: v('Enabling', 'Enabled', 'Couldn’t enable'), object: `tool server ${quoted(pick(a, 'id', 'name'), 28)}`, category: 'nullbot'}),
  mcp_disable_server: a => ({verb: v('Disabling', 'Disabled', 'Couldn’t disable'), object: `tool server ${quoted(pick(a, 'id', 'name'), 28)}`, category: 'nullbot'}),
  mcp_remove_server: a => ({verb: v('Removing', 'Removed', 'Couldn’t remove'), object: `tool server ${quoted(pick(a, 'id', 'name'), 28)}`, category: 'delete'}),
};

function listOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(str).filter(Boolean).join(', ');
  return str(value);
}

const verbs: Record<string, [string, string, string]> = {
  get: v('Getting', 'Got', 'Couldn’t get'),
  read: v('Reading', 'Read', 'Couldn’t read'),
  list: v('Listing', 'Listed', 'Couldn’t list'),
  search: v('Searching', 'Searched', 'Couldn’t search'),
  find: v('Finding', 'Found', 'Couldn’t find'),
  fetch: v('Fetching', 'Fetched', 'Couldn’t fetch'),
  query: v('Querying', 'Queried', 'Couldn’t query'),
  lookup: v('Looking up', 'Looked up', 'Couldn’t look up'),
  check: v('Checking', 'Checked', 'Couldn’t check'),
  create: v('Creating', 'Created', 'Couldn’t create'),
  add: v('Adding', 'Added', 'Couldn’t add'),
  update: v('Updating', 'Updated', 'Couldn’t update'),
  set: v('Setting', 'Set', 'Couldn’t set'),
  write: v('Writing', 'Wrote', 'Couldn’t write'),
  edit: v('Editing', 'Edited', 'Couldn’t edit'),
  save: v('Saving', 'Saved', 'Couldn’t save'),
  delete: v('Deleting', 'Deleted', 'Couldn’t delete'),
  remove: v('Removing', 'Removed', 'Couldn’t remove'),
  send: v('Sending', 'Sent', 'Couldn’t send'),
  post: v('Posting', 'Posted', 'Couldn’t post'),
  run: v('Running', 'Ran', 'Couldn’t run'),
  execute: v('Running', 'Ran', 'Couldn’t run'),
  start: v('Starting', 'Started', 'Couldn’t start'),
  stop: v('Stopping', 'Stopped', 'Couldn’t stop'),
  open: v('Opening', 'Opened', 'Couldn’t open'),
  download: v('Downloading', 'Downloaded', 'Couldn’t download'),
  upload: v('Uploading', 'Uploaded', 'Couldn’t upload'),
  generate: v('Generating', 'Generated', 'Couldn’t generate'),
  analyze: v('Analyzing', 'Analyzed', 'Couldn’t analyze'),
  summarize: v('Summarizing', 'Summarized', 'Couldn’t summarize'),
  parse: v('Parsing', 'Parsed', 'Couldn’t parse'),
  extract: v('Extracting', 'Extracted', 'Couldn’t extract'),
  convert: v('Converting', 'Converted', 'Couldn’t convert'),
  describe: v('Describing', 'Described', 'Couldn’t describe'),
  inspect: v('Inspecting', 'Inspected', 'Couldn’t inspect'),
};

const categoryHints: [RegExp, StepCategory][] = [
  [/mail|email|inbox/, 'email'],
  [/drive|onedrive|gdrive|storage|bucket/, 'drive'],
  [/message|slack|teams|discord|telegram|sms|chat/, 'message'],
  [/browser|page|tab/, 'browser'],
  [/web|url|http|fetch/, 'web'],
  [/image|photo|picture|vision/, 'image'],
  [/pdf|doc|sheet|table|parse/, 'document'],
  [/search|find|query|lookup/, 'search'],
  [/delete|remove/, 'delete'],
  [/write|edit|create|update|save/, 'edit'],
  [/run|exec|command|shell/, 'command'],
  [/file|dir|folder|path/, 'file'],
];

const salientKeys = ['query', 'q', 'search', 'url', 'path', 'file', 'name', 'title', 'subject', 'to', 'channel', 'prompt', 'command', 'key', 'issue', 'id'];

function words(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function genericPhrase(name: string, args: Args, step: Step): Phrase {
  const parts = words(name);
  // Server prefixes ("github_create_issue") are dropped when the verb follows.
  let verbIndex = parts.findIndex(part => verbs[part]);
  if (verbIndex < 0) verbIndex = -1;
  const verb = verbIndex >= 0 ? verbs[parts[verbIndex]] : undefined;
  const rest = (verbIndex >= 0 ? parts.slice(verbIndex + 1) : parts).join(' ');
  const hay = `${name} ${step.server || ''}`.toLowerCase();
  const category = categoryHints.find(([re]) => re.test(hay))?.[1] || 'tool';
  const salient = salientKeys.map(key => [key, str(args[key])] as const).find(([, value]) => value);
  let object = rest;
  if (salient) {
    const [key, value] = salient;
    const shown = key === 'url' ? urlLabel(value) : key === 'path' || key === 'file' ? pathLabel(value) : quoted(value, 40);
    object = object ? `${object} ${shown}` : shown;
  }
  if (!verb) {
    const label = step.title || parts.map((p, i) => (i === 0 ? p[0].toUpperCase() + p.slice(1) : p)).join(' ') || 'a tool';
    return {verb: v('Using', 'Used', 'Couldn’t use'), object: salient ? `${label} (${object})` : label, category};
  }
  return {verb, object: object || 'it', category};
}

export function describeStep(step: Step): StepDescription {
  if (step.kind === 'thinking') {
    const first = String(step.text || '').split('\n').map(line => line.replace(/^[#*\s>-]+/, '').trim()).find(Boolean) || '';
    return {title: step.state === 'running' ? 'Thinking' : 'Thought it through', detail: shorten(first.replace(/\*\*/g, ''), 120), category: 'agent'};
  }
  if (step.kind === 'note' || step.kind === 'error') {
    return {title: shorten(step.text || (step.kind === 'error' ? 'Something went wrong' : ''), 160), category: 'nullbot'};
  }
  const args = (step.args || {}) as Args;
  const name = step.tool || 'tool';
  const describer = registry[name];
  const phrase = describer ? describer(args, step) : genericPhrase(name, args, step);
  const verb = step.state === 'running' ? phrase.verb[0] : step.state === 'done' ? phrase.verb[1] : phrase.verb[2];
  const title = [verb, phrase.object].filter(Boolean).join(' ');
  return {title: step.state === 'blocked' ? `Blocked: ${lowerFirst(phrase.verb[0])} ${phrase.object || ''}`.trim() : title, detail: stepDetail(step), category: phrase.category};
}

function lowerFirst(value: string) {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

/** The secondary line: what came back, or why it failed. */
export function stepDetail(step: Step): string | undefined {
  if (step.state === 'blocked') return step.permission?.reason || step.error;
  if (step.state === 'error') return firstLine(step.error);
  if (step.state === 'running') return undefined;
  if (step.guard?.full_tokens) return `Cut to fit: about ${formatTokens(step.guard.full_tokens)} tokens, too large for the room left`;
  const meta = step.resultMeta || {};
  const items = typeof meta.items === 'number' ? meta.items : undefined;
  const links = Array.isArray(meta.links) ? meta.links.length : 0;
  const types = (meta.content_types || {}) as Record<string, number>;
  const parts: string[] = [];
  if (items != null) parts.push(`${items} ${pluralFor(step, items)}`);
  else if (links) parts.push(`${links} link${links === 1 ? '' : 's'}`);
  if (types.image) parts.push(types.image === 1 ? 'an image' : `${types.image} images`);
  if (!parts.length) {
    const counted = countFromResult(step.result);
    if (counted) parts.push(counted);
  }
  if (!parts.length && typeof meta.bytes === 'number' && meta.bytes > 2000) parts.push(formatBytes(meta.bytes));
  if (!parts.length) {
    const line = firstLine(step.result);
    if (line && line.length > 2) parts.push(line);
  }
  return parts.join(', ') || undefined;
}

function pluralFor(step: Step, n: number): string {
  const name = step.tool || '';
  const noun = /search|query|find/.test(name) ? 'result' : /email|mail/.test(name) ? 'message' : /message/.test(name) ? 'message' : /file|dir|drive|list/.test(name) ? 'item' : 'item';
  return n === 1 ? noun : `${noun}s`;
}

function countFromResult(result?: string): string | undefined {
  const text = String(result || '').trim();
  if (!text) return undefined;
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return `${parsed.length} item${parsed.length === 1 ? '' : 's'}`;
      if (parsed && typeof parsed === 'object') {
        const arrays = Object.entries(parsed).filter(([, value]) => Array.isArray(value)) as [string, unknown[]][];
        if (arrays.length === 1) return `${arrays[0][1].length} ${arrays[0][0]}`;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function firstLine(text?: string): string | undefined {
  const line = String(text || '').split('\n').map(part => part.trim()).find(Boolean);
  return line ? shorten(line.replace(/^(error|permission denied):\s*/i, ''), 140) : undefined;
}

/** Who ran the step, for the trace's secondary line. */
export function stepSource(step: Step): string {
  if (step.kind !== 'tool') return step.agentName || '';
  const server = step.serverTitle || step.server;
  const from = server ? server.replace(/^nullbot[-\s]?/i, '').replace(/[-\s]?mcp$/i, '') : step.source === 'builtin' || !step.server ? 'NullBot' : '';
  return step.agentName && from ? `${step.agentName} via ${from}` : step.agentName || from;
}

/** Links worth surfacing from a result (resource links, or URLs in text). */
export function resultLinks(step: Step, limit = 6): string[] {
  const meta = step.resultMeta || {};
  const fromMeta = Array.isArray(meta.links) ? (meta.links as string[]) : [];
  const fromText = String(step.result || '').match(/https?:\/\/[^\s)"'<>\]]+/g) || [];
  // Only links the app would open in the browser, and only ones that parse.
  return [...new Set([...fromMeta, ...fromText])].filter(link => classifyHref(link).kind === 'external').slice(0, limit);
}

export {hostOf};
