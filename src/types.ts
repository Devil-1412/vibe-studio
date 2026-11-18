// Shared between the extension host and the webview. Keep it free of node/vscode imports.
import type { GameState } from './game';

export type AgentId = 'claude' | 'codex';

export type SessionStatus = 'idle' | 'active' | 'running';

export interface SessionSummary {
  key: string; // `${agent}:${id}`
  agent: AgentId;
  id: string;
  title: string;
  cwd: string;
  project: string;
  updatedAt: number;
  status: SessionStatus;
}

export interface TodoEntry {
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export type ChatItem = (
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'thinking'; text: string }
  | {
      id: string;
      kind: 'tool';
      name: string;
      summary: string;
      input: string;
      output?: string;
      isError?: boolean;
      diff?: boolean;
      /** One-line outcome (Grep, Glob), shown when the row is open. */
      result?: string;
    }
  | { id: string; kind: 'note'; text: string; tone?: 'info' | 'error' }
  /** TodoWrite (Claude) or update_plan (Codex): the whole checklist as of that call. */
  | { id: string; kind: 'todo'; items: TodoEntry[] }
  /** A compaction: `text` is the summary the agent continued from (empty until it arrives). */
  | { id: string; kind: 'compact'; text: string; trigger?: string; preTokens?: number }
  | PlanItem
  | QuestionItem
  | AgentItem
) & {
  /** Transcript timestamp (ms) of the line that created the item. */
  ts?: number;
};

/** Claude's ExitPlanMode: the plan it proposed and whether the user approved it. */
export interface PlanItem {
  id: string;
  kind: 'plan';
  plan: string;
  /** File name of the saved plan, when the transcript names one. */
  file?: string;
  /** waiting = no result yet; kept = rejected, Claude stays in plan mode. */
  status: 'waiting' | 'approved' | 'kept';
}

export interface QuestionEntry {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
  /** Labels of the options the user picked. */
  chosen?: string[];
  /** A typed answer that matches no option. */
  other?: string;
}

/** Claude's AskUserQuestion: the questions and, once answered, what the user picked. */
export interface QuestionItem {
  id: string;
  kind: 'question';
  questions: QuestionEntry[];
  /** none = answered with nothing. */
  status: 'waiting' | 'answered' | 'none' | 'declined';
  /** Why the user declined, when they said. */
  reason?: string;
  /** The result text, when its structured answers could not be read. */
  text?: string;
}

/** A sub-agent the chat started (Claude's Agent tool, Codex's spawn_agent). */
export interface AgentItem {
  id: string;
  kind: 'agent';
  agentType: string;
  description: string;
  prompt: string;
  model?: string;
  background?: boolean;
  status: 'running' | 'done' | 'failed' | 'stopped';
  /** Its own transcript: Claude agent id, or Codex thread id. */
  agentId?: string;
  report?: string;
  /** Transcript timestamps (ms), and the totals the agent reported when it finished. */
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  tokens?: number;
  toolUses?: number;
}

/** As the Agent map shows it. A running agent whose transcript went quiet counts as stopped. */
export type AgentStatus = 'working' | 'finished' | 'failed' | 'stopped';

export interface AgentTool {
  id: string;
  name: string;
  summary: string;
  running: boolean;
  isError?: boolean;
}

export interface AgentNode {
  /** The spawn tool call's id; children point at it. */
  id: string;
  parentId?: string;
  agentId?: string;
  description: string;
  agentType: string;
  model?: string;
  background?: boolean;
  status: AgentStatus;
  prompt: string;
  /** Final report, or the failure text. */
  result?: string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  tokens?: number;
  toolUses?: number;
  /** What a working agent is doing right now. */
  activity?: string;
  tools: AgentTool[];
}

export interface AgentMap {
  main: { title: string; model?: string; context?: number; busy: boolean };
  agents: AgentNode[];
  /** Vibe Studio owns this chat's process, so Stop agent can reach it. */
  canStop: boolean;
  now: number;
}

export interface FileStat {
  path: string;
  adds: number;
  dels: number;
}

export interface Usage {
  /** Output tokens of the last model call. */
  out?: number;
  /** Tokens in the context window after the last model call. */
  context?: number;
  /** Size of the context window, when known. */
  window?: number;
  /** Session cost in USD (Claude). */
  cost?: number;
  /** Tokens used by the whole session (Codex). */
  total?: number;
  /** Claude's prompt cache, an estimate: time (ms) of the newest model call, and when its cache entry likely lapses. */
  cacheAt?: number;
  cacheUntil?: number;
}

export interface Recap {
  chats: number;
  turns: number;
  files: number;
  adds: number;
  dels: number;
  byAgent: Record<string, number>;
  longest?: { ms: number; title: string; agent: AgentId; key: string; prompt: string };
  topFiles: FileStat[];
}

export interface SkillInfo {
  /** What follows the agent's skill prefix, e.g. "hallmark:hallmark". */
  name: string;
  description: string;
  /** Where it comes from: Personal, Project, System, or "Plugin · name". */
  source: string;
}

