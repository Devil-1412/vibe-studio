// "Servers" in the top bar: which project or worktree runs which dev server, with Open, Stop and Run.
import type { FromWebview, ProjectServers } from '../src/types';

type Child = Node | string | null | undefined | false;
type H = (tag: string, attrs?: Record<string, any>, ...children: Child[]) => HTMLElement;

export interface ServersCtx {
  h: H;
  icon(name: string): HTMLElement;
  post(m: FromWebview): void;
}

const FAST = 5000;
const SLOW = 20000;

export function createServers(ctx: ServersCtx) {
  const { h } = ctx;
  let projects: ProjectServers[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const count = h('span', { class: 'srv-n' });
  const button = h('button', { class: 'servers-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Dev servers by project', onclick: () => toggle() }, ctx.icon('server'), h('span', { text: 'Servers' }), count);
  const list = h('div', { class: 'srv-list' });
  const pop = h(
    'div',
    { class: 'shop srv-pop', role: 'dialog', 'aria-label': 'Dev servers', hidden: true },
    h('div', { class: 'srv-head' }, h('span', { text: 'Servers' }), h('button', { class: 'icon-btn', title: 'Refresh', 'aria-label': 'Refresh', onclick: () => ctx.post({ type: 'servers' }) }, ctx.icon('refresh'))),
    list,
  );
  const el = h('span', { class: 'coins-wrap' }, button, pop);

  const button1 = (label: string, onclick: () => void, kind = '') => h('button', { type: 'button', class: `ask-btn ${kind}`, onclick }, label);

  function row(p: ProjectServers) {
    const title = h('div', { class: 'srv-title' }, h('span', { class: 'srv-name', text: p.name }), p.branch && h('span', { class: 'srv-branch', text: p.worktree ? `worktree · ${p.branch}` : p.branch }));
    const lines = p.servers.map((s) =>
      h(
        'div',
        { class: 'srv-line' },
        h('span', { class: 'srv-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'srv-port', text: `:${s.port}` }),
        h('span', { class: 'srv-cmd', text: s.cmd, title: `pid ${s.pid}` }),
        h('span', { class: 'spacer' }),
        button1('Open', () => ctx.post({ type: 'openServer', port: s.port })),
        button1('Stop', () => ctx.post({ type: 'stopServer', pid: s.pid }), 'danger'),
      ),
    );
    const run = !p.servers.length && p.scripts.length
      ? h('div', { class: 'srv-line' }, h('span', { class: 'srv-cmd', text: 'No server running' }), h('span', { class: 'spacer' }), ...p.scripts.slice(0, 3).map((sc) => button1(`Run ${sc}`, () => ctx.post({ type: 'runServer', root: p.root, script: sc }), 'primary')))
      : null;
    return h('div', { class: 'srv-row', title: p.root }, title, ...lines, run);
  }

  function render() {
    const running = projects.reduce((n, p) => n + p.servers.length, 0);
    count.textContent = running ? String(running) : '';
    button.classList.toggle('on', running > 0);
    button.title = running ? `${running} dev server${running === 1 ? '' : 's'} running` : 'Dev servers by project';
    // running projects first, then the rest by name
    const sorted = [...projects].sort((a, b) => b.servers.length - a.servers.length || a.name.localeCompare(b.name));
    list.replaceChildren(...(sorted.length ? sorted.map(row) : [h('div', { class: 'srv-empty', text: 'No projects found yet.' })]));
  }

  function poll() {
    clearTimeout(timer);
    ctx.post({ type: 'servers' });
    timer = setTimeout(poll, pop.hidden ? SLOW : FAST);
  }

  function toggle(open = pop.hidden) {
    pop.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) poll();
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
    start: poll,
    set(next: ProjectServers[]) {
      projects = next;
      render();
    },
  };
}
