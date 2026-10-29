// Chat transcript state: streaming fragments into live rows and reconciling
// them with durable history. Moved unchanged from the original App.tsx so the
// behavior (and its tests) carry over; types are intentionally loose.
/* eslint-disable @typescript-eslint/no-explicit-any */

export function localMessage(role: string, content: string, extra: any = {}) {
  return {
    role,
    content,
    time: new Date().toISOString(),
    local: true,
    ...extra,
  };
}

export function messageWithAttachmentTokens(text: string, attachments: any[]) {
  const tokens = attachments.map((item) => item.token).filter(Boolean);
  if (tokens.length === 0) return text;
  if (!text.trim()) return tokens.join(' ');
  return `${text.trim()}\n\n${tokens.join(' ')}`;
}

export function mergeAttachments(current: any[], incoming: any[]) {
  const out = [...(current || [])];
  for (const item of incoming || []) {
    const key = String(item.path || item.original_path || item.name || '').replace(/\\/g, '/');
    if (!key || out.some((existing) => String(existing.path || existing.original_path || existing.name || '').replace(/\\/g, '/') === key)) continue;
    out.push(item);
  }
  return out;
}

export function messageWithVisibleAttachments(message: any) {
  const fromMessage = message.attachments || [];
  if ((message.role || '').toLowerCase() !== 'user') {
    return {content: message.content || '', attachments: fromMessage};
  }
  const parsed = attachmentsFromText(message.content || '');
  const content = String(message.content || '').replace(attachmentTokenRegex(), '').trim();
  return {content, attachments: mergeAttachments(fromMessage, parsed)};
}

export function attachmentsFromText(text: string) {
  const attachments: any[] = [];
  const regex = attachmentTokenRegex();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const path = String(match[1] || match[2] || '').trim().replace(/^["']|["']$/g, '');
    if (!path) continue;
    attachments.push({
      name: basename(path),
      path,
      kind: fileKindLabel(path),
      token: match[0],
    });
  }
  return attachments;
}

export function attachmentTokenRegex() {
  return /@file\("([^"]+)"\)|@file\(([^)]+)\)/g;
}

export function basename(path: string) {
  return path.split(/[\\/]+/).filter(Boolean).pop() || path;
}

export function fileKindLabel(path: string) {
  const ext = path.toLowerCase().split('.').pop() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['docx', 'doc'].includes(ext)) return 'document';
  if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) return 'spreadsheet';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  return 'file';
}

export function streamStatus(record: any) {
  return ({on_llm_new_token: 'response delta', on_llm_reasoning: 'reasoning delta', on_llm_commentary: 'commentary', on_llm_end: 'agent complete', on_llm_error: 'model error', on_chat_model_start: 'model start'} as any)[record.kind] || record.status || '';
}

export function isAlsoRecord(record: any) {
  return record.lane === 'also' || record.mode === 'also' || record.source === 'also' || record.role === 'also' || /^(also|observer)(?:$|[-:/])/i.test(String(record.agent_id || record.agent || record.task_id || ''));
}

export function isPublicRecord(record: any) {
  return record.private !== true && record.visibility !== 'private' && record.channel !== 'analysis' && !/private|raw_reasoning|chain_of_thought/i.test(String(record.kind || ''));
}

