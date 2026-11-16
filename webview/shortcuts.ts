// Keyboard shortcuts: one table drives both the key handler and the cheat sheet. Ctrl+Alt on every platform.

export interface Shortcut {
  keys: string;
  what: string;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl+Alt+Enter', what: 'Full screen for the focused tile (Esc leaves)' },
  { keys: 'Ctrl+Alt+Shift+Enter', what: 'Studio full screen: hide the lists and maximize the editor' },
  { keys: 'Ctrl+Alt+1 … 9', what: 'Jump to tile 1 … 9' },
  { keys: 'Ctrl+Alt+Arrows', what: 'Move to the tile left, right, above or below' },
  { keys: 'Ctrl+Alt+Shift+Arrows', what: 'Move this tile one place' },
  { keys: 'Ctrl+Alt+N', what: 'New chat' },
  { keys: 'Ctrl+Alt+W', what: 'Close the focused tile' },
  { keys: 'Ctrl+Alt+F', what: 'Focus view for the tile' },
  { keys: 'Ctrl+Alt+S', what: 'Show or hide the session list' },
  { keys: 'Ctrl+Alt+U', what: 'Usage limits' },
  { keys: 'Ctrl+Alt+H', what: 'Shelf' },
  { keys: 'Ctrl+Alt+/', what: 'This list' },
];

export type Action = 'max' | 'zen' | 'tile' | 'left' | 'right' | 'up' | 'down' | 'new' | 'close' | 'sidebar' | 'usage' | 'shelf' | 'help';

/** What a key press means, or undefined. Needs Ctrl+Alt, never AltGr (that types characters on many layouts). */
export function actionOf(e: { ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean; code: string; key: string }, altGraph = false): { action: Action; shift: boolean; n?: number } | undefined {
  if (!e.ctrlKey || !e.altKey || e.metaKey || altGraph) return undefined;
  const shift = e.shiftKey;
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit) return shift ? undefined : { action: 'tile', shift, n: Number(digit[1]) };
  switch (e.code) {
    case 'Enter':
      return { action: shift ? 'zen' : 'max', shift };
    case 'ArrowLeft':
      return { action: 'left', shift };
    case 'ArrowRight':
      return { action: 'right', shift };
    case 'ArrowUp':
      return { action: 'up', shift };
    case 'ArrowDown':
      return { action: 'down', shift };
  }
  if (shift) return undefined;
  switch (e.code) {
    case 'KeyN':
      return { action: 'new', shift };
    case 'KeyW':
      return { action: 'close', shift };
    case 'KeyS':
      return { action: 'sidebar', shift };
    case 'KeyU':
      return { action: 'usage', shift };
    case 'KeyH':
      return { action: 'shelf', shift };
    case 'Slash':
      return { action: 'help', shift };
  }
  return e.key === '/' ? { action: 'help', shift } : undefined;
}

/** Index of the neighbouring tile in a grid of `cols` columns, or the same index at an edge. */
export function neighbour(i: number, count: number, cols: number, dir: 'left' | 'right' | 'up' | 'down'): number {
  const d = dir === 'left' ? -1 : dir === 'right' ? 1 : dir === 'up' ? -cols : cols;
  const j = i + d;
  if ((dir === 'left' && i % cols === 0) || (dir === 'right' && i % cols === cols - 1)) return i;
  return j < 0 || j >= count ? i : j;
}
