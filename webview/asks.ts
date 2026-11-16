// Cards for what the CLI waits on: a tool permission, a question, a plan to approve. Answers go back through `ctx.answer`.
import type { AskAnswer, PendingAsk } from '../src/types';

type Child = Node | string | null | undefined | false;
type H = (tag: string, attrs?: Record<string, any>, ...children: Child[]) => HTMLElement;

export interface AskCtx {
  h: H;
  icon(name: string): HTMLElement;
  markdown(text: string): HTMLElement;
  answer(id: string, a: AskAnswer): void;
}

const OTHER = '\u0000other';
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const head = (s: unknown, n: number) => String(s ?? '').split('\n').slice(0, n).join('\n');

function toolName(tool: string): string {
  if (tool === 'Bash') return 'command';
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(tool)) return 'edit';
  return tool.replace(/^mcp__/, '').replace(/__/g, ' · ');
}

/** What the tool wants to do, in a few lines. */
function preview(ask: PendingAsk, h: H): Node {
  const i = ask.input ?? {};
  if (ask.tool === 'Bash' && typeof i.command === 'string') return h('pre', { class: 'ask-code', text: i.command });
  if (typeof i.file_path === 'string') {
    const body =
      ask.tool === 'Write'
        ? head(i.content, 8)
        : i.old_string !== undefined
          ? `- ${head(i.old_string, 4).replace(/\n/g, '\n- ')}\n+ ${head(i.new_string, 4).replace(/\n/g, '\n+ ')}`
          : '';
    return h('div', {}, h('div', { class: 'ask-file', text: i.file_path }), body ? h('pre', { class: 'ask-code', text: body }) : null);
  }
  if (typeof i.url === 'string') return h('div', { class: 'ask-file', text: i.url });
  return h('pre', { class: 'ask-code', text: clip(JSON.stringify(i, null, 2), 700) });
}

const button = (h: H, label: string, kind: string, onclick: () => void) => h('button', { type: 'button', class: `ask-btn ${kind}`, onclick }, label);

function frame(ctx: AskCtx, ask: PendingAsk, icon: string, title: string, ...body: Child[]) {
  const { h } = ctx;
  return h(
    'div',
    { class: `ask ${ask.kind}`, role: 'group', 'aria-label': title },
    h('div', { class: 'ask-head' }, ctx.icon(icon), h('span', { class: 'ask-title', text: title }), ask.agentId ? h('span', { class: 'ask-tag', text: 'sub-agent' }) : null),
    ...body,
  );
}

function reasonField(h: H, placeholder: string) {
  return h('input', { class: 'ask-reason', placeholder, 'aria-label': placeholder }) as HTMLInputElement;
}

function toolCard(ask: PendingAsk, ctx: AskCtx) {
  const { h } = ctx;
  const why = reasonField(h, 'Tell Claude what to do instead (optional)');
  return frame(
    ctx,
    ask,
    'shield',
    `Allow this ${toolName(ask.tool)}?`,
    ask.description ? h('div', { class: 'ask-desc', text: ask.description }) : null,
    preview(ask, h),
    why,
    h(
      'div',
      { class: 'ask-btns' },
      button(h, 'Allow', 'primary', () => ctx.answer(ask.id, { allow: true })),
      ask.suggestions.length ? button(h, 'Always allow this session', '', () => ctx.answer(ask.id, { allow: true, always: true })) : null,
      button(h, 'Deny', 'danger', () => ctx.answer(ask.id, { allow: false, message: why.value })),
    ),
  );
}

function questionCard(ask: PendingAsk, ctx: AskCtx) {
  const { h } = ctx;
  const qs: any[] = Array.isArray(ask.input?.questions) ? ask.input.questions.filter((q: any) => q && typeof q.question === 'string') : [];
  if (!qs.length) return toolCard(ask, ctx);
  const picked = qs.map(() => new Set<string>());
  const other = qs.map(() => '');
  const submit = button(h, 'Submit', 'primary', () =>
    ctx.answer(ask.id, {
      allow: true,
      answers: Object.fromEntries(qs.map((q, i) => [q.question, [...picked[i]].map((l) => (l === OTHER ? other[i].trim() : l)).filter(Boolean).join(', ')])),
    }),
  ) as HTMLButtonElement;
  const refresh = () => (submit.disabled = !qs.every((_, i) => [...picked[i]].some((l) => l !== OTHER || other[i].trim())));

  const blocks = qs.map((q, i) => {
    const multi = !!q.multiSelect;
    const choose = (label: string, on: boolean) => {
      if (!multi) picked[i].clear();
      if (on) picked[i].add(label);
      else picked[i].delete(label);
      refresh();
    };
    const row = (label: string, extra: Child[], box: HTMLInputElement) => h('label', { class: 'ask-opt' }, box, h('span', { class: 'ask-opt-text' }, ...extra));
    const box = (label: string) => h('input', { type: multi ? 'checkbox' : 'radio', name: `q${i}`, onchange: (e: Event) => choose(label, (e.target as HTMLInputElement).checked) }) as HTMLInputElement;
    const options = (Array.isArray(q.options) ? q.options : []).map((o: any) =>
      row(String(o.label), [h('span', { class: 'ask-opt-label', text: String(o.label) }), o.description ? h('span', { class: 'ask-opt-desc', text: String(o.description) }) : null], box(String(o.label))),
    );
    const otherBox = box(OTHER);
    const text = h('input', {
      class: 'ask-other',
      placeholder: 'Other…',
      'aria-label': 'Other answer',
      oninput: (e: Event) => {
        other[i] = (e.target as HTMLInputElement).value;
        if (other[i] && !otherBox.checked) {
          otherBox.checked = true;
          choose(OTHER, true);
        } else refresh();
      },
    });
    return h(
      'div',
      { class: 'ask-q' },
      q.header ? h('span', { class: 'ask-chip', text: String(q.header) }) : null,
      h('div', { class: 'ask-qtext', text: q.question }),
      ...options,
      h('label', { class: 'ask-opt' }, otherBox, text),
    );
  });
  refresh();
  return frame(ctx, ask, 'question', qs.length === 1 ? 'Question' : 'Questions', ...blocks, h('div', { class: 'ask-btns' }, submit));
}

function planCard(ask: PendingAsk, ctx: AskCtx) {
  const { h } = ctx;
  const plan = typeof ask.input?.plan === 'string' ? ask.input.plan : '';
  const why = reasonField(h, 'Feedback on the plan (optional)');
  return frame(
    ctx,
    ask,
    'plan',
    "Claude's plan: approve it?",
    plan ? h('div', { class: 'ask-plan' }, ctx.markdown(plan)) : null,
    why,
    h(
      'div',
      { class: 'ask-btns' },
      button(h, 'Approve · auto-accept edits', 'primary', () => ctx.answer(ask.id, { allow: true, mode: 'acceptEdits' })),
      button(h, 'Approve · ask before edits', '', () => ctx.answer(ask.id, { allow: true, mode: 'default' })),
      button(h, 'Keep planning', 'danger', () => ctx.answer(ask.id, { allow: false, message: why.value })),
    ),
  );
}

export function askCard(ask: PendingAsk, ctx: AskCtx): HTMLElement {
  return ask.kind === 'question' ? questionCard(ask, ctx) : ask.kind === 'plan' ? planCard(ask, ctx) : toolCard(ask, ctx);
}
