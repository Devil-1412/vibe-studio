import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { createAgentMap, type AgentCtx } from './agents';
import { askCard, type AskCtx } from './asks';
import { createGame } from './game';
import { createServers } from './servers';
import { createArrange } from './arrange';
import { quoteText } from './quote';
import { excerpt, markSent, setComment, unsent, withComments, type PointComment } from './comments';
import { SUMMARY_PROMPT, continuationText, newestReply, offerHandoff } from './handoff';
import { createLayouts } from './layouts';
import { createShelf } from './shelf';
import { createSettings } from './settings';
import { pace, sayings, type Pace } from './commentary';
import { SHORTCUTS, actionOf, neighbour } from './shortcuts';
import { formatReset, timeLeft } from '../src/limits';
import { attachmentType, mentionAt, mentionText, screenAttachments, transcriptText } from '../src/mentions';
import { COAT_SWATCHES, createPet, type Mood, type Pet } from './fun';
import { WARDROBE, cleanCat } from '../src/game';
import type {
  AgentId,
  AgentInfo,
  CatPrefs,
  ShelfItem,
  AgentItem,
  AgentStatus,
  AccountUsage,
  Attachment,
  FileEntry,
  PendingAsk,
  ChatItem,
  FileStat,
  FromWebview,
  Layout,
  PlanItem,
  PromptChip,
  QuestionEntry,
  QuestionItem,
  Recap,
  SessionSummary,
  SkillInfo,
  ToWebview,
  Usage,
} from '../src/types';

declare function acquireVsCodeApi(): {
  postMessage(m: FromWebview): void;
  getState(): any;
  setState(s: any): void;
};

const vscode = acquireVsCodeApi();
const post = (m: FromWebview) => vscode.postMessage(m);

marked.setOptions({ gfm: true, breaks: false });
const md = (text: string) => DOMPurify.sanitize(marked.parse(text, { async: false }) as string);

// ---- tiny DOM helper ---------------------------------------------------------------------------

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: Child[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c != null && c !== false) el.append(c);
  return el;
}

