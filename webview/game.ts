// Keystroke Coins in the top bar: a counter, and a shop popover. Rules live in src/game.ts.
import { COMBO_GAP_MS, UPGRADES, bonus, buy, buyItem, canBuy, compact, cost, earn, loadGame, newGame, offlineGain, owns, perChar, rate, tick, type GameState } from '../src/game';

type Child = Node | string | null | undefined | false;
type H = (tag: string, attrs?: Record<string, any>, ...children: Child[]) => HTMLElement;

export interface GameCtx {
  h: H;
  icon(name: string): HTMLElement;
  /** How many tiles have a turn running. */
  running(): number;
  save(state: GameState): void;
}

export function createGame(ctx: GameCtx) {
  const { h } = ctx;
  let state = newGame();
  let on = true;
  let floaters = false;
  let combo = 0;
  let lastKey = 0;
  let dirty = false;
  let lastTick = Date.now();

  const count = h('span', { class: 'coins-n', text: '0' });
  const button = h('button', { class: 'coins', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => toggle() }, ctx.icon('coin'), count);
  const head = h('div', { class: 'shop-head' });
  const rows = new Map<string, { row: HTMLElement; level: HTMLElement; buy: HTMLButtonElement }>();
  const list = h('div', { class: 'shop-list' });
  for (const u of UPGRADES) {
    const level = h('span', { class: 'shop-level' });
    const b = h('button', { class: 'ask-btn primary', type: 'button', onclick: () => purchase(u.id) }) as HTMLButtonElement;
    const row = h('div', { class: 'shop-row' }, h('div', { class: 'shop-info' }, h('div', {}, h('span', { class: 'shop-name', text: u.name }), level), h('div', { class: 'shop-desc', text: u.desc })), b);
    rows.set(u.id, { row, level, buy: b });
    list.append(row);
  }
  const shop = h('div', { class: 'shop', role: 'dialog', 'aria-label': 'Keystroke Coins shop', hidden: true }, head, list);
  const el = h('span', { class: 'coins-wrap' }, button, shop);

  const away = () => !document.hasFocus();

  function render() {
    count.textContent = compact(state.coins);
    button.title = `${Math.floor(state.coins).toLocaleString()} coins · click for the shop`;
    if (shop.hidden) return;
    const per = rate(state, ctx.running(), away());
    head.textContent = `${Math.floor(state.coins).toLocaleString()} coins · ${per ? `+${compact(per)}/s` : 'idle'} · ${compact(state.lifetime)} earned in all`;
    for (const u of UPGRADES) {
      const r = rows.get(u.id)!;
      const owned = state.owned[u.id] ?? 0;
      const sold = !!u.once && owned > 0;
      r.level.textContent = u.once ? (sold ? ' · owned' : '') : owned ? ` · level ${owned}` : '';
      r.buy.textContent = sold ? 'Owned' : `Buy · ${compact(cost(u.id, owned))}`;
      r.buy.disabled = !canBuy(state, u.id);
    }
  }

  function purchase(id: string) {
    if (!buy(state, id)) return;
    dirty = true;
    render();
  }

  function toggle(open = shop.hidden) {
    shop.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    render();
  }

  function apply() {
    el.hidden = !on;
    if (!on) toggle(false);
  }

  document.addEventListener('mousedown', (e) => {
    if (!shop.hidden && !el.contains(e.target as Node)) toggle(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !shop.hidden) {
      toggle(false);
      button.focus();
    }
  });

  setInterval(() => {
    const now = Date.now();
    const dt = Math.min((now - lastTick) / 1000, 60);
    lastTick = now;
    if (on && tick(state, dt, ctx.running(), away())) dirty = true;
    state.at = now;
    if (on) render();
  }, 1000);
  setInterval(() => {
    if (!dirty) return;
    dirty = false;
    ctx.save(state);
  }, 2000);

  function float(input: HTMLElement, n: number) {
    const r = input.getBoundingClientRect();
    const f = h('span', { class: 'coin-float', text: `+${compact(n)}`, style: `left:${Math.min(r.right - 28, r.left + r.width - 28)}px;top:${r.top - 4}px` });
    f.addEventListener('animationend', () => f.remove());
    document.body.append(f);
  }

  return {
    el,
    /** Wardrobe: what is unlocked, what you have, and buying an item. */
    owns: (id: string) => owns(state, id),
    coins: () => Math.floor(state.coins),
    buyItem(id: string): boolean {
      if (!buyItem(state, id)) return false;
      dirty = true;
      render();
      return true;
    },
    /** Settings and saved state arrive together on init. Away time pays out once. */
    init(saved: unknown, enabled: boolean, showFloaters: boolean) {
      state = loadGame(saved);
      on = enabled;
      floaters = showFloaters;
      const gain = offlineGain(state, Date.now());
      if (gain) {
        earn(state, gain);
        dirty = true;
      }
      state.at = lastTick = Date.now();
      apply();
      render();
    },
    config(enabled: boolean, showFloaters: boolean) {
      on = enabled;
      floaters = showFloaters;
      apply();
      render();
    },
    /** One typed character earns; pasting, dropping and deleting do not. */
    typed(e: Event, input: HTMLElement) {
      const ie = e as InputEvent;
      if (!on || ie.inputType !== 'insertText' || !ie.data) return;
      const now = Date.now();
      combo = now - lastKey > COMBO_GAP_MS ? 1 : combo + 1;
      lastKey = now;
      const n = perChar(state, combo) * ie.data.length;
      earn(state, n);
      dirty = true;
      count.textContent = compact(state.coins);
      if (floaters) float(input, n);
    },
    /** Lucky bone: a rare bonus for sending a message. */
    sent() {
      if (!on) return;
      const n = bonus(state, Math.random());
      if (!n) return;
      earn(state, n);
      dirty = true;
      render();
    },
  };
}
