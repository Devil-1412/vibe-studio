// "Continue in a new chat": when a chat's context is nearly full, ask it for a summary and start a fresh chat from it.
// Pure (no DOM), so the self-test can run it.

/** Context use (percent) from which the button is offered. */
export const HANDOFF_AT = 80;
/** The same, in low usage mode: a long context is what makes every turn expensive. */
export const HANDOFF_AT_LOW = 50;

export const SUMMARY_PROMPT =
  'Summarize this chat so I can continue it in a fresh one: the goal, what is done, what is left, the files and decisions that matter, and any commands to run. Under 300 words, plain text, no preamble.';

/** The first message of the new chat. It is only filled in, never sent, so the summary can be read and edited first. */
export function continuationText(summary: string): string {
  return `Context from my previous chat (it ran out of room), summarized:\n\n${summary.trim()}\n\n---\nContinue from here: `;
}

/** The newest assistant reply that is not `before`, or undefined while it has not arrived. `items` is oldest first. */
export function newestReply(items: { id: string; kind: string; text?: string }[], before: string | undefined): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== 'assistant') continue;
    return it.id !== before && it.text?.trim() ? it.text : undefined;
  }
  return undefined;
}

export const offerHandoff = (pct: number | undefined, low = false): boolean => pct !== undefined && pct >= (low ? HANDOFF_AT_LOW : HANDOFF_AT);
