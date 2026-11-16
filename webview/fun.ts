// Ambient companions: a creature on every tile that acts out what its agent is doing (a cat for Claude, a robot for Codex).
// Pure SVG + CSS animations; JS only switches states once a second.
import type { AgentId } from '../src/types';

import type { Mood } from './commentary';
export type { Mood };

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(viewBox: string, cls: string, inner: string): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('class', cls);
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = inner;
  return el;
}

// ---- tile companions ---------------------------------------------------------------------------

const BIT = `
<ellipse cx="20" cy="37.1" rx="11.5" ry="1.5" fill="#11152d" opacity=".18"/>
<path class="stalk" d="M20 8.5V5.8" fill="none" stroke="#2b2f66" stroke-width="1.6"/>
<circle class="antenna" cx="20" cy="4.2" r="2.25" fill="#ffcc4d" stroke="#2b2f66" stroke-width="1"/>
<g class="feet" fill="#5a68c9" stroke="#2b2f66" stroke-width="1">
<rect x="10.3" y="33.2" width="7.7" height="3.8" rx="1.9"/><rect x="22" y="33.2" width="7.7" height="3.8" rx="1.9"/>
</g>
<path d="M13 27.5h14v6.3c-3.5 1.5-10.5 1.5-14 0Z" fill="#6877dc" stroke="#2b2f66" stroke-width="1.15"/>
<path d="M16.2 30.7h7.6" fill="none" stroke="#aeb8ff" stroke-width=".7" opacity=".7"/>
<g class="arms" fill="#5a68c9" stroke="#2b2f66" stroke-width="1">
<path class="arm" d="M7.8 25.1c-1.8.3-2.7 1.8-2.1 3.8.4 1.2 1.4 1.8 2.7 1.7l1.6-1.5-1.2-3.6Z"/>
<path class="arm" d="M32.2 25.1c1.8.3 2.7 1.8 2.1 3.8-.4 1.2-1.4 1.8-2.7 1.7L30 29.1l1.2-3.6Z"/>
</g>
<rect x="4.3" y="13.4" width="4.8" height="9.5" rx="2.4" fill="#5a68c9" stroke="#2b2f66" stroke-width="1.1"/>
<rect x="30.9" y="13.4" width="4.8" height="9.5" rx="2.4" fill="#5a68c9" stroke="#2b2f66" stroke-width="1.1"/>
<rect class="shape" x="7.1" y="8.2" width="25.8" height="22.2" rx="8" fill="#7c8cf0" stroke="#2b2f66" stroke-width="1.3"/>
<path d="M11 11.8c4.2-2.5 12.4-2.8 17.9-.3" fill="none" stroke="#fff" stroke-width="1.3" opacity=".34"/>
<path d="M29.8 11.8c1.1 2.1 1.3 4.2.7 6.2" fill="none" stroke="#aeb8ff" stroke-width=".75" opacity=".65"/>
<rect class="screen" x="9.8" y="13" width="20.4" height="13.8" rx="4.8" fill="#1b1e3a" stroke="#2b2f66" stroke-width=".8"/>
<g class="eyes" fill="#7dffb0">
<rect x="13.1" y="16.5" width="4.2" height="5" rx="2"/><rect x="22.7" y="16.5" width="4.2" height="5" rx="2"/>
</g>
<circle cx="14.5" cy="17.8" r=".72" fill="#fff"/><circle cx="24.1" cy="17.8" r=".72" fill="#fff"/>
<ellipse cx="12.1" cy="23.3" rx="1.35" ry=".7" fill="#ff7a9a" opacity=".72"/><ellipse cx="27.9" cy="23.3" rx="1.35" ry=".7" fill="#ff7a9a" opacity=".72"/>
<path class="mouth" d="M16.1 22.7c1.7 2 6.1 2 7.8 0-.6 2.7-7.2 2.7-7.8 0Z" fill="#7dffb0"/>
<circle cx="20" cy="31.8" r="1.25" fill="#ffcc4d" stroke="#2b2f66" stroke-width=".7"/>`;

