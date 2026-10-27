// Shows one visual: a sandboxed page for pages, pictures, charts and
// diagrams, a form for polls, or a file preview. In the window it records
// what the person does; in the Visuals view it is a preview only.
import {useEffect, useRef, useState} from 'react';
import {Check} from 'lucide-react';
import {api} from '../../lib/bindings';
import {onVisualNavigate} from '../../lib/events';
import type {VisualEvent, VisualView, Visualization} from '../../lib/types';
import {Blank, Spinner} from '../../ui/layout';
import {toast} from '../../ui/toast';
import {PreviewContent} from '../files/Preview';

export type Staged = {data: unknown; requested: boolean};

type Props = {
  visual: Visualization;
  /** live records interactions; preview shows the visual and records nothing. */
  mode: 'live' | 'preview';
  /** The visual set what to send, or asked to send it. */
  onStaged?: (staged: Staged) => void;
  /** Interactions recorded since it opened here. */
  onRecorded?: (count: number) => void;
  /** Bumped to reload the visual from the start. */
  reloadKey?: number;
  /** Receives a function that waits until the page has handed over its
   *  last interactions, for Send to call first. */
  onFlush?: (flush: () => Promise<void>) => void;
};

const MAX_EVENT_JSON = 16_000;
const MAX_BATCH_JSON = 256_000;

/** Interactions as the frame reported them, bounded before they reach Go. */
export function boundedEvents(raw: unknown): VisualEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: VisualEvent[] = [];
  let total = 0;
  for (const event of raw.slice(0, 300)) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    let json = '';
    try {
      json = JSON.stringify(event);
    } catch {
      continue;
    }
    const kept = json.length > MAX_EVENT_JSON ? {type: String((event as VisualEvent).type || 'event').slice(0, 40), t: (event as VisualEvent).t, note: 'too large to keep'} : (event as VisualEvent);
    total += Math.min(json.length, MAX_EVENT_JSON);
    if (total > MAX_BATCH_JSON) break;
    out.push(kept);
  }
  return out;
}

export function VisualSurface({visual, mode, onStaged, onRecorded, reloadKey = 0, onFlush}: Props) {
  const [view, setView] = useState<VisualView | null>(null);
  const [error, setError] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);
  const recorded = useRef(0);
  const callbacks = useRef({onStaged, onRecorded});
  callbacks.current = {onStaged, onRecorded};
  const live = mode === 'live';
  const pending = useRef(new Set<Promise<unknown>>());
  const flushWaiters = useRef(new Map<number, () => void>());
  const flushSeq = useRef(0);
  // When the page last said it was leaving, and when it last asked to move.
  const leftAt = useRef(0);
  const movedAt = useRef<number[]>([]);

  async function load(page = '') {
    try {
      const next = page ? await api.visualPage(visual.id, page) : await api.openVisualization(visual.id);
      setView(next);
      setError(next.error || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    setView(null);
    setError('');
    void load();
  }, [visual.id, reloadKey]);

  function record(events: VisualEvent[]) {
    if (!live || !events.length) return;
    recorded.current += events.length;
    callbacks.current.onRecorded?.(recorded.current);
    const saving = api.recordVisualEvents(visual.id, events).catch(() => undefined);
    pending.current.add(saving);
    void saving.finally(() => pending.current.delete(saving));
  }

  // A page may move a few times a second at most; more is a page looping.
  function mayMove() {
    const now = Date.now();
    movedAt.current = movedAt.current.filter(t => now - t < 2000);
    if (movedAt.current.length >= 4) return false;
    movedAt.current.push(now);
    return true;
  }

  useEffect(() => {
    onFlush?.(async () => {
      const win = frame.current?.contentWindow;
      if (win) {
        const id = ++flushSeq.current;
        await new Promise<void>(resolve => {
          const timer = window.setTimeout(resolve, 600);
          flushWaiters.current.set(id, () => {
            window.clearTimeout(timer);
            resolve();
          });
          win.postMessage({__nullbot: 1, type: 'flush', id}, '*');
        });
        flushWaiters.current.delete(id);
      }
      await Promise.allSettled([...pending.current]);
    });
  }, [onFlush, view]);

  // Messages from the visual's frame. Only that frame is listened to, and
  // what it sends is treated as data.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const win = frame.current?.contentWindow;
      if (!win || event.source !== win) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || data.__nullbot !== 1) return;
      switch (data.type) {
        case 'ready':
          win.postMessage({__nullbot: 1, type: 'context', context: {title: visual.title, prompt: visual.prompt || '', theme: document.documentElement.dataset.appearance === 'dark' ? 'dark' : 'light', labels: visual.labels || []}}, '*');
          break;
        case 'events':
          record(boundedEvents(data.events));
          break;
        case 'flushed':
          flushWaiters.current.get(Number(data.id))?.();
          break;
        case 'leaving':
          leftAt.current = Date.now();
          break;
        case 'response':
          if (live) callbacks.current.onStaged?.({data: data.data, requested: false});
          break;
        case 'submit':
          if (live) callbacks.current.onStaged?.({data: data.data, requested: true});
          break;
        case 'navigate':
          if (typeof data.page === 'string' && data.page.length < 1000 && mayMove()) void load(data.page);
          break;
        case 'external':
          toast('Links to the web don’t open from a visual.', 'info');
          break;
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [visual.id, visual.title, visual.prompt, live]);

  // The page navigated its frame itself (a script set location); show the
  // new page the safe way. A frame inside the page asking for a page is not
  // the page leaving, so it changes nothing.
  useEffect(() => onVisualNavigate(nav => {
    if (nav.id !== visual.id || Date.now() - leftAt.current > 3000 || !mayMove()) return;
    leftAt.current = 0;
    void load(nav.page);
  }), [visual.id]);

  if (error) return <Blank title="This visual can’t be shown">{error}</Blank>;
  if (!view) return <div className="visual-loading"><Spinner label="Opening" /></div>;
  if (visual.kind === 'poll') return <PollForm visual={view.visual} assets={view.assets || {}} live={live} onStaged={onStaged} onRecord={record} />;
  if (view.preview) return <div className="visual-file"><PreviewContent preview={view.preview} mode="rendered" /></div>;
  return (
    <iframe
      ref={frame}
      className="visual-frame"
      title={visual.title}
      // Scripts run, but the page gets no origin of its own: it can't reach
      // the app, other visuals, or anything but its own files.
      sandbox="allow-scripts allow-forms allow-modals allow-pointer-lock"
      srcDoc={view.document}
      referrerPolicy="no-referrer"
    />
  );
}

