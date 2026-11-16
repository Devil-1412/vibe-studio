// Keystroke Coins: the rules of the idle game. Pure (no DOM, no vscode), so the webview and the self-test share it.

export interface GameState {
  coins: number;
  /** Everything ever earned; shown in the shop, never spent. */
  lifetime: number;
  owned: Record<string, number>;
  /** Wardrobe items unlocked (coats, hats, neckwear), by id. */
  wardrobe: string[];
  /** ms since epoch of the last tick or save, for offline gains. */
  at: number;
}

export interface Upgrade {
  id: string;
  name: string;
  desc: string;
  base: number;
  /** One purchase only. */
  once?: boolean;
}

export const UPGRADES: Upgrade[] = [
  { id: 'keys', name: 'Bigger keys', desc: '+1 coin per character you type.', base: 50 },
  { id: 'coffee', name: 'Coffee', desc: 'Typing 20 characters without a pause doubles each one.', base: 300, once: true },
  { id: 'cats', name: 'Helper cats', desc: '+1 coin a second for every tile that is running.', base: 100 },
  { id: 'night', name: 'Night shift', desc: '+2 coins a second while you are away from the studio.', base: 400 },
  { id: 'bone', name: 'Lucky bone', desc: 'A 2% chance that sending a message pays a 100× bonus.', base: 1000, once: true },
];

export interface WardrobeItem {
  id: string;
  kind: 'coat' | 'hat' | 'neck';
  name: string;
  cost: number;
}

/** Bought once with coins, then any cat can wear them. The six first coats are free. */
export const WARDROBE: WardrobeItem[] = [
  { id: 'Tuxedo', kind: 'coat', name: 'Tuxedo', cost: 300 },
  { id: 'Lilac', kind: 'coat', name: 'Lilac', cost: 400 },
  { id: 'Golden', kind: 'coat', name: 'Golden', cost: 600 },
  { id: 'Cyber', kind: 'coat', name: 'Cyber', cost: 1000 },
  { id: 'party', kind: 'hat', name: 'Party hat', cost: 150 },
  { id: 'beanie', kind: 'hat', name: 'Beanie', cost: 200 },
  { id: 'wizard', kind: 'hat', name: 'Wizard hat', cost: 300 },
  { id: 'crown', kind: 'hat', name: 'Crown', cost: 2000 },
  { id: 'bell', kind: 'neck', name: 'Bell collar', cost: 100 },
  { id: 'bowtie', kind: 'neck', name: 'Bow tie', cost: 120 },
  { id: 'scarf', kind: 'neck', name: 'Scarf', cost: 200 },
];

export const GROWTH = 1.15;
export const COMBO_AT = 20;
export const COMBO_GAP_MS = 2000;
export const OFFLINE_CAP_MS = 8 * 3600_000;
/** Away time pays a quarter of the rate of one running tile. */
const OFFLINE_SHARE = 0.25;

export const newGame = (now = Date.now()): GameState => ({ coins: 0, lifetime: 0, owned: {}, wardrobe: [], at: now });

const level = (s: GameState, id: string) => s.owned[id] ?? 0;

/** Anything read back from storage is treated as untrusted. */
export function loadGame(raw: unknown, now = Date.now()): GameState {
  const r = (raw ?? {}) as Partial<GameState>;
  const num = (n: unknown) => (typeof n === 'number' && isFinite(n) && n >= 0 ? n : 0);
  const owned: Record<string, number> = {};
  for (const u of UPGRADES) {
    const n = Math.floor(num(r.owned?.[u.id]));
    if (n) owned[u.id] = u.once ? 1 : n;
  }
  const ids = new Set(WARDROBE.map((w) => w.id));
  const wardrobe = [...new Set([...(Array.isArray(r.wardrobe) ? r.wardrobe : []), ...(num((r.owned as any)?.crown) ? ['crown'] : [])])].filter((id): id is string => typeof id === 'string' && ids.has(id));
  return { coins: num(r.coins), lifetime: num(r.lifetime), owned, wardrobe, at: num(r.at) || now };
}

export function cost(id: string, owned: number): number {
  const u = UPGRADES.find((x) => x.id === id)!;
  return Math.ceil(u.base * GROWTH ** owned - 1e-9);
}

export const canBuy = (s: GameState, id: string): boolean => {
  const u = UPGRADES.find((x) => x.id === id);
  return !!u && !(u.once && level(s, id)) && s.coins >= cost(id, level(s, id));
};

export function buy(s: GameState, id: string): boolean {
  if (!canBuy(s, id)) return false;
  s.coins -= cost(id, level(s, id));
  s.owned[id] = level(s, id) + 1;
  return true;
}

export function earn(s: GameState, n: number): void {
  s.coins += n;
  s.lifetime += n;
}

/** Coins for one typed character; `combo` is how many came in a row without a pause. */
export const perChar = (s: GameState, combo: number): number => (1 + level(s, 'keys')) * (level(s, 'coffee') && combo >= COMBO_AT ? 2 : 1);

/** Coins a second, from helpers (per running tile) and the night shift (when away). */
export const rate = (s: GameState, running: number, away: boolean): number => level(s, 'cats') * running + (away ? 2 * level(s, 'night') : 0);

export function tick(s: GameState, seconds: number, running: number, away: boolean): number {
  const n = rate(s, running, away) * seconds;
  earn(s, n);
  return n;
}

/** Coins earned while Vibe Studio was closed: capped at 8 hours, at a quarter of one tile's pace. */
export function offlineGain(s: GameState, now: number): number {
  const ms = Math.min(Math.max(0, now - s.at), OFFLINE_CAP_MS);
  return Math.floor(((level(s, 'cats') + 2 * level(s, 'night')) * ms * OFFLINE_SHARE) / 1000);
}

/** Lucky bone: pays on a sent message, `roll` is a number in [0,1). */
export const bonus = (s: GameState, roll: number): number => (level(s, 'bone') && roll < 0.02 ? 100 * perChar(s, 0) : 0);

/** Cat preferences from storage or the webview: only known hats and neckwear, short strings. */
export function cleanCat(raw: unknown): { name?: string; coat?: string; hat?: string; neck?: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const item = (v: unknown, kind: 'hat' | 'neck') => (typeof v === 'string' && WARDROBE.some((w) => w.kind === kind && w.id === v) ? v : undefined);
  const out = { name: str(r.name, 20), coat: str(r.coat, 20), hat: item(r.hat, 'hat'), neck: item(r.neck, 'neck') };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

export const owns = (s: GameState, id: string): boolean => s.wardrobe.includes(id);

/** Unlocks a wardrobe item for good; false when it is owned, unknown or too dear. */
export function buyItem(s: GameState, id: string): boolean {
  const w = WARDROBE.find((x) => x.id === id);
  if (!w || owns(s, id) || s.coins < w.cost) return false;
  s.coins -= w.cost;
  s.wardrobe.push(id);
  return true;
}

export function compact(n: number): string {
  const v = Math.floor(n);
  if (v < 1000) return String(v);
  const units = ['K', 'M', 'B', 'T'];
  let x = v;
  let i = -1;
  while (x >= 1000 && i < units.length - 1) {
    x /= 1000;
    i++;
  }
  return `${x < 10 ? x.toFixed(1).replace(/\.0$/, '') : Math.floor(x)}${units[i]}`;
}