const PROPS = `
  <g class="prop laptop"><rect class="lid" x="36" y="30" width="15" height="9.5" rx="1.2"/><rect class="glow" x="38" y="32.2" width="6" height="1.2"/><rect class="base" x="33" y="39.5" width="21" height="2.2" rx="1"/></g>
  <g class="prop glass"><circle class="lens" cx="47" cy="20" r="4.6"/><line class="handle" x1="50.3" y1="23.3" x2="54" y2="27"/></g>
  <g class="prop hammer"><rect class="grip" x="45.6" y="16" width="2" height="14" rx="1"/><rect class="head" x="42" y="13" width="9" height="5" rx="1.2"/></g>
  <g class="prop balls"><circle cx="20" cy="7" r="2.2"/><circle cx="28" cy="7" r="2.2"/><circle cx="36" cy="7" r="2.2"/></g>
  <g class="prop dizzy"><text x="18" y="9">✦</text><text x="33" y="7">✦</text><text x="26" y="3.5">✦</text></g>
  <g class="prop notes"><text x="42" y="13">♪</text><text x="5" y="15">♫</text></g>
  <g class="prop zzz"><text x="42" y="13">z</text><text x="46.5" y="8">z</text><text x="51" y="3.5">Z</text></g>
  <g class="prop think"><circle cx="42" cy="11.5" r="1.8"/><circle cx="46.5" cy="8" r="2.3"/><circle cx="52" cy="4" r="2.9"/></g>
  <g class="prop heart"><path d="M28 9c-1.6-2.6-5.4-1.6-5 1.3.3 2 3.2 3.6 5 5.2 1.8-1.6 4.7-3.2 5-5.2.4-2.9-3.4-3.9-5-1.3z"/></g>`;

const MOOD_TEXT: Record<Mood, string> = {
  sleep: 'napping',
  idle: 'hanging out',
  think: 'thinking',
  type: 'writing',
  read: 'reading',
  edit: 'editing files',
  juggle: 'running tools',
  dizzy: 'dizzy from an error',
  dance: 'celebrating',
};

/** Lines a chat has shipped decide how big its companion has grown. */
export function petLevel(lines: number): number {
  return lines >= 2000 ? 4 : lines >= 500 ? 3 : lines >= 50 ? 2 : 1;
}

export interface Pet {
  el: SVGSVGElement;
  /** Name of the cat's coat; empty for the robot. */
  coat: string;
  set(mood: Mood, buddies: number, lines: number): void;
  /** Changes the coat, hat and neckwear. Unknown or empty parts reset to the default. */
  dress(p: { coat?: string; hat?: string; neck?: string }): void;
}

const CROWN = '<path class="crown" d="M12.7 11 14 5.7l3.7 3 2.3-5 2.3 5 3.7-3 1.3 5Z" fill="#f6c453" stroke="#9b6624" stroke-width=".7" stroke-linejoin="round"/>';
// Hats and neckwear for the sitting cat, in its 32 x 28 drawing. Shown by data-hat / data-neck on the pet.
const ACCESSORIES = `
  <g class="hat hat-party"><path d="M12.6 4.8 16-3.6l3.4 8.4z" fill="#ff6fb5" stroke="#2b1a12" stroke-width=".5" stroke-linejoin="round"/><path d="m13.9 1.4 4.4 1.5M13.2 3.4l5.7 1.1" fill="none" stroke="#fff" stroke-width=".7" stroke-linecap="round" opacity=".85"/><circle cx="16" cy="-3.8" r="1.1" fill="#ffd84d" stroke="#2b1a12" stroke-width=".4"/></g>
  <g class="hat hat-beanie"><path d="M11 5c0-3.9 2.2-5.6 5-5.6S21 1.1 21 5z" fill="#4aa3d8" stroke="#2b1a12" stroke-width=".5" stroke-linejoin="round"/><rect x="10.4" y="3.5" width="11.2" height="2" rx="1" fill="#2f7fb0" stroke="#2b1a12" stroke-width=".4"/><circle cx="16" cy="-1.1" r="1.3" fill="#fff" stroke="#2b1a12" stroke-width=".4"/></g>
  <g class="hat hat-wizard"><path d="M11.8 4.9 16.4-6.4l4 11.3z" fill="#6a4cc9" stroke="#2b1a12" stroke-width=".5" stroke-linejoin="round"/><ellipse cx="16" cy="5" rx="7.4" ry="1.5" fill="#5a3db3" stroke="#2b1a12" stroke-width=".5"/><circle cx="15.6" cy="0" r=".7" fill="#ffd84d"/><circle cx="17.6" cy="2.6" r=".55" fill="#ffd84d"/></g>
  <g class="neck neck-bell"><path d="M11.2 19.8c3 1.3 6.6 1.3 9.6 0" fill="none" stroke="#e5484d" stroke-width="1.1" stroke-linecap="round"/><circle cx="16" cy="21.4" r="1.2" fill="#ffd84d" stroke="#9b6624" stroke-width=".4"/><path d="M15.4 21.6h1.2" stroke="#9b6624" stroke-width=".35"/></g>
  <g class="neck neck-bowtie"><path d="M16 20.6 12.4 18.6v4zM16 20.6l3.6-2v4z" fill="#e5484d" stroke="#2b1a12" stroke-width=".45" stroke-linejoin="round"/><circle cx="16" cy="20.6" r="1" fill="#b3282d" stroke="#2b1a12" stroke-width=".35"/></g>
  <g class="neck neck-scarf"><path d="M10.4 19.6c3.7 1.8 7.5 1.8 11.2 0l.6 2.2c-4 2-8.4 2-12.4 0z" fill="#e5484d" stroke="#2b1a12" stroke-width=".45" stroke-linejoin="round"/><path d="m18.8 21.8 1.6 3.6-2.3.5-1-3.2z" fill="#c23338" stroke="#2b1a12" stroke-width=".4" stroke-linejoin="round"/><path d="M12.4 20.6l.4 1.8M15 21l.2 1.8" stroke="#fff" stroke-width=".5" opacity=".7"/></g>`;