export function ingestChatStream(messages: any[], record: any) {
  if (!isPublicRecord(record) || isAlsoRecord(record) || record.agent_id !== 'main' || record.parent_run_id || !record.run_id) return messages;
  const status = streamStatus(record);
  if (!['response delta', 'commentary delta', 'commentary', 'reasoning delta', 'reasoning', 'agent complete', 'model error', 'model start'].includes(status)) return messages;
  const key = [record.submission_id || '', record.agent_id, record.run_id].join(':');
  const previous = messages.find(message => message.streamKey === key);
  if (!previous && ['agent complete', 'model error'].includes(status)) return messages;
  const item = {...(previous || {role: 'assistant', content: '', summaries: [], commentary: [], time: record.time, run_id: record.run_id, submission_id: record.submission_id, streamKey: key, historyAnchor: messages.filter(message => message.role === 'assistant' && !message.streamKey && !message.pending).length}), summaries: [...(previous?.summaries || [])], commentary: [...(previous?.commentary || [])]};
  const text = String(record.detail || '');
  if (status === 'response delta' && record.channel !== 'commentary') item.content += text;
  if (status === 'commentary' && item.content.trim() && item.content.trim() === text.trim()) {
    // The text streamed so far led to a tool call: it was commentary, not
    // the answer. Move it rather than showing it twice.
    item.commentary.push(text);
    item.content = '';
    item.lastChannel = 'commentary';
  } else if (status === 'commentary delta' || status === 'commentary' || (status === 'response delta' && record.channel === 'commentary')) {
    const last = item.commentary.length - 1;
    if (last >= 0 && item.lastChannel === 'commentary' && status !== 'commentary') item.commentary[last] += text;
    else item.commentary.push(text);
    item.lastChannel = 'commentary';
  } else if (status === 'reasoning delta' || status === 'reasoning') {
    const last = item.summaries.length - 1;
    if (last >= 0 && !item.newRound && status !== 'reasoning') item.summaries[last] += text;
    else item.summaries.push(text);
    item.newRound = false;
    item.lastChannel = 'summary';
  } else if (status === 'model start') {
    // A subsequent model round follows public tool commentary. Keep it even if
    // persisted history contains only the final model answer.
    if (item.content) {item.commentary.push(item.content); item.content = '';}
    item.newRound = true;
    item.lastChannel = '';
  } else item.lastChannel = 'response';
  item.pending = status !== 'agent complete' && status !== 'model error';
  item.streamState = status === 'model error' ? 'incomplete' : status === 'agent complete' ? 'complete' : 'streaming';
  let nextSummaryID = previous?.nextSummaryID ?? previous?.summaries?.length ?? 0;
  item.summaryKeys = item.summaries.map((_: string, index: number) => item.summaryKeys?.[index] || `stream:${key}:0:summary:${nextSummaryID++}`);
  item.nextSummaryID = nextSummaryID;
  return previous ? messages.map(message => message === previous ? item : message) : [...messages.filter(message => !message.pending || message.streamKey), item];
}

export function isTranscriptNearBottom(element: {scrollHeight: number; scrollTop: number; clientHeight: number}) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
}

export function followTranscript(element: {scrollHeight: number; scrollTo: (options: {top: number}) => void} | null, follow: boolean) {
  if (element && follow) element.scrollTo({top: element.scrollHeight});
}

export function rememberSummaryOpen(states: Map<string, boolean>, key: string, initiallyOpen: boolean) {
  if (!states.has(key)) states.set(key, initiallyOpen);
  return states.get(key)!;
}

export function identifyChatMessages(messages: any[]) {
  const occurrences = new Map<string, number>();
  return messages.map(message => {
    // Scope ordinals to a message identity, not its position in the transcript.
    // Content is only a fallback for old histories without IDs or timestamps.
    const base = message.streamKey ? `stream:${message.streamKey}` : JSON.stringify([
      message.lane || 'primary', message.submission_id || '', message.run_id || '',
      message.agent_id || '', message.task_id || '', message.role || 'assistant',
      message.id || message.optimisticRequestID || message.time || '',
      message.id || message.optimisticRequestID || message.time || message.submission_id || message.run_id ? '' : message.content || '',
    ]);
    const ordinal = occurrences.get(base) || 0;
    occurrences.set(base, ordinal + 1);
    return {...message, transcriptKey: message.transcriptKey || `${base}:${ordinal}`};
  });
}

