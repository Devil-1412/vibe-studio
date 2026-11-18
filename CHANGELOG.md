# Changelog

## 0.2.0

- Settings panel (gear in the top bar, Ctrl+Alt+,) for default model, effort, permission mode, Chrome and Codex defaults, plus the on/off preferences.
- Low usage mode in the usage popup: Sonnet at high effort, Chrome off, no MCP servers, shorter answers, and an earlier Continue nudge.
- Changing the permission mode no longer restarts the chat, so running sub-agents keep going.
- Sub-agent status is exact for chats Vibe Studio runs: only agents the current process started can be working, so ones that died with an earlier process no longer show as running.
- An idle chat keeps its process while background sub-agents are still working, instead of closing it after 30 minutes and ending them.
- Links in a chat open once (VS Code's webview was opening them a second time).

## 0.1.0

First release.

- Claude Code and Codex chats as a grid of independent tiles, each with its own composer.
- Live permission, question and plan cards; Focus view; todo checklist; agent map; timestamps.
- One usage meter for Claude and Codex, with a popup split by provider.
- @-file picker and attachments; magic wand; comments on the points of a report.
- Servers per project and worktree; saved layouts; drag to rearrange; Shelf; keyboard shortcuts.
- Cats and a robot for each tile, with a wardrobe and a small idle game.
