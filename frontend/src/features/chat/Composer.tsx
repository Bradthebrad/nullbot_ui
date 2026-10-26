import {useEffect, useMemo, useRef, useState} from 'react';
import {ChevronDown, CornerDownLeft, Layers, Paperclip, Play, Square, X} from 'lucide-react';
import {useStore} from '../../lib/store';
import {api} from '../../lib/bindings';
import {chatStore, isBusy, resumeRuns, runPhase, sendChat, stopRun} from '../../state/chat';
import {appStore} from '../../state/app';
import {useComposerDraft} from '../../useComposerDraft';
import {useAttachments} from '../../useAttachments';
import {attachmentSendBlock, handleAttachmentPaste} from '../../attachments';
import AttachmentTray from '../../AttachmentTray';
import BusySendDialog from '../../BusySendDialog';
import {SkillComposer, useSkillContext} from '../../SkillComposer';
import {removeQueuedChat, type ChatMode} from '../../chatSubmission';
import {MenuButton} from '../../ui/Menu';
import {ContextMeter} from './ContextMeter';
import {toast, toastError} from '../../ui/toast';
import {OnFileDrop, OnFileDropOff} from '../../../wailsjs/runtime/runtime';
import type {SkillFile} from '../../lib/types';
import {shorten} from '../../lib/format';

type Suggestion = {kind: 'command' | 'skill'; value: string; label: string; detail?: string; path?: string};

/** The word the caret is in, if it starts with "/". */
function slashToken(text: string, caret: number): {start: number; word: string} | null {
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  const word = text.slice(start, caret);
  return word.startsWith('/') ? {start, word} : null;
}

