// The Settings panel: defaults for new chats and tiles that follow them, plus the on/off preferences.
// Values are VS Code user settings (vibeStudio.*), written by the host, so this and the settings editor agree.
import type { AgentId, AgentInfo, FromWebview, ModeOption } from '../src/types';

type Child = Node | string | null | undefined | false;
type H = (tag: string, attrs?: Record<string, any>, ...children: Child[]) => HTMLElement;

export interface SettingsCtx {
  h: H;
  icon(name: string): HTMLElement;
  post(m: FromWebview): void;
  agents(): AgentInfo[];
  lowUsage(): boolean;
}

export function createSettings(ctx: SettingsCtx) {
  const { h } = ctx;
  let values: Record<string, unknown> = {};

  const button = h('button', { class: 'icon-btn', title: 'Settings (Ctrl+Alt+,)', 'aria-label': 'Settings', onclick: () => toggle(true) }, ctx.icon('gear'));
  const body = h('div', { class: 'set-body' });
  const panel = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-label': 'Settings', hidden: true, onclick: (e: Event) => e.target === panel && toggle(false) },
    h('div', { class: 'sheet-card set-card' }, h('div', { class: 'srv-head' }, h('span', { text: 'Settings' }), h('button', { class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close settings', onclick: () => toggle(false) }, ctx.icon('close'))), body),
  );

  const write = (key: string, value: unknown) => {
    values = { ...values, [key]: value };
    ctx.post({ type: 'setSetting', key, value });
  };

  function select(key: string, label: string, options: ModeOption[]) {
    const current = String(values[key] ?? '');
    const list = options.some((o) => o.value === current) ? options : [...options, { value: current, label: current }];
    return row(label, h('select', { class: 'set-select', 'aria-label': label, onchange: (e: Event) => write(key, (e.target as HTMLSelectElement).value) }, ...list.map((o) => h('option', { value: o.value, text: o.label, selected: o.value === current }))));
  }

  function toggleRow(key: string, label: string, hint = '') {
    const on = values[key] === true;
    const sw = h('button', { class: `switch${on ? ' on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label, onclick: () => (write(key, !on), render()) }, h('span', { class: 'switch-knob' }));
    return row(label, sw, hint);
  }

  function row(label: string, control: HTMLElement, hint = '') {
    return h('div', { class: 'set-row' }, h('div', { class: 'set-label' }, h('span', { text: label }), hint ? h('span', { class: 'set-hint', text: hint }) : ''), control);
  }

  function agentSection(id: AgentId) {
    const info = ctx.agents().find((a) => a.id === id);
    if (!info) return '';
    const efforts: ModeOption[] = [{ value: '', label: 'Default effort' }, ...info.efforts];
    return h(
      'section',
      { class: 'set-sec' },
      h('div', { class: 'usage-sec-title', text: `${info.label} defaults` }),
      select(`${id}Model`, 'Model', info.models),
      select(`${id}Effort`, 'Effort', efforts),
      select(`${id}Mode`, id === 'codex' ? 'Sandbox' : 'Permission mode', info.modes),
      id === 'claude' ? toggleRow('claudeChrome', 'Chrome', 'Let Claude drive your Chrome') : '',
    );
  }

  function render() {
    body.replaceChildren(
      h('div', { class: 'set-note', text: 'New chats, and tiles where you have not picked your own, use these.' }),
      ctx.lowUsage() ? h('div', { class: 'set-note warn', text: 'Low usage mode is on: until you turn it off, Claude tiles on their defaults use Sonnet at high effort with Chrome off.' }) : '',
      agentSection('claude'),
      agentSection('codex'),
      h(
        'section',
        { class: 'set-sec' },
        h('div', { class: 'usage-sec-title', text: 'Chats' }),
        toggleRow('reportInPoints', 'Report in points', 'Asks agents for bullet points you can comment on'),
        toggleRow('showTimestamps', 'Timestamps'),
        toggleRow('focusView', 'Focus view', 'Fold tool calls and thinking'),
      ),
      h('section', { class: 'set-sec' }, h('div', { class: 'usage-sec-title', text: 'Fun' }), toggleRow('catCommentary', 'Cat commentary'), toggleRow('game', 'Coin game'), toggleRow('gameFloaters', '+N while typing')),
      h('section', { class: 'set-sec' }, h('div', { class: 'usage-sec-title', text: 'Other' }), toggleRow('showStatusBar', 'Status bar button')),
      h('div', { class: 'set-foot' }, h('span', { class: 'set-hint', text: 'Prompt chips, extra models and CLI paths' }), h('button', { class: 'ask-btn', type: 'button', onclick: () => ctx.post({ type: 'openSettings' }) }, 'Open in VS Code settings ↗')),
    );
  }

  function toggle(open = panel.hidden) {
    panel.hidden = !open;
    if (open) {
      render();
      (panel.querySelector('select, button.switch') as HTMLElement | null)?.focus();
    } else button.focus();
  }

  return {
    button,
    panel,
    toggle,
    isOpen: () => !panel.hidden,
    set(next: Record<string, unknown>) {
      values = next;
      if (!panel.hidden) render();
    },
    /** Agent lists or low usage mode changed. */
    refresh() {
      if (!panel.hidden) render();
    },
  };
}
