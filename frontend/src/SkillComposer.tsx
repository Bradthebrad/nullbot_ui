import {useEffect, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes} from 'react';
import {matchSkills, highlightSkillWords, type SkillMetadata, type SkillMatch} from './skillMatching';
import './skill-composer.css';

export function useSkillContext(input: string, skills: SkillMetadata[], enabled: boolean, eligible: boolean) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const candidates = enabled && eligible ? matchSkills(input, skills) : [];
  const candidateKey = candidates.map(skill => skill.path).join('\n');
  useEffect(() => {
    setDismissed(current => current.filter(path => candidates.some(skill => skill.path === path)));
  }, [candidateKey]);
  const matches = candidates.filter(skill => !dismissed.includes(skill.path));
  return {matches, paths: matches.map(skill => skill.path), dismiss: (path: string) => setDismissed(current => [...current, path])};
}

type ComposerProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {matches: SkillMatch[]};
// Keep a real textarea for selection, IME, paste, caret, accessibility and undo.
// The non-interactive mirror paints only matching words without changing the draft.
export function SkillComposer({matches, value, onScroll, className = '', ...props}: ComposerProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const text = String(value || '');
  function sync() {
    const input = textarea.current, layer = mirror.current;
    if (!input || !layer) return;
    layer.style.width = `${input.clientWidth}px`;
    layer.style.height = `${input.clientHeight}px`;
    layer.scrollTop = input.scrollTop;
    layer.scrollLeft = input.scrollLeft;
  }
  useLayoutEffect(() => {sync();}, [text, matches]);
  useEffect(() => {
    if (!textarea.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(sync);
    observer.observe(textarea.current);
    return () => observer.disconnect();
  }, []);
  return <div className="skill-composer">
    <textarea {...props} value={value} ref={textarea} className={`skill-composer-input ${className}`} onScroll={event => {sync(); onScroll?.(event);}} />
    <div className="skill-composer-mirror" ref={mirror} aria-hidden="true">
      {highlightSkillWords(text, matches).map((part, index) => part.highlighted
        ? <span className="skill-word-glow" key={index}>{part.text}</span>
        : <span key={index}>{part.text}</span>)}{'\n'}
    </div>
  </div>;
}

export function SkillContextNotice({matches, dismiss}: {matches: SkillMatch[]; dismiss: (path: string) => void}) {
  return <div className="skill-context-notices" aria-live="polite" aria-atomic="true">
    {matches.map(skill => <div className="skill-context-bubble" key={skill.path}>
      <span aria-hidden="true">⚡</span>
      <span><strong>{skill.name}</strong> will be added to context</span>
      <button type="button" aria-label={`Skip ${skill.name} for this message`} title="Skip for this message" onClick={() => dismiss(skill.path)}>×</button>
    </div>)}
  </div>;
}
