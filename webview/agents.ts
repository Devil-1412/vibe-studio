// The Agent map, modelled on the Claude Code panel's: a tree of every sub-agent a chat started, rows that
// open a detail card (status, spawner, activity, result, prompt, tool calls), and a transcript view.
import type { AgentId, AgentMap, AgentNode, AgentStatus, ChatItem, FromWebview, ToWebview } from '../src/types';

type Child = Node | string | null | undefined | false;
type H = (tag: string, attrs?: Record<string, any>, ...children: Child[]) => HTMLElement;

export interface AgentCtx {
  h: H;
  icon(name: string): HTMLElement;
  post(m: FromWebview): void;
  renderItem(item: ChatItem, prev: HTMLElement | undefined, key: string): HTMLElement;
  modelLabel(agent: AgentId, id: string): string;
  tokens(n: number): string;
}

type Dot = 'running' | 'idle' | 'failed';
type View = { kind: 'main' } | { kind: 'agent'; id: string; transcript: boolean };

const LABEL: Record<AgentStatus, string> = { working: 'Working', finished: 'Finished', failed: 'Failed', stopped: 'Stopped' };
const dotOf = (s: AgentStatus): Dot => (s === 'working' ? 'running' : s === 'finished' ? 'idle' : 'failed');

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const joinMeta = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ');

interface TreeNode {
  agent: AgentNode;
  children: TreeNode[];
}

