import {useEffect, useRef, useState} from 'react';

export function clampSize(value: number, min: number, max: number) {
  return Math.round(Math.min(Math.max(min, max), Math.max(min, Number.isFinite(value) ? value : min)));
}
export function resizeBounds(axis: 'activity' | 'composer', width: number, height: number) {
  return axis === 'activity' ? {min: 220, max: Math.max(220, width - 360)} : {min: 150, max: Math.max(150, Math.min(600, height - 140))};
}
function readSize(key: string, fallback: number) {
  try {const stored = localStorage.getItem(key); const value = Number(stored); return stored && Number.isFinite(value) ? value : fallback;} catch {return fallback;}
}
export function useChatLayout() {
  const container = useRef<HTMLElement>(null);
  const [dimensions, setDimensions] = useState({width: 1100, height: 800});
  const [activity, setActivity] = useState(() => readSize('nullbot.activityWidth', 390));
  const [composer, setComposer] = useState(() => readSize('nullbot.composerHeight', 250));
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {const rect = element.getBoundingClientRect(); if (rect.width && rect.height) setDimensions({width: rect.width - 28, height: rect.height - 28});};
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const activityBounds = resizeBounds('activity', dimensions.width, dimensions.height);
  const composerBounds = resizeBounds('composer', dimensions.width, dimensions.height);
  const activityWidth = clampSize(activity, activityBounds.min, activityBounds.max);
  const composerHeight = clampSize(composer, composerBounds.min, composerBounds.max);
  function change(axis: 'activity' | 'composer', value: number) {
    const bounds = axis === 'activity' ? activityBounds : composerBounds;
    const next = clampSize(value, bounds.min, bounds.max);
    (axis === 'activity' ? setActivity : setComposer)(next);
    try {localStorage.setItem(axis === 'activity' ? 'nullbot.activityWidth' : 'nullbot.composerHeight', String(next));} catch { /* Storage may be disabled. */ }
  }
  return {container, activityWidth, composerHeight, activityBounds, composerBounds, change};
}

export function ResizeHandle({axis, value, min, max, onChange}: {axis: 'activity' | 'composer'; value: number; min: number; max: number; onChange: (value: number) => void}) {
  const drag = useRef<{id: number; start: number; value: number} | null>(null);
  const horizontal = axis === 'activity';
  return <div className={`resize-handle resize-${axis}`} role="separator" tabIndex={0}
    aria-label={horizontal ? 'Resize chat and activity panels' : 'Resize message composer'}
    aria-orientation={horizontal ? 'vertical' : 'horizontal'} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
    aria-valuetext={`${value} pixels`} aria-controls={horizontal ? 'chat-main live-activity' : 'message-composer'}
    title="Drag to resize. Use arrow keys, Home or End when focused."
    onPointerDown={event => {if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = {id: event.pointerId, start: horizontal ? event.clientX : event.clientY, value};}}
    onPointerMove={event => {const current = drag.current; if (current?.id === event.pointerId) onChange(current.value + current.start - (horizontal ? event.clientX : event.clientY));}}
    onPointerUp={event => {drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);}}
    onPointerCancel={() => {drag.current = null;}} onLostPointerCapture={() => {drag.current = null;}}
    onKeyDown={event => {
      const step = event.shiftKey ? 40 : 10;
      let next: number;
      if (event.key === 'Home') next = min;
      else if (event.key === 'End') next = max;
      else if (event.key === (horizontal ? 'ArrowLeft' : 'ArrowUp')) next = value + step;
      else if (event.key === (horizontal ? 'ArrowRight' : 'ArrowDown')) next = value - step;
      else return;
      event.preventDefault(); onChange(clampSize(next, min, max));
    }}><span aria-hidden="true" /></div>;
}
