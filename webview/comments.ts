// Comments on points of an agent's report. They are added to the next message you send. Pure (no DOM), so the self-test can run it.

export interface PointComment {
  /** `${message id}:${point number}` */
  id: string;
  /** The point's text, shortened. */
  point: string;
  text: string;
  /** Already added to a message you sent. */
  sent?: boolean;
}

export const excerpt = (s: string, max = 90): string => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

/** The message to send: the unsent comments first, then what you typed. */
export function withComments(list: PointComment[], text: string): string {
  const open = list.filter((c) => !c.sent && c.text.trim());
  if (!open.length) return text;
  const block = ['My comments on points in your replies:', ...open.map((c) => `- "${c.point}" → ${c.text.trim().replace(/\s*\n\s*/g, ' ')}`)].join('\n');
  return text.trim() ? `${block}\n\n${text}` : block;
}

/** Adds or replaces the comment for a point; an empty text removes it. */
export function setComment(list: PointComment[], c: PointComment): PointComment[] {
  const rest = list.filter((x) => x.id !== c.id);
  return c.text.trim() ? [...rest, { ...c, text: c.text.trim(), sent: false }] : rest;
}

export const unsent = (list: PointComment[]): PointComment[] => list.filter((c) => !c.sent);
export const markSent = (list: PointComment[]): PointComment[] => list.map((c) => (c.sent ? c : { ...c, sent: true }));