const ICONS: Record<string, string> = {
  plus: '<path d="M8 3v10M3 8h10"/>',
  close: '<path d="m4 4 8 8m0-8-8 8"/>',
  expand: '<path d="M9.5 2.5h4v4m0-4L9 7M6.5 13.5h-4v-4m0 4L7 9"/>',
  collapse: '<path d="M13.5 6.5h-4v-4m4 4L9 2M2.5 9.5h4v4m-4-4L7 14"/>',
  sidebar: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M6.5 3v10"/>',
  send: '<path d="M8 13V3m0 0L3.5 7.5M8 3l4.5 4.5"/>',
  stop: '<rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" stroke="none"/>',
  search: '<circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3.5 3.5"/>',
  globe: '<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c1.7 1.5 2.3 3.3 2.3 5.5S9.7 12 8 13.5C6.3 12 5.7 10.2 5.7 8S6.3 4 8 2.5Z"/>',
  edit: '<path d="m9.75 3.25 3 3L6 13H3v-3l6.75-6.75Z"/><path d="m8.5 4.5 3 3M3 13l3-.75"/>',
  down: '<path d="M8 3v10m0 0 4.5-4.5M8 13 3.5 8.5"/>',
  spark: '<path d="M7.8 2.1c.35 3.3 1.55 4.5 4.85 4.85-3.3.35-4.5 1.55-4.85 4.85-.35-3.3-1.55-4.5-4.85-4.85 3.3-.35 4.5-1.55 4.85-4.85Z"/><path d="M12.7 11.2c.12 1.25.55 1.68 1.8 1.8-1.25.12-1.68.55-1.8 1.8-.12-1.25-.55-1.68-1.8-1.8 1.25-.12 1.68-.55 1.8-1.8Z"/>',
  file: '<path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.5v3h3M6.5 8h3M6.5 10.5h3"/>',
  bolt: '<path d="m9.6 1.7-5.5 6.6h3.75l-1.2 6 5.3-7.1H8.4Z"/><path d="m10.8 2.9-1.3 2" opacity=".55"/>',
  agent: '<path d="M8 2v2.2"/><circle cx="8" cy="1.8" r=".7" fill="currentColor" stroke="none"/><path d="M3.2 7H2.3v3h.9m9.6-3h.9v3h-.9"/><rect x="3.2" y="4.2" width="9.6" height="9" rx="3"/><circle cx="6.2" cy="8.1" r=".75" fill="currentColor" stroke="none"/><circle cx="9.8" cy="8.1" r=".75" fill="currentColor" stroke="none"/><path d="M6.2 10.5q1.8 1.5 3.6 0"/>',
  coin: '<circle cx="8" cy="8" r="5.5"/><path d="M9.75 5.75H7.4a1.4 1.4 0 0 0 0 2.8h1.2a1.4 1.4 0 0 1 0 2.8H6.25M8 4.5v1.25m0 5.6v1.15"/>',
  comment: '<path d="M2.5 3.5h11v7H7.5l-3 2.5v-2.5h-2z"/>',
  wand: '<path d="M3 13l7-7M9.5 3.5l3 3M12 1.5v2M11 2.5h2M5 2.5v1.5M4.2 3.2h1.6M13 9v2M12 10h2"/>',
  shelf: '<path d="M2.5 9.5l2-5.5h7l2 5.5v3.5h-11zM2.5 9.5h3.2l.8 1.5h3l.8-1.5h3.2"/>',
  info: '<circle cx="8" cy="8" r="5.5"/><path d="M8 7.4v3.3M8 5.3h.01"/>',
  gear: '<path d="M12.73 6.73 L14.52 6.97 L14.52 9.03 L12.73 9.27 L12.24 10.45 L13.34 11.88 L11.88 13.34 L10.45 12.24 L9.27 12.73 L9.03 14.52 L6.97 14.52 L6.73 12.73 L5.55 12.24 L4.12 13.34 L2.66 11.88 L3.76 10.45 L3.27 9.27 L1.48 9.03 L1.48 6.97 L3.27 6.73 L3.76 5.55 L2.66 4.12 L4.12 2.66 L5.55 3.76 L6.73 3.27 L6.97 1.48 L9.03 1.48 L9.27 3.27 L10.45 3.76 L11.88 2.66 L13.34 4.12 L12.24 5.55Z"/><circle cx="8" cy="8" r="2"/>',
  grip: '<path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" stroke-width="2"/>',
  layouts: '<rect x="2.5" y="2.5" width="5" height="5" rx="1"/><rect x="8.5" y="2.5" width="5" height="5" rx="1"/><rect x="2.5" y="8.5" width="11" height="5" rx="1"/>',
  server: '<rect x="2.5" y="3" width="11" height="4" rx="1.25"/><rect x="2.5" y="9" width="11" height="4" rx="1.25"/><path d="M5 5h.01M5 11h.01M8 5h3M8 11h3"/>',
  refresh: '<path d="M13 3.5v3h-3M3 12.5v-3h3"/><path d="M12.6 6.5A5 5 0 0 0 4 5M3.4 9.5A5 5 0 0 0 12 11"/>',
  shield: '<path d="M8 2.25 13 4v3.75c0 3-1.9 5.05-5 6-3.1-.95-5-3-5-6V4z"/><path d="m5.75 8 1.5 1.5 3-3"/>',
  clip: '<path d="m6.5 10.5 4.75-4.75a1.75 1.75 0 0 0-2.5-2.5l-5 5a2.65 2.65 0 0 0 3.75 3.75l5-5"/>',
  folder: '<path d="M2.5 4h3.25l1.5 1.5h6.25v7H2.5z"/>',
  back: '<path d="M10.5 3.5 6 8l4.5 4.5"/>',
  chevron: '<path d="M5.75 3.5 10.25 8l-4.5 4.5"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M5.5 10.5h-2a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>',
  check: '<path d="m3.5 8.5 3 3 6-7"/>',
  eye: '<path d="M1.75 8s2.25-4.25 6.25-4.25S14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8Z"/><circle cx="8" cy="8" r="2"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 4.75V8l2.5 1.5"/>',
  plan: '<path d="M6 4h7M6 8h7M6 12h7M2.75 4h.01M2.75 8h.01M2.75 12h.01"/>',
  question: '<circle cx="8" cy="8" r="5.5"/><path d="M6.35 6.25a1.75 1.75 0 1 1 2.35 1.65c-.5.25-.7.65-.7 1.25M8 11.5h.01"/>',
};
function icon(name: string) {
  return h('span', {
    class: 'icon',
    'aria-hidden': 'true',
    html: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`,
  });
}

// ---- state -------------------------------------------------------------------------------------

/** A transcript item and its row. `merged` marks the first of a run of Reads that shows as one row. */
interface Entry {
  item: ChatItem;
  el: HTMLElement;
  merged?: string;
  /** Why the row is hidden, if it is: one reason at a time, set only by layoutRows. */
  hide?: 'merged' | 'folded';
}

/** Focus view: the row standing in for a run of tool calls and thinking, and the Collapse row ending it once opened. */
interface Fold {
  head: HTMLButtonElement;
  end: HTMLButtonElement;
}

interface Tile {
  key: string;
  agent: AgentId;
  draft?: { cwd: string };
  el: HTMLElement;
  head: HTMLElement;
  title: HTMLElement;
  sub: HTMLElement;
  dot: HTMLElement;
  msgs: HTMLElement;
  list: HTMLElement;
  earlier: HTMLButtonElement;
  working: HTMLElement;
  error: HTMLElement;
  input: HTMLTextAreaElement;
  sendBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
  mode: HTMLSelectElement;
  model: HTMLSelectElement;
  /** Model the transcript says the session last used. */
  currentModel?: string;
  chromeBtn: HTMLButtonElement;
  /** Send with Claude in Chrome enabled. */
  chrome: boolean;
  effort: HTMLSelectElement;
  /** Effort the transcript says the session last used. */
  currentEffort?: string;
  /** Pinned bar with the last message the user sent. */
  lastBar: HTMLElement;
  lastText: HTMLButtonElement;
  lastMore: HTMLButtonElement;
  lastUser?: { text: string; el: HTMLElement };
  jump: HTMLButtonElement;
  frame?: number;
  resize: ResizeObserver;
  hint: HTMLElement;
  items: Map<string, Entry>;
  /** Focus view: each run of tool calls and thinking folds into one row. */
  focusView: boolean;
  focusBtn?: HTMLButtonElement;
  /** Fold rows by run (the first item's id), and the runs the user opened. */
  folds: Map<string, Fold>;
  foldOpen: Set<string>;
  /** Local day (toDateString) of the newest item, for date dividers. */
  lastDay?: string;
  pending?: { el: HTMLElement; text: string };
  running: boolean;
  loaded: boolean;
  /** New agent output arrived that the user hasn't looked at. */
  unread: boolean;
  unreadDot: HTMLElement;
  /** Messages typed while the agent was busy; sent one per finished turn. */
  /** Messages typed while the agent was busy, with their attachments. */
  queue: { text: string; attachments: Attachment[] }[];
  /** Questions the CLI is waiting on (tool permissions, questions, plans), shown as cards above the box. */
  asks: PendingAsk[];
  asksEl: HTMLElement;
  askCards: Map<string, HTMLElement>;
  needsEl: HTMLElement;
  /** The magic wand: the button, and the note with Undo while a rewrite is in the box. `asked` is the text that was sent to be rewritten. */
  wandBtn: HTMLButtonElement;
  wandNote: HTMLElement;
  wand?: { asked: string; original?: string; pending: boolean };
  /** Comments on points of the agent's replies, added to your next message. */
  comments: PointComment[];
  commentsEl: HTMLElement;
  /** "Continue in a new chat", offered when the context is nearly full; `handoff` is set while the summary is being written. */
  continueBtn: HTMLButtonElement;
  /** Context used (percent), for the Continue nudge. */
  ctxPct?: number;
  handoff?: { before?: string };
  /** Drag handle in the header, and the cat's speech bubble with what it last said. */
  grip: HTMLElement;
  bubble: HTMLElement;
  chat: Pace;
  /** Files attached to the message being written. */
  attachments: Attachment[];
  attachEl: HTMLElement;
  clipBtn: HTMLButtonElement;
  /** The @ picker (shares the skill menu's popover). */
  fileState?: { items: FileEntry[]; active: number; start: number; query: string; id: number; loading: boolean };
  fileTimer?: number;
  queuePaused: boolean;
  queueEl: HTMLElement;
  chipsEl: HTMLElement;
  /** One line under the header: edited files on the left, usage meter on the right. */
  filesEl: HTMLElement;
  filesList: HTMLElement;
  files: FileStat[];
  meter: HTMLElement;
  /** Claude's prompt-cache estimate (ms) and its pill beside the meter. */
  cache?: { at: number; until: number };
  cachePill: HTMLElement;
  /** Skills and commands the chat ran, shown at the start of the strip. */
  skillsUsed: string[];
  /** Sub-agents the chat started (all of them, not only the loaded window). */
  agents: { id: string; description: string; status: AgentStatus }[];
  /** Footer pill that opens the Agent map. */
  agentsPill: HTMLButtonElement;
  /** Autocomplete for /skill (Claude) or $skill (Codex) in the message box. */
  skillMenu: HTMLElement;
  skillState?: { items: SkillInfo[]; active: number; start: number; query: string };
  /** Companion sitting on the composer, acting out what the agent is doing. */
  pet: Pet;
  /** Newest item in the transcript, for the companion's mood. */
  lastItemId?: string;
  finishedAt: number;
}

let sessions: SessionSummary[] = [];
const byKey = new Map<string, SessionSummary>();
let agents: AgentInfo[] = [];
let folders: string[] = [];
let tileModes: Record<string, string> = {};
let tileModels: Record<string, string> = {};
let tileChrome: Record<string, boolean> = {};
let tileEfforts: Record<string, string> = {};
let tileFocus: Record<string, boolean> = {};
/** vibeStudio.focusView: what a tile with no choice of its own uses. */
let focusDefault = false;
/** The tile you touched last, for the Focus view shortcut when nothing inside a tile has focus. */
let activeTile: Tile | undefined;
let prompts: PromptChip[] = [];
/** Skill lists by `${agent}|${scope}`; scope is a chat key or a new chat's folder. */
const skillCache = new Map<string, SkillInfo[]>();
const skillWaiters = new Map<string, Set<Tile>>();
let layout: Layout = { columns: 2, rows: 2, sidebar: true };
const tiles = new Map<string, Tile>();
const saved = vscode.getState() ?? {};
const filter: { q: string; agent: 'all' | AgentId } = { q: saved.q ?? '', agent: saved.agent ?? 'all' };
let maximized: string | null = null;

const agentInfo = (id: AgentId) => agents.find((a) => a.id === id);
const agentLabel = (id: AgentId) => agentInfo(id)?.label ?? id;
const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

function ago(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function bucket(ms: number): string {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const t = day.getTime();
  if (ms >= t) return 'Today';
  if (ms >= t - 86400e3) return 'Yesterday';
  if (ms >= t - 6 * 86400e3) return 'This week';
  return 'Older';
}

// ---- shell -------------------------------------------------------------------------------------

const search = h('input', {
  class: 'search-input',
  type: 'search',
  placeholder: 'Search chats',
  'aria-label': 'Search chats',
  value: filter.q,
  oninput: (e: Event) => {
    filter.q = (e.target as HTMLInputElement).value;
    remember();
    renderList();
  },
});
const seg = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Filter by agent' });
const list = h('nav', { class: 'list', 'aria-label': 'Chat sessions' });
const side = h(
  'aside',
  { class: 'side' },
  h(
    'div',
    { class: 'side-top' },
    h('div', { class: 'brand', text: 'Vibe Studio' }),
    h('button', { class: 'btn primary', onclick: () => newDraft(), title: 'Start a new chat' }, icon('plus'), 'New chat'),
  ),
  h('label', { class: 'search' }, icon('search'), search),
  seg,
  list,
);

const grid = h('div', { class: 'grid' });
const arrange = createArrange({
  h: h as unknown as Parameters<typeof createArrange>[0]['h'],
  icon,
  grid,
  columns: () => layout.columns,
  post,
  quote: (key, text) => quoteInto(key, text),
  shelfDrop: (key, id) => {
    const item = shelf.get(id);
    const tile = tiles.get(key);
    if (item && tile) insertShelfItem(tile, item);
  },
});
const shelf = createShelf({
  h: h as unknown as Parameters<typeof createShelf>[0]['h'],
  icon,
  post,
  read: async (f) => {
    const type = attachmentType(f.name, f.type);
    return type ? { name: f.name || 'pasted file', type, size: f.size, data: type === 'text/plain' ? await f.text() : await toBase64(f) } : undefined;
  },
  insert: (item) => {
    const tile = (activeTile && tiles.get(activeTile.key) === activeTile ? activeTile : undefined) ?? screenTiles()[0];
    if (tile) insertShelfItem(tile, item);
  },
});
const settingsUi = createSettings({ h: h as unknown as Parameters<typeof createSettings>[0]['h'], icon, post, agents: () => agents, lowUsage: () => lowUsage });
const layoutsUi = createLayouts({ h: h as unknown as Parameters<typeof createLayouts>[0]['h'], icon, post, count: () => [...tiles.values()].filter((t) => !t.draft).length });
const empty = h(
  'div',
  { class: 'empty' },
  h('div', { class: 'empty-title', text: 'No chats open' }),
  h('div', { class: 'empty-body', text: 'Pick sessions from the list to watch them side by side, or start a new one.' }),
  h('button', { class: 'btn primary', onclick: () => newDraft() }, icon('plus'), 'New chat'),
);
const openCount = h('span', { class: 'bar-count' });
const colSeg = h('div', { class: 'seg small', role: 'group', 'aria-label': 'Columns' });
const rowSeg = h('div', { class: 'seg small', role: 'group', 'aria-label': 'Rows' });
const game = createGame({
  h: h as unknown as Parameters<typeof createGame>[0]['h'],
  icon,
  running: () => [...tiles.values()].filter((t) => t.running).length,
  save: (state) => post({ type: 'gameSave', state }),
});
const servers = createServers({ h: h as unknown as Parameters<typeof createServers>[0]['h'], icon, post });
const usageBody = h('div', { class: 'usage-body' });
const usagePop = h('div', { class: 'shop usage-pop', role: 'dialog', 'aria-label': 'Plan usage limits', hidden: true }, usageBody);
const usageBtn = h('button', { class: 'usage', hidden: true, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => toggleUsage() });
const usageWrap = h('span', { class: 'coins-wrap', hidden: true }, usageBtn, usagePop);

const bar = h(
  'div',
  { class: 'bar' },
  h('button', { class: 'icon-btn', title: 'Toggle session list', 'aria-label': 'Toggle session list', onclick: toggleSidebar }, icon('sidebar')),
  openCount,
  h('span', { class: 'spacer' }),
  servers.el,
  layoutsUi.el,
  shelf.button,
  game.el,
  usageWrap,
  h('button', { class: 'btn ghost', title: "Today's recap", onclick: () => showRecap() }, icon('spark'), 'Today'),
  h('span', { class: 'bar-label', text: 'Columns' }),
  colSeg,
  h('span', { class: 'bar-label', text: 'Rows' }),
  rowSeg,
  settingsUi.button,
);
const recapBody = h('div', { class: 'recap-body' });
const recapEl = h(
  'div',
  {
    class: 'recap-backdrop',
    hidden: true,
    onclick: (e: MouseEvent) => e.target === recapEl && hideRecap(),
  },
  h(
    'section',
    { class: 'recap-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': "Today's recap" },
    h(
      'header',
      { class: 'recap-head' },
      h('div', {}, h('div', { class: 'recap-title', text: 'Today' }), h('div', { class: 'recap-date', text: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) })),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => hideRecap() }, icon('close')),
    ),
    recapBody,
  ),
);
const agentMap = createAgentMap({ h: h as unknown as AgentCtx['h'], icon, post, renderItem, modelLabel, tokens });
const app = h('div', { class: 'app' }, side, h('main', { class: 'main' }, bar, grid, empty), recapEl, agentMap.el, shelf.drawer, settingsUi.panel);
document.getElementById('app')!.replaceWith(app);

/** Times and date dividers are always rendered; the setting only hides them, so it applies live. */
const setTimestamps = (show = true) => app.classList.toggle('no-times', !show);

// ---- companions --------------------------------------------------------------------------------

/** Coats the other tiles' cats wear, so each tile gets its own. */
const wornCoats = (except?: Tile) => [...tiles.values()].filter((t) => t !== except && t.pet).map((t) => t.pet.coat);

function moodOf(tile: Tile): Mood {
  if (!tile.error.hidden) return 'dizzy';
  const s = byKey.get(tile.key);
  if (tile.running || s?.status === 'active') {
    const last = tile.lastItemId ? tile.items.get(tile.lastItemId)?.item : undefined;
    if (last?.kind === 'tool' && last.output === undefined) {
      if (/edit|write|patch|notebook/i.test(last.name)) return 'edit';
      if (/read|grep|glob|search|find|fetch|view|ls\b/i.test(last.name)) return 'read';
      return 'juggle';
    }
    if (last?.kind === 'thinking' || (last?.kind === 'agent' && last.status === 'running')) return 'think';
    return 'type';
  }
  const now = Date.now();
  if (now - tile.finishedAt < 6000) return 'dance';
  return now - Math.max(tile.finishedAt, s?.updatedAt ?? 0) < 120_000 ? 'idle' : 'sleep';
}

// ---- cat wardrobe -------------------------------------------------------------------------------

let cats: Record<string, CatPrefs> = {};
let catCard: HTMLElement | undefined;

/** Dresses the tile's cat from its saved outfit, and opens the wardrobe on a double-click. */
function watchPet(tile: Tile) {
  tile.pet.dress(cats[tile.key] ?? {});
  tile.pet.el.setAttribute('aria-label', `${tile.pet.el.getAttribute('aria-label') ?? ''} · double-click to rename or dress`.trim());
  tile.pet.el.querySelector('.creature')?.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    openCatCard(tile);
  });
}

function closeCatCard() {
  catCard?.remove();
  catCard = undefined;
}

function setCatPref(tile: Tile, patch: CatPrefs) {
  const next = cleanCat({ ...cats[tile.key], ...patch });
  // an explicit "none" is an empty string in the patch: it clears the part
  for (const k of Object.keys(patch) as (keyof CatPrefs)[]) if (!patch[k]) delete next[k];
  if (Object.keys(next).length) cats[tile.key] = next;
  else delete cats[tile.key];
  post({ type: 'setCat', key: tile.key, cat: cats[tile.key] ?? {} });
  tile.pet.dress(cats[tile.key] ?? {});
  if (!tile.draft) syncTile(tile);
}

/** A card by the cat: its name, and a coat, hat and neckwear to choose. Locked items unlock with coins, on the spot. */
function openCatCard(tile: Tile) {
  closeCatCard();
  const isCat = tile.agent === 'claude';
  const body = h('div', { class: 'cat-body' });
  const note = h('div', { class: 'cat-note', 'aria-live': 'polite' });
  const card = h('div', { class: 'cat-card', role: 'dialog', 'aria-label': 'Dress your cat' }, body);
  const draw = () => {
    const prefs = cats[tile.key] ?? {};
    const nameIn = h('input', { class: 'ask-reason', maxlength: '20', placeholder: tile.pet.coat || 'Bit', value: prefs.name ?? '', 'aria-label': 'Name' }) as HTMLInputElement;
    const saveName = () => nameIn.value.trim() !== (prefs.name ?? '') && setCatPref(tile, { name: nameIn.value.trim() });
    nameIn.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), saveName(), closeCatCard()));
    nameIn.addEventListener('blur', saveName);
    const pick = (kind: 'coat' | 'hat' | 'neck', id: string, cost = 0) => {
      if (cost && !game.owns(id)) {
        if (!game.buyItem(id)) {
          note.textContent = `Needs ${cost - game.coins()} more coins`;
          return;
        }
        note.textContent = '';
      }
      setCatPref(tile, { [kind]: id });
      draw();
    };
    const lockedLabel = (w: { id: string; cost: number }) => (game.owns(w.id) ? '' : ` · ${w.cost}`);
    const swatch = (name: string, fur: string, fur2: string) => {
      const w = WARDROBE.find((x) => x.id === name);
      const locked = !!w && !game.owns(name);
      const on = (prefs.coat ?? tile.pet.coat) === name;
      return h('button', { type: 'button', class: `swatch${on ? ' on' : ''}${locked ? ' locked' : ''}`, style: `background:linear-gradient(135deg,${fur} 50%,${fur2} 50%)`, title: `${name}${w && locked ? ` · ${w.cost} coins` : ''}`, 'aria-label': `${name} coat${locked ? `, locked, ${w!.cost} coins` : ''}`, 'aria-pressed': String(on), onclick: () => pick('coat', name, locked ? w!.cost : 0) });
    };
    const chips = (kind: 'hat' | 'neck', none: string) => [
      h('button', { type: 'button', class: `chip${!prefs[kind] ? ' on' : ''}`, 'aria-pressed': String(!prefs[kind]), onclick: () => (setCatPref(tile, { [kind]: '' }), draw()), text: none }),
      ...WARDROBE.filter((w) => w.kind === kind).map((w) => {
        const locked = !game.owns(w.id);
        return h('button', { type: 'button', class: `chip${prefs[kind] === w.id ? ' on' : ''}${locked ? ' locked' : ''}`, 'aria-pressed': String(prefs[kind] === w.id), onclick: () => pick(kind, w.id, locked ? w.cost : 0), text: `${w.name}${lockedLabel(w)}` });
      }),
    ];
    body.replaceChildren(
      h('div', { class: 'srv-head' }, h('span', { text: isCat ? 'Dress your cat' : 'Name your bot' }), h('span', { class: 'srv-branch', text: `${game.coins().toLocaleString()} coins` })),
      h('label', { class: 'cat-row' }, h('span', { class: 'cat-label', text: 'Name' }), nameIn),
      ...(isCat
        ? [
            h('div', { class: 'cat-row' }, h('span', { class: 'cat-label', text: 'Coat' }), h('div', { class: 'cat-swatches' }, ...COAT_SWATCHES.map((c) => swatch(c.name, c.fur, c.fur2)))),
            h('div', { class: 'cat-row' }, h('span', { class: 'cat-label', text: 'Hat' }), h('div', { class: 'cat-chips' }, ...chips('hat', 'None'))),
            h('div', { class: 'cat-row' }, h('span', { class: 'cat-label', text: 'Neck' }), h('div', { class: 'cat-chips' }, ...chips('neck', 'None'))),
          ]
        : [h('div', { class: 'cat-note', text: "Bit doesn't wear clothes yet." })]),
      note,
    );
  };
  draw();
  document.body.append(card);
  // beside the cat, kept on screen
  const r = tile.pet.el.getBoundingClientRect();
  card.style.top = `${Math.max(8, Math.min(window.innerHeight - card.offsetHeight - 8, r.top - card.offsetHeight - 6))}px`;
  card.style.left = `${Math.max(8, Math.min(window.innerWidth - card.offsetWidth - 8, r.right - card.offsetWidth))}px`;
  catCard = card;
  (card.querySelector('input') as HTMLInputElement | null)?.focus();
}
document.addEventListener('mousedown', (e) => {
  if (catCard && !catCard.contains(e.target as Node)) closeCatCard();
});

// ---- magic wand ---------------------------------------------------------------------------------

function clearWand(tile: Tile) {
  tile.wand = undefined;
  tile.wandNote.hidden = true;
  tile.wandNote.replaceChildren();
}

function improve(tile: Tile) {
  const text = tile.input.value.trim();
  if (!text || tile.wand?.pending) return;
  showError(tile, '');
  tile.wand = { asked: tile.input.value, pending: true };
  tile.wandNote.hidden = true;
  syncTile(tile);
  post({ type: 'improvePrompt', key: tile.key, text });
}

function gotImproved(tile: Tile, text?: string, error?: string) {
  const asked = tile.wand?.asked;
  if (asked === undefined) return;
  if (!text) {
    clearWand(tile);
    showError(tile, error ?? 'The rewrite failed.');
    syncTile(tile);
    return;
  }
  // you kept typing while it was working: leave your text alone
  if (tile.input.value !== asked) {
    clearWand(tile);
    syncTile(tile);
    return;
  }
  tile.wand = { asked, original: asked, pending: false };
  tile.input.value = text;
  autosize(tile.input);
  tile.wandNote.hidden = false;
  tile.wandNote.replaceChildren(
    h('span', { text: 'Prompt rewritten. Edit it, or' }),
    h('button', { class: 'ask-btn', type: 'button', onclick: () => ((tile.input.value = tile.wand?.original ?? tile.input.value), autosize(tile.input), clearWand(tile), syncTile(tile), tile.input.focus()) }, 'Undo'),
  );
  syncTile(tile);
  tile.input.focus();
}

// ---- comments on the points of a report -----------------------------------------------------------

/** The strip above the message box: what will be added to your next message. */
function renderComments(tile: Tile) {
  const open = unsent(tile.comments);
  tile.commentsEl.hidden = !open.length;
  tile.commentsEl.replaceChildren(
    ...(open.length
      ? [
          h('div', { class: 'comments-head' }, h('span', { text: `${open.length} comment${open.length === 1 ? '' : 's'} will be added to your next message` }), h('button', { class: 'ask-btn', type: 'button', onclick: () => ((tile.comments = tile.comments.filter((c) => c.sent)), renderComments(tile), refreshNotes(tile)) }, 'Clear')),
          ...open.map((c) => h('div', { class: 'comments-row' }, h('span', { class: 'comments-point', text: `“${c.point}”` }), h('span', { class: 'comments-text', text: c.text }), h('button', { class: 'icon-btn', title: 'Remove comment', 'aria-label': 'Remove comment', onclick: () => ((tile.comments = tile.comments.filter((x) => x.id !== c.id)), renderComments(tile), refreshNotes(tile)) }, icon('close')))),
        ]
      : []),
  );
  syncTile(tile);
}

/** Notes under the points follow the list: redraw the ones on screen after it changes elsewhere. */
function refreshNotes(tile: Tile) {
  for (const [id, entry] of tile.items) if (entry.item.kind === 'assistant') attachPointComments(tile, entry.el, id);
}

const pointText = (li: HTMLElement) => {
  const copy = li.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('ul, ol, .pt-note, .pt-btn, .pt-edit').forEach((n) => n.remove());
  return excerpt(copy.textContent ?? '');
};

/** Every point (list item) of an assistant message gets a comment button and shows its comment. Safe to call again after a redraw. */
function attachPointComments(tile: Tile, root: HTMLElement, itemId: string) {
  root.querySelectorAll('.pt-btn, .pt-note, .pt-edit').forEach((n) => n.remove());
  root.querySelectorAll<HTMLElement>('li').forEach((li, i) => {
    const id = `${itemId}:${i}`;
    const point = pointText(li);
    if (!point) return;
    li.classList.add('has-pt');
    const nested = () => li.querySelector(':scope > ul, :scope > ol');
    const put = (el: HTMLElement) => li.insertBefore(el, nested());
    const existing = () => tile.comments.find((c) => c.id === id);

    const showNote = () => {
      li.querySelector(':scope > .pt-note')?.remove();
      const c = existing();
      if (!c) return;
      put(h('div', { class: `pt-note${c.sent ? ' sent' : ''}`, title: c.sent ? 'Sent with an earlier message' : 'Will be added to your next message' }, h('span', { text: c.text }), c.sent ? h('span', { class: 'pt-sent', text: 'sent' }) : ''));
    };
    const edit = () => {
      if (li.querySelector(':scope > .pt-edit')) return;
      li.querySelector(':scope > .pt-note')?.remove();
      let done = false;
      const input = h('input', { class: 'pt-edit', placeholder: 'Comment on this point…', 'aria-label': 'Comment on this point', value: existing()?.sent ? '' : existing()?.text ?? '' }) as HTMLInputElement;
      const finish = (save: boolean) => {
        if (done) return;
        done = true;
        input.remove();
        if (save && input.value.trim()) tile.comments = setComment(tile.comments, { id, point, text: input.value });
        else if (save && !input.value.trim() && existing() && !existing()!.sent) tile.comments = tile.comments.filter((c) => c.id !== id);
        showNote();
        renderComments(tile);
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') (e.preventDefault(), finish(true));
        else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), finish(false));
      });
      input.addEventListener('blur', () => finish(true));
      put(input);
      input.focus();
    };
    li.append(h('button', { class: 'pt-btn', type: 'button', title: 'Comment on this point', 'aria-label': 'Comment on this point', onclick: edit }, icon('comment')));
    showNote();
  });
}

/** A shelf card used on a tile: messages are quoted, code is fenced, images and files are attached. */
function insertShelfItem(tile: Tile, item: ShelfItem) {
  if (item.kind === 'attachment') {
    if (tile.agent === 'codex') return showError(tile, "Codex tiles don't take attachments yet");
    attach(tile, [item.att!], '');
    return;
  }
  if (item.kind === 'text') return quoteInto(tile.key, item.text ?? '');
  tile.input.value = `${tile.input.value ? `${tile.input.value.trimEnd()}\n\n` : ''}\`\`\`${item.lang ?? ''}\n${item.text}\n\`\`\`\n\n`;
  autosize(tile.input);
  syncTile(tile);
  focusTile(tile);
  tile.input.focus();
}

/** A small button that puts something on the shelf and shows a check for a moment. */
function shelfAddBtn(get: () => { kind: 'text' | 'code'; text: string; lang?: string; from?: string }) {
  const btn = h('button', { class: 'shelf-add', type: 'button', title: 'Add to the shelf', 'aria-label': 'Add to the shelf' }, icon('shelf'));
  btn.addEventListener('click', () => {
    const v = get();
    shelf.add(v.kind, v);
    btn.replaceChildren(icon('check'));
    setTimeout(() => btn.replaceChildren(icon('shelf')), 1200);
  });
  return btn;
}

/** A message dropped on a tile: quoted into its message box, not sent. */
function quoteInto(key: string, text: string) {
  const tile = tiles.get(key);
  if (!tile || !text.trim()) return;
  const q = quoteText(text);
  tile.input.value = `${tile.input.value ? `${tile.input.value.trimEnd()}\n\n` : ''}${q}\n\n`;
  autosize(tile.input);
  syncTile(tile);
  focusTile(tile);
  tile.input.focus();
}

let commentaryOn = true;

/** The cat's bubble: what its chat is doing, at a calm pace. */
function chatter(tile: Tile, mood: Mood, now: number) {
  const last = tile.lastItemId ? tile.items.get(tile.lastItemId)?.item : undefined;
  const path = last?.kind === 'tool' && /^[^\s]*[\\/.][^\s]*$/.test(last.summary) ? basename(last.summary) : undefined;
  const text = commentaryOn ? sayings({ name: cats[tile.key]?.name || tile.pet.coat || 'Bit', mood, file: path, helpers: tile.agents.filter((a) => a.status === 'working').length, changed: tile.files.length }) : undefined;
  const next = commentaryOn ? pace(tile.chat, text, mood, now) : { ...tile.chat, visible: false };
  if (next.shown !== tile.chat.shown && next.shown) tile.bubble.textContent = next.shown;
  tile.bubble.hidden = !next.visible;
  tile.chat = next;
}

let cachePainted = 0;

function tickFun() {
  // the prompt-cache minutes need no transcript line, a repaint every 30 s is enough
  const now = Date.now();
  const repaintCache = now - cachePainted >= 30_000;
  if (repaintCache) cachePainted = now;
  for (const t of tiles.values()) {
    const lines = t.files.reduce((n, f) => n + f.adds + f.dels, 0);
    const mood = moodOf(t);
    t.pet.set(mood, t.agents.filter((a) => a.status === 'working').length, lines);
    chatter(t, mood, now);
    if (repaintCache) syncCache(t);
  }
}
setInterval(tickFun, 1000);

// ---- account limits: one indicator for everything -----------------------------------------------

let accountUsage: Extract<ToWebview, { type: 'accountUsage' }> | undefined;

const WINDOW_NAMES: Record<string, string> = {
  five_hour: 'Current session',
  seven_day: 'Current week (all models)',
  seven_day_opus: 'Current week (Opus only)',
  seven_day_sonnet: 'Current week (Sonnet only)',
};
const windowName = (w: AccountUsage['windows'][number]) => WINDOW_NAMES[w.id] ?? (w.id.startsWith('model:') ? `Current week (${w.id.slice(6)} only)` : w.label);

function toggleUsage(open = usagePop.hidden) {
  usagePop.hidden = !open;
  usageBtn.setAttribute('aria-expanded', String(open));
  if (open) post({ type: 'refreshUsage' });
  renderUsage();
}
document.addEventListener('mousedown', (e) => {
  if (!usagePop.hidden && !usageWrap.contains(e.target as Node)) toggleUsage(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !usagePop.hidden) {
    toggleUsage(false);
    usageBtn.focus();
  }
});
// countdowns tick without waiting for new data
setInterval(() => (accountUsage || codexUsage) && renderUsage(), 30_000);

let codexUsage: AccountUsage | undefined;

type Provider = { id: 'claude' | 'codex'; name: string; usage: AccountUsage };
const providers = (): Provider[] => [
  ...(accountUsage?.usage ? [{ id: 'claude' as const, name: 'Claude', usage: accountUsage.usage }] : []),
  ...(codexUsage ? [{ id: 'codex' as const, name: 'Codex', usage: codexUsage }] : []),
];

let lowInfoOpen = false;

/** Turns low usage mode on or off. Tiles you did not set up yourself follow the mode; the next message in each starts with the new flags. */
function setLowUsage(on: boolean) {
  lowUsage = on;
  post({ type: 'setLowUsage', on });
  refreshDefaults();
  renderUsage();
}

/** Defaults changed (low usage mode, or the Settings panel): tiles that follow them pick up the new values for their next message. */
function refreshDefaults() {
  for (const t of tiles.values()) {
    modeOptions(t);
    modelOptions(t);
    effortOptions(t);
    t.chrome = picked(tileChrome, t.key, normalChrome(t.agent)) ?? defaultChrome(t.agent);
    t.continueBtn.hidden = t.draft ? true : !offerHandoff(t.ctxPct, lowUsage);
    syncTile(t);
  }
  settingsUi.refresh();
}

/** The switch at the top of the usage popup, and an info mark that lists what the mode does (on hover, or click). */
function lowRow() {
  const sonnet = lowModel('claude')?.label;
  const lines = [
    `${sonnet ?? 'Default model'} · high effort${sonnet ? '' : ' (no Sonnet found)'}`,
    'Chrome off · no MCP servers (Claude)',
    'Short answers; small tasks go to sub-agents',
    'Continue nudge from 50% context',
    'Tiles whose model, effort or Chrome you chose keep your choice',
    'Applies from your next message in each chat',
  ];
  const wrap = h('span', { class: `info-wrap${lowInfoOpen ? ' open' : ''}` });
  const info = h('button', { class: 'icon-btn info-btn', type: 'button', 'aria-label': 'What low usage mode does', 'aria-expanded': String(lowInfoOpen), onclick: () => ((lowInfoOpen = !lowInfoOpen), wrap.classList.toggle('open', lowInfoOpen), info.setAttribute('aria-expanded', String(lowInfoOpen))) }, icon('info'));
  wrap.append(info, h('div', { class: 'info-pop', role: 'tooltip' }, ...lines.map((t) => h('div', { text: t }))));
  const sw = h('button', { class: `switch${lowUsage ? ' on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(lowUsage), 'aria-label': 'Low usage mode', onclick: () => setLowUsage(!lowUsage) }, h('span', { class: 'switch-knob' }));
  return h('div', { class: 'low-row' }, h('span', { class: 'low-title', text: 'Low usage mode' }), wrap, h('span', { class: 'spacer' }), sw);
}

/** "5h 8% · 3h 12m" per window, one orange group for Claude and one blue for Codex; the popup has every window, when it resets, and a refresh. */
function renderUsage() {
  const m = accountUsage;
  const list = providers();
  usageWrap.hidden = !m && !list.length;
  usageBtn.hidden = usageWrap.hidden;
  if (usageWrap.hidden) return;
  if (!list.length) {
    usageBtn.replaceChildren(h('span', { class: 'usage-label', text: 'Usage –' }));
    usageBtn.title = m?.state === 'unavailable' ? "Plan limits aren't available for this login method." : 'Failed to load usage data. Click to retry.';
    usageBody.replaceChildren(lowRow(), h('div', { class: 'srv-empty', text: usageBtn.title }), h('button', { class: 'ask-btn', onclick: () => post({ type: 'refreshUsage' }) }, 'Try again'));
    return;
  }
  const now = Date.now();
  const short = (w: AccountUsage['windows'][number]) => (w.id === 'five_hour' ? '5h' : w.id === 'seven_day' ? '7d' : w.label.replace('Weekly ', ''));
  // one bar for both: Claude's orange fill above Codex's blue one, each at its most-used window.
  // A number shows from 80%, and the reset time only once that window is full; the popup has everything.
  const worst = list.map((p) => {
    const ws = p.usage.windows;
    const top = ws.reduce((a, w) => (w.pct > a.pct ? w : a), ws[0]);
    // when several windows are full, the one that lets you back in last
    const full = ws.filter((w) => w.pct >= 100).reduce<typeof top | undefined>((a, w) => (!a || (w.resetsAt ?? 0) > (a.resetsAt ?? 0) ? w : a), undefined);
    return { p, w: full ?? top };
  });
  usageBtn.replaceChildren(
    h('span', { class: 'usage-label', text: 'Usage' }),
    lowUsage ? h('span', { class: 'usage-low', text: 'Low', title: 'Low usage mode is on' }) : '',
    // both fills start at the left; the higher one is drawn first, so the lower one sits on top and the rest shows beyond it
    h('span', { class: 'usage-bar dual' }, ...[...worst].sort((a, b) => b.w.pct - a.w.pct).map(({ p, w }, i) => h('span', { class: `usage-fill ${p.id}`, title: `${p.name} ${w.pct}%`, style: `width:${w.pct}%;z-index:${i + 1}` }))),
    ...worst.filter(({ w }) => w.pct >= 80).map(({ p, w }) =>
      h('span', { class: `usage-pct ${p.id}${w.pct >= 100 ? ' high' : ''}`, title: p.name, text: `${short(w)} ${w.pct}%${w.pct >= 100 && timeLeft(w.resetsAt, now) ? ` · resets in ${timeLeft(w.resetsAt, now)}` : ''}` }),
    ),
  );
  usageBtn.title = `${worst.map(({ p, w }) => `${p.name} ${w.pct}%`).join(' · ')} (most-used window) · click for details`;
  if (usagePop.hidden) return;
  const ago = (at: number) => {
    const min = Math.round((now - at) / 60_000);
    return min < 1 ? 'just now' : min < 90 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
  };
  const item = (w: AccountUsage['windows'][number]) =>
    h(
      'div',
      { class: `usage-item${w.pct >= 80 ? ' high' : ''}` },
      h('div', { class: 'usage-item-head' }, h('span', { text: windowName(w) }), h('span', { class: 'usage-pct', text: `${w.pct}% used` })),
      h('div', { class: 'usage-meter', role: 'progressbar', 'aria-valuenow': String(w.pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': windowName(w) }, h('span', { class: 'usage-fill', style: `width:${w.pct}%` })),
      h('div', { class: 'usage-reset', text: [formatReset(w.resetsAt, now), timeLeft(w.resetsAt, now) && `in ${timeLeft(w.resetsAt, now)}`].filter(Boolean).join(' · ') || 'Resets when you next use it' }),
    );
  const section = (title: string, ws: AccountUsage['windows']) => (ws.length ? h('div', { class: 'usage-sec' }, h('div', { class: 'usage-sec-title', text: title }), ...ws.map(item)) : '');
  usageBody.replaceChildren(
    lowRow(),
    ...list.map((p) =>
      h(
        'div',
        { class: `usage-prov ${p.id}` },
        h('div', { class: 'srv-head' }, h('span', { class: 'usage-provname' }, h('span', { class: 'usage-dot', 'aria-hidden': 'true' }), p.name), p.usage.plan ? h('span', { class: 'srv-branch', text: p.usage.plan }) : ''),
        section('Current session', p.usage.windows.filter((w) => w.id === 'five_hour')),
        section('Weekly limits', p.usage.windows.filter((w) => w.id !== 'five_hour')),
        h('div', { class: 'usage-reset', text: p.id === 'codex' ? `As of the last Codex run, ${ago(p.usage.at)}` : `Updated ${ago(p.usage.at)}` }),
      ),
    ),
    m?.state === 'error' ? h('div', { class: 'usage-reset', text: 'Could not refresh Claude just now.' }) : '',
    h('div', { class: 'usage-foot' }, h('span', {}), h('button', { class: 'ask-btn', onclick: () => post({ type: 'refreshUsage' }) }, 'Refresh')),
  );
}

// ---- daily recap -------------------------------------------------------------------------------

function showRecap() {
  recapEl.hidden = false;
  recapBody.replaceChildren(h('div', { class: 'placeholder', text: "Reading today's sessions…" }));
  post({ type: 'recap' });
}

function hideRecap() {
  recapEl.hidden = true;
}

function duration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function renderRecap(r: Recap) {
  const stat = (label: string, value: Node | string, sub?: string) =>
    h('div', { class: 'stat' }, h('div', { class: 'stat-label', text: label }), h('div', { class: 'stat-value' }, value), sub && h('div', { class: 'stat-sub', text: sub }));
  const perAgent = Object.entries(r.byAgent)
    .map(([a, n]) => `${agentLabel(a as AgentId)} ${n}`)
    .join(' · ');
  const lines = h('span', {}, h('span', { class: 'add', text: `+${r.adds.toLocaleString()}` }), ' ', h('span', { class: 'del', text: `−${r.dels.toLocaleString()}` }));
  const out: Node[] = [
    h(
      'div',
      { class: 'stats' },
      stat('Chats', String(r.chats), perAgent || undefined),
      stat('Prompts', String(r.turns)),
      stat('Files touched', String(r.files)),
      stat('Lines changed', lines),
    ),
  ];
  if (r.longest) {
    const longest = r.longest;
    out.push(
      h(
        'div',
        { class: 'recap-section' },
        h('div', { class: 'stat-label', text: 'Longest task' }),
        h(
          'button',
          {
            class: 'longest',
            title: 'Open this chat',
            onclick: () => {
              hideRecap();
              openTile(longest.key);
            },
          },
          h('span', { class: 'longest-time', text: duration(longest.ms) }),
          h('span', { class: 'longest-text' }, h('span', { class: 'longest-title', text: longest.title }), longest.prompt && h('span', { class: 'longest-prompt', text: longest.prompt })),
          h('span', { class: 'agent-pill', 'data-agent': longest.agent, text: agentLabel(longest.agent) }),
        ),
      ),
    );
  }
  if (r.topFiles.length) {
    out.push(
      h(
        'div',
        { class: 'recap-section' },
        h('div', { class: 'stat-label', text: 'Most changed files' }),
        ...r.topFiles.map((f) =>
          h(
            'button',
            { class: 'recap-file', title: f.path, onclick: () => post({ type: 'openDiff', path: f.path }) },
            icon('file'),
            h('span', { class: 'recap-file-name', text: basename(f.path) }),
            h('span', { class: 'recap-file-dir', text: f.path.split(/[\\/]/).slice(-3, -1).join('/') }),
            h('span', { class: 'add', text: `+${f.adds}` }),
            h('span', { class: 'del', text: `−${f.dels}` }),
          ),
        ),
      ),
    );
  }
  if (!r.chats) out.push(h('div', { class: 'placeholder', text: 'No prompts sent today yet.' }));
  recapBody.replaceChildren(...out);
}

function remember() {
  Object.assign(saved, { q: filter.q, agent: filter.agent });
  vscode.setState(saved);
}

function toggleSidebar() {
  layout = { ...layout, sidebar: !layout.sidebar };
  applyLayout();
  post({ type: 'layout', layout });
}

function applyLayout() {
  app.dataset.sidebar = String(layout.sidebar);
  grid.style.setProperty('--cols', String(layout.columns));
  grid.style.setProperty('--rows', String(layout.rows));
  const make = (container: HTMLElement, values: number[], current: number, set: (n: number) => void) =>
    container.replaceChildren(
      ...values.map((n) =>
        h('button', { class: n === current ? 'on' : '', 'aria-pressed': String(n === current), onclick: () => set(n), text: String(n) }),
      ),
    );
  make(colSeg, [1, 2, 3, 4], layout.columns, (n) => setLayout({ columns: n }));
  make(rowSeg, [1, 2, 3], layout.rows, (n) => setLayout({ rows: n }));
}

function setLayout(patch: Partial<Layout>) {
  layout = { ...layout, ...patch };
  applyLayout();
  post({ type: 'layout', layout });
}

function syncChrome() {
  const n = tiles.size;
  openCount.textContent = n === 1 ? '1 chat open' : `${n} chats open`;
  empty.hidden = n > 0;
  grid.hidden = n === 0;
  grid.classList.toggle('has-max', !!maximized && tiles.has(maximized));
}

// ---- session list ------------------------------------------------------------------------------

function renderList() {
  const counts: Record<string, number> = { all: sessions.length };
  for (const s of sessions) counts[s.agent] = (counts[s.agent] ?? 0) + 1;
  seg.replaceChildren(
    ...(['all', ...agents.map((a) => a.id)] as const).map((id) =>
      h(
        'button',
        {
          role: 'tab',
          class: filter.agent === id ? 'on' : '',
          'aria-selected': String(filter.agent === id),
          onclick: () => {
            filter.agent = id;
            remember();
            renderList();
          },
        },
        id === 'all' ? 'All' : agentLabel(id),
        h('span', { class: 'count', text: String(counts[id] ?? 0) }),
      ),
    ),
  );

  const q = filter.q.trim().toLowerCase();
  const rows = sessions.filter(
    (s) =>
      (filter.agent === 'all' || s.agent === filter.agent) &&
      (!q || s.title.toLowerCase().includes(q) || s.project.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q)),
  );
  const scroll = list.scrollTop;
  const out: Node[] = [];
  let group = '';
  for (const s of rows) {
    const g = bucket(s.updatedAt);
    if (g !== group) {
      group = g;
      out.push(h('div', { class: 'group', text: g }));
    }
    out.push(
      h(
        'button',
        {
          class: `row${tiles.has(s.key) ? ' open' : ''}`,
          'data-agent': s.agent,
          title: `${s.title}\n${s.cwd}`,
          onclick: () => openTile(s.key),
        },
        h('span', { class: 'row-mark', 'data-agent': s.agent, 'aria-label': agentLabel(s.agent) }),
        h(
          'span',
          { class: 'row-main' },
          h('span', { class: 'row-title', text: s.title }),
          h('span', { class: 'row-sub', text: [s.project, ago(s.updatedAt)].filter(Boolean).join(' · ') }),
        ),
        tiles.get(s.key)?.unread && h('span', { class: 'unread-dot', title: 'New activity' }),
        s.status !== 'idle' && h('span', { class: 'dot', 'data-status': s.status, title: statusText(s.status) }),
      ),
    );
  }
  if (!rows.length) out.push(h('div', { class: 'list-empty', text: q ? 'No chats match your search.' : 'No chats yet.' }));
  list.replaceChildren(...out);
  list.scrollTop = scroll;
}

function statusText(status: string) {
  return status === 'running' ? 'Running here' : status === 'active' ? 'Active in another window' : 'Idle';
}

// ---- tiles -------------------------------------------------------------------------------------

function modeOptions(tile: Tile) {
  const info = agentInfo(tile.agent);
  const value = tileModes[tile.key] ?? info?.defaultMode ?? '';
  tile.mode.replaceChildren(...(info?.modes ?? []).map((m) => h('option', { value: m.value, text: m.label, selected: m.value === value })));
}

// Low usage mode: what tiles use unless you picked something yourself (your picks are in tileModels / tileEfforts / tileChrome)
let lowUsage = false;
const lowModel = (agent: AgentId) => (agent === 'claude' ? agentInfo(agent)?.models.find((m) => /sonnet/i.test(m.label)) : undefined);
/** A stored choice counts as yours only when it differs from the normal default: chats made here store their starting values too. */
const picked = <T>(map: Record<string, T>, key: string, normal: T): T | undefined => (map[key] !== undefined && map[key] !== normal ? map[key] : undefined);
const normalModel = (agent: AgentId) => agentInfo(agent)?.defaultModel ?? '';
const normalEffort = (agent: AgentId) => agentInfo(agent)?.defaultEffort ?? '';
const normalChrome = (agent: AgentId) => agentInfo(agent)?.defaultChrome ?? false;
const defaultModel = (agent: AgentId) => (lowUsage ? lowModel(agent)?.value : undefined) ?? agentInfo(agent)?.defaultModel ?? '';
const defaultEffort = (agent: AgentId) => (lowUsage ? 'high' : agentInfo(agent)?.defaultEffort ?? '');
const defaultChrome = (agent: AgentId) => (lowUsage ? false : agentInfo(agent)?.defaultChrome ?? false);

function modelOptions(tile: Tile) {
  const options = agentInfo(tile.agent)?.models ?? [{ value: '', label: 'Default model' }];
  const value = picked(tileModels, tile.key, normalModel(tile.agent)) ?? defaultModel(tile.agent);
  const list = options.some((m) => m.value === value) ? options : [...options, { value, label: value }];
  tile.model.replaceChildren(
    ...list.map((m) => h('option', { value: m.value, text: m.label, title: m.value || 'Use the CLI default', selected: m.value === value })),
  );
}

function modelLabel(agent: AgentId, id: string) {
  return agentInfo(agent)?.models.find((m) => m.value === id)?.label ?? id;
}

/** Only the levels the selected model supports, when the agent says which. */
function effortOptions(tile: Tile) {
  const info = agentInfo(tile.agent);
  const supported = info?.modelEfforts[tile.model.value];
  const levels = (info?.efforts ?? []).filter((l) => !supported || supported.includes(l.value));
  const stored = picked(tileEfforts, tile.key, normalEffort(tile.agent)) ?? defaultEffort(tile.agent);
  const value = levels.some((l) => l.value === stored) ? stored : '';
  tile.effort.replaceChildren(
    h('option', { value: '', text: 'Default effort', title: 'Use the CLI default', selected: value === '' }),
    ...levels.map((l) => h('option', { value: l.value, text: l.label, selected: l.value === value })),
  );
}

function effortName(agent: AgentId, level: string) {
  return agentInfo(agent)?.efforts.find((l) => l.value === level)?.label ?? level;
}

function buildTile(key: string, agent: AgentId, draft?: { cwd: string }): Tile {
  const tile = {} as Tile;
  const chrome = picked(tileChrome, key, normalChrome(agent)) ?? defaultChrome(agent);
  Object.assign(tile, {
    key,
    agent,
    draft,
    items: new Map(),
    focusView: tileFocus[key] ?? focusDefault,
    folds: new Map(),
    foldOpen: new Set(),
    running: false,
    loaded: !!draft,
    chrome,
    unread: false,
    queue: [],
    attachments: [],
    comments: [],
    asks: [],
    askCards: new Map(),
    queuePaused: false,
    files: [],
    skillsUsed: [],
    agents: [],
    finishedAt: 0,
  });
  tile.pet = createPet(agent, wornCoats(), key);
  watchPet(tile);
  tile.skillMenu = h('div', { class: 'skill-menu', hidden: true, role: 'listbox', 'aria-label': 'Skills' });

  tile.grip = arrange.grip(() => tile.key);
  tile.bubble = h('span', { class: 'pet-bubble', hidden: true, 'aria-hidden': 'true' });
  tile.chat = { at: -1e9, visible: false };
  tile.unreadDot = h('span', { class: 'unread-dot', hidden: true, title: 'New activity since you last looked' });
  tile.queueEl = h('div', { class: 'queue', hidden: true });
  tile.asksEl = h('div', { class: 'asks', hidden: true });
  tile.commentsEl = h('div', { class: 'comments', hidden: true });
  tile.wandNote = h('div', { class: 'wand-note', hidden: true });
  tile.wandBtn = h('button', { class: 'icon-btn wand', type: 'button', title: 'Improve my prompt', 'aria-label': 'Improve my prompt', onclick: () => improve(tile) }, icon('wand')) as HTMLButtonElement;
  tile.needsEl = h('span', { class: 'needs-badge', hidden: true, text: 'Needs you', title: 'The agent is waiting for your answer' });
  tile.attachEl = h('div', { class: 'attach-chips', hidden: true });
  tile.clipBtn = h(
    'button',
    { type: 'button', class: 'icon-btn clip', title: 'Attach files (or paste / drop them here)', 'aria-label': 'Attach files', onclick: () => post({ type: 'pickAttachments', key: tile.key }) },
    icon('clip'),
  );
  tile.chipsEl = h('div', { class: 'chips', role: 'toolbar', 'aria-label': 'Saved prompts' });
  tile.filesList = h('div', { class: 'files-list', 'aria-label': 'Files this chat changed' });
  tile.meter = h('span', { class: 'meter', hidden: true });
  tile.cachePill = h('span', { class: 'cache-pill', hidden: true }, icon('clock'), h('span', { class: 'cache-text' }));
  tile.continueBtn = h('button', { class: 'btn mini', hidden: true, title: 'Continue in a new chat: ask this chat for a summary, then start a new one from it', onclick: () => startHandoff(tile) }, 'Continue ↗') as HTMLButtonElement;
  tile.filesEl = h('div', { class: 'info-strip', hidden: true }, tile.filesList, tile.cachePill, tile.meter, tile.continueBtn);
  tile.title = h('div', { class: 'tile-title', ondblclick: () => startRename(tile) });
  tile.sub = h('div', { class: 'tile-sub' });
  tile.dot = h('span', { class: 'dot' });
  tile.head = h('header', { class: 'tile-head' });

  tile.list = h(
    'div',
    { class: 'items' },
    h('div', { class: 'placeholder', text: draft ? 'Choose an agent and a folder, then send the first message.' : 'Loading transcript…' }),
  );
  tile.earlier = h('button', { class: 'earlier', hidden: true, onclick: () => post({ type: 'loadEarlier', key: tile.key }) });
  tile.working = h('div', { class: 'working', hidden: true, 'aria-label': 'Working' }, h('span'), h('span'), h('span'));
  tile.msgs = h('div', { class: 'msgs', role: 'log', 'aria-live': 'polite' }, tile.earlier, tile.list, tile.working);
  tile.msgs.addEventListener('scroll', () => scheduleOverlays(tile), { passive: true });
  tile.resize = new ResizeObserver(() => scheduleOverlays(tile));
  tile.resize.observe(tile.msgs);
  tile.lastText = h('button', { class: 'lp-text', title: 'Go to this message', onclick: () => jumpToLast(tile) });
  tile.lastMore = h('button', { class: 'lp-more', onclick: () => toggleLast(tile) }, 'Show more');
  tile.lastBar = h('div', { class: 'last-prompt', hidden: true }, tile.lastText, tile.lastMore);
  tile.jump = h(
    'button',
    {
      class: 'jump',
      hidden: true,
      title: 'Scroll to the end',
      'aria-label': 'Scroll to the end',
      onclick: () => tile.msgs.scrollTo({ top: tile.msgs.scrollHeight, behavior: 'smooth' }),
    },
    icon('down'),
  );
  tile.error = h('div', { class: 'tile-error', hidden: true, role: 'alert' });

  tile.input = h('textarea', {
    rows: 1,
    'aria-label': 'Message',
    title: 'Enter to send · Shift+Enter for a new line',
    oninput: (e: Event) => {
      if (tile.wand && !tile.wand.pending) clearWand(tile); // typing keeps the rewrite
      game.typed(e, tile.input);
      autosize(tile.input);
      syncTile(tile);
      updateSkillMenu(tile);
      updateFileMenu(tile);
    },
    onclick: () => {
      updateSkillMenu(tile);
      updateFileMenu(tile);
    },
    onblur: () => {
      closeSkillMenu(tile);
      closeFileMenu(tile);
    },
    onpaste: (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      void takeFiles(tile, files);
    },
    onkeydown: (e: KeyboardEvent) => {
      if (skillMenuKey(tile, e) || fileMenuKey(tile, e)) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!tile.sendBtn.disabled && !tile.sendBtn.hidden) submit(tile);
      }
    },
  });
  tile.mode = h('select', {
    class: 'mode',
    'aria-label': 'Permission mode',
    onchange: () => {
      tileModes[tile.key] = tile.mode.value;
      if (!tile.draft) post({ type: 'setMode', key: tile.key, mode: tile.mode.value });
    },
  });
  tile.model = h('select', {
    class: 'mode',
    'aria-label': 'Model',
    onchange: () => {
      tileModels[tile.key] = tile.model.value;
      if (!tile.draft) post({ type: 'setModel', key: tile.key, model: tile.model.value });
      effortOptions(tile);
    },
  });
  tile.effort = h('select', {
    class: 'mode',
    'aria-label': 'Reasoning effort',
    onchange: () => {
      tileEfforts[tile.key] = tile.effort.value;
      if (!tile.draft) post({ type: 'setEffort', key: tile.key, effort: tile.effort.value });
    },
  });
  tile.chromeBtn = h(
    'button',
    {
      class: 'toggle',
      title: 'Let this chat use your Chrome (Claude in Chrome). Chrome must be open with the extension signed in.',
      onclick: () => {
        tile.chrome = !tile.chrome;
        tileChrome[tile.key] = tile.chrome;
        if (!tile.draft) post({ type: 'setChrome', key: tile.key, chrome: tile.chrome });
        syncTile(tile);
      },
    },
    icon('globe'),
    h('span', { class: 'toggle-label', text: 'Chrome' }),
  );
  tile.agentsPill = h(
    'button',
    { type: 'button', class: 'toggle agents-pill', hidden: true, onclick: () => agentMap.open(tile.key, tile.agent) },
    icon('agent'),
    h('span', { class: 'am-dot am-dot-idle' }),
    h('span', { class: 'agents-pill-label' }),
  );
  tile.hint = h('span', { class: 'hint' });
  tile.sendBtn = h('button', { class: 'send', title: 'Send (Enter)', 'aria-label': 'Send', onclick: () => submit(tile) }, icon('send'));
  tile.stopBtn = h('button', { class: 'send stop', title: 'Stop', 'aria-label': 'Stop', hidden: true, onclick: () => post({ type: 'stop', key: tile.key }) }, icon('stop'));

  tile.el = h(
    'section',
    { class: 'tile', 'data-agent': agent, 'data-key': key },
    tile.head,
    tile.filesEl,
    h('div', { class: 'tile-body' }, tile.msgs, tile.lastBar, tile.jump),
    tile.error,
    h(
      'footer',
      { class: 'composer' },
      tile.bubble,
      tile.pet.el,
      tile.skillMenu,
      tile.asksEl,
      tile.commentsEl,
      tile.wandNote,
      tile.queueEl,
      tile.chipsEl,
      tile.attachEl,
      h('div', { class: 'field' }, tile.input, tile.wandBtn, tile.clipBtn, tile.sendBtn, tile.stopBtn),
      h('div', { class: 'composer-row' }, tile.model, tile.effort, tile.mode, tile.chromeBtn, tile.agentsPill, tile.hint),
    ),
  );
  // Files dropped on the composer are attached.
  const composer = tile.el.querySelector<HTMLElement>('.composer')!;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
  composer.addEventListener('dragover', (e) => hasFiles(e) && (e.preventDefault(), composer.classList.add('dropping')));
  composer.addEventListener('dragleave', (e) => !composer.contains(e.relatedTarget as Node | null) && composer.classList.remove('dropping'));
  composer.addEventListener('drop', (e) => {
    composer.classList.remove('dropping');
    if (!hasFiles(e)) return;
    e.preventDefault();
    void takeFiles(tile, [...(e.dataTransfer?.files ?? [])]);
  });
  // Any interaction with a tile counts as having seen it.
  const touched = () => {
    activeTile = tile;
    setUnread(tile, false);
  };
  arrange.attach(tile.el);
  tile.el.addEventListener('pointerdown', touched);
  tile.el.addEventListener('focusin', touched);
  renderHead(tile);
  modeOptions(tile);
  modelOptions(tile);
  effortOptions(tile);
  renderChips(tile);
  syncTile(tile);
  return tile;
}

// ---- unread dot --------------------------------------------------------------------------------

/** The user can see new output arrive: window focused, tile on screen and scrolled to the end. */
function isWatching(tile: Tile) {
  if (document.hidden || !document.hasFocus()) return false;
  if (maximized && maximized !== tile.key) return false;
  if (!nearBottom(tile.msgs)) return false;
  const r = tile.el.getBoundingClientRect();
  const g = grid.getBoundingClientRect();
  return r.bottom > g.top && r.top < g.bottom;
}

function setUnread(tile: Tile, unread: boolean) {
  if (tile.unread === unread || tile.draft) return;
  tile.unread = unread;
  tile.unreadDot.hidden = !unread;
  tile.el.classList.toggle('unread', unread);
  renderList();
}

// ---- queue + prompt chips ----------------------------------------------------------------------

const isElsewhere = (tile: Tile) => !tile.running && byKey.get(tile.key)?.status === 'active';

/** Send now, or queue it while the agent is busy here or in another window. */
function dispatch(tile: Tile, text: string, attachments: Attachment[] = []) {
  if (tile.running || isElsewhere(tile)) {
    tile.queue.push({ text, attachments });
    renderQueue(tile);
    syncTile(tile);
    return;
  }
  sendText(tile, text, attachments);
}

function flushQueue(tile: Tile) {
  if (tile.running || isElsewhere(tile) || tile.queuePaused || tile.draft || !tile.queue.length) return;
  const next = tile.queue.shift()!;
  renderQueue(tile);
  sendText(tile, next.text, next.attachments);
}

function renderQueue(tile: Tile) {
  tile.queueEl.hidden = !tile.queue.length;
  tile.queueEl.replaceChildren(
    ...tile.queue.map(({ text, attachments }, i) =>
      h(
        'div',
        { class: 'queued' },
        h('span', { class: 'queued-label', text: i === 0 ? (tile.queuePaused ? 'Paused' : 'Next') : `#${i + 1}` }),
        h('span', { class: 'queued-text', text: text || '(attachment)', title: text }),
        attachments.length ? h('span', { class: 'queued-clip', title: `${attachments.length} attached` }, icon('clip'), String(attachments.length)) : null,
        h(
          'button',
          {
            class: 'icon-btn',
            title: 'Remove from queue',
            'aria-label': 'Remove from queue',
            onclick: () => {
              tile.queue.splice(i, 1);
              renderQueue(tile);
              syncTile(tile);
            },
          },
          icon('close'),
        ),
      ),
    ),
  );
}

function renderChips(tile: Tile) {
  tile.chipsEl.replaceChildren(
    h(
      'button',
      {
        class: 'chip skills-chip',
        title: 'Browse skills and commands',
        // keep focus in the message box so the menu stays open
        onmousedown: (e: MouseEvent) => e.preventDefault(),
        onclick: () => browseSkills(tile),
      },
      icon('bolt'),
      'Skills',
    ),
    ...prompts.map((p) =>
      h(
        'button',
        {
          class: 'chip',
          title: `${p.prompt}\n\nClick to send (queues while busy) · Alt/Shift-click to edit first`,
          onclick: (e: MouseEvent) => {
            if (e.altKey || e.shiftKey) {
              tile.input.value = p.prompt;
              autosize(tile.input);
              tile.input.focus();
              syncTile(tile);
            } else if (!tile.input.disabled && !(tile.draft && !tile.draft.cwd)) dispatch(tile, p.prompt);
          },
        },
        p.label,
      ),
    ),
  );
}

// ---- questions from the CLI ---------------------------------------------------------------------

const askCtx = (tile: Tile): AskCtx => ({
  h: h as unknown as AskCtx['h'],
  icon,
  markdown: (text) => mdDiv('md', text),
  answer: (id, answer) => post({ type: 'answer', key: tile.key, id, answer }),
});

/** Pending questions are cards above the box; answered or expired ones go away. A card keeps what you typed while others come and go. */
function renderAsks(tile: Tile, asks: PendingAsk[]) {
  const pending = asks.filter((a) => a.state === 'pending');
  const fresh = pending.some((a) => !tile.askCards.has(a.id));
  for (const id of [...tile.askCards.keys()]) {
    if (pending.some((a) => a.id === id)) continue;
    tile.askCards.get(id)!.remove();
    tile.askCards.delete(id);
  }
  for (const a of pending) {
    if (tile.askCards.has(a.id)) continue;
    const card = askCard(a, askCtx(tile));
    tile.askCards.set(a.id, card);
    tile.asksEl.append(card);
  }
  // only the oldest waiting card shows, so a pile of questions never takes over the tile
  pending.forEach((a, i) => (tile.askCards.get(a.id)!.hidden = i > 0));
  tile.asksEl.querySelector('.ask-more')?.remove();
  if (pending.length > 1) tile.asksEl.prepend(h('div', { class: 'ask-more', text: `${pending.length - 1} more waiting after this one` }));
  tile.asks = asks;
  tile.asksEl.hidden = !pending.length;
  tile.needsEl.hidden = !pending.length;
  tile.el.classList.toggle('needs-you', !!pending.length);
  if (fresh && !isWatching(tile)) setUnread(tile, true);
  syncTile(tile);
  scheduleOverlays(tile);
}

// ---- @ file picker -----------------------------------------------------------------------------

let fileRequest = 0;

/** Opens (or refreshes) the picker when an @ was typed after whitespace; asks the extension 200 ms after the last key. */
function updateFileMenu(tile: Tile) {
  const ta = tile.input;
  const hit = mentionAt(ta.value.slice(0, ta.selectionStart ?? ta.value.length));
  if (!hit) return closeFileMenu(tile);
  closeSkillMenu(tile);
  const id = ++fileRequest;
  tile.fileState = { items: tile.fileState?.items ?? [], active: 0, start: hit.start, query: hit.query, id, loading: true };
  renderFileMenu(tile);
  clearTimeout(tile.fileTimer);
  tile.fileTimer = window.setTimeout(() => post({ type: 'findFiles', key: tile.key, cwd: tile.draft?.cwd, query: hit.query, id }), 200);
}

function renderFileMenu(tile: Tile) {
  const st = tile.fileState;
  if (!st) return;
  tile.skillMenu.hidden = false;
  if (!st.items.length) {
    tile.skillMenu.replaceChildren(h('div', { class: 'sk-empty', text: st.loading ? 'Searching…' : 'No files found' }));
    return;
  }
  tile.skillMenu.replaceChildren(
    ...st.items.map((f, i) =>
      h(
        'button',
        {
          class: `sk-item${i === st.active ? ' active' : ''}`,
          role: 'option',
          'aria-selected': String(i === st.active),
          title: f.path,
          onmousedown: (e: MouseEvent) => {
            e.preventDefault();
            pickFile(tile, i, false);
          },
        },
        h('span', { class: 'fm-icon' }, icon(f.folder ? 'folder' : 'file')),
        h('span', { class: 'fm-name', text: f.name }),
        h('span', { class: 'sk-desc', text: f.dir }),
      ),
    ),
  );
  tile.skillMenu.querySelector('.sk-item.active')?.scrollIntoView({ block: 'nearest' });
}

function closeFileMenu(tile: Tile) {
  clearTimeout(tile.fileTimer);
  if (!tile.fileState) return;
  tile.fileState = undefined;
  tile.skillMenu.hidden = true;
}

/** `drill` (Tab on a folder) keeps the @ and lists what is inside; otherwise the mention is finished with a space. */
function pickFile(tile: Tile, i: number, drill: boolean) {
  const st = tile.fileState;
  const f = st?.items[i];
  if (!st || !f) return;
  const ta = tile.input;
  const caret = ta.selectionStart ?? ta.value.length;
  const insert = mentionText(f, tile.agent, drill && !!f.folder);
  ta.value = ta.value.slice(0, st.start) + insert + ta.value.slice(caret);
  const pos = st.start + insert.length;
  ta.setSelectionRange(pos, pos);
  if (drill && f.folder) updateFileMenu(tile);
  else closeFileMenu(tile);
  autosize(ta);
  syncTile(tile);
  ta.focus();
}

function fileMenuKey(tile: Tile, e: KeyboardEvent): boolean {
  const st = tile.fileState;
  if (!st || tile.skillMenu.hidden) return false;
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && st.items.length) {
    e.preventDefault();
    st.active = (st.active + (e.key === 'ArrowDown' ? 1 : -1) + st.items.length) % st.items.length;
    renderFileMenu(tile);
    return true;
  }
  if ((e.key === 'Enter' || e.key === 'Tab') && st.items.length) {
    e.preventDefault();
    pickFile(tile, st.active, e.key === 'Tab');
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeFileMenu(tile);
    return true;
  }
  return false;
}