export function reconcileChatHistory(current: any[], history: any[]) {
  // Empty refresh snapshots are not explicit Clear actions (those bypass this helper).
  if (!history.length) return current.filter(message => !message.pending || message.streamKey);
  const previousRows = identifyChatMessages(current);
  const previousByKey = new Map(previousRows.filter(message => !message.streamKey).map(message => [message.historyKey || message.transcriptKey, message]));
  const result = identifyChatMessages(history.filter(isPublicRecord).filter(message => !isAlsoRecord(message))).map(message => {
    const previous = previousByKey.get(message.transcriptKey);
    return {...message, historyKey: message.transcriptKey, transcriptKey: previous?.transcriptKey || message.transcriptKey, summaryKey: previous?.summaryKey};
  });
  const assistants = result.filter(message => message.role === 'assistant');
  for (const original of previousRows.filter(message => message.streamKey)) {
    // Durable public records replace their transient copy. Transfer disclosure
    // identity (not text) before removing the live summary. Match each copy once.
    const persisted = result.filter(message => message.submission_id && message.submission_id === original.submission_id && (!message.agent_id || message.agent_id === 'main') && (!message.run_id || message.run_id === original.run_id));
    const retained = (values: string[], role: string) => values.filter(text => !persisted.some(message => message.role === role && String(message.content).trim() === text.trim()));
    const summaries: string[] = [], summaryKeys: string[] = [];
    const matched = new Set<any>();
    (original.summaries || []).forEach((text: string, index: number) => {
      const key = original.summaryKeys?.[index] || `${original.transcriptKey}:summary:${index}`;
      const durable = persisted.find(message => !matched.has(message) && message.role === 'reasoning' && String(message.content).trim() === text.trim());
      if (durable) {durable.summaryKey = key; matched.add(durable);}
      else {summaries.push(text); summaryKeys.push(key);}
    });
    const stream = {...original, summaries, summaryKeys, commentary: retained(original.commentary || [], 'commentary')};
    if (stream.reconciled) {
      const at = result.findIndex(message => message.role === 'assistant' && (stream.finalRunID ? message.run_id === stream.finalRunID : message.time === stream.finalTime && message.content === stream.finalContent));
      if (at >= 0 && (stream.summaries.length || stream.commentary.length || stream.content)) result.splice(at, 0, stream);
      continue;
    }
    // Prefer stable run IDs. The ordinal anchor is only a fallback for legacy
    // history; never attach every earlier stream to the latest assistant turn.
    const final = assistants.find(message => message.run_id && message.run_id === stream.run_id && (!stream.submission_id || !message.submission_id || message.submission_id === stream.submission_id)) || assistants.find(message => message.submission_id && message.submission_id === stream.submission_id) || assistants[stream.historyAnchor];
    if (stream.streamState === 'complete' && final) {
      const content = String(stream.content || '').trim();
      const answer = String(final.content || '').trim();
      let commentary = [...(stream.commentary || [])];
      if (content && content !== answer && !answer.includes(content)) {
        const prefix = answer && content.endsWith(answer) ? content.slice(0, -answer.length).trim() : content;
        if (prefix) commentary.push(prefix);
      }
      commentary = retained([...new Set(commentary)].filter(text => text.trim() !== answer), 'commentary');
      if (stream.summaries?.length || commentary.length) result.splice(result.indexOf(final), 0, {...stream, content: '', commentary, pending: false, reconciled: true, finalTime: final.time, finalContent: final.content, finalRunID: final.run_id});
      else final.transcriptKey = stream.transcriptKey;
    } else result.push(stream);
  }
  return result;
}

/** Ends live streams (all, or one submission's) as complete or cut short. */
export function settleChatStreams(messages: any[], submissionId: string | undefined, streamState: 'complete' | 'incomplete') {
  return messages.map(message => message.streamKey && message.pending && (!submissionId || message.submission_id === submissionId) ? {...message, pending: false, streamState} : message);
}

export function interruptChatStreams(messages: any[], submissionId?: string) {
  return settleChatStreams(messages, submissionId, 'incomplete');
}