/** A request from the CLI that waits for the user: a tool permission, a question, or a plan to approve. */
export interface PendingAsk {
  /** The control request's id; the answer quotes it. */
  id: string;
  toolUseId?: string;
  /** Set when a sub-agent is asking. */
  agentId?: string;
  kind: 'tool' | 'question' | 'plan';
  tool: string;
  input: any;
  description?: string;
  /** Rules the CLI offers to remember ("always allow"). */
  suggestions: any[];
  /** expired: the turn ended, was interrupted, or the process went away before an answer. */
  state: 'pending' | 'answered' | 'expired';
}

export type AskAnswer =
  | { allow: true; always?: boolean; answers?: Record<string, string>; mode?: 'acceptEdits' | 'default' }
  | { allow: false; message?: string };

/** One account limit window: the 5-hour session, the weekly total, or a weekly per-model one. */
export interface UsageWindow {
  id: string;
  label: string;
  /** 0-100 */
  pct: number;
  /** ms since epoch */
  resetsAt?: number;
}

export interface AccountUsage {
  windows: UsageWindow[];
  plan?: string;
  /** When the numbers were last updated (ms). */
  at: number;
}

/** A file or folder in a chat's working folder, as the @ picker lists it. */
export interface FileEntry {
  /** Relative to the folder, with forward slashes. */
  path: string;
  name: string;
  /** Parent folder, '' for the top level. */
  dir: string;
  folder?: boolean;
}

/** A file attached to a message. */
export interface Attachment {
  name: string;
  /** image/jpeg, image/png, image/gif, image/webp, application/pdf, or text/plain. */
  type: string;
  /** base64 for images and PDFs, the file's text for text/plain. */
  data: string;
  size: number;
}

/** One listening port found inside a project folder. */
export interface ServerEntry {
  pid: number;
  port: number;
  cmd: string;
}

/** A project folder or git worktree, its running servers, and the package.json scripts that start one. */
export interface ProjectServers {
  root: string;
  name: string;
  branch?: string;
  /** A linked worktree rather than the main checkout. */
  worktree: boolean;
  servers: ServerEntry[];
  scripts: string[];
}

export interface PromptChip {
  label: string;
  prompt: string;
}

export interface ModeOption {
  value: string;
  label: string;
}

export interface AgentInfo {
  id: AgentId;
  label: string;
  available: boolean;
  modes: ModeOption[];
  defaultMode: string;
  /** First entry has value '' and means "don't pass a model flag". */
  models: ModeOption[];
  /** Can drive the user's Chrome through Claude in Chrome. */
  supportsChrome: boolean;
  /** Reasoning effort levels; '' (not listed) = CLI default. */
  efforts: ModeOption[];
  /** Levels a specific model supports, when known. */
  modelEfforts: Record<string, string[]>;
  /** Character that invokes a skill in a prompt: "/" for Claude, "$" for Codex. */
  skillPrefix: string;
  /** Used by tiles that have not picked their own. */
  defaultModel: string;
  defaultEffort: string;
  defaultChrome: boolean;
}

/** Something kept on the Shelf: a message, a piece of code, or an attached image or file. */
export interface ShelfItem {
  id: string;
  kind: 'text' | 'code' | 'attachment';
  title: string;
  text?: string;
  lang?: string;
  att?: Attachment;
  /** Title of the chat it came from. */
  from?: string;
  at: number;
}

/** How one chat's cat is dressed. Unset parts fall back to the default coat, no hat and no neckwear. */
export interface CatPrefs {
  name?: string;
  coat?: string;
  hat?: string;
  neck?: string;
}

/** A named set of open chats, in screen order, with the grid they were arranged in. */
export interface SavedLayout {
  name: string;
  open: string[];
  layout: Layout;
}

export interface Layout {
  columns: number;
  rows: number;
  sidebar: boolean;
}