/** Working agents first (oldest first), then failed, then the rest newest-finished first. */
function order(a: AgentNode, b: AgentNode): number {
  const rank = (x: AgentNode) => (x.status === 'working' ? 0 : x.status === 'failed' ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  const sa = a.startedAt ?? 0;
  const sb = b.startedAt ?? 0;
  if (rank(a) === 0) return sa - sb;
  if (a.endedAt === undefined || b.endedAt === undefined) {
    if (a.endedAt !== b.endedAt) return a.endedAt === undefined ? 1 : -1;
    return sb - sa;
  }
  return b.endedAt - a.endedAt || sb - sa;
}

function buildTree(agents: AgentNode[]): TreeNode[] {
  const nodes = [...agents].sort(order).map((agent) => ({ agent, children: [] as TreeNode[] }));
  const byId = new Map(nodes.map((n) => [n.agent.id, n]));
  const within = (root: TreeNode, target: TreeNode): boolean => root.children.some((c) => c === target || within(c, target));
  const roots: TreeNode[] = [];
  for (const n of nodes) {
    const parent = n.agent.parentId ? byId.get(n.agent.parentId) : undefined;
    if (parent && parent !== n && !within(n, parent)) parent.children.push(n);
    else roots.push(n);
  }
  return roots;
}

export function createAgentMap(ctx: AgentCtx) {
  const { h, icon, post } = ctx;
  const root = h('div', { class: 'am-root', hidden: true });

  let key = '';
  let agent: AgentId = 'claude';
  let data: AgentMap | undefined;
  let sig = '';
  let detail: View | undefined;
  let log: Extract<ToWebview, { type: 'agentLog' }> | undefined;
  let opener: Element | null = null;
  let poll = 0;
  let tick = 0;
  const promptOpen = new Map<string, boolean>();
  const toolsOpen = new Map<string, boolean>();
  const stopping = new Set<string>();
  const stopFailed = new Set<string>();

  const node = (id: string) => data?.agents.find((a) => a.id === id);
  const dot = (s: Dot) => h('span', { class: `am-dot am-dot-${s}`, 'data-status-dot': s });
  const modelName = (id?: string) => (id ? (/^[a-z]+$/.test(id) ? id[0].toUpperCase() + id.slice(1) : ctx.modelLabel(agent, id)) : undefined);

  // ---- open / close ----------------------------------------------------------------------------

  function open(k: string, a: AgentId, id?: string) {
    if (!root.hidden && k === key) {
      // already open (e.g. a nested agent clicked inside a transcript): just switch the card
      detail = id ? { kind: 'agent', id, transcript: false } : detail;
      log = undefined;
      render();
      return;
    }
    opener = document.activeElement;
    key = k;
    agent = a;
    data = undefined;
    sig = '';
    log = undefined;
    stopping.clear();
    stopFailed.clear();
    detail = id ? { kind: 'agent', id, transcript: false } : undefined;
    root.hidden = false;
    post({ type: 'agentMap', key });
    clearInterval(poll);
    clearInterval(tick);
    poll = window.setInterval(refresh, 2500);
    tick = window.setInterval(tickLive, 1000);
    render();
  }

  function close() {
    root.hidden = true;
    root.replaceChildren();
    clearInterval(poll);
    clearInterval(tick);
    (opener as HTMLElement | null)?.focus?.({ preventScroll: true });
  }

  /** Esc and the back button: transcript → card → map → closed. */
  function back() {
    if (detail?.kind === 'agent' && detail.transcript) detail = { ...detail, transcript: false };
    else if (detail) detail = undefined;
    else return close();
    log = undefined;
    render();
  }

  function refresh() {
    post({ type: 'agentMap', key });
    if (detail?.kind === 'agent' && detail.transcript) {
      const a = node(detail.id);
      if (a?.agentId) post({ type: 'agentLog', key, agentId: a.agentId });
    }
  }

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || root.hidden) return;
      e.preventDefault();
      e.stopPropagation();
      back();
    },
    true,
  );

  // ---- messages from the extension -------------------------------------------------------------

  function update(m: Extract<ToWebview, { type: 'agentMap' }>) {
    if (root.hidden || m.key !== key) return;
    data = m.map;
    let changed = false;
    for (const id of [...stopping]) {
      const a = data.agents.find((x) => x.agentId === id);
      if (!a || a.status !== 'working') {
        stopping.delete(id);
        changed = true;
      }
    }
    const next = JSON.stringify({ ...m.map, now: 0 });
    if (next === sig && !changed) return;
    sig = next;
    render();
  }

  function setLog(m: Extract<ToWebview, { type: 'agentLog' }>) {
    if (root.hidden || m.key !== key || detail?.kind !== 'agent' || !detail.transcript) return;
    if (node(detail.id)?.agentId !== m.agentId) return;
    log = m;
    render();
  }

  function stopped(m: Extract<ToWebview, { type: 'agentStop' }>) {
    if (root.hidden || m.key !== key || m.ok) return;
    stopping.delete(m.agentId);
    stopFailed.add(m.agentId);
    render();
  }

  // ---- rendering -------------------------------------------------------------------------------

  /** Keeps a working agent's run time ticking without rebuilding anything. */
  function tickLive() {
    for (const el of root.querySelectorAll<HTMLElement>('[data-live-start]')) {
      el.textContent = joinMeta(fmt(Date.now() - Number(el.dataset.liveStart)), el.dataset.tail);
    }
  }

  function dialog(o: { title: Node; width?: number; inside?: boolean; closeButton?: boolean; back?: boolean; onClose(): void; children: Child[] }) {
    const box = h(
      'div',
      { class: `am-dialog${o.inside ? ' am-inside' : ''}`, role: 'dialog', 'aria-modal': 'true', tabindex: '-1', style: o.width ? `--am-w:${o.width}px` : null },
      h(
        'div',
        { class: 'am-header' },
        o.back ? h('button', { type: 'button', class: 'icon-btn', title: 'Back', 'aria-label': 'Back', onclick: o.onClose }, icon('back')) : null,
        h('h3', { class: 'am-title' }, o.title),
        o.closeButton ? h('button', { type: 'button', class: 'icon-btn', title: 'Close', 'aria-label': 'Close', onclick: o.onClose }, icon('close')) : null,
      ),
      h('div', { class: 'am-content' }, ...o.children),
    );
    return h('div', { class: 'am-overlay', onclick: (e: MouseEvent) => e.target === e.currentTarget && o.onClose() }, box);
  }

  /** "duration · N tokens", live while the agent works. */
  function usage(a: AgentNode): HTMLElement {
    const tail = a.tokens && a.tokens > 0 ? `${ctx.tokens(a.tokens)} tokens` : undefined;
    const span = h('span', {});
    if (a.status === 'working' && a.startedAt) {
      span.dataset.liveStart = String(a.startedAt);
      if (tail) span.dataset.tail = tail;
      span.textContent = joinMeta(fmt(Date.now() - a.startedAt), tail);
    } else {
      const ms = a.durationMs ?? (a.startedAt && a.endedAt ? a.endedAt - a.startedAt : undefined);
      span.textContent = joinMeta(ms ? fmt(ms) : undefined, tail);
    }
    return span;
  }

  const select = (v: View) => {
    detail = v;
    log = undefined;
    render();
  };

  function agentRow(a: AgentNode) {
    return h(
      'button',
      { type: 'button', class: 'am-row', title: a.description, 'data-agent-status': a.status, onclick: () => select({ kind: 'agent', id: a.id, transcript: false }) },
      h('span', { class: 'am-row-title' }, dot(dotOf(a.status)), h('span', { text: a.description })),
      h('span', { class: 'am-row-meta' }, usage(a)),
    );
  }

  const treeNode = (n: TreeNode): HTMLElement =>
    h('div', { class: 'am-child' }, h('div', { class: 'am-node' }, agentRow(n.agent), n.children.length ? h('div', { class: 'am-children' }, ...n.children.map(treeNode)) : null));

  function mapLayer() {
    if (!data) return dialog({ title: document.createTextNode('Agent map'), inside: true, closeButton: true, onClose: close, children: [h('div', { class: 'am-subtitle', text: 'Reading agents…' })] });
    const n = data.agents.length;
    const m = data.main;
    const roots = buildTree(data.agents);
    const mainRow = h(
      'button',
      { type: 'button', class: 'am-row am-row-main', title: m.title, onclick: () => select({ kind: 'main' }) },
      h('span', { class: 'am-row-title' }, dot(m.busy ? 'running' : 'idle'), h('span', { text: m.title })),
      h('span', { class: 'am-row-meta', text: joinMeta(m.model ? ctx.modelLabel(agent, m.model) : undefined, m.context != null ? `${ctx.tokens(m.context)} tokens in context` : undefined) }),
    );
    return dialog({
      title: document.createTextNode('Agent map'),
      inside: true,
      closeButton: true,
      onClose: close,
      children: [
        h('div', { class: 'am-subtitle', text: `${n} agent${n === 1 ? '' : 's'} · click an agent for details` }),
        h('div', { class: 'am-tree' }, h('div', { class: 'am-node' }, mainRow, roots.length ? h('div', { class: 'am-children' }, ...roots.map(treeNode)) : null)),
      ],
    });
  }

  const meta = (...c: Child[]) => h('div', { class: 'am-meta' }, ...c);

  function mainDetail() {
    const m = data!.main;
    const counts = (['working', 'finished', 'failed', 'stopped'] as AgentStatus[])
      .map((s) => [s, data!.agents.filter((a) => a.status === s).length] as const)
      .filter(([, n]) => n > 0);
    const n = data!.agents.length;
    return dialog({
      title: h('span', { class: 'am-card-title' }, dot(m.busy ? 'running' : 'idle'), h('span', { text: m.title })),
      width: 420,
      back: true,
      onClose: back,
      children: [
        meta(joinMeta(m.busy ? 'Working' : 'Idle', m.model ? ctx.modelLabel(agent, m.model) : undefined, m.context != null ? `${ctx.tokens(m.context)} tokens in context` : undefined)),
        h('div', { class: 'am-counts', text: `${n} agent${n === 1 ? '' : 's'}` }),
        ...counts.map(([s, c]) => meta(`${c} ${LABEL[s].toLowerCase()}`)),
      ],
    });
  }

  function section(id: string, label: string, store: Map<string, boolean>, fallback: boolean, body: () => Child): HTMLElement {
    const isOpen = store.get(id) ?? fallback;
    return h(
      'div',
      { class: 'am-section' },
      h(
        'button',
        {
          type: 'button',
          class: 'am-section-header',
          'aria-expanded': String(isOpen),
          onclick: () => {
            store.set(id, !isOpen);
            render();
          },
        },
        icon('chevron'),
        label,
      ),
      isOpen ? body() : null,
    );
  }

  function agentDetail(v: Extract<View, { kind: 'agent' }>) {
    const a = node(v.id);
    if (!a) return undefined;
    const parent = a.parentId ? node(a.parentId) : undefined;
    const model = modelName(a.model) ?? (data!.main.model ? ctx.modelLabel(agent, data!.main.model) : undefined);
    const header = [
      meta(joinMeta(LABEL[a.status], a.agentType, model, a.background === undefined ? undefined : a.background ? 'background' : 'foreground')),
      meta(`Spawned by ${parent ? parent.description : 'the main agent'}`),
      meta(usage(a)),
    ];
    const title = h('span', { class: 'am-card-title' }, dot(dotOf(a.status)), h('span', { text: a.description }));

    if (v.transcript) {
      const items = log?.items ?? [];
      return dialog({
        title: h('span', { class: 'am-transcript-header' }, title, ...header),
        width: 1000,
        inside: true,
        back: true,
        onClose: back,
        children: [
          h(
            'div',
            { class: 'am-transcript', 'data-transcript': '' },
            !log ? h('div', { class: 'placeholder', text: 'Loading transcript…' }) : null,
            log?.missing ? h('div', { class: 'placeholder', text: 'Its transcript is not on this machine.' }) : null,
            log?.hidden ? h('div', { class: 'note', text: `${log.hidden} earlier steps not shown` }) : null,
            ...items.map((it) => ctx.renderItem(it, undefined, key)),
          ),
        ],
      });
    }

    const working = a.status === 'working';
    const inFlight = a.tools.filter((t) => t.running).pop();
    const failure = a.status === 'failed' ? a.result : undefined;
    const result = a.status === 'finished' ? a.result : undefined;
    const id = a.agentId;
    const stopBusy = !!id && stopping.has(id);
    return dialog({
      title,
      width: 420,
      back: true,
      onClose: back,
      children: [
        ...header,
        working && (inFlight || a.activity)
          ? h('div', { class: `am-activity${inFlight ? ' am-tool' : ''}` }, inFlight ? h('span', { class: 'am-activity-label', text: 'Now' }) : null, inFlight ? `${inFlight.name} ${inFlight.summary}` : a.activity)
          : null,
        failure ? h('div', { class: 'am-failure', text: failure }) : null,
        result ? h('div', { class: 'am-result', text: result }) : null,
        a.prompt ? section(a.id, 'Prompt', promptOpen, working, () => h('pre', { class: 'am-prompt', text: a.prompt })) : null,
        section(a.id, `Tool calls (${a.tools.length})`, toolsOpen, true, () =>
          a.tools.length
            ? h(
                'ul',
                { class: 'am-tools' },
                ...a.tools.map((t) => h('li', { class: 'am-tool' }, t.running ? dot('running') : h('span', { class: 'am-tool-spacer' }), h('span', {}, h('b', { text: t.name }), ' ', t.summary))),
              )
            : null,
        ),
        h(
          'div',
          { class: 'am-actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'am-button',
              disabled: !id,
              title: id ? '' : 'This agent has no transcript yet',
              onclick: () => {
                detail = { ...v, transcript: true };
                log = undefined;
                if (id) post({ type: 'agentLog', key, agentId: id });
                render();
              },
            },
            'Open transcript',
          ),
          working && data!.canStop && id
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'am-button am-danger',
                  disabled: stopBusy,
                  onclick: () => {
                    stopping.add(id);
                    stopFailed.delete(id);
                    post({ type: 'stopAgent', key, agentId: id });
                    // no sign of it stopping after a while: say so, like the panel does
                    setTimeout(() => {
                      if (stopping.delete(id)) {
                        stopFailed.add(id);
                        render();
                      }
                    }, 10_000);
                    render();
                  },
                },
                stopBusy ? 'Stopping…' : 'Stop agent',
              )
            : null,
        ),
        id && stopFailed.has(id) ? h('div', { class: 'am-failure', text: 'The agent could not be stopped. It may have finished already.' }) : null,
      ],
    });
  }

  function render() {
    if (root.hidden) return;
    const old = [...root.querySelectorAll<HTMLElement>('.am-content')];
    const keep = old.map((c) => c.scrollTop);
    // a transcript that was scrolled to its end keeps following new steps
    const wasBottom = old.map((c) => c.scrollHeight - c.scrollTop - c.clientHeight < 40);

    const layers = [mapLayer()];
    if (detail && data) {
      const l = detail.kind === 'main' ? mainDetail() : agentDetail(detail);
      if (l) layers.push(l);
    }
    const grew = layers.length > old.length;
    root.replaceChildren(...layers);
    root.querySelectorAll<HTMLElement>('.am-content').forEach((c, i) => {
      const fresh = i >= old.length;
      c.scrollTop = c.querySelector('[data-transcript]') && (fresh || wasBottom[i]) ? c.scrollHeight : keep[i] ?? 0;
    });
    if (grew || !old.length) root.querySelector<HTMLElement>('.am-overlay:last-child .am-dialog')?.focus({ preventScroll: true });
    tickLive();
  }

  return { el: root, open, update, log: setLog, stopped, isOpen: () => !root.hidden };
}