// ---- attachments -------------------------------------------------------------------------------

const toBase64 = (f: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

const sizeText = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Adds files that passed the size and type rules; says why the others were skipped. */
function attach(tile: Tile, files: Attachment[], message = '') {
  const { ok, message: over } = screenAttachments(files, tile.attachments.reduce((n, a) => n + a.size, 0));
  tile.attachments.push(...ok);
  renderAttachments(tile);
  syncTile(tile);
  showError(tile, [message, over].filter(Boolean).join('\n'));
}

/** Pasted or dropped files: read in the page (the extension never sees a path). */
async function takeFiles(tile: Tile, list: File[]) {
  if (tile.agent === 'codex') return showError(tile, "Codex tiles don't take attachments yet");
  const read = await Promise.all(
    list.map(async (f) => {
      const type = attachmentType(f.name, f.type);
      return { name: f.name || 'pasted file', type: type ?? '', size: f.size, data: !type ? '' : type === 'text/plain' ? await f.text() : await toBase64(f) };
    }),
  );
  const known = read.filter((a) => a.type);
  attach(tile, known, read.length > known.length ? `Not attached (unsupported type): ${read.filter((a) => !a.type).map((a) => a.name).join(', ')}` : '');
}

function renderAttachments(tile: Tile) {
  tile.attachEl.hidden = !tile.attachments.length;
  tile.attachEl.replaceChildren(
    ...tile.attachments.map((a, i) =>
      h(
        'div',
        { class: 'attach-chip', title: `${a.name} · ${sizeText(a.size)}` },
        a.type.startsWith('image/') ? h('img', { class: 'attach-thumb', alt: '', src: `data:${a.type};base64,${a.data}` }) : icon('file'),
        h('span', { class: 'attach-name', text: a.name }),
        h('span', { class: 'attach-size', text: sizeText(a.size) }),
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            title: 'Remove',
            'aria-label': `Remove ${a.name}`,
            onclick: () => {
              tile.attachments.splice(i, 1);
              renderAttachments(tile);
              syncTile(tile);
            },
          },
          icon('close'),
        ),
      ),
    ),
  );
}

