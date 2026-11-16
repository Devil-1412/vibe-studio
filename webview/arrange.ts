// Moving things between tiles: drag a tile by its grip to re-order, drag a message onto another tile to quote it there.
import type { FromWebview } from '../src/types';

type Child = Node | string | null | undefined | false;
type H = (tag: string, attrs?: Record<string, any>, ...children: Child[]) => HTMLElement;

export interface ArrangeCtx {
  h: H;
  icon(name: string): HTMLElement;
  grid: HTMLElement;
  columns(): number;
  post(m: FromWebview): void;
  /** A message was dropped on a tile: put it in that tile's message box. */
  quote(key: string, text: string): void;
  /** A shelf card was dropped on a tile. */
  shelfDrop(key: string, id: string): void;
}

const TILE = 'application/x-vibestudio-tile';
const MSG = 'application/x-vibestudio-msg';
const FROM = 'application/x-vibestudio-from';
const SHELF = 'application/x-vibestudio-shelf';

export function createArrange(ctx: ArrangeCtx) {
  const { h } = ctx;
  let dragging: string | undefined;

  const tileEls = () => [...ctx.grid.querySelectorAll<HTMLElement>(':scope > .tile')];
  const clear = () => {
    for (const el of tileEls()) el.classList.remove('drop-before', 'drop-after', 'quote-target', 'dragging');
  };

  /** Chats open in the studio, in screen order; the host keeps this order for the next start. */
  function save() {
    ctx.post({ type: 'order', keys: tileEls().map((el) => el.dataset.key!).filter((k) => !k.startsWith('draft:')) });
  }

  function place(key: string, target: string, after: boolean) {
    const el = tileEls().find((t) => t.dataset.key === key);
    const to = tileEls().find((t) => t.dataset.key === target);
    if (!el || !to || el === to) return;
    const focused = document.activeElement as HTMLElement | null;
    if (after) to.after(el);
    else to.before(el);
    // a moved node loses focus
    if (focused && el.contains(focused)) focused.focus();
    save();
  }

  return {
    /** The handle in a tile's header. `key` is read when the drag starts, since a new chat's key changes. */
    grip(key: () => string): HTMLElement {
      const g = h('button', { class: 'icon-btn grip', draggable: 'true', title: 'Drag to move this tile', 'aria-label': 'Move tile (Ctrl+Alt+Shift+Arrows moves it from the keyboard)' }, ctx.icon('grip'));
      g.addEventListener('dragstart', (e) => {
        dragging = key();
        e.dataTransfer?.setData(TILE, dragging);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        const tile = g.closest<HTMLElement>('.tile');
        if (tile) {
          e.dataTransfer?.setDragImage(tile, 24, 16);
          setTimeout(() => tile.classList.add('dragging'));
        }
      });
      g.addEventListener('dragend', () => {
        dragging = undefined;
        clear();
      });
      return g;
    },

    /** A grip on a message; its text goes wherever it is dropped. */
    messageGrip(text: () => string, from?: () => string): HTMLElement {
      const g = h('span', { class: 'msg-grip', draggable: 'true', title: 'Drag onto another tile to quote it there', 'aria-hidden': 'true' }, ctx.icon('grip'));
      g.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData(MSG, text());
        if (from) e.dataTransfer?.setData(FROM, from());
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
      });
      g.addEventListener('dragend', clear);
      return g;
    },

    /** Makes a tile a drop target for both kinds of drag. */
    attach(el: HTMLElement) {
      el.addEventListener('dragover', (e) => {
        const types = e.dataTransfer?.types ?? [];
        if (types.includes(MSG) || types.includes(SHELF)) {
          e.preventDefault();
          el.classList.add('quote-target');
        } else if (types.includes(TILE) && dragging && dragging !== el.dataset.key) {
          e.preventDefault();
          const r = el.getBoundingClientRect();
          const after = ctx.columns() > 1 ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
          el.classList.toggle('drop-after', after);
          el.classList.toggle('drop-before', !after);
        }
      });
      el.addEventListener('dragleave', (e) => {
        if (!el.contains(e.relatedTarget as Node | null)) el.classList.remove('drop-before', 'drop-after', 'quote-target');
      });
      el.addEventListener('drop', (e) => {
        const types = e.dataTransfer?.types ?? [];
        if (types.includes(SHELF)) {
          e.preventDefault();
          ctx.shelfDrop(el.dataset.key!, e.dataTransfer!.getData(SHELF));
        } else if (types.includes(MSG)) {
          e.preventDefault();
          ctx.quote(el.dataset.key!, e.dataTransfer!.getData(MSG));
        } else if (types.includes(TILE) && dragging) {
          e.preventDefault();
          place(dragging, el.dataset.key!, el.classList.contains('drop-after'));
        }
        clear();
      });
    },

    /** Keyboard version of the drag: move a tile one place, or one row. */
    shift(key: string, delta: number) {
      const els = tileEls();
      const i = els.findIndex((t) => t.dataset.key === key);
      const j = Math.max(0, Math.min(els.length - 1, i + delta));
      if (i < 0 || i === j) return;
      place(key, els[j].dataset.key!, j > i);
    },
  };
}