/** A poll: options to choose, maybe with pictures, and maybe their own answer. */
export function PollForm({visual, assets, live, onStaged, onRecord}: {
  visual: Visualization;
  assets: Record<string, string>;
  live: boolean;
  onStaged?: (staged: Staged) => void;
  onRecord?: (events: VisualEvent[]) => void;
}) {
  const answered = (visual.response || {}) as {selected?: string[]; other?: string};
  const [selected, setSelected] = useState<string[]>(() => (live ? [] : answered.selected || []));
  const [other, setOther] = useState(() => (live ? '' : answered.other || ''));
  const options = visual.options || [];

  useEffect(() => {
    if (live) onStaged?.({data: selected.length || other.trim() ? {selected, ...(other.trim() ? {other: other.trim()} : {})} : null, requested: false});
  }, [selected, other, live]);

  function toggle(id: string) {
    if (!live) return;
    const option = options.find(o => o.id === id);
    const on = !selected.includes(id);
    setSelected(current => (visual.multiple ? (on ? [...current, id] : current.filter(s => s !== id)) : on ? [id] : []));
    onRecord?.([{type: on ? 'select' : 'unselect', t: Date.now(), target: `option ${id}`, label: option?.label}]);
  }

  return (
    <div className="poll">
      <fieldset className="poll-options" disabled={!live}>
        <legend className="sr-only">{visual.prompt || visual.title}</legend>
        {options.map(option => {
          const on = selected.includes(option.id);
          const image = option.image ? assets[option.image] : '';
          return (
            <label key={option.id} className={`poll-option${on ? ' is-on' : ''}${image ? ' has-image' : ''}`}>
              <input type={visual.multiple ? 'checkbox' : 'radio'} name={`poll-${visual.id}`} checked={on} onChange={() => toggle(option.id)} />
              {image && <img src={image} alt="" className="poll-image" />}
              <span className="poll-text">
                <span className="poll-label">{option.label}</span>
                {option.description && <span className="poll-desc muted">{option.description}</span>}
              </span>
              <span className="poll-check" aria-hidden="true">{on && <Check size={14} />}</span>
            </label>
          );
        })}
        {visual.allow_other && (
          <label className="poll-other">
            <span className="muted">Something else</span>
            <input className="input" value={other} placeholder="Write your own answer" onChange={event => setOther(event.target.value)}
              onBlur={() => other.trim() && onRecord?.([{type: 'change', t: Date.now(), target: 'other', value: other.trim()}])} />
          </label>
        )}
      </fieldset>
      {visual.multiple && live && <p className="faint poll-hint">Choose any that apply.</p>}
    </div>
  );
}