// sits on the cat's head, between the ears
const CAT_CROWN = '<path class="crown" d="M12.2 4.7 12.8.8l2.1 2L16 0l1.1 2.8 2.1-2 .6 3.9Z" fill="#f6c453" stroke="#9b6624" stroke-width=".45" stroke-linejoin="round"/>';

/** Claude tiles get a cat in a coat no other tile wears; Codex tiles get the robot Bit. */
export function createPet(agent: AgentId, worn: Iterable<string>, seed: string): Pet {
  const first = agent === 'claude' ? pickLook(new Set(worn), seed) : undefined;
  let look = first;
  const creature = look
    ? `<g class="creature"><g transform="translate(1.4 8.8) scale(1.12)" stroke-linecap="round" stroke-linejoin="round"><g class="cat-sit">${catSit()}${ACCESSORIES}${CAT_CROWN}</g><g class="cat-sleep">${catSleep()}</g></g></g>`
    : `<g class="creature">${BIT}${CROWN}</g>`;
  // mini copies on the left stand for running sub-agents (kittens in other coats for the cat)
  const buddies = [0, 1, 2]
    .map((i) => {
      const kitten = look ? CATS[(CATS.indexOf(look) + 1 + i) % CATS.length] : undefined;
      const art = kitten ? catSit() : BIT;
      // kittens stand further left and a bit bigger, clear of the main cat's tail
      const x = kitten ? -20 + i * 7 : -13 + i * 5;
      return `<g class="buddy b${i + 1}" transform="translate(${x} ${(kitten ? 30 : 28) - (i % 2) * 3}) scale(${kitten ? 0.4 : 0.32})"${kitten ? ` style="${coatVars(kitten)}"` : ''}><g>${art}</g></g>`;
    })
    .join('');
  const el = svg('-14 0 70 44', `pet ${look ? 'kitty' : 'codex'}`, `${buddies}${creature}${PROPS}`);
  if (look) {
    el.style.cssText = coatVars(look);
    el.dataset.coat = look.name;
  }
  el.setAttribute('aria-hidden', 'false');
  el.setAttribute('role', 'img');
  // a boop: tap the creature for a hop and a heart
  el.querySelector('.creature')!.addEventListener('click', () => {
    el.classList.remove('boop');
    void el.getBoundingClientRect();
    el.classList.add('boop');
    setTimeout(() => el.classList.remove('boop'), 900);
  });
  const name = look?.name ?? 'Bit';
  let last = '';
  return {
    el,
    get coat() {
      return look?.name ?? '';
    },
    dress(p) {
      if (!first) return;
      look = COATS.find((c) => c.name === p.coat) ?? first;
      el.style.cssText = coatVars(look);
      el.dataset.coat = look.name;
      el.dataset.hat = p.hat ?? '';
      el.dataset.neck = p.neck ?? '';
    },
    set(mood, n, lines) {
      const level = petLevel(lines);
      const sig = `${mood}|${n}|${level}`;
      if (sig === last) return;
      last = sig;
      el.dataset.mood = mood;
      el.dataset.buddies = String(Math.min(3, n));
      el.dataset.level = String(level);
      const label = `${name} is ${MOOD_TEXT[mood]} · level ${level} (${lines.toLocaleString()} lines shipped) · tap for a boop`;
      el.setAttribute('aria-label', label);
      const title = el.querySelector('title') ?? el.insertBefore(document.createElementNS(SVG_NS, 'title'), el.firstChild);
      title.textContent = label;
    },
  };
}

