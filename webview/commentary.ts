// What a cat says: a few words about what its agent is doing now. Pure (no DOM), so the self-test can run it.
export type Mood = 'sleep' | 'idle' | 'think' | 'type' | 'read' | 'edit' | 'juggle' | 'dizzy' | 'dance';

export interface Facts {
  name: string;
  mood: Mood;
  /** File the running tool is on, when it names one. */
  file?: string;
  helpers: number;
  /** Files the chat has changed. */
  changed: number;
}

const clip = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function sayings(f: Facts): string | undefined {
  const who = f.name;
  const helpers = f.helpers ? ` · ${f.helpers} helper${f.helpers === 1 ? '' : 's'}` : '';
  switch (f.mood) {
    case 'think':
      return `${who} is thinking…${helpers}`;
    case 'type':
      return `${who} is writing`;
    case 'read':
      return `${who} is reading ${f.file ? clip(f.file) : 'files'}`;
    case 'edit':
      return `${who} is editing ${f.file ? clip(f.file) : 'files'}`;
    case 'juggle':
      return `${who} is running tools${helpers}`;
    case 'dizzy':
      return `${who} hit an error`;
    case 'dance':
      return f.changed ? `${who} is done · ${f.changed} file${f.changed === 1 ? '' : 's'} changed` : `${who} is done!`;
    default:
      return undefined;
  }
}

export const SHOW_MS = 6000;
export const GAP_MS = 8000;

export interface Pace {
  /** The line on screen, or the last one shown. */
  shown?: string;
  /** When it appeared. */
  at: number;
  visible: boolean;
}

/** Decides each second whether the bubble shows `text`: a new line at most every 8 s (errors and a finish at once), gone after 6 s. */
export function pace(p: Pace, text: string | undefined, mood: Mood, now: number): Pace {
  const urgent = mood === 'dizzy' || mood === 'dance';
  if (text && text !== p.shown && (urgent || now - p.at >= GAP_MS)) return { shown: text, at: now, visible: true };
  if (p.visible && now - p.at >= SHOW_MS) return { ...p, visible: false };
  if (p.visible && !text) return { ...p, visible: false };
  return p;
}