// ---- skills: autocomplete, browser, used-in-chat -----------------------------------------------

const skillPrefix = (tile: Tile) => agentInfo(tile.agent)?.skillPrefix ?? '/';
const skillScope = (tile: Tile) => (tile.draft ? tile.draft.cwd : tile.key);

/** Cached list, or undefined while it is being fetched (the menu refreshes when it arrives). */
function skillsFor(tile: Tile): SkillInfo[] | undefined {
  const k = `${tile.agent}|${skillScope(tile)}`;
  const hit = skillCache.get(k);
  if (hit) return hit;
  if (!skillWaiters.has(k)) {
    skillWaiters.set(k, new Set());
    post({ type: 'skills', agent: tile.agent, scope: skillScope(tile) });
  }
  skillWaiters.get(k)!.add(tile);
  return undefined;
}

// Browse order: project first, then plugins, your own, and the agent's built-ins.
function sourceRank(source: string) {
  return source === 'Project' ? 0 : source.startsWith('Plugin') ? 1 : source === 'Personal' ? 2 : 3;
}

function matchRank(s: SkillInfo, q: string) {
  const name = s.name.toLowerCase();
  if (name.startsWith(q)) return 0;
  if (name.split(':').pop()!.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  return 3;
}

function updateSkillMenu(tile: Tile) {
  const prefix = skillPrefix(tile);
  const ta = tile.input;
  const caret = ta.selectionStart ?? ta.value.length;
  const m = new RegExp(`(?:^|\\s)\\${prefix}([\\w:.-]*)$`).exec(ta.value.slice(0, caret));
  if (!m) return closeSkillMenu(tile);
  const query = m[1].toLowerCase();
  const start = caret - m[1].length - 1;
  const all = skillsFor(tile);
  if (!all) {
    tile.skillState = { items: [], active: 0, start, query };
    tile.skillMenu.hidden = false;
    tile.skillMenu.replaceChildren(h('div', { class: 'sk-empty', text: 'Loading skills…' }));
    return;
  }
  const items = query
    ? all
        .filter((s) => s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query))
        .sort((a, b) => matchRank(a, query) - matchRank(b, query) || a.name.localeCompare(b.name))
    : [...all].sort((a, b) => sourceRank(a.source) - sourceRank(b.source) || a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
  tile.skillState = { items, active: 0, start, query };
  renderSkillMenu(tile);
}

function renderSkillMenu(tile: Tile) {
  const st = tile.skillState;
  if (!st) return;
  const prefix = skillPrefix(tile);
  tile.skillMenu.hidden = false;
  if (!st.items.length) {
    tile.skillMenu.replaceChildren(h('div', { class: 'sk-empty', text: `No skills match “${st.query}”` }));
    return;
  }
  const rows: Node[] = [];
  let group = '';
  st.items.forEach((s, i) => {
    if (!st.query && s.source !== group) {
      group = s.source;
      rows.push(h('div', { class: 'sk-group', text: group }));
    }
    rows.push(
      h(
        'button',
        {
          class: `sk-item${i === st.active ? ' active' : ''}`,
          role: 'option',
          'aria-selected': String(i === st.active),
          title: s.description,
          onmousedown: (e: MouseEvent) => {
            e.preventDefault();
            pickSkill(tile, i);
          },
        },
        h('span', { class: 'sk-name', text: prefix + s.name }),
        h('span', { class: 'sk-desc', text: s.description }),
      ),
    );
  });
  tile.skillMenu.replaceChildren(...rows);
  tile.skillMenu.querySelector('.sk-item.active')?.scrollIntoView({ block: 'nearest' });
}

function closeSkillMenu(tile: Tile) {
  tile.skillState = undefined;
  tile.skillMenu.hidden = true;
}

function pickSkill(tile: Tile, i: number) {
  const st = tile.skillState;
  const s = st?.items[i];
  if (!st || !s) return;
  const ta = tile.input;
  const caret = ta.selectionStart ?? ta.value.length;
  const insert = `${skillPrefix(tile)}${s.name} `;
  ta.value = ta.value.slice(0, st.start) + insert + ta.value.slice(caret);
  const pos = st.start + insert.length;
  ta.setSelectionRange(pos, pos);
  closeSkillMenu(tile);
  autosize(ta);
  syncTile(tile);
  ta.focus();
}

/** Arrow keys, Enter/Tab and Escape drive the menu while it is open. */
function skillMenuKey(tile: Tile, e: KeyboardEvent): boolean {
  const st = tile.skillState;
  if (!st || tile.skillMenu.hidden) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!st.items.length) return false;
    e.preventDefault();
    st.active = (st.active + (e.key === 'ArrowDown' ? 1 : -1) + st.items.length) % st.items.length;
    renderSkillMenu(tile);
    return true;
  }
  if ((e.key === 'Enter' || e.key === 'Tab') && st.items.length) {
    e.preventDefault();
    pickSkill(tile, st.active);
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeSkillMenu(tile);
    return true;
  }
  return false;
}