export type ToWebview =
  | {
      type: 'init';
      sessions: SessionSummary[];
      open: string[];
      layout: Layout;
      agents: AgentInfo[];
      tileModes: Record<string, string>;
      tileModels: Record<string, string>;
      tileChrome: Record<string, boolean>;
      tileEfforts: Record<string, string>;
      tileFocus: Record<string, boolean>;
      folders: string[];
      prompts: PromptChip[];
      showTimestamps: boolean;
      /** vibeStudio.focusView: Focus view for tiles with no choice of their own. */
      focusView: boolean;
      game: GameState | undefined;
      gameOn: boolean;
      gameFloaters: boolean;
      layouts: SavedLayout[];
      commentary: boolean;
      cats: Record<string, CatPrefs>;
      shelf: ShelfItem[];
      lowUsage: boolean;
      /** Current values of the settings the Settings panel shows. */
      settings: Record<string, unknown>;
    }
  | { type: 'settings'; values: Record<string, unknown> }
  /** Agent defaults changed in settings. */
  | { type: 'agents'; agents: AgentInfo[] }
  | { type: 'layouts'; list: SavedLayout[] }
  | { type: 'commentary'; on: boolean }
  | { type: 'servers'; projects: ProjectServers[] }
  | { type: 'improved'; key: string; text?: string; error?: string }
  | { type: 'gameConfig'; on: boolean; floaters: boolean }
  | { type: 'timestamps'; show: boolean }
  | { type: 'focusView'; on: boolean }
  | { type: 'sessions'; sessions: SessionSummary[] }
  | {
      type: 'items';
      key: string;
      items: ChatItem[];
      reset: boolean;
      hidden: number;
      model?: string;
      effort?: string;
      usage?: Usage;
      files?: FileStat[];
      /** Skills and commands this chat ran. */
      skills?: string[];
      /** Every sub-agent the chat started, including ones above the loaded window. */
      agents?: { id: string; description: string; status: AgentStatus }[];
    }
  | { type: 'agentMap'; key: string; map: AgentMap }
  | { type: 'agentStop'; key: string; agentId: string; ok: boolean }
  | { type: 'recap'; recap: Recap }
  | { type: 'skills'; agent: AgentId; scope: string; skills: SkillInfo[] }
  | { type: 'agentLog'; key: string; agentId: string; items: ChatItem[]; hidden: number; missing?: boolean }
  | { type: 'files'; id: number; files: FileEntry[] }
  /** Account limits; `unavailable` for API-key logins, `error` when the CLI could not be asked. */
  | { type: 'asks'; key: string; asks: PendingAsk[] }
  | { type: 'codexUsage'; usage?: AccountUsage }
  | { type: 'accountUsage'; state: 'ok' | 'unavailable' | 'error'; usage?: AccountUsage }
  /** The paperclip's picks; `message` says which files were skipped and why. */
  | { type: 'attachments'; key: string; files: Attachment[]; message: string }
  | { type: 'running'; key: string; running: boolean }
  | { type: 'error'; key: string; message: string }
  | { type: 'bound'; draftKey: string; key: string }
  | { type: 'folderPicked'; draftKey: string; path: string }
  | { type: 'focus'; key: string };

export type FromWebview =
  | { type: 'ready' }
  | { type: 'openTile'; key: string }
  | { type: 'closeTile'; key: string }
  | { type: 'send'; key: string; text: string; mode: string; model: string; effort: string; chrome: boolean; attachments?: Attachment[] }
  | { type: 'stop'; key: string }
  | {
      type: 'newChat';
      draftKey: string;
      agent: AgentId;
      cwd: string;
      text: string;
      mode: string;
      model: string;
      effort: string;
      chrome: boolean;
      attachments?: Attachment[];
      /** Low usage mode only: which of these the user chose themselves, so the rest keep following the mode. */
      pinned?: ('model' | 'effort' | 'chrome')[];
    }
  | { type: 'pickFolder'; draftKey: string }
  /** Files of the chat's folder for the @ picker; `cwd` is only read for a new-chat draft. */
  | { type: 'findFiles'; key: string; cwd?: string; query: string; id: number }
  | { type: 'pickAttachments'; key: string }
  | { type: 'refreshUsage' }
  | { type: 'gameSave'; state: GameState }
  | { type: 'servers' }
  | { type: 'setSetting'; key: string; value: unknown }
  | { type: 'openSettings' }
  | { type: 'setLowUsage'; on: boolean }
  | { type: 'setCat'; key: string; cat: CatPrefs }
  | { type: 'shelfSave'; items: ShelfItem[] }
  | { type: 'improvePrompt'; key: string; text: string }
  /** The open chats in the order they now appear on screen. */
  | { type: 'order'; keys: string[] }
  | { type: 'saveLayout'; name: string }
  | { type: 'applyLayout'; name: string }
  | { type: 'deleteLayout'; name: string }
  | { type: 'deckFullscreen' }
  | { type: 'runServer'; root: string; script: string }
  | { type: 'stopServer'; pid: number }
  | { type: 'openServer'; port: number }
  | { type: 'answer'; key: string; id: string; answer: AskAnswer }
  | { type: 'setMode'; key: string; mode: string }
  | { type: 'setModel'; key: string; model: string }
  | { type: 'setChrome'; key: string; chrome: boolean }
  | { type: 'setEffort'; key: string; effort: string }
  | { type: 'setFocus'; key: string; focus: boolean }
  /** '' restores the agent's own title. */
  | { type: 'rename'; key: string; title: string }
  | { type: 'recap' }
  | { type: 'openDiff'; path: string; key?: string }
  /** scope = the chat's key, or a folder for a new chat; it picks up project skills. */
  | { type: 'skills'; agent: AgentId; scope: string }
  /** A sub-agent's own transcript, for its card. */
  | { type: 'agentLog'; key: string; agentId: string }
  | { type: 'agentMap'; key: string }
  | { type: 'stopAgent'; key: string; agentId: string }
  | { type: 'layout'; layout: Layout }
  | { type: 'loadEarlier'; key: string }
  | { type: 'openLink'; href: string; key?: string }
  | { type: 'copy'; text: string };
