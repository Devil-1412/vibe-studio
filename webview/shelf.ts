// The Shelf: a drawer on the right edge for things kept across chats. Drag in a message, code, image or file;
// drag a card onto any tile, or press Insert. Rules and limits live in src/shelf.ts.
import { addToShelf, titleOf } from '../src/shelf';
import type { Attachment, FromWebview, ShelfItem } from '../src/types';

type Child = Node | string | null | undefined | false;
type H = (tag: string, attrs?: Record<string, any>, ...children: Child[]) => HTMLElement;

export const SHELF_TYPE = 'application/x-vibestudio-shelf';
export const MSG_TYPE = 'application/x-vibestudio-msg';
export const FROM_TYPE = 'application/x-vibestudio-from';

export interface ShelfCtx {
  h: H;
  icon(name: string): HTMLElement;
  post(m: FromWebview): void;
  /** A dropped or pasted file as an attachment, or undefined when its type is not supported. */
  read(f: File): Promise<Attachment | undefined>;
  /** Puts an item into the tile you were last working in. */
  insert(item: ShelfItem): void;
}

const ago = (at: number) => {
  const m = Math.round((Date.now() - at) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function createShelf(ctx: ShelfCtx) {
  const { h } = ctx;
  let items: ShelfItem[] = [];
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const count = h('span', { class: 'srv-n' });
  const button = h('button', { class: 'servers-btn', 'aria-expanded': 'false', 'aria-controls': 'shelf', title: 'Shelf: keep things across chats (Ctrl+Alt+H)', onclick: () => toggle() }, ctx.icon('shelf'), h('span', { text: 'Shelf' }), count);
  const note = h('div', { class: 'shelf-note', role: 'status' });
  const list = h('div', { class: 'shelf-list' });
  const drawer = h(
    'aside',
    { class: 'shelf', id: 'shelf', hidden: true, 'aria-label': 'Shelf', tabindex: '-1' },
    h('div', { class: 'srv-head' }, h('span', { text: 'Shelf' }), h('button', { class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close the shelf', onclick: () => toggle(false) }, ctx.icon('close'))),
    note,
    list,
  );

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ctx.post({ type: 'shelfSave', items }), 500);
  }

  function render() {
    count.textContent = items.length ? String(items.length) : '';
    list.replaceChildren(
      ...(items.length
        ? items.map(card)
        : [h('div', { class: 'srv-empty', text: 'Nothing here yet. Drag a message, a code block, an image or a file onto the shelf, or paste. Then drag a card onto any chat.' })]),
    );
  }

  function card(it: ShelfItem) {
    const preview =
      it.kind === 'attachment'
        ? it.att!.type.startsWith('image/')
          ? h('img', { class: 'shelf-img', alt: it.att!.name, src: `data:${it.att!.type};base64,${it.att!.data}` })
          : h('div', { class: 'shelf-file' }, ctx.icon('file'), h('span', { text: `${it.att!.name} · ${kb(it.att!.size)}` }))
        : h('pre', { class: 'shelf-text', text: (it.text ?? '').slice(0, 400) });
    const el = h(
      'div',
      { class: `shelf-card ${it.kind}`, draggable: 'true' },
      h('div', { class: 'shelf-title', text: it.title, title: it.title }),
      preview,
      h('div', { class: 'shelf-meta', text: [it.kind === 'code' ? 'Code' : it.kind === 'text' ? 'Message' : 'File', it.from, ago(it.at)].filter(Boolean).join(' · ') }),
      h(
        'div',
        { class: 'shelf-actions' },
        h('button', { type: 'button', class: 'ask-btn primary', title: "Put it in the chat you were last using", onclick: () => ctx.insert(it) }, 'Insert'),
        it.text
          ? h('button', { type: 'button', class: 'ask-btn', onclick: (e: Event) => {
              const b = e.currentTarget as HTMLElement;
              ctx.post({ type: 'copy', text: it.text! });
              b.textContent = 'Copied';
              setTimeout(() => (b.textContent = 'Copy'), 1200);
            } }, 'Copy')
          : '',
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'icon-btn', title: 'Remove from the shelf', 'aria-label': `Remove ${it.title}`, onclick: () => ((items = items.filter((x) => x.id !== it.id)), render(), save()) }, ctx.icon('close')),
      ),
    );
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData(SHELF_TYPE, it.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
    });
    return el;
  }

  function add(kind: ShelfItem['kind'], v: { text?: string; lang?: string; att?: Attachment; from?: string }) {
    const item: ShelfItem = { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, title: titleOf(kind, v.text, v.att, v.lang), text: v.text, lang: v.lang, att: v.att, from: v.from, at: Date.now() };
    const r = addToShelf(items, item);
    note.textContent = r.error ?? '';
    if (r.error) toggle(true);
    items = r.list;
    render();
    save();
  }

  async function take(dt: DataTransfer | null) {
    if (!dt) return;
    const msg = dt.getData(MSG_TYPE);
    if (msg.trim()) return add('text', { text: msg, from: dt.getData(FROM_TYPE) || undefined });
    if (dt.files.length) {
      const read = await Promise.all([...dt.files].map((f) => ctx.read(f)));
      const ok = read.filter((a): a is Attachment => !!a);
      for (const att of ok.reverse()) add('attachment', { att });
      if (ok.length < read.length) note.textContent = `Not added (unsupported type): ${[...dt.files].filter((_, i) => !read[i]).map((f) => f.name).join(', ')}`;
      return;
    }
    const plain = dt.getData('text/plain');
    if (plain.trim()) add('text', { text: plain });
  }

  const wants = (e: DragEvent) => !!e.dataTransfer && (e.dataTransfer.types.includes(MSG_TYPE) || e.dataTransfer.types.includes('Files') || (e.dataTransfer.types.includes('text/plain') && !e.dataTransfer.types.includes(SHELF_TYPE)));
  for (const t of [drawer, button]) {
    t.addEventListener('dragover', (e) => wants(e) && (e.preventDefault(), t.classList.add('dropping')));
    t.addEventListener('dragleave', (e) => !t.contains(e.relatedTarget as Node | null) && t.classList.remove('dropping'));
    t.addEventListener('drop', (e) => {
      t.classList.remove('dropping');
      if (!wants(e)) return;
      e.preventDefault();
      void take(e.dataTransfer);
    });
  }
  drawer.addEventListener('paste', (e) => {
    if (!e.clipboardData) return;
    e.preventDefault();
    void take(e.clipboardData);
  });

  function toggle(open = drawer.hidden) {
    drawer.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      note.textContent = '';
      drawer.focus();
    }
  }

  return {
    button,
    drawer,
    add,
    toggle,
    isOpen: () => !drawer.hidden,
    get: (id: string) => items.find((i) => i.id === id),
    set(next: ShelfItem[]) {
      items = next;
      render();
    },
  };
}
