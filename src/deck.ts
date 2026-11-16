import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { safeJson, type RunOptions, type TranscriptParser } from './adapters/common';
import { resolveBinary } from './binaries';
import { findFiles, readAttachments, rgFrom } from './files';
import { agentStatus, buildAgentMap, claudeAgentFile, codexAgentFile, type AgentFile } from './agents';
import { cleanCat, loadGame, type GameState } from './game';
import { scanServers } from './servers';
import { latestCodexUsage } from './codexUsage';
import { improvePrompt } from './improve';
import { cleanShelf } from './shelf';
import { Asks, answerLines, cancelledId, parseAsk } from './asks';
import { mergeLimitEvent } from './limits';
import { Runner, type LiveSpec } from './runner';
import { fetchUsage } from './usage';
import { listSkills } from './skills';
import { ADAPTERS, SessionIndex, splitKey } from './store';
import { TailReader } from './tail';
import type { AccountUsage, AgentId, AgentInfo, AgentItem, Attachment, CatPrefs, FileStat, FromWebview, Layout, ModeOption, SavedLayout, ProjectServers, PromptChip, Recap, SessionStatus, ToWebview } from './types';

const VIEW_TYPE = 'vibeStudio';
const STATE_KEY = 'vibeStudio.state';
const GAME_KEY = 'vibeStudio.game';
const SHELF_KEY = 'vibeStudio.shelf';
const WINDOWS_KEY = 'vibeStudio.contextWindows';
const DEFAULT_PROMPTS: PromptChip[] = [
  { label: 'Review staged', prompt: 'Review the staged changes (git diff --cached) for bugs, regressions and missed edge cases. Do not modify anything.' },
  { label: 'Commit message', prompt: 'Write a git commit message for the staged changes.' },
  { label: 'Typecheck + lint', prompt: "Run this project's typecheck and lint, then fix any errors your changes introduced." },
  { label: 'Continue', prompt: 'Continue.' },
];
const PAGE = 150;
const ACTIVE_MS = 15_000;
const NEW_SESSION_WAIT_MS = 120_000;

// Lives with the extension, not the panel, so closing Vibe Studio never kills a running turn.
const runner = new Runner();
export const disposeRunner = () => runner.dispose();

interface Persisted {
  open: string[];
  layout: Layout;
  modes: Record<string, string>;
  models: Record<string, string>;
  chrome: Record<string, boolean>;
  efforts: Record<string, string>;
  /** Focus view per tile; tiles with no entry follow vibeStudio.focusView. */
  focus: Record<string, boolean>;
  /** Saved arrangements of open chats. */
  layouts: SavedLayout[];
  /** Each chat's cat: name, coat, hat, neckwear. */
  cats: Record<string, CatPrefs>;
  /** Names given in Vibe Studio; they override the agent's own title here only. */
  names: Record<string, string>;
}

/** "Family version" labels group by family (alphabetical); otherwise newest version first. */
function compareModels(a: ModeOption, b: ModeOption): number {
  const [fa, ...ra] = a.label.split(' ');
  const [fb, ...rb] = b.label.split(' ');
  if (ra.length && rb.length && fa !== fb) return fa.localeCompare(fb);
  return b.label.localeCompare(a.label, undefined, { numeric: true });
}

interface OpenTile {
  key: string;
  parser: TranscriptParser;
  reader?: TailReader;
  expectedFile?: string;
  window: number;
  shownFrom: number;
  sent: boolean;
  pumping?: boolean;
  createdAt: number;
}

export class Deck {
  private static current?: Deck;
  /** Context window per Claude model, learned from the CLI's run results (transcripts don't record it). */
  private static windows: Record<string, number> = {};
  /** Account limits: from the CLI's get_usage, kept fresh by every run's rate_limit_events. */
  private static usage?: AccountUsage;
  private usageBusy = false;
  private static asks = new Asks();

  private readonly index = new SessionIndex();
  private readonly tiles = new Map<string, OpenTile>();
  private readonly timers: NodeJS.Timeout[] = [];
  private state: Persisted;
  private lastSessions = '';

