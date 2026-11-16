// @-mentions and attachments: the rules shared by the extension host and the webview. No node or vscode imports.
import type { AgentId, FileEntry } from './types';

const MB = 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * MB;
export const MAX_FILE_BYTES = 10 * MB;
export const MAX_TOTAL_BYTES = 20 * MB;

const IMAGES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const TEXT_EXTENSIONS = new Set(
  'txt md markdown json jsonc csv tsv ts tsx js jsx mjs cjs py rb go rs java kt swift c cc cpp h hpp cs php css scss less html htm xml yaml yml toml ini cfg conf sh bash zsh sql log graphql prisma vue svelte lua dart scala gradle properties diff patch tex rst gitignore'.split(
    ' ',
  ),
);
const TEXT_NAMES = new Set(['dockerfile', 'makefile', 'readme', 'license']);

/** What a file is sent as (an image or PDF MIME type, or text/plain), or undefined when it cannot be attached. */
export function attachmentType(name: string, type = ''): string | undefined {
  const lower = name.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  if (Object.values(IMAGES).includes(type)) return type;
  if (IMAGES[ext]) return IMAGES[ext];
  if (type === 'application/pdf' || ext === 'pdf') return 'application/pdf';
  if (TEXT_EXTENSIONS.has(ext) || TEXT_NAMES.has(lower)) return 'text/plain';
  return undefined;
}

export interface Candidate {
  name: string;
  size: number;
  type?: string;
}

/** Keeps the files that fit on top of `used` bytes already attached; `message` says why the others were skipped. */
export function screenAttachments<T extends Candidate>(files: T[], used: number): { ok: T[]; message: string } {
  const skipped = new Map<string, string[]>();
  const skip = (why: string, name: string) => skipped.set(why, [...(skipped.get(why) ?? []), name]);
  const ok: T[] = [];
  let total = used;
  for (const f of files) {
    const type = attachmentType(f.name, f.type);
    const image = !!type?.startsWith('image/');
    if (!type) skip('unsupported type', f.name);
    else if (!f.size) skip('empty', f.name);
    else if (f.size > (image ? MAX_IMAGE_BYTES : MAX_FILE_BYTES)) skip(`over ${image ? 5 : 10} MB`, f.name);
    else if (total + f.size > MAX_TOTAL_BYTES) skip('attachments would pass 20 MB in total', f.name);
    else {
      ok.push(f);
      total += f.size;
    }
  }
  return { ok, message: [...skipped].map(([why, names]) => `Not attached (${why}): ${names.join(', ')}`).join('\n') };
}

/** How the transcript will show a message with attachments (the Claude parser's [image] / [document]), to match the pending bubble. */
export function transcriptText(text: string, attachments: { type: string }[]): string {
  return [text, ...attachments.map((a) => (a.type.startsWith('image/') ? '[image]' : '[document]'))].filter(Boolean).join('\n\n');
}

/** An @ typed after whitespace (or at the start), up to the caret: where it starts and what follows it. */
export function mentionAt(beforeCaret: string): { start: number; query: string } | undefined {
  const m = /(?:^|\s)@("[^"\n]*|[^\s"]*)$/.exec(beforeCaret);
  return m ? { start: beforeCaret.length - m[1].length - 1, query: m[1].replace(/^"/, '') } : undefined;
}

/**
 * What picking an entry puts in the box. Claude: @path (quoted when it has spaces); Codex has no @ syntax, so its
 * plain path. `drill` keeps the @ and ends in "/" with no trailing space, so the picker stays open on that folder.
 */
export function mentionText(e: Pick<FileEntry, 'path' | 'folder'>, agent: AgentId, drill = false): string {
  const p = e.folder ? `${e.path}/` : e.path;
  const quoted = /\s/.test(p);
  if (drill) return quoted ? `@"${p}` : `@${p}`;
  if (agent === 'codex') return `${p} `;
  return quoted ? `@"${p}" ` : `@${p} `;
}
