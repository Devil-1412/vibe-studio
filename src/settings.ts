// The settings the in-app Settings panel may change. Everything else stays in VS Code's own settings editor.
// Pure (no vscode), so the self-test can run it.

export const PANEL_SETTINGS = {
  claudeModel: 'string',
  claudeEffort: 'string',
  claudeMode: 'string',
  claudeChrome: 'boolean',
  codexModel: 'string',
  codexEffort: 'string',
  codexMode: 'string',
  reportInPoints: 'boolean',
  showTimestamps: 'boolean',
  focusView: 'boolean',
  catCommentary: 'boolean',
  game: 'boolean',
  gameFloaters: 'boolean',
  showStatusBar: 'boolean',
} as const;

export type PanelSetting = keyof typeof PANEL_SETTINGS;

/** The webview is untrusted: only known keys, with the right type and a short string. */
export function validSetting(key: unknown, value: unknown): key is PanelSetting {
  if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(PANEL_SETTINGS, key)) return false;
  const type = PANEL_SETTINGS[key as PanelSetting];
  return type === 'boolean' ? typeof value === 'boolean' : typeof value === 'string' && value.length <= 120 && !/[\n\r]/.test(value);
}

/** Settings whose change alters what new chats and tiles on their defaults use. */
export const AGENT_DEFAULTS: PanelSetting[] = ['claudeModel', 'claudeEffort', 'claudeMode', 'claudeChrome', 'codexModel', 'codexEffort', 'codexMode'];