  static show(context: vscode.ExtensionContext): void {
    if (Deck.current) {
      Deck.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Vibe Studio', vscode.ViewColumn.Active, Deck.options(context));
    Deck.current = new Deck(context, panel);
  }

  static revive(context: vscode.ExtensionContext, panel: vscode.WebviewPanel): void {
    panel.webview.options = Deck.options(context);
    Deck.current = new Deck(context, panel);
  }

  private static options(context: vscode.ExtensionContext): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist'), vscode.Uri.joinPath(context.extensionUri, 'media')],
    };
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
  ) {
    this.state = {
      open: [],
      layout: { columns: 2, rows: 2, sidebar: true },
      layouts: [],
      cats: {},
      modes: {},
      models: {},
      chrome: {},
      efforts: {},
      focus: {},
      names: {},
      ...context.globalState.get<Persisted>(STATE_KEY),
    };
    this.state.names ??= {};
    Deck.windows = { ...context.globalState.get<Record<string, number>>(WINDOWS_KEY), ...Deck.windows };
    this.state.models ??= {};
    this.state.chrome ??= {};
    this.state.efforts ??= {};
    this.state.focus ??= {};
    this.state.layouts ??= [];
    this.state.cats ??= {};
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
    panel.webview.html = this.html();
    panel.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m).catch((e) => console.error('[vibe-studio]', e)));
    panel.onDidDispose(() => this.dispose());
    const config = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('vibeStudio.showTimestamps')) this.post({ type: 'timestamps', show: this.showTimestamps() });
      if (e.affectsConfiguration('vibeStudio.game') || e.affectsConfiguration('vibeStudio.gameFloaters')) this.post({ type: 'gameConfig', on: this.gameOn(), floaters: this.gameFloaters() });
      if (e.affectsConfiguration('vibeStudio.catCommentary')) this.post({ type: 'commentary', on: this.commentary() });
      if (e.affectsConfiguration('vibeStudio.focusView')) this.post({ type: 'focusView', on: this.focusView() });
    });
    panel.onDidDispose(() => config.dispose());
    this.timers.push(setInterval(() => void this.pumpAll(), 1000));
    this.timers.push(setInterval(() => void this.refreshSessions(), 4000));
    this.timers.push(setInterval(() => this.panel.visible && void this.refreshUsage(), 5 * 60_000));
    this.timers.push(setInterval(() => this.panel.visible && this.postCodexUsage(), 60_000));
  }

  private dispose(): void {
    Deck.current = undefined;
    for (const t of this.timers) clearInterval(t);
  }

  private post(msg: ToWebview): void {
    if (Deck.current !== this) return;
    void this.panel.webview.postMessage(msg).then(undefined, () => undefined);
  }

  /** Run callbacks can outlive the panel that started them; route them to the live one. */
  private static post(msg: ToWebview): void {
    Deck.current?.post(msg);
  }

  private save(): void {
    void this.context.globalState.update(STATE_KEY, this.state);
  }

  // ---- messages from the webview -------------------------------------------------------------

  private async onMessage(m: FromWebview): Promise<void> {
    switch (m.type) {
      case 'ready':
        await this.index.scan();
        this.post({
          type: 'init',
          sessions: this.summaries(),
          open: this.state.open,
          layout: this.state.layout,
          agents: await this.agents(),
          tileModes: this.state.modes,
          tileModels: this.state.models,
          tileChrome: this.state.chrome,
          tileEfforts: this.state.efforts,
          tileFocus: this.state.focus,
          folders: this.folders(),
          prompts: this.prompts(),
          showTimestamps: this.showTimestamps(),
          focusView: this.focusView(),
          game: this.context.globalState.get<GameState>(GAME_KEY),
          gameOn: this.gameOn(),
          gameFloaters: this.gameFloaters(),
          layouts: this.state.layouts,
          commentary: this.commentary(),
          cats: this.state.cats,
          shelf: cleanShelf(this.context.globalState.get(SHELF_KEY)),
        });
        this.tiles.clear();
        for (const key of this.state.open) void this.attach(key);
        if (Deck.usage) this.post({ type: 'accountUsage', state: 'ok', usage: Deck.usage });
        for (const key of this.state.open) if (Deck.asks.list(key).length) Deck.postAsks(key);
        void this.refreshUsage();
        this.postCodexUsage();
        return;
      case 'openTile':
        if (!this.state.open.includes(m.key)) this.state.open.unshift(m.key);
        this.save();
        if (!this.tiles.has(m.key)) void this.attach(m.key);
        return;
      case 'closeTile':
        this.denyAll(m.key, 'Tile closed');
        runner.release(m.key);
        this.tiles.delete(m.key);
        this.state.open = this.state.open.filter((k) => k !== m.key);
        this.save();
        return;
      case 'layout':
        this.state.layout = m.layout;
        this.save();
        return;
      case 'setMode':
        this.state.modes[m.key] = m.mode;
        this.save();
        return;
      // Stored even when '' / false: an explicit choice must survive a reload instead of falling back to the defaults.
      case 'setModel':
        this.state.models[m.key] = m.model;
        this.save();
        return;
      case 'setChrome':
        this.state.chrome[m.key] = m.chrome;
        this.save();
        return;
      case 'setEffort':
        this.state.efforts[m.key] = m.effort;
        this.save();
        return;
      case 'setFocus':
        this.state.focus[m.key] = m.focus;
        this.save();
        return;
      case 'recap':
        this.post({ type: 'recap', recap: await this.recap() });
        return;
      case 'agentLog': {
        const file = this.agentFile(m.key, m.agentId);
        if (!file) {
          this.post({ type: 'agentLog', key: m.key, agentId: m.agentId, items: [], hidden: 0, missing: true });
          return;
        }
        const parser = ADAPTERS[splitKey(m.key).agent].createParser({ sidechain: true });
        await new TailReader(file).read((line) => parser.feed(line));
        const from = Math.max(0, parser.items.length - PAGE);
        this.post({ type: 'agentLog', key: m.key, agentId: m.agentId, items: parser.items.slice(from), hidden: from });
        return;
      }
      case 'agentMap': {
        const tile = this.tiles.get(m.key);
        if (!tile) return;
        const s = this.summaries().find((x) => x.key === m.key);
        const map = await buildAgentMap({
          agent: splitKey(m.key).agent,
          items: tile.parser.items,
          main: {
            title: s?.title ?? 'This session',
            model: tile.parser.model,
            context: tile.parser.usage.context,
            busy: runner.isRunning(m.key) || s?.status === 'active',
          },
          canStop: runner.hasLive(m.key),
          resolve: this.resolveAgent(m.key),
        });
        this.post({ type: 'agentMap', key: m.key, map });
        return;
      }
      case 'stopAgent': {
        const live = ADAPTERS[splitKey(m.key).agent].live;
        this.post({ type: 'agentStop', key: m.key, agentId: m.agentId, ok: !!live && runner.control(m.key, live.stopTask(m.agentId)) });
        return;
      }
      case 'skills': {
        // scope is a chat key ("agent:id") or, for a new chat, its folder
        const cwd = m.scope.includes(':') && !path.isAbsolute(m.scope) ? this.index.cwdFor(m.scope) : m.scope;
        this.post({ type: 'skills', agent: m.agent, scope: m.scope, skills: await listSkills(m.agent, cwd || undefined) });
        return;
      }
      case 'openDiff':
        await this.openDiff(m.path, m.key);
        return;
      case 'rename': {
        const title = m.title.trim().slice(0, 200);
        if (title) this.state.names[m.key] = title;
        else delete this.state.names[m.key];
        this.save();
        await this.refreshSessions();
        return;
      }
      case 'loadEarlier': {
        const tile = this.tiles.get(m.key);
        if (!tile) return;
        tile.window += PAGE * 2;
        this.sendItems(tile, true);
        return;
      }
      case 'send':
        this.send(m.key, m.text, { mode: m.mode, model: m.model, effort: m.effort, chrome: m.chrome, points: this.reportInPoints() }, m.attachments);
        return;
      case 'stop':
        runner.stop(m.key);
        return;
      case 'newChat':
        this.newChat(m.draftKey, m.agent, m.cwd, m.text, { mode: m.mode, model: m.model, effort: m.effort, chrome: m.chrome, points: this.reportInPoints() }, m.attachments);
        return;
      case 'pickFolder': {
        const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Start chat here' });
        if (picked?.[0]) this.post({ type: 'folderPicked', draftKey: m.draftKey, path: picked[0].fsPath });
        return;
      }
      case 'findFiles': {
        // a draft's folder comes from the webview (findFiles checks it is a real folder); a chat's is the host's own
        const cwd = m.key.startsWith('draft:') ? m.cwd : this.index.cwdFor(m.key);
        this.post({ type: 'files', id: m.id, files: cwd ? await findFiles(cwd, m.query, rgFrom(vscode.env.appRoot)) : [] });
        return;
      }
      case 'pickAttachments': {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: 'Attach' });
        if (picked?.length) this.post({ type: 'attachments', key: m.key, ...(await readAttachments(picked.map((u) => u.fsPath))) });
        return;
      }
      case 'openLink':
        await this.openLink(m.href, m.key);
        return;
      case 'answer': {
        const ask = Deck.asks.find(m.key, m.id);
        if (!ask || ask.state !== 'pending') return; // a second click, or it expired meanwhile
        const sent = answerLines(ask, m.answer).every((l) => runner.control(m.key, l));
        Deck.asks.settle(m.key, sent ? 'answered' : 'expired', m.id);
        Deck.postAsks(m.key);
        return;
      }
      case 'shelfSave':
        void this.context.globalState.update(SHELF_KEY, cleanShelf(m.items));
        return;
      case 'setCat': {
        const cat = cleanCat(m.cat);
        if (Object.keys(cat).length) this.state.cats[m.key] = cat;
        else delete this.state.cats[m.key];
        this.save();
        return;
      }
      case 'order': {
        // keep chats the webview did not list (still loading) at the end
        const known = new Set(this.state.open);
        const keys = m.keys.filter((k) => known.has(k));
        this.state.open = [...keys, ...this.state.open.filter((k) => !keys.includes(k))];
        this.save();
        return;
      }
      case 'saveLayout': {
        const name = m.name.trim().slice(0, 40);
        if (!name || !this.state.open.length) return;
        const entry: SavedLayout = { name, open: [...this.state.open], layout: { ...this.state.layout } };
        this.state.layouts = [...this.state.layouts.filter((l) => l.name !== name), entry].slice(-20);
        this.save();
        this.post({ type: 'layouts', list: this.state.layouts });
        return;
      }
      case 'deleteLayout':
        this.state.layouts = this.state.layouts.filter((l) => l.name !== m.name);
        this.save();
        this.post({ type: 'layouts', list: this.state.layouts });
        return;
      case 'applyLayout': {
        const l = this.state.layouts.find((x) => x.name === m.name);
        if (!l) return;
        // chats that leave the screen can no longer answer a question
        for (const k of this.state.open) if (!l.open.includes(k)) this.denyAll(k, 'Tile closed');
        this.state.open = [...l.open];
        this.state.layout = { ...l.layout };
        this.save();
        await this.onMessage({ type: 'ready' });
        return;
      }
      case 'deckFullscreen':
        await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup');
        return;
      case 'improvePrompt': {
        const bin = resolveBinary('claude');
        if (!bin) {
          this.post({ type: 'improved', key: m.key, error: 'The Claude CLI was not found. Install the Claude Code extension or set "vibeStudio.claudePath".' });
          return;
        }
        const r = await improvePrompt(bin, m.text.slice(0, 20_000));
        this.post(r.ok ? { type: 'improved', key: m.key, text: r.text } : { type: 'improved', key: m.key, error: r.error });
        return;
      }
      case 'servers':
        await this.postServers();
        return;
      case 'runServer': {
        const p = this.servers.find((x) => x.root === m.root);
        if (!p?.scripts.includes(m.script)) return;
        const term = vscode.window.createTerminal({ name: `Server · ${p.name}${p.branch ? ` (${p.branch})` : ''}`, cwd: p.root });
        term.show(true);
        term.sendText(`npm run ${m.script}`);
        return;
      }
      case 'stopServer':
        // only processes the last scan found inside a listed project
        if (this.servers.some((p) => p.servers.some((s) => s.pid === m.pid))) process.kill(m.pid, 'SIGTERM');
        setTimeout(() => void this.postServers(), 800);
        return;
      case 'openServer':
        if (this.servers.some((p) => p.servers.some((s) => s.port === m.port))) await vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${m.port}`));
        return;
      case 'gameSave':
        void this.context.globalState.update(GAME_KEY, loadGame(m.state));
        return;
      case 'refreshUsage':
        this.postCodexUsage();
        await this.refreshUsage();
        return;
      case 'copy':
        await vscode.env.clipboard.writeText(m.text);
        return;
    }
  }

  // ---- transcripts ---------------------------------------------------------------------------

  private async attach(key: string): Promise<void> {
    const tile = this.newTile(key);
    this.tiles.set(key, tile);
    await this.pump(tile);
    if (!tile.reader && !runner.isRunning(key)) {
      this.post({ type: 'error', key, message: 'Transcript not found. The session may have been deleted.' });
    }
  }

  private newTile(key: string, expectedFile?: string): OpenTile {
    const parser = ADAPTERS[splitKey(key).agent].createParser();
    return { key, parser, expectedFile, window: PAGE, shownFrom: 0, sent: false, createdAt: Date.now() };
  }

  private async pumpAll(): Promise<void> {
    let missing = false;
    for (const tile of this.tiles.values()) {
      await this.pump(tile);
      if (!tile.reader && Date.now() - tile.createdAt < NEW_SESSION_WAIT_MS) missing = true;
    }
    if (missing) await this.refreshSessions(true);
  }

  private async pump(tile: OpenTile): Promise<void> {
    if (tile.pumping) return;
    tile.pumping = true;
    try {
      await this.read(tile);
    } finally {
      tile.pumping = false;
    }
  }

  private async read(tile: OpenTile): Promise<void> {
    if (!tile.reader) {
      const file = this.index.fileFor(tile.key) ?? (tile.expectedFile && fs.existsSync(tile.expectedFile) ? tile.expectedFile : undefined);
      if (!file) return;
      tile.reader = new TailReader(file);
    }
    const parser = tile.parser;
    const result = await tile.reader.read((line) => parser.feed(line));
    if (this.tiles.get(tile.key) !== tile) return; // closed while reading
    if (result === 'reset') {
      tile.parser = ADAPTERS[splitKey(tile.key).agent].createParser();
      tile.sent = false;
      return this.read(tile);
    }
    if (!tile.sent) {
      tile.sent = true;
      tile.parser.takeDirty();
      this.sendItems(tile, true);
      return;
    }
    if (!result) return;
    const changed = tile.parser
      .takeDirty()
      .map((id) => tile.parser.indexOf(id))
      .filter((i) => i >= tile.shownFrom)
      .sort((a, b) => a - b)
      .map((i) => tile.parser.items[i]);
    if (changed.length) this.post({ type: 'items', key: tile.key, items: changed, reset: false, hidden: tile.shownFrom, ...this.extras(tile) });
  }

  private sendItems(tile: OpenTile, reset: boolean): void {
    const items = tile.parser.items;
    tile.shownFrom = Math.max(0, items.length - tile.window);
    this.post({ type: 'items', key: tile.key, items: items.slice(tile.shownFrom), reset, hidden: tile.shownFrom, ...this.extras(tile) });
  }

  /** Model, effort, usage, edited files, skills and agents that travel with every transcript update. */
  private extras(tile: OpenTile) {
    const { model, effort, usage } = tile.parser;
    const window = usage.window ?? (model ? Deck.windows[model] : undefined);
    const resolve = this.resolveAgent(tile.key);
    // only a running agent needs its transcript looked at to tell working from stopped
    const agents = tile.parser.items.flatMap((i) =>
      i.kind === 'agent' ? [{ id: i.id, description: i.description, status: agentStatus(i, i.status === 'running' ? resolve(i) : undefined) }] : [],
    );
    return { model, effort, usage: { ...usage, window }, files: [...tile.parser.files.values()], skills: [...tile.parser.skillsUsed], agents };
  }

  /** Finds a sub-agent's own transcript: Claude's <session>/subagents folder, or a Codex thread's rollout. */
  private resolveAgent(key: string): (item: AgentItem) => AgentFile | undefined {
    const { agent } = splitKey(key);
    const file = this.index.fileFor(key);
    return (item) => (agent === 'claude' ? (file ? claudeAgentFile(file, item) : undefined) : codexAgentFile((k) => this.index.fileFor(k), item));
  }

  /** Claude: <session>/subagents/agent-<id>.jsonl. Codex: the agent's own thread rollout. */
  private agentFile(key: string, agentId: string): string | undefined {
    if (!/^[\w-]+$/.test(agentId)) return undefined; // it becomes part of a path
    const { agent } = splitKey(key);
    const file = agent === 'claude' ? this.index.fileFor(key)?.replace(/\.jsonl$/, `/subagents/agent-${agentId}.jsonl`) : this.index.fileFor(`codex:${agentId}`);
    return file && fs.existsSync(file) ? file : undefined;
  }

  // ---- sessions list -------------------------------------------------------------------------

  private statusFor = (key: string, mtimeMs: number): SessionStatus => {
    if (runner.isRunning(key)) return 'running';
    const ownWrite = (runner.lastExit.get(key) ?? 0) + 3000 >= mtimeMs;
    return Date.now() - mtimeMs < ACTIVE_MS && !ownWrite ? 'active' : 'idle';
  };

  private summaries() {
    const names = this.state.names;
    return this.index.summaries(this.statusFor).map((s) => (names[s.key] ? { ...s, title: names[s.key] } : s));
  }

  private async refreshSessions(force = false): Promise<void> {
    if (force || this.panel.visible) await this.index.scan();
    const sessions = this.summaries();
    const json = JSON.stringify(sessions);
    if (json === this.lastSessions) return;
    this.lastSessions = json;
    this.post({ type: 'sessions', sessions });
  }

  private async agents(): Promise<AgentInfo[]> {
    const config = vscode.workspace.getConfiguration('vibeStudio');
    return Promise.all(
      (Object.keys(ADAPTERS) as AgentId[]).map(async (id) => {
        const adapter = ADAPTERS[id];
        const efforts = await adapter.efforts();
        return {
          id,
          label: adapter.label,
          available: !!resolveBinary(id),
          modes: adapter.modes,
          defaultMode: config.get<string>(`${id}Mode`) ?? adapter.modes[0].value,
          models: await this.models(id),
          supportsChrome: adapter.supportsChrome,
          skillPrefix: id === 'codex' ? '$' : '/',
          efforts: efforts.levels,
          modelEfforts: efforts.byModel,
          defaultModel: config.get<string>(`${id}Model`)?.trim() ?? '',
          defaultEffort: config.get<string>(`${id}Effort`)?.trim() ?? '',
          defaultChrome: adapter.supportsChrome && (config.get<boolean>(`${id}Chrome`) ?? false),
        };
      }),
    );
  }

  /** Current models, every model past sessions used, and any the user added in settings. */
  private async models(agent: AgentId): Promise<ModeOption[]> {
    const adapter = ADAPTERS[agent];
    const byValue = new Map<string, ModeOption>();
    for (const m of await adapter.knownModels()) byValue.set(m.value, m);
    const extra = vscode.workspace.getConfiguration('vibeStudio').get<string[]>(`${agent}Models`) ?? [];
    for (const id of [...this.index.modelsSeen(agent), ...extra]) {
      const value = id.trim();
      if (value && !byValue.has(value)) byValue.set(value, { value, label: adapter.modelLabel(value) });
    }
    const list = [...byValue.values()].sort(compareModels);
    // Two ids with the same name (e.g. dated snapshots) get the id appended so they stay distinguishable.
    const counts = new Map<string, number>();
    for (const m of list) counts.set(m.label, (counts.get(m.label) ?? 0) + 1);
    const options = list.map((m) => ((counts.get(m.label) ?? 0) > 1 ? { ...m, label: `${m.label} · ${m.value}` } : m));
    return [{ value: '', label: 'Default model' }, ...options];
  }

  private folders(): string[] {
    const out = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    for (const s of this.summaries()) {
      if (out.length >= 12) break;
      if (s.cwd && !out.includes(s.cwd) && fs.existsSync(s.cwd)) out.push(s.cwd);
    }
    return out;
  }

  // ---- running agents ------------------------------------------------------------------------

  private binaryOrError(agent: AgentId, key: string): string | undefined {
    const bin = resolveBinary(agent);
    if (!bin) {
      this.post({
        type: 'error',
        key,
        message: `${ADAPTERS[agent].label} CLI not found. Install its VS Code extension or set "vibeStudio.${agent}Path".`,
      });
    }
    return bin;
  }

  private handlers(agent: AgentId, getKey: () => string, onLine?: (line: string) => void) {
    let error: string | undefined;
    return {
      onLine: (line: string) => {
        onLine?.(line);
        Deck.learnWindow(line);
        Deck.learnLimits(line);
        Deck.learnAsk(getKey(), line);
        error ??= ADAPTERS[agent].errorFromStdout(line);
      },
      onExit: (code: number | null, stderr: string, stopped: boolean) => {
        const key = getKey();
        // Held until the turn ends so a Stop (which reports an error result) stays quiet.
        // Error first: the webview pauses its queue on error and sends the next message when running ends.
        if (!stopped && (error || code !== 0)) {
          Deck.post({ type: 'error', key, message: error ?? (stderr.split('\n').slice(-6).join('\n') || `Exited with code ${code}`) });
        }
        // a turn that ends (or a process that dies) with a question open can no longer use the answer
        if (Deck.asks.settle(key, 'expired')) Deck.postAsks(key);
        Deck.post({ type: 'running', key, running: false });
        const deck = Deck.current;
        if (agent === 'codex') deck?.postCodexUsage();
        const tile = deck?.tiles.get(key);
        if (tile) void deck!.pump(tile);
        void deck?.refreshSessions(true);
      },
    };
  }

  private send(key: string, text: string, opts: RunOptions, attachments?: Attachment[]): void {
    const { agent, id } = splitKey(key);
    if (runner.isRunning(key)) return;
    const bin = this.binaryOrError(agent, key);
    if (!bin) return;
    const adapter = ADAPTERS[agent];
    const cwd = this.index.cwdFor(key);
    if (adapter.live) runner.send(key, this.liveSpec(agent, id, opts, cwd, bin, false), adapter.live.message(text, attachments), this.handlers(agent, () => key));
    else runner.start(key, bin, adapter.resumePlan(id, text, opts), cwd, this.handlers(agent, () => key), adapter.env);
    this.post({ type: 'running', key, running: true });
    void this.refreshSessions();
  }

  private liveSpec(agent: AgentId, id: string, opts: RunOptions, cwd: string | undefined, bin: string, fresh: boolean): LiveSpec {
    const live = ADAPTERS[agent].live!;
    return {
      bin,
      args: live.args(id, opts, fresh),
      cwd,
      env: ADAPTERS[agent].env,
      // fresh/resume isn't part of it: the process that created a session keeps serving it
      sig: JSON.stringify([bin, cwd, opts]),
      interrupt: live.interrupt(),
      isTurnEnd: live.isTurnEnd,
      controlReply: live.controlReply,
    };
  }

  private newChat(draftKey: string, agent: AgentId, cwd: string, text: string, opts: RunOptions, attachments?: Attachment[]): void {
    const adapter = ADAPTERS[agent];
    const bin = this.binaryOrError(agent, draftKey);
    if (!bin) return;

    const bind = (key: string, expectedFile?: string) => {
      this.state.open = [key, ...this.state.open.filter((k) => k !== key)];
      this.state.modes[key] = opts.mode;
      this.state.models[key] = opts.model;
      this.state.chrome[key] = opts.chrome;
      this.state.efforts[key] = opts.effort;
      this.save();
      this.post({ type: 'bound', draftKey, key });
      this.post({ type: 'running', key, running: runner.isRunning(key) });
      this.tiles.set(key, this.newTile(key, expectedFile));
    };

    if (adapter.supportsChosenId) {
      const id = randomUUID();
      const key = `${agent}:${id}`;
      if (adapter.live) runner.send(key, this.liveSpec(agent, id, opts, cwd, bin, true), adapter.live.message(text, attachments), this.handlers(agent, () => key));
      else runner.start(key, bin, adapter.newPlan(text, id, opts), cwd, this.handlers(agent, () => key), adapter.env);
      bind(key, adapter.expectedFile?.(id, cwd));
      return;
    }

    let key = draftKey;
    runner.start(
      draftKey,
      bin,
      adapter.newPlan(text, '', opts),
      cwd,
      this.handlers(
        agent,
        () => key,
        (line) => {
          const id = key === draftKey ? adapter.idFromStdout?.(line) : undefined;
          if (!id) return;
          key = `${agent}:${id}`;
          runner.rekey(draftKey, key);
          bind(key);
        },
      ),
      adapter.env,
    );
    this.post({ type: 'running', key: draftKey, running: true });
  }

  /** A question from the CLI becomes a card in the tile; a withdrawn one expires. */
  private static learnAsk(key: string, line: string): void {
    if (!line.includes('can_use_tool') && !line.includes('control_cancel_request')) return;
    const d = safeJson(line);
    const ask = parseAsk(d);
    if (ask) Deck.asks.add(key, ask);
    const gone = cancelledId(d);
    if (gone) Deck.asks.settle(key, 'expired', gone);
    if (ask || gone) Deck.postAsks(key);
  }

  private static postAsks(key: string): void {
    Deck.post({ type: 'asks', key, asks: Deck.asks.list(key) });
  }

  /** Closing a tile must not leave the CLI waiting for an answer nobody can give. */
  private denyAll(key: string, why: string): void {
    for (const ask of Deck.asks.pending(key)) answerLines(ask, { allow: false, message: why }).forEach((l) => runner.control(key, l));
    if (Deck.asks.settle(key, 'expired')) Deck.postAsks(key);
  }

  /** Every run streams rate_limit_events; they keep the meter current between get_usage calls. */
  private static learnLimits(line: string): void {
    if (!line.includes('"rate_limit_event"')) return;
    const d = safeJson(line);
    if (d?.type !== 'rate_limit_event') return;
    const next = mergeLimitEvent(Deck.usage, d);
    if (!next) return;
    Deck.usage = next;
    Deck.post({ type: 'accountUsage', state: 'ok', usage: next });
  }

  /** One throwaway CLI process answers get_usage; on failure the last numbers stay. */
  private postCodexUsage(): void {
    this.post({ type: 'codexUsage', usage: latestCodexUsage() });
  }

  private async refreshUsage(): Promise<void> {
    const bin = resolveBinary('claude');
    if (!bin || this.usageBusy) return;
    this.usageBusy = true;
    const r = await fetchUsage(bin);
    this.usageBusy = false;
    if (r.state === 'ok') Deck.usage = r.usage;
    this.post({ type: 'accountUsage', state: r.state, usage: r.state === 'unavailable' ? undefined : Deck.usage });
  }

  /** Claude's run result lists each model's context window; remember it for the meter. */
  private static learnWindow(line: string): void {
    if (!line.includes('"modelUsage"')) return;
    const d = safeJson(line);
    if (d?.type !== 'result' || !d.modelUsage) return;
    let changed = false;
    for (const [model, u] of Object.entries<any>(d.modelUsage)) {
      if (typeof u?.contextWindow === 'number' && Deck.windows[model] !== u.contextWindow) {
        Deck.windows[model] = u.contextWindow;
        changed = true;
      }
    }
    if (changed) void Deck.current?.context.globalState.update(WINDOWS_KEY, Deck.windows);
  }

  private showTimestamps(): boolean {
    return vscode.workspace.getConfiguration('vibeStudio').get<boolean>('showTimestamps', true);
  }

  private servers: ProjectServers[] = [];
  private scanning = false;

  private async postServers(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const open = this.state.open.map((k) => this.index.cwdFor(k)).filter((c): c is string => !!c);
      this.servers = await scanServers([...new Set([...this.folders(), ...open])]);
      this.post({ type: 'servers', projects: this.servers });
    } finally {
      this.scanning = false;
    }
  }

  private reportInPoints(): boolean {
    return vscode.workspace.getConfiguration('vibeStudio').get<boolean>('reportInPoints', true);
  }

  private commentary(): boolean {
    return vscode.workspace.getConfiguration('vibeStudio').get<boolean>('catCommentary', true);
  }

  private gameOn(): boolean {
    return vscode.workspace.getConfiguration('vibeStudio').get<boolean>('game', true);
  }

  private gameFloaters(): boolean {
    return vscode.workspace.getConfiguration('vibeStudio').get<boolean>('gameFloaters', false);
  }

  private focusView(): boolean {
    return vscode.workspace.getConfiguration('vibeStudio').get<boolean>('focusView', false);
  }

  private prompts(): PromptChip[] {
    const configured = vscode.workspace.getConfiguration('vibeStudio').get<PromptChip[]>('prompts');
    const list = Array.isArray(configured) ? configured : DEFAULT_PROMPTS;
    return list.filter((p) => p && typeof p.label === 'string' && typeof p.prompt === 'string' && p.prompt.trim());
  }

  // ---- daily recap ---------------------------------------------------------------------------

  /** Today's work across every session: turns started today, edits applied today. */
  private async recap(): Promise<Recap> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const since = today.getTime();
    const files = new Map<string, FileStat>();
    const byAgent: Record<string, number> = {};
    let chats = 0;
    let turns = 0;
    let longest: Recap['longest'];
    for (const s of this.summaries().filter((x) => x.updatedAt >= since)) {
      const file = this.index.fileFor(s.key);
      if (!file) continue;
      const parser = ADAPTERS[s.agent].createParser();
      await new TailReader(file).read((line) => parser.feed(line));
      const todays = parser.turns.filter((t) => t.start >= since);
      if (todays.length) {
        chats++;
        byAgent[s.agent] = (byAgent[s.agent] ?? 0) + 1;
      }
      turns += todays.length;
      for (const t of todays) {
        const ms = t.end - t.start;
        if (!longest || ms > longest.ms) longest = { ms, title: s.title, agent: s.agent, key: s.key, prompt: t.text };
      }
      for (const e of parser.edits) {
        if (e.ts < since) continue;
        const f = files.get(e.path) ?? { path: e.path, adds: 0, dels: 0 };
        f.adds += e.adds;
        f.dels += e.dels;
        files.set(e.path, f);
      }
      await new Promise((r) => setImmediate(r)); // keep the extension host responsive
    }
    const all = [...files.values()];
    return {
      chats,
      turns,
      files: all.length,
      adds: all.reduce((n, f) => n + f.adds, 0),
      dels: all.reduce((n, f) => n + f.dels, 0),
      byAgent,
      longest,
      topFiles: all.sort((a, b) => b.adds + b.dels - (a.adds + a.dels)).slice(0, 6),
    };
  }

  // ---- links ---------------------------------------------------------------------------------

  /** HEAD ↔ working tree diff through VS Code's git extension; plain file when it isn't in a repo. */
  private async openDiff(file: string, key?: string): Promise<void> {
    const base = key ? this.index.cwdFor(key) : undefined;
    const full = path.isAbsolute(file) ? file : base ? path.join(base, file) : file;
    const uri = vscode.Uri.file(full);
    const opts: vscode.TextDocumentShowOptions = { viewColumn: vscode.ViewColumn.Beside, preview: true };
    try {
      const ext = vscode.extensions.getExtension('vscode.git');
      const git = (ext?.isActive ? ext.exports : await ext?.activate())?.getAPI?.(1);
      if (git?.getRepository(uri)) {
        const head = git.toGitUri(uri, 'HEAD');
        if (fs.existsSync(full)) await vscode.commands.executeCommand('vscode.diff', head, uri, `${path.basename(full)} (HEAD ↔ now)`, opts);
        else await vscode.window.showTextDocument(head, opts); // deleted: show what it was
        return;
      }
    } catch {
      /* fall through to plain open */
    }
    if (fs.existsSync(full)) await vscode.window.showTextDocument(uri, opts);
    else void vscode.window.showWarningMessage(`Vibe Studio: ${full} does not exist.`);
  }

  private async openLink(href: string, key?: string): Promise<void> {
    if (/^https?:\/\//i.test(href)) {
      await vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    let target = decodeURIComponent(href.replace(/^file:\/\//, ''));
    let line: number | undefined;
    const hash = /#L(\d+)(?:-L?\d+)?$/.exec(target);
    const colon = /:(\d+)(?::\d+)?$/.exec(target);
    if (hash) {
      line = Number(hash[1]);
      target = target.slice(0, hash.index);
    } else if (colon) {
      line = Number(colon[1]);
      target = target.slice(0, colon.index);
    }
    if (!path.isAbsolute(target)) {
      const base = key ? this.index.cwdFor(key) : undefined;
      if (!base) return;
      target = path.join(base, target);
    }
    if (!fs.existsSync(target)) {
      void vscode.window.showWarningMessage(`Vibe Studio: ${target} does not exist.`);
      return;
    }
    const pos = line ? new vscode.Position(Math.max(0, line - 1), 0) : undefined;
    await vscode.window.showTextDocument(vscode.Uri.file(target), {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
      selection: pos ? new vscode.Range(pos, pos) : undefined,
    });
  }

  // ---- html ----------------------------------------------------------------------------------

  private html(): string {
    const webview = this.panel.webview;
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    const js = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'));
    const nonce = randomUUID().replace(/-/g, '');
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
<title>Vibe Studio</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

export function registerDeck(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('vibeStudio.open', () => Deck.show(context)),
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      deserializeWebviewPanel: async (panel) => Deck.revive(context, panel),
    }),
  );
}
