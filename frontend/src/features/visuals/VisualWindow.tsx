// The window visuals open in: it floats over the app so the conversation
// stays in reach, moves and resizes, and holds one tab per visual.
import {useEffect, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';
import {Maximize2, Minimize2, Minus, RotateCw, X} from 'lucide-react';
import {useStore} from '../../lib/store';
import type {Visualization} from '../../lib/types';
import {confirmDialog} from '../../ui/dialogs';
import {closeVisual, kindNames, respondToVisual, saveWindowRect, setVisualWindow, visualStore, type WindowRect} from '../../state/visuals';
import {VisualIcon} from './visualIcons';
import {VisualSurface, type Staged} from './VisualSurface';

type TabState = {note: string; staged: Staged | null; recorded: number; reloadKey: number; sending: boolean};
const blankTab: TabState = {note: '', staged: null, recorded: 0, reloadKey: 0, sending: false};

function defaultRect(): WindowRect {
  const w = Math.round(Math.min(860, Math.max(420, window.innerWidth * 0.55)));
  const h = Math.round(Math.min(720, Math.max(360, window.innerHeight * 0.74)));
  return {x: Math.max(8, window.innerWidth - w - 24), y: 56, w, h};
}

function clampRect(rect: WindowRect): WindowRect {
  const w = Math.min(Math.max(rect.w, 360), window.innerWidth - 16);
  const h = Math.min(Math.max(rect.h, 260), window.innerHeight - 16);
  return {w, h, x: Math.min(Math.max(rect.x, 8 - w + 120), window.innerWidth - 120), y: Math.min(Math.max(rect.y, 4), window.innerHeight - 44)};
}

export function VisualWindow() {
  const {tabs, active, minimized, maximized, known, live, rect} = useStore(visualStore, state => state);
  const [states, setStates] = useState<Record<string, TabState>>({});
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<WindowRect>(() => clampRect(rect || defaultRect()));

  const visuals = tabs.map(id => live.find(v => v.id === id) || known[id]).filter(Boolean) as Visualization[];
  const current = visuals.find(v => v.id === active) || visuals[0];
  const tab = (id: string) => states[id] || blankTab;
  const patch = (id: string, next: Partial<TabState>) => setStates(all => ({...all, [id]: {...(all[id] || blankTab), ...next}}));

  // Remember the size the person gives it.
  useEffect(() => {
    const el = box.current;
    if (!el || maximized || minimized || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const next = {...place, w: el.offsetWidth, h: el.offsetHeight};
      if (Math.abs(next.w - place.w) > 2 || Math.abs(next.h - place.h) > 2) {
        setPlace(next);
        saveWindowRect(next);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [place, maximized, minimized, visuals.length > 0]);

  useEffect(() => {
    const onResize = () => setPlace(p => clampRect(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!visuals.length || !current) return null;

  function startDrag(event: ReactPointerEvent<HTMLElement>) {
    if (maximized || event.button !== 0 || (event.target as HTMLElement).closest('button, input, textarea, [role="tab"]')) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = place;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    const move = (e: PointerEvent) => setPlace(clampRect({...origin, x: origin.x + e.clientX - startX, y: origin.y + e.clientY - startY}));
    const up = (e: PointerEvent) => {
      target.releasePointerCapture?.(e.pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPlace(p => {
        saveWindowRect(p);
        return p;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  async function close(visual: Visualization) {
    if (visual.waiting && !(await confirmDialog({title: `Close “${visual.title}”?`, body: 'NullBot is waiting for your answer. It keeps waiting; you can reopen this from Visuals.', confirmLabel: 'Close'}))) return;
    closeVisual(visual.id);
  }

  async function send(visual: Visualization, dismiss = false) {
    const state = tab(visual.id);
    patch(visual.id, {sending: true});
    // Let the page hand over its last interactions first.
    await new Promise(resolve => setTimeout(resolve, 320));
    const done = await respondToVisual(visual.id, dismiss ? null : state.staged?.data ?? null, dismiss ? '' : state.note.trim(), dismiss);
    if (done) setStates(all => {
      const next = {...all};
      delete next[visual.id];
      return next;
    });
    else patch(visual.id, {sending: false});
  }

  if (minimized) {
    const waiting = visuals.filter(v => v.waiting).length;
    return (
      <button className="visual-pill" onClick={() => setVisualWindow({minimized: false})} title="Show the visual window">
        <VisualIcon kind={current.kind} size={14} />
        <span className="visual-pill-title">{current.title}</span>
        {visuals.length > 1 && <span className="faint num">+{visuals.length - 1}</span>}
        {waiting > 0 && <span className="tag warn"><span className="dot live" aria-hidden="true" />Waiting for you</span>}
      </button>
    );
  }

  const state = tab(current.id);
  const isPoll = current.kind === 'poll';
  const canSend = !state.sending && (!isPoll || state.staged?.data != null);
  const style = maximized ? undefined : {left: place.x, top: place.y, width: place.w, height: place.h};
  return (
    <section ref={box} className={`visual-window${maximized ? ' is-max' : ''}`} style={style} role="dialog" aria-label={`Visual: ${current.title}`} aria-modal="false">
      <header className="visual-head" onPointerDown={startDrag} onDoubleClick={event => !(event.target as HTMLElement).closest('button') && setVisualWindow({maximized: !maximized})}>
        <VisualIcon kind={current.kind} size={15} />
        <div className="visual-heading">
          <h2 title={current.title}>{current.title}</h2>
          <span className="faint">{kindNames[current.kind] || 'Visual'}{current.project_name ? ` in ${current.project_name}` : ''}</span>
        </div>
        {current.waiting && <span className="tag warn visual-waiting"><span className="dot live" aria-hidden="true" />Waiting for you</span>}
        <div className="visual-head-actions">
          {!isPoll && <button className="btn btn-ghost btn-icon btn-sm" title="Reload" aria-label="Reload" onClick={() => patch(current.id, {reloadKey: state.reloadKey + 1})}><RotateCw size={13} /></button>}
          <button className="btn btn-ghost btn-icon btn-sm" title={maximized ? 'Restore' : 'Fill the window'} aria-label={maximized ? 'Restore' : 'Maximize'} onClick={() => setVisualWindow({maximized: !maximized})}>{maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
          <button className="btn btn-ghost btn-icon btn-sm" title="Minimize" aria-label="Minimize" onClick={() => setVisualWindow({minimized: true})}><Minus size={13} /></button>
          <button className="btn btn-ghost btn-icon btn-sm" title="Close" aria-label="Close" onClick={() => void close(current)}><X size={14} /></button>
        </div>
      </header>
      {visuals.length > 1 && (
        <div className="visual-tabs" role="tablist" aria-label="Open visuals">
          {visuals.map(v => (
            <button key={v.id} role="tab" aria-selected={v.id === current.id} className={v.id === current.id ? 'visual-tab active' : 'visual-tab'} onClick={() => setVisualWindow({active: v.id})} title={v.title}>
              {v.waiting && <span className="dot live" aria-hidden="true" />}
              <span>{v.title}</span>
            </button>
          ))}
        </div>
      )}
      {current.prompt && <p className="visual-prompt"><span>{current.prompt}</span></p>}
      <div className="visual-body">
        {/* Every tab stays mounted, so a game or form keeps its state. */}
        {visuals.map(v => (
          <div key={v.id} className="visual-slot" hidden={v.id !== current.id}>
            <VisualSurface
              visual={v}
              mode="live"
              reloadKey={tab(v.id).reloadKey}
              onStaged={staged => patch(v.id, {staged: staged.data == null && !staged.requested ? null : staged})}
              onRecorded={count => patch(v.id, {recorded: count})}
            />
          </div>
        ))}
      </div>
      <footer className="visual-foot">
        <div className="visual-status">
          <span className="visual-recording" title="What you do here is recorded and sent with your answer">
            <span className="dot live" aria-hidden="true" />
            {state.recorded ? `${state.recorded} interaction${state.recorded === 1 ? '' : 's'} recorded` : 'Recording what you do here'}
          </span>
          {state.staged?.requested ? <span className="visual-ready">The visual is ready to send.</span> : state.staged?.data != null && !isPoll ? <span className="faint">Answer set by the visual.</span> : null}
        </div>
        <div className="visual-reply">
          <textarea
            className="textarea visual-note"
            rows={1}
            placeholder="Add a note for NullBot (optional)"
            aria-label="Note for NullBot"
            value={state.note}
            onChange={event => patch(current.id, {note: event.target.value})}
            onKeyDown={event => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canSend) {
                event.preventDefault();
                void send(current);
              }
            }}
          />
          {current.waiting && <button className="btn" disabled={state.sending} onClick={() => void send(current, true)} title="Tell NullBot you’re skipping this">Skip</button>}
          <button className={`btn btn-primary${state.staged?.requested ? ' is-ready' : ''}`} disabled={!canSend} title={canSend ? 'Send your answer, note and interactions (Ctrl+Enter)' : 'Choose an option first'} onClick={() => void send(current)}>
            Send to NullBot
          </button>
        </div>
      </footer>
    </section>
  );
}