// ---- cat coats ---------------------------------------------------------------------------------

interface CatLook {
  name: string;
  fur: string;
  fur2: string;
  fur3?: string;
  eye: string;
  pattern: 'stripes' | 'plain' | 'patches' | 'points';
}

const CATS: CatLook[] = [
  { name: 'Ginger', fur: '#e8964a', fur2: '#b8642a', eye: '#3b2a14', pattern: 'stripes' },
  { name: 'Midnight', fur: '#4d4d5c', fur2: '#363642', eye: '#f5d142', pattern: 'plain' },
  { name: 'Snow', fur: '#f3f1ec', fur2: '#d6d0c4', eye: '#4aa3d8', pattern: 'plain' },
  { name: 'Smokey', fur: '#8b919c', fur2: '#5f6570', eye: '#9ad46b', pattern: 'stripes' },
  { name: 'Calico', fur: '#f3ece0', fur2: '#e0893c', fur3: '#2f2a28', eye: '#3b2a14', pattern: 'patches' },
  { name: 'Mochi', fur: '#efe2c8', fur2: '#5a4636', eye: '#4a90d9', pattern: 'points' },
];

/** Coats that coins unlock; the six above are free. */
const EXTRA_COATS: CatLook[] = [
  { name: 'Tuxedo', fur: '#2b2b33', fur2: '#1c1c22', fur3: '#f4f1ea', eye: '#f5d142', pattern: 'patches' },
  { name: 'Lilac', fur: '#d9d4e2', fur2: '#8d82a3', eye: '#e8b23a', pattern: 'points' },
  { name: 'Golden', fur: '#f2c14e', fur2: '#c08a1c', eye: '#3b2a14', pattern: 'stripes' },
  { name: 'Cyber', fur: '#1f2540', fur2: '#00c8f0', fur3: '#ff3df0', eye: '#7dffb0', pattern: 'plain' },
];
const COATS: CatLook[] = [...CATS, ...EXTRA_COATS];

/** Coat colours by name, for the wardrobe card's swatches. */
export const COAT_SWATCHES: { name: string; fur: string; fur2: string }[] = COATS.map((c) => ({ name: c.name, fur: c.fur, fur2: c.fur2 }));

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The coat this seed prefers, or the next one no other tile wears; repeats only past six tiles. */
function pickLook(worn: Set<string>, seed: string): CatLook {
  const start = hash(seed) % CATS.length;
  for (let k = 0; k < CATS.length; k++) {
    const c = CATS[(start + k) % CATS.length];
    if (!worn.has(c.name)) return c;
  }
  return CATS[start];
}

const coatVars = (l: CatLook) => `--fur:${l.fur};--fur2:${l.fur2};--fur3:${l.fur3 ?? l.fur2};--eye:${l.eye}`;

