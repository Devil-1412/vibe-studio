import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentId } from './types';

const EXE = process.platform === 'win32' ? '.exe' : '';

const SOURCES: Record<AgentId, { setting: string; extension: string; name: string }> = {
  claude: { setting: 'claudePath', extension: 'anthropic.claude-code', name: 'claude' },
  codex: { setting: 'codexPath', extension: 'openai.chatgpt', name: 'codex' },
};

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function fromExtension(agent: AgentId): string | undefined {
  const ext = vscode.extensions.getExtension(SOURCES[agent].extension);
  if (!ext) return undefined;
  if (agent === 'claude') {
    const p = path.join(ext.extensionPath, 'resources', 'native-binary', `claude${EXE}`);
    return isFile(p) ? p : undefined;
  }
  const bin = path.join(ext.extensionPath, 'bin');
  const platform = { darwin: 'macos', linux: 'linux', win32: 'windows' }[process.platform as string] ?? process.platform;
  const arch = { arm64: 'aarch64', x64: 'x86_64' }[process.arch as string] ?? process.arch;
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(bin);
  } catch {
    return undefined;
  }
  dirs.sort((a, b) => Number(b === `${platform}-${arch}`) - Number(a === `${platform}-${arch}`));
  for (const d of dirs) {
    const p = path.join(bin, d, `codex${EXE}`);
    if (isFile(p)) return p;
  }
  return undefined;
}

function fromPath(name: string): string | undefined {
  const home = os.homedir();
  const dirs = [
    ...(process.env.PATH ?? '').split(path.delimiter),
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.bun', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  for (const d of dirs) {
    if (!d) continue;
    const p = path.join(d, name + EXE);
    if (isFile(p)) return p;
  }
  return undefined;
}

/** Setting first, then the binary bundled with the agent's own VS Code extension, then PATH. */
export function resolveBinary(agent: AgentId): string | undefined {
  const configured = vscode.workspace.getConfiguration('vibeStudio').get<string>(SOURCES[agent].setting)?.trim();
  if (configured) return isFile(configured) ? configured : undefined;
  return fromExtension(agent) ?? fromPath(SOURCES[agent].name);
}
