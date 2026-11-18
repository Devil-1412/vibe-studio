import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import type { RunPlan } from './adapters/common';

export interface RunHandlers {
  onLine(line: string): void;
  onExit(code: number | null, stderr: string, stopped: boolean): void;
}

/** A process that stays up between messages (Claude's stream-json input), like the VS Code panel's. */
export interface LiveSpec {
  bin: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Same signature = same flags, so the running process can take the next message. */
  sig: string;
  /** Permission mode the next message wants. A different one is sent to the running process instead of restarting it. */
  mode?: string;
  setMode?(mode: string): string;
  /** Line that interrupts the current turn without ending the process. */
  interrupt?: string;
  isTurnEnd(line: string): boolean;
  /** Answer to a control request the process sends us, so it never waits on the host. */
  controlReply?(line: string): string | undefined;
}

interface Live {
  proc: ChildProcess;
  spec: LiveSpec;
  busy: boolean;
  handlers?: RunHandlers;
  err: string;
  stopping: boolean;
  release: boolean;
  idle?: NodeJS.Timeout;
}

// Idle live processes exit after this; the next message starts a new one (and runs SessionStart hooks again).
const LIVE_IDLE_MS = 30 * 60_000;

const workDir = (cwd?: string) => (cwd && fs.existsSync(cwd) ? cwd : os.homedir());

/** Feeds a child's stdout to onLine one complete line at a time. */
function readLines(child: ChildProcess, onLine: (line: string) => void): () => void {
  let out = '';
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    const lines = (out + chunk).split('\n');
    out = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onLine(line);
  });
  return () => {
    if (out.trim()) onLine(out);
    out = '';
  };
}

/** One agent process per session, so each tile talks to its own agent. */
export class Runner {
  private procs = new Map<string, ChildProcess>();
  private stopped = new Set<ChildProcess>();
  private live = new Map<string, Live>();
  readonly lastExit = new Map<string, number>();

  isRunning(key: string): boolean {
    return this.procs.has(key) || !!this.live.get(key)?.busy;
  }

  /** One-shot run: the prompt goes in on stdin and the process exits after its reply. */
  start(key: string, bin: string, plan: RunPlan, cwd: string | undefined, h: RunHandlers, env?: Record<string, string>): void {
    const child = spawn(bin, plan.args, { cwd: workDir(cwd), env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.procs.set(key, child);

    let err = '';
    let done = false;
    const flush = readLines(child, (line) => h.onLine(line));
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      flush();
      for (const [k, p] of this.procs) {
        if (p !== child) continue;
        this.procs.delete(k);
        this.lastExit.set(k, Date.now());
      }
      h.onExit(code, err.trim(), this.stopped.delete(child));
    };

    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      err = (err + chunk).slice(-4000);
    });
    child.on('error', (e) => {
      err += `${e.message}\n`;
      finish(null);
    });
    child.on('close', (code) => finish(code));
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(plan.stdin);
  }

  /** Sends one message to the session's live process, starting (or restarting with new flags) it if needed. */
  send(key: string, spec: LiveSpec, line: string, h: RunHandlers): void {
    let l = this.live.get(key);
    if (l && l.spec.sig !== spec.sig) {
      this.close(key);
      l = undefined;
    }
    if (!l) l = this.spawnLive(key, spec);
    else if (spec.mode && spec.mode !== l.spec.mode && spec.setMode) {
      // a restart would kill the sub-agents still running in this process
      l.proc.stdin?.write(`${spec.setMode(spec.mode)}\n`);
      l.spec = { ...l.spec, mode: spec.mode };
    }
    clearTimeout(l.idle);
    Object.assign(l, { busy: true, handlers: h, err: '', stopping: false, release: false });
    l.proc.stdin?.write(`${line}\n`);
  }

  private spawnLive(key: string, spec: LiveSpec): Live {
    const proc = spawn(spec.bin, spec.args, { cwd: workDir(spec.cwd), env: { ...process.env, ...spec.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const l: Live = { proc, spec, busy: false, err: '', stopping: false, release: false };
    this.live.set(key, l);
    readLines(proc, (line) => {
      const reply = spec.controlReply?.(line);
      if (reply) proc.stdin?.write(`${reply}\n`);
      l.handlers?.onLine(line);
      if (l.busy && spec.isTurnEnd(line)) this.endTurn(key, l, 0);
    });
    proc.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      l.err = (l.err + chunk).slice(-4000);
    });
    let gone = false;
    const onGone = (code: number | null) => {
      if (gone) return;
      gone = true;
      clearTimeout(l.idle);
      if (this.live.get(key) === l) this.live.delete(key);
      if (l.busy) this.endTurn(key, l, code || 1);
    };
    proc.on('error', (e) => {
      l.err += `${e.message}\n`;
      onGone(null);
    });
    proc.on('close', (code) => onGone(code));
    proc.stdin?.on('error', () => undefined);
    return l;
  }

  private endTurn(key: string, l: Live, code: number): void {
    l.busy = false;
    this.lastExit.set(key, Date.now());
    const h = l.handlers;
    l.handlers = undefined;
    if (this.live.get(key) === l) {
      if (l.release) this.close(key);
      else l.idle = setTimeout(() => this.close(key), LIVE_IDLE_MS);
    }
    h?.onExit(code, l.err.trim(), l.stopping);
  }

  /** Ends a live process (closing stdin lets it exit cleanly). */
  private close(key: string): void {
    const l = this.live.get(key);
    if (!l) return;
    this.live.delete(key);
    clearTimeout(l.idle);
    l.proc.stdin?.end();
    setTimeout(() => {
      if (l.proc.exitCode === null && l.proc.signalCode === null) l.proc.kill('SIGTERM');
    }, 3000);
  }

  /** True when Vibe Studio owns a live process for this session (so control requests can reach it). */
  hasLive(key: string): boolean {
    return this.live.has(key);
  }

  /** Writes a control request to the live process; false if there is none. */
  control(key: string, line: string): boolean {
    const l = this.live.get(key);
    if (!l) return false;
    l.proc.stdin?.write(`${line}\n`);
    return true;
  }

  /** The tile closed: end its live process now, or after the turn in progress. */
  release(key: string): void {
    const l = this.live.get(key);
    if (l?.busy) l.release = true;
    else this.close(key);
  }

  /** Codex picks its own id; the run starts under a draft key and moves once the id is known. */
  rekey(from: string, to: string): void {
    const p = this.procs.get(from);
    if (!p) return;
    this.procs.delete(from);
    this.procs.set(to, p);
  }

  stop(key: string): void {
    const l = this.live.get(key);
    if (l?.busy) {
      l.stopping = true;
      // Interrupt keeps the process (and its warm state); kill only if it doesn't answer.
      if (l.spec.interrupt) l.proc.stdin?.write(`${l.spec.interrupt}\n`);
      else l.proc.kill('SIGINT');
      setTimeout(() => l.busy && l.stopping && l.proc.kill('SIGINT'), 5000);
      return;
    }
    const p = this.procs.get(key);
    if (!p) return;
    this.stopped.add(p);
    p.kill('SIGINT');
    setTimeout(() => {
      if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
    }, 4000);
  }

  dispose(): void {
    for (const p of this.procs.values()) p.kill('SIGTERM');
    this.procs.clear();
    for (const l of this.live.values()) l.proc.kill('SIGTERM');
    this.live.clear();
  }
}