/** The Skills chip: type the prefix at the caret, which opens the full list. */
function browseSkills(tile: Tile) {
  if (tile.input.disabled) return;
  const ta = tile.input;
  ta.focus();
  const caret = ta.selectionStart ?? ta.value.length;
  const before = ta.value.slice(0, caret);
  const insert = (before && !/\s$/.test(before) ? ' ' : '') + skillPrefix(tile);
  ta.value = before + insert + ta.value.slice(caret);
  ta.setSelectionRange(caret + insert.length, caret + insert.length);
  autosize(ta);
  syncTile(tile);
  updateSkillMenu(tile);
}

// ---- files strip + usage meter -----------------------------------------------------------------

function renderFiles(tile: Tile, files: FileStat[]) {
  const same = files.length === tile.files.length && files.every((f, i) => f.path === tile.files[i].path && f.adds === tile.files[i].adds && f.dels === tile.files[i].dels);
  if (same) return;
  tile.files = files;
  renderStrip(tile);
}

function renderSkillsUsed(tile: Tile, skills: string[]) {
  if (skills.length === tile.skillsUsed.length && skills.every((s, i) => s === tile.skillsUsed[i])) return;
  tile.skillsUsed = skills;
  renderStrip(tile);
}

function renderStrip(tile: Tile) {
  syncStrip(tile);
  const files = tile.files;
  const prefix = skillPrefix(tile);
  const out: Node[] = [];
  if (tile.skillsUsed.length) {
    const recent = tile.skillsUsed.slice(-3).reverse();
    const more = tile.skillsUsed.length - recent.length;
    out.push(
      h(
        'span',
        { class: 'skills-used', title: `Skills this chat used:\n${tile.skillsUsed.map((s) => prefix + s).join('\n')}` },
        icon('bolt'),
        recent.join(' · ') + (more ? ` +${more}` : ''),
      ),
    );
  }
  if (files.length) {
    const adds = files.reduce((n, f) => n + f.adds, 0);
    const dels = files.reduce((n, f) => n + f.dels, 0);
    out.push(
      h(
        'span',
        { class: 'files-sum' },
        `${files.length} file${files.length === 1 ? '' : 's'}`,
        h('span', { class: 'add', text: ` +${adds}` }),
        h('span', { class: 'del', text: ` −${dels}` }),
      ),
      // most recently first-edited last in the map → show newest first
      ...[...files].reverse().map((f) =>
        h(
          'button',
          { class: 'file-chip', title: `${f.path}\nClick to open the diff (HEAD ↔ now)`, onclick: () => post({ type: 'openDiff', path: f.path, key: tile.key }) },
          h('span', { class: 'file-name', text: basename(f.path) }),
          h('span', { class: 'add', text: `+${f.adds}` }),
          h('span', { class: 'del', text: `−${f.dels}` }),
        ),
      ),
    );
  }
  tile.filesList.replaceChildren(...out);
}

function syncStrip(tile: Tile) {
  tile.filesEl.hidden = !tile.files.length && !tile.skillsUsed.length && tile.meter.hidden && tile.cachePill.hidden && tile.continueBtn.hidden;
}

/**
 * Claude's prompt cache as a pill: minutes left while it is likely warm, a bare clock once it has lapsed. The host
 * works the times out of the transcript (see ClaudeParser.cache), so it is an estimate.
 */
function renderCache(tile: Tile, u?: Usage) {
  tile.cache = u?.cacheAt && u.cacheUntil ? { at: u.cacheAt, until: u.cacheUntil } : undefined;
  syncCache(tile);
}

