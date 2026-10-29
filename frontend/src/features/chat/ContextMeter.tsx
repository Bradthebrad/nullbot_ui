// How full the manager's last request was, against the model's window, with
// the two compaction thresholds marked. Hidden until a request has run.
import {formatTokens} from '../../lib/format';
import {isBusy} from '../../state/chat';
import {useChat, useChatState} from './ChatContext';
import {openSettings} from '../../state/app';
import {MenuButton} from '../../ui/Menu';
import type {Turn} from '../activity/model';

export function latestContext(turns: Turn[]): Turn['context'] {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].lane !== 'also' && turns[i].context) return turns[i].context;
  }
  return undefined;
}

export function ContextMeter() {
  const chat = useChat();
  const context = useChatState(state => latestContext(state.activity.turns));
  const busy = useChatState(isBusy);
  if (!context || !context.window) return null;
  const ratio = Math.min(1, context.tokens / context.window);
  const percent = Math.round(ratio * 100);
  const shortenAt = context.shortenAt ? context.shortenAt / context.window : undefined;
  const summarizeAt = context.summarizeAt ? context.summarizeAt / context.window : undefined;
  const level = summarizeAt && ratio >= summarizeAt ? 'full' : shortenAt && ratio >= shortenAt ? 'busy' : 'calm';
  const summary = `About ${formatTokens(context.tokens)} of ${formatTokens(context.window)} tokens in the last request.`;
  const thresholds = context.shortenAt && context.summarizeAt
    ? `Earlier tool results are shortened from about ${formatTokens(context.shortenAt)} tokens, and older messages summarized from about ${formatTokens(context.summarizeAt)}.`
    : '';
  return (
    <MenuButton
      className={`btn btn-ghost btn-sm context-meter is-${level}`}
      title={`${summary} ${thresholds}`.trim()}
      placement="above"
      align="end"
      label={
        <>
          <span className="context-track" aria-hidden="true">
            <span className="context-fill" style={{width: `${percent}%`}} />
            {shortenAt && <span className="context-mark" style={{left: `${shortenAt * 100}%`}} />}
            {summarizeAt && <span className="context-mark" style={{left: `${summarizeAt * 100}%`}} />}
          </span>
          <span className="num">{percent}%</span>
          <span className="sr-only"> of the context window used</span>
        </>
      }
      items={[
        {kind: 'heading', label: summary},
        ...(thresholds ? [{kind: 'heading' as const, label: thresholds}] : []),
        {kind: 'separator'},
        {label: busy ? 'Compacting waits for this request to finish' : 'Compact the conversation', disabled: busy, onSelect: () => void chat.compact('')},
        {label: 'Context settings', onSelect: () => openSettings('agent')},
      ]}
    />
  );
}