/** Sitting, facing the viewer. Coordinates 0..32 × 0..28; paws are .arm so they can tap. Colours come from the coat variables. */
const catSit = () => `
<ellipse cx="16" cy="26.1" rx="10.8" ry="1.25" fill="#000" opacity=".12"/>
<path class="tail" d="M21.3 23.6c3.7 1.8 7.9.1 7.8-3.5-.1-2.3-2.2-2.8-2.4-4.5-.1-.9.3-1.7 1.2-2.4l1.4 1.1c-.5.5-.7.9-.6 1.3.2.9 2.3 1.8 2.4 4.5.2 5.3-5.3 7.9-10.4 5.5Z" fill="var(--fur)" stroke="var(--line)" stroke-width=".78"/>
<path d="M26.7 15.6c-.1-.9.3-1.7 1.2-2.4l1.4 1.1c-.5.5-.7.9-.6 1.3.1.5.8 1 1.4 1.6l-1.5 1.25c-.9-.8-1.8-1.6-1.9-2.85Z" fill="var(--fur2)"/>
<path d="M9.7 24.6c.2-7.6 2.4-11.3 6.3-11.3s6.1 3.7 6.3 11.3c-2.9 1.2-9.7 1.2-12.6 0Z" fill="var(--fur)" stroke="var(--line)" stroke-width=".78"/>
<path d="M11.7 24.6c.4-5.3 1.7-8.3 4.3-9.3 2.6 1 3.9 4 4.3 9.3-2.1.8-6.5.8-8.6 0Z" fill="var(--fur2)" opacity=".34"/>
<path d="M19.5 15.4c2.1.7 3.3 2.2 3.6 4.8-1.6.1-3.1-.4-4.4-1.5Z" fill="var(--fur3)" opacity=".82"/>
<path d="M7.1 8.2c-.7-1.9-.6-4.3.2-6.5.3-.8 1-.9 1.6-.3l3.6 2.8c2.2-.7 4.8-.7 7 0l3.6-2.8c.6-.6 1.3-.5 1.6.3.8 2.2.9 4.6.2 6.5 1.1 1.3 1.4 3.2.9 5.2-.8 3.5-4.4 5.5-9.8 5.5s-9-2-9.8-5.5c-.5-2-.2-3.9.9-5.2Z" fill="var(--fur)" stroke="var(--line)" stroke-width=".82"/>
<path d="m7.7 6.7.4-4.3 3.3 2.5c-1.6.4-2.8 1-3.7 1.8Z" fill="var(--fur2)"/>
<path d="m24.3 6.7-.4-4.3-3.3 2.5c1.6.4 2.8 1 3.7 1.8Z" fill="var(--fur3)"/>
<path d="M7.8 8.2c1.8-1.7 4.5-2.8 8.2-2.8s6.4 1.1 8.2 2.8c-1.7-1-3.7-1.4-5.8-1.6-3.9-.3-7.4.3-10.6 1.6Z" fill="#fff" opacity=".16"/>
<path d="M7 11.2c1.4-1.7 3.4-2.4 5.9-2.1.1 2.7-1.7 4.4-5.8 5.2-.5-1.1-.6-2.1-.1-3.1Z" fill="var(--fur2)" opacity=".44"/>
<path d="M22.8 6c1.2 1.2 2 2.8 2.2 4.6-2.2-.2-3.8-1.2-4.8-3Z" fill="var(--fur3)" opacity=".88"/>
<g class="eyes">
<ellipse cx="11.6" cy="12" rx="1.8" ry="2.15" fill="var(--eye)" stroke="var(--line)" stroke-width=".5"/>
<ellipse cx="20.4" cy="12" rx="1.8" ry="2.15" fill="var(--eye)" stroke="var(--line)" stroke-width=".5"/>
<circle cx="11" cy="11.25" r=".6" fill="#fff"/><circle cx="19.8" cy="11.25" r=".6" fill="#fff"/>
<circle cx="12.2" cy="12.85" r=".25" fill="#fff" opacity=".78"/><circle cx="21" cy="12.85" r=".25" fill="#fff" opacity=".78"/>
</g>
<ellipse cx="9.2" cy="14.9" rx="1.55" ry=".8" fill="#ef8f9f" opacity=".5"/><ellipse cx="22.8" cy="14.9" rx="1.55" ry=".8" fill="#ef8f9f" opacity=".5"/>
<path d="m15.2 14.2.8.6.8-.6c-.2-.6-1.4-.6-1.6 0Z" fill="#d77783" stroke="var(--line)" stroke-width=".5"/>
<path d="M16 14.8c-.1.8-.7 1.2-1.35 1.25M16 14.8c.1.8.7 1.2 1.35 1.25" fill="none" stroke="var(--line)" stroke-width=".58"/>
<path d="m7.4 13.3-3-.45m3.2 1.75-3 .25m19.9-1.55 3-.45m-3.2 1.75 3 .25" fill="none" stroke="var(--line)" stroke-width=".52" opacity=".68"/>
<path d="M14.25 18.1 16 19.5l1.75-1.4-.45 2.25H14.7Z" fill="var(--fur)"/>
<g class="arms">
<path class="arm" d="M11.6 19.1c1.9-.2 3 .9 3 2.8v3.5c-1.2.6-2.5.6-3.8.1l.2-4.9c.1-.8.2-1.3.6-1.5Z" fill="var(--fur)" stroke="var(--line)" stroke-width=".68"/>
<path class="arm" d="M20.4 19.1c-1.9-.2-3 .9-3 2.8v3.5c1.2.6 2.5.6 3.8.1l-.2-4.9c-.1-.8-.2-1.3-.6-1.5Z" fill="var(--fur)" stroke="var(--line)" stroke-width=".68"/>
</g>
<path d="M12.2 24.4v.7m1.25-.7v.7m5.1-.7v.7m1.25-.7v.7" fill="none" stroke="var(--line)" stroke-width=".5" opacity=".62"/>`;

