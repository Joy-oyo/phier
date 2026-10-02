import type { KnowledgeEvent, KnowledgeInput } from '../../shared/knowledge';

export async function analyzeKnowledge(
  input: KnowledgeInput,
  signal: AbortSignal,
  onEvent: (event: KnowledgeEvent) => void,
) {
  const response = await fetch('/api/knowledge/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Phier-Client': '1' },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || 'Could not research this passage. Please retry.');
  }
  if (!response.body) throw new Error('Streaming results are unavailable in this browser.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '',
    completed = false;
  const receive = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as KnowledgeEvent;
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'complete') completed = true;
    onEvent(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        receive(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (done) break;
    }
    receive(buffer);
    if (!completed) throw new Error('Research ended before it finished. Retry this passage.');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