export function Composer({active}: {active: boolean}) {
  const {input, setInput, undo, redo} = useComposerDraft();
  const {attachments, queue} = useAttachments();
  const busy = useStore(chatStore, isBusy);
  const phase = useStore(chatStore, runPhase);
  const sending = useStore(chatStore, state => state.sending);
  const submissions = useStore(chatStore, state => state.submissions);
  const commands = useStore(chatStore, state => state.commands);
  const suggestSkills = useStore(appStore, state => !!state.config?.ui?.suggest_matching_skills);
  const botName = useStore(appStore, state => state.runtime.bot_name || 'NullBot');
  const [skills, setSkills] = useState<SkillFile[]>([]);
  const [choice, setChoice] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [caret, setCaret] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState('');
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const revision = useRef(0);
  const history = useRef<string[]>([]);
  const cursor = useRef<number | null>(null);
  const recallDraft = useRef('');
  const blocked = attachmentSendBlock(attachments);
  const skillContext = useSkillContext(input, skills, suggestSkills, !input.trim().startsWith('/'));
  // Skills chosen from the / menu (or typed as /skill-name at the start).
  // They apply to the next message whether or not word suggestions are on.
  const [picked, setPicked] = useState<SkillFile[]>([]);

  useEffect(() => {
    if (!active) return;
    api.skills().then(list => setSkills(list || [])).catch(() => undefined);
  }, [active]);

  const attachRequest = useStore(chatStore, state => state.attachRequest);
  useEffect(() => {
    if (!attachRequest) return;
    void queue.stagePaths(attachRequest.paths);
    chatStore.set({attachRequest: null});
    window.setTimeout(() => textarea.current?.focus(), 0);
  }, [attachRequest]);

  useEffect(() => {
    if (!active || !(window as any).runtime) return;
    OnFileDrop((_x: number, _y: number, paths: string[]) => {
      void queue.stagePaths(paths);
      setDragging(false);
    }, true);
    return () => OnFileDropOff();
  }, [active]);

  // Grow with content up to 40% of the window.
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }, [input]);

  const token = slashToken(input, caret);
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!token || menuDismissed === token.word) return [];
    const q = token.word.slice(1).toLowerCase();
    const atStart = token.start === 0;
    const cmd: Suggestion[] = atStart ? commands.filter(c => c.slice(1).toLowerCase().startsWith(q)).slice(0, 8).map(c => ({kind: 'command', value: c, label: c, detail: commandHelp[c]})) : [];
    const sk: Suggestion[] = skills.filter(s => s.name.toLowerCase().includes(q)).slice(0, 6).map(s => ({kind: 'skill', value: `/${s.name}`, label: `/${s.name}`, detail: shorten(s.description, 70), path: s.path}));
    return [...cmd, ...sk];
  }, [token?.word, token?.start, commands, skills, menuDismissed]);

  useEffect(() => setMenuIndex(0), [token?.word]);

  function update(value: string) {
    revision.current++;
    setInput(value);
    cursor.current = null;
  }

  function applySuggestion(item: Suggestion) {
    if (!token) return;
    if (item.kind === 'skill') {
      // A skill becomes a selection, not text: "/name" at the start of a
      // message would otherwise be sent as an unknown command.
      const skill = skills.find(s => s.path === item.path);
      if (skill) setPicked(current => (current.some(s => s.path === skill.path) ? current : [...current, skill]));
      const next = `${input.slice(0, token.start)}${input.slice(caret).replace(/^\s+/, '')}`;
      update(next);
      window.setTimeout(() => {
        textarea.current?.setSelectionRange(token.start, token.start);
        setCaret(token.start);
      }, 0);
      return;
    }
    const next = `${input.slice(0, token.start)}${item.value} ${input.slice(caret)}`;
    update(next);
    const position = token.start + item.value.length + 1;
    window.setTimeout(() => {
      textarea.current?.setSelectionRange(position, position);
      setCaret(position);
    }, 0);
  }

  function remember(text: string) {
    const t = text.trim();
    if (t && history.current[history.current.length - 1] !== t) history.current = [...history.current.slice(-99), t];
    cursor.current = null;
  }

  function recall(delta: -1 | 1) {
    const list = history.current;
    if (!list.length) return;
    let next: number | null;
    if (cursor.current === null) {
      if (delta > 0) return;
      recallDraft.current = input;
      next = list.length - 1;
    } else {
      const candidate = cursor.current + delta;
      next = candidate < 0 ? 0 : candidate >= list.length ? null : candidate;
    }
    cursor.current = next;
    revision.current++;
    setInput(next === null ? recallDraft.current : list[next]);
  }

  async function send(mode?: ChatMode) {
    let text = input.trim();
    // "/skill-name do this" at the start means: do this, with that skill.
    let leading: SkillFile | undefined;
    const lead = /^\/(\S+)(?:\s+|$)/.exec(text);
    if (lead && !commands.includes(`/${lead[1]}`)) {
      leading = skills.find(s => s.name === lead[1]);
      if (leading) text = text.slice(lead[0].length).trim();
    }
    const staged = queue.snapshot();
    const block = attachmentSendBlock(staged);
    if (block) {
      toast(block, 'error');
      return;
    }
    if (!text && !staged.length) {
      if (leading || picked.length) toast('Add a message for the skill to work on.');
      return;
    }
    if (!mode && busy) {
      setChoice(true);
      return;
    }
    setChoice(false);
    const sentRevision = revision.current;
    const command = text.startsWith('/');
    const sendSkills = command ? [] : [...new Set([...picked.map(s => s.path), ...(leading ? [leading.path] : []), ...skillContext.paths])];
    try {
      const accepted = await sendChat({mode: mode || 'normal', text, attachments: [...staged], skills: sendSkills, targetJob: submissions.primary_id});
      if (!accepted) return;
      remember(text);
      if (revision.current === sentRevision) setInput('');
      queue.removeMany(staged.map(item => item.id));
      if (!command) setPicked([]);
      if (sendSkills.length) toast(`Included ${sendSkills.length === 1 ? 'a skill' : `${sendSkills.length} skills`} as context.`);
    } catch (error) {
      toastError(error);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (suggestions.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setMenuIndex(i => (i + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && suggestions[menuIndex]?.value !== token?.word)) {
        event.preventDefault();
        applySuggestion(suggestions[menuIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuDismissed(token?.word || '');
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      revision.current++;
      cursor.current = null;
      if (event.key.toLowerCase() === 'y' || event.shiftKey) redo();
      else undo();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
      return;
    }
    if (event.key === 'ArrowUp' && !event.shiftKey && !event.altKey && (input === '' || cursor.current !== null)) {
      event.preventDefault();
      recall(-1);
      return;
    }
    if (event.key === 'ArrowDown' && !event.shiftKey && cursor.current !== null) {
      event.preventDefault();
      recall(1);
    }
  }

  const canSend = !sending && !blocked && (!!input.trim() || attachments.length > 0);
  const queued = submissions.queue || [];

  return (
    <div
      className={`composer ${dragging ? 'is-dragging' : ''}`}
      style={{'--wails-drop-target': 'drop'} as React.CSSProperties}
      onDragEnter={event => {if (event.dataTransfer?.types?.includes('Files')) setDragging(true);}}
      onDragLeave={event => {if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);}}
      onDragOver={event => {if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();}}
      onDrop={() => setDragging(false)}
    >
      {queued.length > 0 && (
        <div className="composer-queue">
          <span>{queued.length === 1 ? '1 request is queued' : `${queued.length} requests are queued`} after the current one.</span>
          <MenuButton
            className="btn btn-ghost btn-sm"
            label="Manage"
            placement="above"
            items={queued.map(job => ({
              label: shorten(job.input || job.id, 60),
              hint: 'Remove',
              onSelect: async () => {
                try {
                  chatStore.set({submissions: await removeQueuedChat(job.id)});
                  toast('Removed from the queue.');
                } catch (error) {
                  toastError(error);
                }
              },
            }))}
          />
        </div>
      )}
      {(picked.length > 0 || skillContext.matches.length > 0) && (
        <div className="composer-skills" aria-live="polite">
          {picked.map(skill => (
            <span className="tag warn" key={skill.path}>
              Using skill {skill.name}
              <button className="tag-x" aria-label={`Don’t use ${skill.name}`} onClick={() => setPicked(current => current.filter(s => s.path !== skill.path))}><X size={11} /></button>
            </span>
          ))}
          {skillContext.matches.filter(skill => !picked.some(p => p.path === skill.path)).map(skill => (
            <span className="tag" key={skill.path}>
              Using skill {skill.name}
              <button className="tag-x" aria-label={`Don’t use ${skill.name} for this message`} onClick={() => skillContext.dismiss(skill.path)}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="slash-menu" role="listbox" aria-label="Commands and skills">
          {suggestions.map((item, index) => (
            <button
              key={item.kind + item.value}
              role="option"
              aria-selected={index === menuIndex}
              className={index === menuIndex ? 'slash-item active' : 'slash-item'}
              onMouseDown={event => {
                event.preventDefault();
                applySuggestion(item);
              }}
            >
              <span className="slash-label mono">{item.label}</span>
              <span className="slash-kind faint">{item.kind === 'skill' ? 'skill' : 'command'}</span>
              {item.detail && <span className="slash-detail muted">{item.detail}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="composer-box">
        {attachments.length > 0 && <AttachmentTray attachments={attachments} onRemove={queue.remove} />}
        <SkillComposer
          matches={skillContext.matches}
          aria-label={`Message ${botName}`}
          value={input}
          rows={1}
          placeholder={busy ? 'Add a follow-up, or steer the current request' : `Message ${botName}`}
          onChange={event => {
            update(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
          }}
          onSelect={event => setCaret((event.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onPaste={event => handleAttachmentPaste(event, files => {void queue.stageFiles(files);}, paths => {void queue.stagePaths(paths);})}
          onKeyDown={onKeyDown}
          textareaRef={textarea}
        />
        <div className="composer-bar">
          <input ref={fileInput} type="file" multiple hidden onChange={event => {
            const files = Array.from(event.target.files || []);
            if (files.length) void queue.stageFiles(files);
            event.target.value = '';
          }} />
          <button className="btn btn-ghost btn-icon" title="Attach files" aria-label="Attach files" onClick={() => fileInput.current?.click()}>
            <Paperclip size={16} />
          </button>
          <button className="btn btn-ghost btn-sm slash-button" title="Commands and skills" onClick={() => {
            const next = input.startsWith('/') ? input : `/${input}`;
            update(next);
            window.setTimeout(() => {
              textarea.current?.focus();
              textarea.current?.setSelectionRange(1, 1);
              setCaret(1);
            }, 0);
          }}>/</button>
          {blocked && <span className="composer-block faint">{blocked}</span>}
          <span className="composer-spacer" />
          <ContextMeter />
          <span className="composer-hint faint"><CornerDownLeft size={12} /> send, Shift <CornerDownLeft size={12} /> new line</span>
          <button className="btn btn-ghost" disabled={!canSend} title="Ask without interrupting the main conversation" onClick={() => void send('also')}>
            <Layers size={15} />Ask on the side
          </button>
          {busy && !input.trim() && !attachments.length && phase === 'paused' ? (
            <button className="btn btn-primary" onClick={() => void resumeRuns()}><Play size={13} />Resume</button>
          ) : busy && !input.trim() && !attachments.length && phase !== 'held' ? (
            <button className="btn btn-primary" disabled={phase === 'stopping'} title="Finish the current step, then wrap up with what was done" onClick={() => void stopRun()}><Square size={13} />{phase === 'stopping' ? 'Stopping' : 'Stop'}</button>
          ) : busy ? (
            <div className="split">
              <button className="btn btn-primary" disabled={!canSend} onClick={() => void send('queue')}>Queue</button>
              <MenuButton
                className="btn btn-primary btn-icon"
                label={<ChevronDown size={15} />}
                title="More ways to send"
                align="end"
                placement="above"
                disabled={!canSend}
                items={[
                  {label: 'Queue after the current request', onSelect: () => void send('queue')},
                  {label: 'Steer the current request', hint: 'Manager and subagents', disabled: phase === 'stopping', onSelect: () => void send('steer')},
                  {label: 'Ask on the side', onSelect: () => void send('also')},
                ]}
              />
            </div>
          ) : (
            <button className="btn btn-primary" disabled={!canSend} onClick={() => void send()}>Send</button>
          )}
        </div>
      </div>
      {dragging && <div className="drop-hint">Drop files to attach them. Nothing is sent until you press Send.</div>}
      {choice && <BusySendDialog onChoose={mode => void send(mode)} onCancel={() => setChoice(false)} />}
    </div>
  );
}

const commandHelp: Record<string, string> = {
  '/help': 'Show commands and shortcuts',
  '/plan': 'Create a plan for a goal',
  '/analyze': 'Analyze the conversation or a focus',
  '/compact': 'Summarize the conversation; later requests start from the summary',
  '/also': 'Ask a side question',
  '/pause': 'Stop the current request',
  '/clear': 'Clear the visible conversation',
  '/reset': 'Reset the conversation state',
  '/models': 'Choose models',
  '/config': 'Open settings',
  '/mcp': 'Tool servers',
  '/market': 'Marketplace',
  '/skills': 'Skills',
  '/history': 'Saved sessions',
  '/usage': 'Token usage',
  '/files': 'Workspace files',
  '/ls': 'List a folder',
};