/** Curled up, same baseline as the sitting pose. */
const catSleep = () => `
<ellipse cx="16" cy="24.8" rx="12.1" ry="1.35" fill="#000" opacity=".12"/>
<path d="M3.8 19.8c0-6.5 5.3-10.9 12.8-10.9 7.3 0 11.6 3.8 11.6 9.4 0 4.2-4.2 6.3-12 6.3-8.2 0-12.4-1.4-12.4-4.8Z" fill="var(--fur)" stroke="var(--line)" stroke-width=".82"/>
<path d="M4.6 17.1c2.8-4.8 7.6-7.3 13.5-6.8-2 4.2-6.2 6.6-12.8 7.8Z" fill="var(--fur2)" opacity=".32"/>
<path d="M6.3 12.8c2-2.1 4.8-3.4 8.1-3.8 1.2 1 1.8 2.1 1.8 3.4-3.2 1.5-6.5 1.6-9.9.4Z" fill="var(--fur3)" opacity=".78"/>
<path d="M18.1 15.4c-.4-1.8-.1-3.8.8-5.5.4-.7 1.1-.7 1.6-.1l2.5 2.6 3.5-1.8c.7-.4 1.3-.1 1.4.7.2 2.1-.2 4-1.3 5.4.8 1.1 1 2.6.5 4-.8 2.3-3.3 3.7-6.3 3.5-3.2-.2-5.3-2-5.2-4.4.1-1.8 1-3.3 2.5-4.4Z" fill="var(--fur)" stroke="var(--line)" stroke-width=".78"/>
<path d="m19.2 14.3.6-3.5 2.4 2.5c-1.2.1-2.2.4-3 .9Z" fill="var(--fur2)"/>
<path d="m24 13.6 2.9-1.8-.7 3.6c-.6-.8-1.3-1.4-2.2-1.8Z" fill="var(--fur3)"/>
<path d="M18.4 15.7c2.1-1.2 4.8-1.5 7.7-.7-2.2-.1-4.5.5-6.6 1.7Z" fill="#fff" opacity=".16"/>
<path d="M24.4 14.1c1.1.4 1.9 1.2 2.5 2.2-1.2.4-2.3.1-3.3-.7Z" fill="var(--fur3)" opacity=".88"/>
<g class="closed-eyes" fill="none" stroke="var(--line)" stroke-width=".65">
<path d="M18.3 19.2q1.05 1 2.1 0M23.1 19.2q1.05 1 2.1 0"/>
</g>
<ellipse cx="17.8" cy="21.1" rx="1.2" ry=".62" fill="#ef8f9f" opacity=".42"/><ellipse cx="25.7" cy="21.1" rx="1.2" ry=".62" fill="#ef8f9f" opacity=".42"/>
<path d="m21.15 20.5.7.5.7-.5c-.18-.5-1.22-.5-1.4 0Z" fill="#d77783" stroke="var(--line)" stroke-width=".5"/>
<path d="M21.85 21c-.15.7-.68.95-1.2.95m1.2-.95c.15.7.68.95 1.2.95" fill="none" stroke="var(--line)" stroke-width=".55"/>
<path class="tail" d="M5.1 19.2c2.2 4.6 9.6 5 15.6 2.9 2.3-.8 4.5-.8 6.2.1-1.7 2.8-6.4 4-12.4 3.1-5.6-.8-9.2-2.7-9.4-6.1Z" fill="var(--fur2)" stroke="var(--line)" stroke-width=".72"/>
<path d="M21.1 22c2.1-.7 4.2-.6 5.8.2-.5.8-1.2 1.4-2.1 1.9-1.6-.3-2.9-1-3.7-2.1Z" fill="var(--fur3)" opacity=".8"/>
<path d="M7.7 14.1c1.3.4 2.2 1 2.8 2m.25-3.4c1.3.3 2.3.9 3 1.8" fill="none" stroke="var(--fur2)" stroke-width="1.05"/>`;
