// The Shelf: things kept across chats (messages, code, images, files). Pure rules and storage cleaning, no DOM or vscode.
import type { Attachment, ShelfItem } from './types';

export const MAX_ITEMS = 30;
export const MAX_ITEM_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

export const sizeOf = (i: ShelfItem): number => (i.text?.length ?? 0) + (i.att?.data.length ?? 0);

const same = (a: ShelfItem, b: ShelfItem) =>
  a.kind === b.kind && (a.kind === 'attachment' ? a.att?.name === b.att?.name && a.att?.size === b.att?.size : (a.text ?? '').trim() === (b.text ?? '').trim());

/** Puts an item first. The same thing twice moves to the front; the oldest fall off past the limits. */
export function addToShelf(list: ShelfItem[], item: ShelfItem): { list: ShelfItem[]; error?: string } {
  if (sizeOf(item) > MAX_ITEM_BYTES) return { list, error: `Too big for the shelf (over ${MAX_ITEM_BYTES / 1048576} MB).` };
  const next = [item, ...list.filter((x) => !same(x, item))];
  let total = next.reduce((n, x) => n + sizeOf(x), 0);
  while (next.length > 1 && (next.length > MAX_ITEMS || total > MAX_TOTAL_BYTES)) total -= sizeOf(next.pop()!);
  return { list: next };
}

/** A line to show for an item. */
export function titleOf(kind: ShelfItem['kind'], text: string | undefined, att: Attachment | undefined, lang?: string): string {
  if (att) return att.name;
  const first = (text ?? '').split('\n').find((l) => l.trim()) ?? '';
  const t = first.trim().replace(/\s+/g, ' ');
  const clipped = t.length > 70 ? `${t.slice(0, 69)}…` : t;
  return kind === 'code' && lang ? `${lang}: ${clipped}` : clipped || 'Untitled';
}

/** Anything read back from storage or sent by the webview is untrusted. */
export function cleanShelf(raw: unknown): ShelfItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ShelfItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !['text', 'code', 'attachment'].includes(r.kind)) continue;
    const text = typeof r.text === 'string' ? r.text : undefined;
    const a = r.att;
    const att = a && typeof a.name === 'string' && typeof a.type === 'string' && typeof a.data === 'string' && typeof a.size === 'number' ? { name: a.name, type: a.type, data: a.data, size: a.size } : undefined;
    if (r.kind === 'attachment' ? !att : !text) continue;
    const item: ShelfItem = {
      id: r.id.slice(0, 40),
      kind: r.kind,
      title: typeof r.title === 'string' ? r.title.slice(0, 120) : titleOf(r.kind, text, att),
      text,
      lang: typeof r.lang === 'string' ? r.lang.slice(0, 20) : undefined,
      att,
      from: typeof r.from === 'string' ? r.from.slice(0, 120) : undefined,
      at: typeof r.at === 'number' ? r.at : 0,
    };
    if (sizeOf(item) <= MAX_ITEM_BYTES) out.push(item);
  }
  return out.slice(0, MAX_ITEMS);
}