function syncCache(tile: Tile) {
  const c = tile.cache;
  tile.cachePill.hidden = !c;
  if (c) {
    const now = Date.now();
    const cold = c.until <= now;
    const mins = Math.ceil((c.until - now) / 60_000);
    const tip = cold ? `Prompt cache likely expired (idle ${duration(now - c.at)})` : `Prompt cache warm, about ${mins} min left`;
    tile.cachePill.dataset.cold = String(cold);
    tile.cachePill.title = tip;
    tile.cachePill.setAttribute('aria-label', tip);
    (tile.cachePill.lastElementChild as HTMLElement).textContent = cold ? '' : `${mins}m`;
  }
  syncStrip(tile);
}

// ---- agents: footer pill + chat rows -----------------------------------------------------------

const agentOf = (key: string) => key.slice(0, key.indexOf(':')) as AgentId;

/** Like the Claude Code footer: a dot for the worst state and how many agents are working. Opens the Agent map. */
function syncPill(tile: Tile) {
  const working = tile.agents.filter((a) => a.status === 'working').length;
  const dot = working ? 'running' : tile.agents.some((a) => a.status === 'failed') ? 'failed' : 'idle';
  const label = `${working} agent${working === 1 ? '' : 's'}`;
  const tip = [{ running: 'Agents are working', failed: 'An agent failed', idle: '' }[dot], 'Click to open the agent map'].filter(Boolean).join(' · ');
  tile.agentsPill.hidden = !tile.agents.length;
  tile.agentsPill.dataset.agentsDot = dot;
  tile.agentsPill.title = tip;
  tile.agentsPill.setAttribute('aria-label', `${label} · ${tip}`);
  (tile.agentsPill.children[1] as HTMLElement).className = `am-dot am-dot-${dot}`;
  (tile.agentsPill.children[2] as HTMLElement).textContent = label;
}

function renderAgentsUsed(tile: Tile, agents: Tile['agents']) {
  if (JSON.stringify(agents) === JSON.stringify(tile.agents)) return;
  const before = new Map(tile.agents.map((a) => [a.id, a.status]));
  tile.agents = agents;
  syncPill(tile);
  // a row whose agent changed state without a new transcript line (it went quiet) needs redrawing
  for (const a of agents) {
    const entry = tile.items.get(a.id);
    if (!entry || before.get(a.id) === a.status) continue;
    const el = renderItem(entry.item, entry.el, tile.key);
    entry.el.replaceWith(el);
    entry.el = el;
  }
}

/** A sub-agent in the chat: one line, like any tool call. Click for its details in the Agent map. */
function agentLine(a: AgentItem, key: string): HTMLElement {
  const status: AgentStatus =
    tiles.get(key)?.agents.find((x) => x.id === a.id)?.status ?? (a.status === 'done' ? 'finished' : a.status === 'running' ? 'working' : a.status);
  const dot = status === 'working' ? 'running' : status === 'finished' ? 'idle' : 'failed';
  return h(
    'button',
    { type: 'button', class: 'agent-line', title: `${a.agentType} · ${a.description}\nClick for details`, onclick: () => agentMap.open(key, agentOf(key), a.id) },
    h('span', { class: `am-dot am-dot-${dot}` }),
    h('span', { class: 'agent-line-name', text: 'Agent' }),
    h('span', { class: 'agent-line-desc', text: a.description }),
    h('span', { class: 'agent-line-state', text: { working: 'Working…', finished: 'Finished', failed: 'Failed', stopped: 'Stopped' }[status] }),
  );
}

