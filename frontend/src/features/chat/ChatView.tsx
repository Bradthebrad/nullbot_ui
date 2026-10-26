import {useEffect, useRef, useState} from 'react';
import {X} from 'lucide-react';
import {useStore} from '../../lib/store';
import {appStore, writePref} from '../../state/app';
import {chatStore} from '../../state/chat';
import {ResizeHandle, clampSize} from '../../ChatLayout';
import {Markdown} from '../../ui/Markdown';
import {Transcript} from './Transcript';
import {Composer} from './Composer';
import {Inspector} from './Inspector';
import {ErrorBoundary} from '../../ui/ErrorBoundary';

function readWidth() {
  try {
    const value = Number(localStorage.getItem('nullbot.inspectorWidth'));
    return Number.isFinite(value) && value > 0 ? value : 360;
  } catch {
    return 360;
  }
}

export function ChatView({active}: {active: boolean}) {
  const inspectorOpen = useStore(appStore, state => state.inspectorOpen);
  const output = useStore(chatStore, state => state.commandOutput);
  const container = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(readWidth);
  const [bounds, setBounds] = useState({min: 280, max: 640});
  useEffect(() => {
    const el = container.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setBounds({min: 280, max: Math.max(280, Math.min(720, el.clientWidth - 420))}));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const inspectorWidth = clampSize(width, bounds.min, bounds.max);
  return (
    <section ref={container} className={`chat ${inspectorOpen ? 'with-inspector' : ''}`} style={{'--inspector-w': `${inspectorWidth}px`} as React.CSSProperties} aria-label="Chat">
      <div className="chat-main" id="chat-main">
        <ErrorBoundary area="The transcript"><Transcript /></ErrorBoundary>
        <div className="chat-footer">
          {output && (
            <div className="command-output">
              <header>
                <span className="mono">{output.command}</span>
                <button className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={() => chatStore.set({commandOutput: null})}><X size={14} /></button>
              </header>
              <Markdown className="prose prose-sm">{output.message}</Markdown>
            </div>
          )}
          <Composer active={active} />
        </div>
      </div>
      {inspectorOpen && (
        <>
          <ResizeHandle axis="activity" value={inspectorWidth} min={bounds.min} max={bounds.max} onChange={value => {
            setWidth(value);
            writePref('nullbot.inspectorWidth', value);
          }} />
          <ErrorBoundary area="The activity panel"><Inspector /></ErrorBoundary>
        </>
      )}
    </section>
  );
}
