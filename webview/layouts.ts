// "Layouts" in the top bar: save the open chats and the grid under a name, and bring them back in one click.
import type { FromWebview, SavedLayout } from '../src/types';

type Child = Node | string | null | undefined | false;
type H = (tag: string, attrs?: Record<string, any>, ...children: Child[]) => HTMLElement;

export interface LayoutsCtx {
  h: H;
  icon(name: string): HTMLElement;
  post(m: FromWebview): void;
  /** Chats open right now, to enable Save. */
  count(): number;
}

export function createLayouts(ctx: LayoutsCtx) {
  const { h } = ctx;
  let list: SavedLayout[] = [];

  const button = h('button', { class: 'servers-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Saved layouts', onclick: () => toggle() }, ctx.icon('layouts'), h('span', { text: 'Layouts' }));
  const name = h('input', { class: 'ask-reason', placeholder: 'Name this arrangement', maxlength: '40', 'aria-label': 'Layout name', onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && save() }) as HTMLInputElement;
  const saveBtn = h('button', { class: 'ask-btn primary', type: 'button', onclick: () => save() }, 'Save') as HTMLButtonElement;
  const rows = h('div', { class: 'srv-list' });
  const pop = h(
    'div',
    { class: 'shop srv-pop', role: 'dialog', 'aria-label': 'Saved layouts', hidden: true },
    h('div', { class: 'srv-head' }, h('span', { text: 'Layouts' })),
    h('div', { class: 'srv-line' }, name, saveBtn),
    rows,
  );
  const el = h('span', { class: 'coins-wrap' }, button, pop);

  function save() {
    const n = name.value.trim();
    if (!n || !ctx.count()) return;
    ctx.post({ type: 'saveLayout', name: n });
    name.value = '';
    render();
  }

  function render() {
    saveBtn.disabled = !ctx.count();
    saveBtn.title = ctx.count() ? 'Save the open chats and grid' : 'Open a chat first';
    rows.replaceChildren(
      ...(list.length
        ? list.map((l) =>
            h(
              'div',
              { class: 'srv-row' },
              h('div', { class: 'srv-title' }, h('span', { class: 'srv-name', text: l.name }), h('span', { class: 'srv-branch', text: `${l.open.length} chat${l.open.length === 1 ? '' : 's'} · ${l.layout.columns}×${l.layout.rows}` })),
              h(
                'div',
                { class: 'srv-line' },
                h('span', { class: 'spacer' }),
                h('button', { class: 'ask-btn', type: 'button', onclick: () => (toggle(false), ctx.post({ type: 'applyLayout', name: l.name })) }, 'Restore'),
                h('button', { class: 'ask-btn danger', type: 'button', onclick: () => ctx.post({ type: 'deleteLayout', name: l.name }) }, 'Delete'),
              ),
            ),
          )
        : [h('div', { class: 'srv-empty', text: 'Nothing saved yet. Arrange your tiles, name it, and save.' })]),
    );
  }

  function toggle(open = pop.hidden) {
    pop.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      render();
      name.focus();
    }
  }
  document.addEventListener('mousedown', (e) => {
    if (!pop.hidden && !el.contains(e.target as Node)) toggle(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) {
      toggle(false);
      button.focus();
    }
  });

  return {
    el,
    set(next: SavedLayout[]) {
      list = next;
      render();
    },
  };
}