function tokens(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function renderMeter(tile: Tile, u?: Usage) {
  if (!u || (u.context == null && u.total == null)) {
    tile.meter.hidden = true;
    syncStrip(tile);
    return;
  }
  const pct = u.context && u.window ? Math.min(100, Math.round((u.context / u.window) * 100)) : undefined;
  const text = [pct !== undefined ? `${pct}%` : u.context ? `${tokens(u.context)} ctx` : '', u.total ? `${tokens(u.total)} tok` : '']
    .filter(Boolean)
    .join(' · ');
  const fill = h('span', { class: 'meter-fill' });
  if (pct !== undefined) fill.style.width = `${pct}%`;
  tile.meter.replaceChildren(pct !== undefined ? h('span', { class: 'meter-bar' }, fill) : '', h('span', { class: 'meter-text', text }));
  tile.meter.dataset.level = pct === undefined ? '' : pct >= 85 ? 'high' : pct >= 60 ? 'mid' : '';
  tile.ctxPct = pct;
  tile.continueBtn.hidden = tile.draft ? true : !offerHandoff(pct, lowUsage);
  tile.meter.title = [
    u.context != null
      ? `Context: ${u.context.toLocaleString()} tokens${u.window ? ` of ${u.window.toLocaleString()}` : ' (window size learned after the first reply sent from this studio)'}`
      : '',
    u.total ? `Session tokens: ${u.total.toLocaleString()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  tile.meter.hidden = false;
  syncStrip(tile);
}

function renderHead(tile: Tile) {
  tile.el.dataset.agent = tile.agent;
  const mark = h('span', { class: 'agent-pill', 'data-agent': tile.agent, text: agentLabel(tile.agent) });
  const maxBtn = h(
    'button',
    { class: 'icon-btn', title: 'Maximize', 'aria-label': 'Maximize', onclick: () => toggleMax(tile.key) },
    icon(maximized === tile.key ? 'collapse' : 'expand'),
  );
  const closeBtn = h('button', { class: 'icon-btn', title: 'Close tile', 'aria-label': 'Close tile', onclick: () => closeTile(tile.key) }, icon('close'));

  if (!tile.draft) {
    const renameBtn = h(
      'button',
      { class: 'icon-btn rename-btn', title: 'Rename chat', 'aria-label': 'Rename chat', onclick: () => startRename(tile) },
      icon('edit'),
    );
    tile.focusBtn = h(
      'button',
      { class: 'icon-btn', title: 'Focus view: hide tool calls', 'aria-label': 'Focus view: hide tool calls', onclick: () => setFocus(tile, !tile.focusView) },
      icon('eye'),
    );
    syncFocusBtn(tile);
    tile.head.replaceChildren(tile.grip, mark, tile.unreadDot, tile.needsEl, h('div', { class: 'head-text' }, tile.title, tile.sub), tile.dot, renameBtn, tile.focusBtn, maxBtn, closeBtn);
    return;
  }
  const agentSel = h(
    'select',
    {
      'aria-label': 'Agent',
      onchange: () => {
        tile.agent = agentSel.value as AgentId;
        tile.chrome = picked(tileChrome, tile.key, normalChrome(tile.agent)) ?? defaultChrome(tile.agent);
        closeSkillMenu(tile);
        const pet = createPet(tile.agent, wornCoats(tile), tile.key);
        tile.pet.el.replaceWith(pet.el);
        tile.pet = pet;
        watchPet(tile);
        renderHead(tile);
        modeOptions(tile);
        modelOptions(tile);
        effortOptions(tile);
        syncTile(tile);
      },
    },
    ...agents.map((a) => h('option', { value: a.id, text: a.label + (a.available ? '' : ' (not installed)'), selected: a.id === tile.agent })),
  );
  const folderSel = h(
    'select',
    {
      'aria-label': 'Folder',
      onchange: () => {
        if (folderSel.value === '__browse') {
          folderSel.value = tile.draft!.cwd;
          post({ type: 'pickFolder', draftKey: tile.key });
          return;
        }
        tile.draft!.cwd = folderSel.value;
        syncTile(tile);
      },
    },
    ...folders.map((f) => h('option', { value: f, text: basename(f), title: f, selected: f === tile.draft!.cwd })),
    h('option', { value: '__browse', text: 'Browse…' }),
  );
  tile.head.replaceChildren(
    tile.grip,
    h('div', { class: 'head-text' }, h('div', { class: 'tile-title', text: 'New chat' }), h('div', { class: 'draft-controls' }, agentSel, folderSel)),
    maxBtn,
    closeBtn,
  );
}

/** Inline rename in the tile header. Enter or click away saves, Escape cancels, empty restores the agent's title. */
function startRename(tile: Tile) {
  if (tile.draft || !tile.title.isConnected) return;
  const current = byKey.get(tile.key)?.title ?? '';
  const input = h('input', { class: 'rename', value: current, maxlength: 200, 'aria-label': 'Chat name', placeholder: 'Chat name' });
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    input.replaceWith(tile.title);
    if (save && value !== current) {
      post({ type: 'rename', key: tile.key, title: value });
      const s = byKey.get(tile.key);
      if (s && value) {
        s.title = value;
        renderList();
      }
    }
    syncTile(tile);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  tile.title.replaceWith(input);
  input.focus();
  input.select();
}

function syncTile(tile: Tile) {
  const s = byKey.get(tile.key);
  const info = agentInfo(tile.agent);
  const status = tile.running ? 'running' : s?.status ?? 'idle';
  tile.dot.dataset.status = status;
  tile.dot.title = statusText(status);
  tile.continueBtn.disabled = tile.running || !!tile.handoff;
  tile.continueBtn.textContent = tile.handoff ? 'Summarizing…' : 'Continue ↗';
  if (!tile.draft) {
    tile.title.textContent = s?.title ?? 'New chat';
    tile.title.title = s?.title ?? '';
    tile.sub.textContent = [
      s?.project,
      s && ago(s.updatedAt),
      tile.currentModel && modelLabel(tile.agent, tile.currentModel),
      tile.currentEffort && effortName(tile.agent, tile.currentEffort),
    ]
      .filter(Boolean)
      .join(' · ');
    tile.sub.title = s?.cwd ?? '';
  }
  const elsewhere = !tile.running && status === 'active';
  const available = !!info?.available;
  tile.input.placeholder = tile.draft
    ? `Start a ${agentLabel(tile.agent)} chat in ${basename(tile.draft.cwd) || 'a folder'}…`
    : `Reply to ${agentLabel(tile.agent)}…`;
  tile.input.disabled = !available;
  const hasText = !!tile.input.value.trim() || tile.attachments.length > 0 || unsent(tile.comments).length > 0;
  tile.wandBtn.disabled = !tile.input.value.trim() || !!tile.wand?.pending;
  tile.wandBtn.classList.toggle('busy', !!tile.wand?.pending);
  tile.wandBtn.hidden = !agentInfo('claude')?.available;
  tile.clipBtn.hidden = tile.agent === 'codex';
  const busy = tile.running || elsewhere;
  // While busy, the send button stays available as "queue" once there is text to queue.
  tile.sendBtn.hidden = tile.running && !hasText;
  tile.stopBtn.hidden = !tile.running;
  tile.sendBtn.disabled = !available || (!!tile.draft && !tile.draft.cwd) || (!hasText && (busy || !tile.queue.length));
  tile.sendBtn.title = busy ? 'Queue (Enter): sends when the agent is free' : hasText || !tile.queue.length ? 'Send (Enter)' : 'Send the next queued message';
  for (const chip of tile.chipsEl.children) (chip as HTMLButtonElement).disabled = !available || (!!tile.draft && !tile.draft.cwd);
  tile.mode.disabled = tile.running;
  tile.model.disabled = tile.running;
  tile.effort.disabled = tile.running;
  tile.chromeBtn.hidden = !info?.supportsChrome;
  tile.chromeBtn.disabled = tile.running;
  tile.chromeBtn.classList.toggle('on', tile.chrome);
  tile.chromeBtn.setAttribute('aria-pressed', String(tile.chrome));
  tile.working.hidden = !tile.running;
  const queued = tile.queue.length ? ` · ${tile.queue.length} queued` : '';
  tile.hint.textContent = !available
    ? `${agentLabel(tile.agent)} CLI not found`
    : tile.queuePaused && tile.queue.length && !busy
      ? 'Queue paused after an error · press Send to resume'
      : tile.running
        ? `${tile.asks.some((a) => a.state === 'pending') ? 'Waiting for your answer' : 'Working…'}${queued}`
        : elsewhere
          ? `Busy in another window${queued}`
          : '';
  tile.hint.dataset.tone = !available || elsewhere || (tile.queuePaused && tile.queue.length) ? 'warn' : '';
}

function autosize(t: HTMLTextAreaElement) {
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight, 180)}px`;
}

function openTile(key: string) {
  const existing = tiles.get(key);
  if (existing) {
    focusTile(existing);
    return;
  }
  const s = byKey.get(key);
  const agent = (s?.agent ?? key.slice(0, key.indexOf(':'))) as AgentId;
  const tile = buildTile(key, agent);
  tiles.set(key, tile);
  grid.prepend(tile.el);
  post({ type: 'openTile', key });
  syncChrome();
  renderList();
  focusTile(tile);
}

function newDraft(from?: Tile): Tile {
  const agent = from?.agent ?? (agents.find((a) => a.available) ?? agents[0])?.id ?? 'claude';
  const key = `draft:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tile = buildTile(key, agent, { cwd: (from && byKey.get(from.key)?.cwd) || folders[0] || '' });
  if (from) {
    // the new chat starts with the old one's mode, model and effort
    for (const f of ['mode', 'model', 'effort'] as const) tile[f].value = from[f].value;
    tile.chrome = from.chrome;
  }
  tiles.set(key, tile);
  grid.prepend(tile.el);
  syncChrome();
  focusTile(tile);
  tile.input.focus();
  return tile;
}

const lastReplyId = (tile: Tile) => [...tile.items.values()].reverse().find((e) => e.item.kind === 'assistant')?.item.id;

/** Asks the chat for a summary; when its turn ends, finishHandoff opens the new chat. */
function startHandoff(tile: Tile) {
  if (tile.running || tile.handoff) return;
  tile.handoff = { before: lastReplyId(tile) };
  dispatch(tile, SUMMARY_PROMPT);
  syncTile(tile);
}

/** The summary reaches the transcript a moment after the process exits, so look for it a few times. */
function finishHandoff(tile: Tile, tries = 0) {
  const h0 = tile.handoff;
  if (!h0) return;
  const summary = newestReply([...tile.items.values()].map((e) => e.item as { id: string; kind: string; text?: string }), h0.before);
  if (summary) {
    tile.handoff = undefined;
    const next = newDraft(tile);
    next.input.value = continuationText(summary);
    autosize(next.input);
    syncTile(next);
    syncTile(tile);
    flushQueue(tile);
  } else if (tries >= 12 || !tile.error.hidden) {
    tile.handoff = undefined; // the turn failed or no reply came: back to the button
    syncTile(tile);
    flushQueue(tile);
  } else {
    setTimeout(() => finishHandoff(tile, tries + 1), 500);
  }
}

function closeTile(key: string) {
  const tile = tiles.get(key);
  if (!tile) return;
  tile.el.remove();
  tile.resize.disconnect();
  tiles.delete(key);
  if (maximized === key) maximized = null;
  if (!tile.draft) post({ type: 'closeTile', key });
  syncChrome();
  renderList();
}

function toggleMax(key: string) {
  const prev = maximized;
  maximized = maximized === key ? null : key;
  for (const k of [prev, maximized]) {
    const t = k && tiles.get(k);
    if (t) {
      t.el.classList.toggle('max', maximized === k);
      renderHead(t);
    }
  }
  syncChrome();
}

function focusTile(tile: Tile) {
  if (maximized && maximized !== tile.key) toggleMax(maximized);
  tile.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  tile.el.classList.remove('flash');
  void tile.el.offsetWidth;
  tile.el.classList.add('flash');
}

/** From the message box: send, queue while busy, or (empty box) resume a paused queue. */
function submit(tile: Tile) {
  const text = tile.input.value.trim();
  if (!text && !tile.attachments.length && !unsent(tile.comments).length) {
    tile.queuePaused = false;
    renderQueue(tile);
    flushQueue(tile);
    return;
  }
  tile.input.value = '';
  autosize(tile.input);
  const attachments = tile.attachments.splice(0);
  renderAttachments(tile);
  clearWand(tile);
  const full = withComments(tile.comments, text);
  tile.comments = markSent(tile.comments);
  renderComments(tile);
  dispatch(tile, full, attachments);
}

function sendText(tile: Tile, text: string, attachments: Attachment[] = []) {
  showError(tile, '');
  const mode = tile.mode.value;
  const model = tile.model.value;
  const effort = tile.effort.value;
  const chrome = tile.chrome && !!agentInfo(tile.agent)?.supportsChrome;
  const files = attachments.length ? attachments : undefined;
  game.sent();
  if (tile.draft) post({ type: 'newChat', draftKey: tile.key, agent: tile.agent, cwd: tile.draft.cwd, text, mode, model, effort, chrome, attachments: files, pinned: ([['model', tileModels], ['effort', tileEfforts], ['chrome', tileChrome]] as const).filter(([, picks]) => picks[tile.key] !== undefined).map(([k]) => k) });
  else post({ type: 'send', key: tile.key, text, mode, model, effort, chrome, attachments: files });
  // the transcript will show attachments as [image] / [document]; match that so the pending bubble is replaced, not duplicated
  text = transcriptText(text, attachments);
  tile.pending?.el.remove();
  const el = h('div', { class: 'msg user pending' }, h('div', { class: 'bubble', text }));
  tile.list.querySelector('.placeholder')?.remove();
  tile.list.append(el);
  tile.pending = { el, text };
  setLastUser(tile, text, el);
  setRunning(tile, true);
  tile.msgs.scrollTop = tile.msgs.scrollHeight;
  scheduleOverlays(tile);
}

// ---- pinned last message + scroll-to-end ------------------------------------------------------

function setLastUser(tile: Tile, text: string, el: HTMLElement) {
  tile.lastUser = { text, el };
  tile.lastText.textContent = text;
}

function toggleLast(tile: Tile) {
  const expanded = tile.lastBar.classList.toggle('expanded');
  tile.lastMore.textContent = expanded ? 'Show less' : 'Show more';
  tile.lastMore.hidden = false;
}

function jumpToLast(tile: Tile) {
  const el = tile.lastUser?.el;
  if (!el?.isConnected) return;
  const top = tile.msgs.scrollTop + el.getBoundingClientRect().top - tile.msgs.getBoundingClientRect().top - 8;
  tile.msgs.scrollTo({ top, behavior: 'smooth' });
}

function scheduleOverlays(tile: Tile) {
  if (tile.frame) return;
  tile.frame = requestAnimationFrame(() => {
    tile.frame = 0;
    updateOverlays(tile);
  });
}

function updateOverlays(tile: Tile) {
  const m = tile.msgs;
  tile.jump.hidden = m.scrollHeight - m.scrollTop - m.clientHeight < 120;
  if (tile.unread && isWatching(tile)) setUnread(tile, false);

  // The bar only shows once the real message has scrolled above the view, so it is never on screen twice.
  const last = tile.lastUser;
  const above = !!last && (!last.el.isConnected || last.el.getBoundingClientRect().bottom < m.getBoundingClientRect().top + 4);
  tile.lastBar.hidden = !above;
  if (!above) {
    tile.lastBar.classList.remove('expanded');
    tile.lastMore.textContent = 'Show more';
    return;
  }
  if (!tile.lastBar.classList.contains('expanded')) {
    const t = tile.lastText;
    tile.lastMore.hidden = !(last!.text.includes('\n') || t.scrollWidth > t.clientWidth);
  }
}

function setRunning(tile: Tile, running: boolean) {
  const finished = tile.running && !running;
  tile.running = running;
  if (tile.focusView) layoutRows(tile); // the newest run's live label
  if (!running && tile.pending) {
    const p = tile.pending;
    // the transcript usually catches up within a tick of the process exiting
    setTimeout(() => tile.pending === p && (p.el.remove(), (tile.pending = undefined)), 4000);
  }
  syncTile(tile);
  if (finished) {
    if (!isWatching(tile)) setUnread(tile, true);
    // errors arrive before the run ends, so a visible error means this turn failed
    if (tile.error.hidden) tile.finishedAt = Date.now();
    tickFun();
    if (tile.handoff) finishHandoff(tile);
    else flushQueue(tile);
  }
}

function showError(tile: Tile, message: string) {
  tile.error.hidden = !message;
  tile.error.replaceChildren(
    h('span', { class: 'error-text', text: message }),
    h('button', { class: 'icon-btn', 'aria-label': 'Dismiss', onclick: () => showError(tile, '') }, icon('close')),
  );
}

// ---- transcript rendering ----------------------------------------------------------------------

function nearBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function pre(text: string, diff = false) {
  const el = h('pre', { class: diff ? 'code diff' : 'code' });
  if (!diff) {
    el.textContent = text;
    return el;
  }
  for (const line of text.split('\n')) {
    const cls = /^\+(?!\+\+)/.test(line) ? 'add' : /^-(?!--)/.test(line) ? 'del' : /^(@@|\*\*\*|⋯)/.test(line) ? 'hunk' : '';
    el.append(h('span', { class: cls, text: line + '\n' }));
  }
  return el;
}

function timeEl(ts?: number) {
  if (!ts) return null;
  const d = new Date(ts);
  return h('time', { class: 'msg-time', datetime: d.toISOString(), title: d.toLocaleString(), text: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) });
}

/** A small Copy button; the extension writes the clipboard, which works reliably inside a webview. */
function copyBtn(text: () => string, label: string, caption = '') {
  const face = (name: string, word: string) => (word ? [icon(name), h('span', { text: word })] : [icon(name)]);
  let timer: number | undefined;
  const btn = h(
    'button',
    {
      type: 'button',
      class: 'copy-btn',
      title: label,
      'aria-label': label,
      onclick: () => {
        post({ type: 'copy', text: text() });
        btn.classList.add('done');
        btn.setAttribute('aria-label', 'Copied');
        btn.replaceChildren(...face('check', caption && 'Copied'));
        clearTimeout(timer);
        timer = window.setTimeout(() => {
          btn.classList.remove('done');
          btn.setAttribute('aria-label', label);
          btn.replaceChildren(...face('copy', caption));
        }, 1500);
      },
    },
    ...face('copy', caption),
  );
  return btn;
}

/** Wraps a block (in place when it is already in the page) so a Copy button shows at its top-right on hover or focus. */
function copyable(block: HTMLElement, text: () => string) {
  const wrap = h('div', { class: 'copy-wrap' });
  block.replaceWith(wrap);
  wrap.append(block, copyBtn(text, 'Copy code'), shelfAddBtn(() => ({ kind: 'code', text: text(), lang: /language-([\w+-]+)/.exec(block.querySelector('code')?.className ?? '')?.[1] })));
  return wrap;
}

/** Markdown in a div, with a Copy button on every code block. */
function mdDiv(cls: string, text: string) {
  const el = h('div', { class: cls, html: md(text) });
  for (const code of el.querySelectorAll('pre > code')) copyable(code.parentElement!, () => code.textContent ?? '');
  return el;
}

function lazyDetails(cls: string, summary: Node[], fill: () => Child[], open = false) {
  const body = h('div', { class: 'details-body' });
  const d = h('details', { class: cls }, h('summary', {}, ...summary), body);
  let filled = false;
  const ensure = () => {
    if (filled || !d.open) return;
    filled = true;
    body.append(...(fill().filter(Boolean) as Node[]));
  };
  d.addEventListener('toggle', ensure);
  if (open) {
    d.open = true;
    ensure();
  }
  return d;
}

function renderItem(item: ChatItem, prev: HTMLElement | undefined, key: string): HTMLElement {
  const wasOpen = prev instanceof HTMLDetailsElement && prev.open;
  switch (item.kind) {
    case 'agent':
      return agentLine(item, key);
    case 'user': {
      const bubble = h('div', { class: 'bubble', text: item.text });
      if (item.text.length > 600 || item.text.split('\n').length > 10) {
        bubble.classList.add('clamp');
        bubble.title = 'Click to expand';
        bubble.addEventListener('click', () => bubble.classList.remove('clamp'), { once: true });
      }
      return h('div', { class: 'msg user' }, timeEl(item.ts), bubble, arrange.messageGrip(() => item.text, () => byKey.get(key)?.title ?? ''));
    }
    case 'assistant': {
      const el = mdDiv('msg assistant md', item.text);
      el.append(h('div', { class: 'msg-foot' }, timeEl(item.ts), copyBtn(() => item.text, 'Copy reply', 'Copy'), shelfAddBtn(() => ({ kind: 'text', text: item.text, from: byKey.get(key)?.title }))), arrange.messageGrip(() => item.text, () => byKey.get(key)?.title ?? ''));
      const owner = tiles.get(key);
      if (owner) attachPointComments(owner, el, item.id);
      return el;
    }
    case 'thinking':
      return lazyDetails('thinking', [h('span', { text: 'Thinking' })], () => [mdDiv('md', item.text)], wasOpen);
    case 'note':
      return h('div', { class: `note${item.tone === 'error' ? ' error' : ''}`, text: item.text });
    case 'todo': {
      const done = item.items.filter((t) => t.status === 'completed').length;
      return h(
        'div',
        { class: 'todos' },
        h('div', { class: 'todos-head' }, h('span', { text: 'Todos' }), h('span', { class: 'todos-count', text: `${done}/${item.items.length}` })),
        h(
          'ul',
          { class: 'todos-list' },
          ...item.items.map((t) =>
            h(
              'li',
              { class: `todo ${t.status}` },
              h('span', { class: 'todo-box', role: 'img', 'aria-label': t.status.replace('_', ' ') }, t.status === 'completed' ? icon('check') : null),
              h('span', { class: 'todo-text', text: t.text }),
            ),
          ),
        ),
      );
    }
    case 'plan':
      return planCard(item, prev);
    case 'question':
      return questionCard(item);
    case 'compact': {
      const head = ['Compacted chat', item.trigger, item.preTokens ? `${tokens(item.preTokens)} tokens freed` : ''].filter(Boolean).join(' · ');
      if (!item.text) return h('div', { class: 'note', text: head });
      return lazyDetails('compact', [h('span', { text: head })], () => [mdDiv('md', item.text)], wasOpen);
    }
    case 'tool': {
      const state = item.output === undefined ? 'pending' : item.isError ? 'error' : 'ok';
      return lazyDetails(
        `tool ${state}`,
        [
          h('span', { class: 'tool-dot', 'aria-hidden': 'true' }),
          h('span', { class: 'tool-name', text: item.name }),
          h('span', { class: 'tool-sum', text: item.summary }),
        ],
        () => [
          item.result ? h('div', { class: 'io-result', text: item.result }) : null,
          item.input ? (item.name === 'Bash' || item.name === 'Shell' ? copyable(pre(item.input), () => item.input) : pre(item.input, item.diff)) : null,
          item.output === undefined
            ? h('div', { class: 'io-pending', text: 'Running…' })
            : h('div', { class: 'io' }, h('div', { class: 'io-label', text: item.isError ? 'Error' : 'Output' }), pre(item.output || '(no output)')),
        ],
        wasOpen,
      );
    }
  }
}

const PLAN_STATUS = { waiting: 'Waiting for approval', approved: 'Approved', kept: 'Stayed in plan mode' };
const PLAN_COLLAPSE_LINES = 12;

/** Claude's plan from ExitPlanMode, read-only: the markdown (folded when long) and how it was answered. */
function planCard(item: PlanItem, prev?: HTMLElement) {
  const long = item.plan.split('\n').length > PLAN_COLLAPSE_LINES;
  const expanded = !!prev?.classList.contains('expanded');
  const more = h('button', {
    type: 'button',
    class: 'card-more',
    hidden: !long,
    'aria-expanded': String(expanded),
    onclick: () => {
      const on = card.classList.toggle('expanded');
      more.textContent = on ? 'Show less' : 'Show more';
      more.setAttribute('aria-expanded', String(on));
    },
    text: expanded ? 'Show less' : 'Show more',
  });
  const card = h(
    'div',
    { class: `card plan${long ? ' long' : ''}${expanded ? ' expanded' : ''}` },
    h('div', { class: 'card-head' }, icon('plan'), h('span', { class: 'card-title', text: "Claude's Plan" }), item.file && h('span', { class: 'card-file', title: item.file, text: item.file })),
    mdDiv('card-body md', item.plan),
    more,
    h('div', { class: 'card-status', 'data-status': item.status, text: PLAN_STATUS[item.status] }),
  );
  return card;
}

/** One question of an AskUserQuestion: its options as radio or checkbox rows, the picked ones lit, typed text under Other. */
function questionBlock(q: QuestionEntry) {
  const mark = (on: boolean) =>
    h('span', { class: `q-mark ${q.multiSelect ? 'check' : 'radio'}${on ? ' on' : ''}`, role: 'img', 'aria-label': on ? 'selected' : 'not selected' }, on && q.multiSelect && icon('check'));
  const row = (on: boolean, label: string, desc?: string, cls = '') =>
    h('li', { class: `q-opt${on ? ' chosen' : ''}${cls}` }, mark(on), h('span', { class: 'q-opt-text' }, h('span', { class: 'q-label', text: label }), desc && h('span', { class: 'q-desc', text: desc })));
  return h(
    'div',
    { class: 'q' },
    h('div', { class: 'q-head' }, q.header && h('span', { class: 'q-chip', text: q.header }), h('span', { class: 'q-text', text: q.question })),
    h('ul', { class: 'q-opts' }, ...q.options.map((o) => row(!!q.chosen?.includes(o.label), o.label, o.description)), q.other && row(true, 'Other', q.other, ' other')),
  );
}

/** Claude's AskUserQuestion, read-only: answered cards fold under a summary (open by default); the rest show a status line. */
function questionCard(item: QuestionItem) {
  const n = item.questions.length;
  const list = h('div', { class: 'q-list' }, ...item.questions.map(questionBlock));
  const note = { waiting: 'Waiting for an answer', none: 'No answer', declined: 'Declined' } as Record<string, string>;
  const body =
    item.status === 'answered'
      ? h(
          'details',
          { class: 'q-answered', open: true },
          h('summary', { text: `Answered · ${n} question${n === 1 ? '' : 's'}` }),
          list,
          item.text && h('div', { class: 'io' }, h('div', { class: 'io-label', text: 'Result' }), pre(item.text)),
        )
      : h(
          'div',
          {},
          list,
          h('div', { class: 'card-status', 'data-status': item.status, text: note[item.status] }),
          item.reason && h('div', { class: 'card-reason', text: `Reason: ${item.reason}` }),
        );
  return h('div', { class: 'card question' }, h('div', { class: 'card-head' }, icon('question'), h('span', { class: 'card-title', text: n === 1 ? 'Question' : 'Questions' })), body);
}

/** A finished, successful Read: its file and the lines asked for (offset/limit), read back from the tool input. */
function readOf(item: ChatItem) {
  if (item.kind !== 'tool' || item.name !== 'Read' || item.output === undefined || item.isError) return undefined;
  try {
    const { file_path: path, offset, limit } = JSON.parse(item.input);
    if (typeof path !== 'string') return undefined;
    const from = Number(offset) || 0;
    const lines = Number(limit) > 0 ? `lines ${from || 1}-${(from || 1) + Number(limit) - 1}` : from ? `from line ${from}` : '';
    return { path, from, lines };
  } catch {
    return undefined;
  }
}

/** One row for a run of Reads: "Read a.ts (lines 10-40), b.ts". Each file opens through the document-wide link handler. */
function readRow(reads: NonNullable<ReturnType<typeof readOf>>[]) {
  const sum = h('span', { class: 'tool-sum' });
  reads.forEach((r, i) =>
    sum.append(i ? ', ' : '', h('a', { href: encodeURI(r.path) + (r.from ? `:${r.from}` : ''), title: r.path, text: basename(r.path) }), r.lines && ` (${r.lines})`),
  );
  return h('div', { class: 'tool-merged' }, h('span', { class: 'tool-dot', 'aria-hidden': 'true' }), h('span', { class: 'tool-name', text: 'Read' }), sum);
}

/**
 * Runs of two or more finished Reads show as one row on the first call. The others stay in the page, hidden,
 * so every item still has exactly one row and updates by id never duplicate anything.
 */
function mergeReads(tile: Tile) {
  const flush = (run: Entry[]) => {
    for (const e of run.slice(1)) e.hide = 'merged';
    const sig = run.map((e) => e.item.id).join();
    if (run.length < 2 || run[0].merged === sig) return;
    const row = readRow(run.map((e) => readOf(e.item)!));
    run[0].el.replaceWith(row);
    run[0].el = row;
    run[0].merged = sig;
  };
  let run: Entry[] = [];
  for (const e of tile.items.values()) {
    if (readOf(e.item)) run.push(e);
    else {
      flush(run);
      run = [];
    }
  }
  flush(run);
}

// ---- Focus view + row visibility ---------------------------------------------------------------

/**
 * The one place that decides which rows show. A row hides for at most one reason (`Entry.hide`): it was merged into
 * the Read row before it, or Focus view folded its run. Merging goes first, so a folded run that is opened again
 * keeps its Reads merged.
 */
function layoutRows(tile: Tile) {
  for (const e of tile.items.values()) e.hide = undefined;
  mergeReads(tile);
  foldRuns(tile);
  for (const e of tile.items.values()) e.el.hidden = !!e.hide;
}

/** Tool calls, thinking and every todo list but the newest fold away; replies, notes, compactions and sub-agents stay. */
function foldRuns(tile: Tile) {
  const seen = new Set<string>();
  if (tile.focusView) {
    const all = [...tile.items.values()];
    let newestTodo: Entry | undefined;
    for (const e of all) if (e.item.kind === 'todo') newestTodo = e;
    const live = tile.running || byKey.get(tile.key)?.status === 'active';
    let run: Entry[] = [];
    // only the run that reaches the newest item can be the one still working
    const close = (last: boolean) => {
      if (run.length) foldRun(tile, run, live && last, seen);
      run = [];
    };
    for (const e of all) {
      const k = e.item.kind;
      if (k === 'tool' || k === 'thinking' || (k === 'todo' && e !== newestTodo)) run.push(e);
      else close(false);
    }
    close(true);
  }
  for (const [key, f] of tile.folds) {
    if (seen.has(key)) continue;
    f.head.remove();
    f.end.remove();
    tile.folds.delete(key);
  }
}

function foldRun(tile: Tile, run: Entry[], live: boolean, seen: Set<string>) {
  const key = run[0].item.id; // a run keeps its key while it grows at the end
  seen.add(key);
  let fold = tile.folds.get(key);
  if (!fold) tile.folds.set(key, (fold = newFold(tile, key)));
  const open = tile.foldOpen.has(key);
  if (!open) for (const e of run) e.hide ??= 'folded';

  const tools = run.flatMap((e) => (e.item.kind === 'tool' ? [e.item] : []));
  const failed = tools.filter((t) => t.isError).length;
  const running = live ? tools.filter((t) => t.output === undefined).pop() : undefined;
  const steps = run.length;
  const counts = tools.length
    ? `${tools.length} tool call${tools.length === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`
    : run.every((e) => e.item.kind === 'thinking')
      ? 'Thinking'
      : `${steps} hidden step${steps === 1 ? '' : 's'}`;
  const { head } = fold;
  head.dataset.live = String(live);
  head.dataset.failed = String(failed > 0);
  head.setAttribute('aria-expanded', String(open));
  head.title = open ? 'Click to fold these steps' : 'Click to show these steps';
  // text only when it changed, so a redraw while streaming doesn't disturb a selection
  const text = (el: Element, t: string) => el.textContent !== t && (el.textContent = t);
  text(head.children[1], running ? `Running ${running.name}…` : counts);
  text(head.children[2], running ? counts : '');
  if (head.nextElementSibling !== run[0].el) run[0].el.before(head);
  fold.end.hidden = !open;
  if (open && fold.end.previousElementSibling !== run[run.length - 1].el) run[run.length - 1].el.after(fold.end);
}

function newFold(tile: Tile, key: string): Fold {
  const toggle = (open: boolean) => {
    const stick = nearBottom(tile.msgs);
    if (open) tile.foldOpen.add(key);
    else tile.foldOpen.delete(key);
    layoutRows(tile);
    if (stick) tile.msgs.scrollTop = tile.msgs.scrollHeight;
    else if (!open) head.scrollIntoView({ block: 'nearest' });
    scheduleOverlays(tile);
  };
  const head = h(
    'button',
    { type: 'button', class: 'fold', onclick: () => toggle(!tile.foldOpen.has(key)) },
    h('span', { class: 'tool-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'fold-text' }),
    h('span', { class: 'fold-more' }),
  );
  const end = h('button', { type: 'button', class: 'fold fold-end', hidden: true, onclick: () => toggle(false) }, 'Collapse');
  return { head, end };
}

function syncFocusBtn(tile: Tile) {
  tile.focusBtn?.setAttribute('aria-pressed', String(tile.focusView));
}

function setFocus(tile: Tile, on: boolean) {
  tile.focusView = on;
  tileFocus[tile.key] = on;
  if (!tile.draft) post({ type: 'setFocus', key: tile.key, focus: on });
  refocus(tile);
}

/** Redraw after Focus view changed, staying at the end if the tile was there. */
function refocus(tile: Tile) {
  const stick = nearBottom(tile.msgs);
  syncFocusBtn(tile);
  layoutRows(tile);
  if (stick) tile.msgs.scrollTop = tile.msgs.scrollHeight;
  scheduleOverlays(tile);
}

/** The date divider that goes before an item on a new local day, if any. */
function dayDivider(tile: Tile, ts?: number) {
  if (!ts) return null;
  const d = new Date(ts);
  const day = d.toDateString();
  if (day === tile.lastDay) return null;
  tile.lastDay = day;
  const year = d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric';
  return h('div', { class: 'day-divider', text: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year }) });
}

function applyItems(tile: Tile, items: ChatItem[], reset: boolean, hidden: number) {
  const first = !tile.loaded;
  const watching = isWatching(tile);
  const fresh = !reset && items.some((i) => i.kind !== 'user' && !tile.items.has(i.id));
  const stick = first || nearBottom(tile.msgs);
  const fromBottom = tile.msgs.scrollHeight - tile.msgs.scrollTop;
  if (reset) {
    tile.items.clear();
    tile.folds.clear();
    tile.lastDay = undefined;
    tile.list.replaceChildren();
    if (tile.pending) tile.list.append(tile.pending.el);
  }
  tile.list.querySelector('.placeholder')?.remove();
  for (const item of items) {
    const prev = tile.items.get(item.id);
    const el = renderItem(item, prev?.el, tile.key);
    if (prev) prev.el.replaceWith(el);
    else {
      const before = tile.pending?.el.isConnected ? tile.pending.el : null;
      const divider = dayDivider(tile, item.ts);
      if (divider) tile.list.insertBefore(divider, before);
      tile.list.insertBefore(el, before);
    }
    if (!prev) tile.lastItemId = item.id;
    tile.items.set(item.id, { item, el });
    if (item.kind === 'user') {
      if (tile.pending && item.text.trim() === tile.pending.text) {
        tile.pending.el.remove();
        tile.pending = undefined;
      }
      if (!tile.pending) setLastUser(tile, item.text, el);
    }
  }
  layoutRows(tile);
  if (!tile.items.size && !tile.pending) tile.list.append(h('div', { class: 'placeholder', text: 'No messages yet.' }));
  tile.earlier.hidden = hidden === 0;
  tile.earlier.textContent = `Show earlier messages (${hidden})`;
  tile.loaded = true;
  if (stick) tile.msgs.scrollTop = tile.msgs.scrollHeight;
  else if (reset) tile.msgs.scrollTop = tile.msgs.scrollHeight - fromBottom;
  if (fresh && !watching) setUnread(tile, true);
  scheduleOverlays(tile);
}

// ---- messages from the extension ---------------------------------------------------------------

function setSessions(next: SessionSummary[]) {
  sessions = next;
  byKey.clear();
  for (const s of next) byKey.set(s.key, s);
  renderList();
  for (const t of tiles.values()) {
    syncTile(t);
    flushQueue(t); // a session that was busy in another window may be free now
    if (t.focusView) layoutRows(t); // working or not may have changed
  }
}

window.addEventListener('message', (e: MessageEvent<ToWebview>) => {
  const m = e.data;
  switch (m.type) {
    case 'init': {
      agents = m.agents;
      folders = m.folders;
      tileModes = m.tileModes;
      tileModels = m.tileModels ?? {};
      tileChrome = m.tileChrome ?? {};
      tileEfforts = m.tileEfforts ?? {};
      tileFocus = m.tileFocus ?? {};
      focusDefault = m.focusView ?? false;
      game.init(m.game, m.gameOn, m.gameFloaters);
      layoutsUi.set(m.layouts ?? []);
      shelf.set(m.shelf ?? []);
      commentaryOn = m.commentary ?? true;
      lowUsage = m.lowUsage ?? false;
      settingsUi.set(m.settings ?? {});
      cats = m.cats ?? {};
      servers.start();
      prompts = m.prompts ?? [];
      setTimestamps(m.showTimestamps);
      layout = m.layout;
      for (const t of tiles.values()) t.el.remove();
      tiles.clear();
      setSessions(m.sessions);
      for (const key of [...m.open].reverse()) {
        const s = byKey.get(key);
        const tile = buildTile(key, (s?.agent ?? key.slice(0, key.indexOf(':'))) as AgentId);
        tile.running = s?.status === 'running';
        tiles.set(key, tile);
        grid.prepend(tile.el);
        syncTile(tile);
      }
      applyLayout();
      syncChrome();
      renderList();
      return;
    }
    case 'timestamps':
      setTimestamps(m.show);
      return;
    case 'servers':
      servers.set(m.projects);
      return;
    case 'improved': {
      const tile = tiles.get(m.key);
      if (tile) gotImproved(tile, m.text, m.error);
      return;
    }
    case 'layouts':
      layoutsUi.set(m.list);
      return;
    case 'settings':
      settingsUi.set(m.values);
      return;
    case 'agents':
      agents = m.agents;
      refreshDefaults();
      return;
    case 'commentary':
      commentaryOn = m.on;
      return;
    case 'codexUsage':
      codexUsage = m.usage;
      renderUsage();
      return;
    case 'gameConfig':
      game.config(m.on, m.floaters);
      return;
    case 'focusView':
      focusDefault = m.on;
      for (const t of tiles.values()) {
        if (tileFocus[t.key] !== undefined) continue;
        t.focusView = focusDefault;
        refocus(t);
      }
      return;
    case 'sessions':
      setSessions(m.sessions);
      return;
    case 'items': {
      const tile = tiles.get(m.key);
      if (!tile) return;
      applyItems(tile, m.items, m.reset, m.hidden);
      if (m.files) renderFiles(tile, m.files);
      if (m.skills) renderSkillsUsed(tile, m.skills);
      if (m.agents) renderAgentsUsed(tile, m.agents);
      if (m.usage) {
        renderMeter(tile, m.usage);
        renderCache(tile, m.usage);
      }
      if ((m.model && m.model !== tile.currentModel) || (m.effort && m.effort !== tile.currentEffort)) {
        tile.currentModel = m.model ?? tile.currentModel;
        tile.currentEffort = m.effort ?? tile.currentEffort;
        syncTile(tile);
      }
      return;
    }
    case 'running': {
      const tile = tiles.get(m.key);
      if (tile) setRunning(tile, m.running);
      return;
    }
    case 'error': {
      const tile = tiles.get(m.key);
      if (!tile) return;
      showError(tile, m.message);
      tile.pending?.el.classList.add('failed');
      // Don't feed the next queued message into a failing session; Send resumes it.
      if (tile.queue.length) {
        tile.queuePaused = true;
        renderQueue(tile);
        syncTile(tile);
      }
      return;
    }
    case 'recap':
      renderRecap(m.recap);
      return;
    case 'agentLog':
      agentMap.log(m);
      return;
    case 'agentMap':
      agentMap.update(m);
      return;
    case 'asks': {
      const t = tiles.get(m.key);
      if (t) renderAsks(t, m.asks);
      return;
    }
    case 'accountUsage':
      accountUsage = m;
      renderUsage();
      return;
    case 'files': {
      for (const t of tiles.values()) {
        if (t.fileState?.id !== m.id) continue;
        t.fileState.items = m.files;
        t.fileState.loading = false;
        renderFileMenu(t);
      }
      return;
    }
    case 'attachments': {
      const t = tiles.get(m.key);
      if (t) attach(t, m.files, m.message);
      return;
    }
    case 'agentStop':
      agentMap.stopped(m);
      return;
    case 'skills': {
      const k = `${m.agent}|${m.scope}`;
      skillCache.set(k, m.skills);
      for (const t of skillWaiters.get(k) ?? []) if (t.skillState) updateSkillMenu(t);
      skillWaiters.delete(k);
      return;
    }
    case 'bound': {
      const tile = tiles.get(m.draftKey);
      if (!tile) return;
      tiles.delete(m.draftKey);
      tile.key = m.key;
      tile.draft = undefined;
      tile.el.dataset.key = m.key;
      if (cats[m.draftKey]) {
        cats[m.key] = cats[m.draftKey];
        delete cats[m.draftKey];
        post({ type: 'setCat', key: m.key, cat: cats[m.key] });
      }
      tileModes[m.key] = tile.mode.value;
      // a pick is what differs from the current defaults, so low usage mode can still hand the rest back
      if (tileModels[m.draftKey] !== undefined || tile.model.value !== defaultModel(tile.agent)) tileModels[m.key] = tile.model.value;
      if (tileChrome[m.draftKey] !== undefined || tile.chrome !== defaultChrome(tile.agent)) tileChrome[m.key] = tile.chrome;
      if (tileEfforts[m.draftKey] !== undefined || tile.effort.value !== defaultEffort(tile.agent)) tileEfforts[m.key] = tile.effort.value;
      tiles.set(m.key, tile);
      if (maximized === m.draftKey) maximized = m.key;
      renderHead(tile);
      syncTile(tile);
      renderList();
      return;
    }
    case 'folderPicked': {
      const tile = tiles.get(m.draftKey);
      if (!tile?.draft) return;
      if (!folders.includes(m.path)) folders = [m.path, ...folders];
      tile.draft.cwd = m.path;
      renderHead(tile);
      syncTile(tile);
      return;
    }
    case 'focus': {
      const tile = tiles.get(m.key);
      if (tile) focusTile(tile);
      return;
    }
  }
});

// Links in markdown open in VS Code (files) or the browser (web).
document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest?.('a');
  const href = a?.getAttribute('href');
  if (!a || !href) return;
  e.preventDefault();
  // VS Code's webview script opens any clicked link from a window listener that ignores preventDefault: stop it there, or links open twice
  e.stopPropagation();
  const key = a.closest<HTMLElement>('.tile')?.dataset.key;
  post({ type: 'openLink', href, key });
});

// ---- keyboard ----------------------------------------------------------------------------------

let zen = false;
function toggleZen() {
  zen = !zen;
  app.classList.toggle('zen', zen);
  post({ type: 'deckFullscreen' });
}

const sheet = h(
  'div',
  { class: 'sheet', role: 'dialog', 'aria-label': 'Keyboard shortcuts', hidden: true, onclick: (e: Event) => e.target === sheet && toggleSheet(false) },
  h(
    'div',
    { class: 'sheet-card' },
    h('div', { class: 'srv-head' }, h('span', { text: 'Keyboard shortcuts' }), h('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close', onclick: () => toggleSheet(false) }, icon('close'))),
    ...SHORTCUTS.map((k) => h('div', { class: 'sheet-row' }, h('kbd', { text: k.keys }), h('span', { text: k.what }))),
  ),
);
app.append(sheet);
function toggleSheet(open = sheet.hidden) {
  sheet.hidden = !open;
}

const screenTiles = () => [...grid.querySelectorAll<HTMLElement>(':scope > .tile')].map((el) => tiles.get(el.dataset.key!)).filter((t): t is Tile => !!t);
const goTo = (t: Tile | undefined) => {
  if (!t) return;
  focusTile(t);
  t.input.focus();
};

document.addEventListener('keydown', (e) => {
  const act = actionOf(e, e.getModifierState('AltGraph'));
  if (act) {
    const key = (e.target as Element).closest?.<HTMLElement>('.tile')?.dataset.key;
    const here = (key && tiles.get(key)) || (activeTile && tiles.get(activeTile.key) === activeTile ? activeTile : undefined);
    const all = screenTiles();
    const i = here ? all.indexOf(here) : -1;
    e.preventDefault();
    switch (act.action) {
      case 'max':
        if (here) toggleMax(here.key);
        break;
      case 'zen':
        toggleZen();
        break;
      case 'tile':
        goTo(all[act.n! - 1]);
        break;
      case 'left':
      case 'right':
      case 'up':
      case 'down': {
        if (!all.length) break;
        const j = neighbour(Math.max(i, 0), all.length, layout.columns, act.action);
        if (act.shift) here && arrange.shift(here.key, j - i);
        else goTo(all[j]);
        break;
      }
      case 'new':
        newDraft();
        break;
      case 'close':
        if (here) closeTile(here.key);
        break;
      case 'sidebar':
        toggleSidebar();
        break;
      case 'usage':
        toggleUsage();
        break;
      case 'help':
        toggleSheet();
        break;
      case 'shelf':
        shelf.toggle();
        break;
      case 'settings':
        settingsUi.toggle();
        break;
    }
    return;
  }
  if (e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey && e.code === 'KeyF') {
    const key = (e.target as Element).closest?.<HTMLElement>('.tile')?.dataset.key;
    const tile = (key && tiles.get(key)) || (activeTile && tiles.get(activeTile.key) === activeTile ? activeTile : undefined);
    if (tile && !tile.draft) {
      e.preventDefault();
      setFocus(tile, !tile.focusView);
    }
    return;
  }
  if (e.key !== 'Escape') return;
  if (settingsUi.isOpen()) settingsUi.toggle(false);
  else if (shelf.isOpen() && !catCard) shelf.toggle(false);
  else if (catCard) closeCatCard();
  else if (!sheet.hidden) toggleSheet(false);
  else if (!recapEl.hidden) hideRecap();
  else if (maximized) toggleMax(maximized);
  else if (zen) toggleZen();
});

setInterval(() => {
  renderList();
  renderUsage();
  for (const t of tiles.values()) syncTile(t);
}, 30_000);

applyLayout();
syncChrome();
post({ type: 'ready' });
