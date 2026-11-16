# Vibe Studio

A VS Code panel for vibe coding with several AI agents at once. It shows your Claude Code and Codex chat sessions side by side in a grid. Each tile is a live chat view with its own message box, so a reply in one tile never touches another.

## Install

```sh
npm install
npm run package          # builds vibe-studio-0.1.0.vsix
code --install-extension vibe-studio-0.1.0.vsix
```

Open it with **Vibe Studio: Open Vibe Studio** (`Cmd+Alt+D` on Mac, `Ctrl+Alt+D` elsewhere) or the **Agents** button in the status bar.

For development, open this folder in VS Code and press `F5`.

## How it works

- **Sessions** are read from the agents' own transcripts, which VS Code, the terminal and other windows all write to:
  - Claude: `~/.claude/projects/<project>/<session>.jsonl` (respects `CLAUDE_CONFIG_DIR`)
  - Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (respects `CODEX_HOME`). Titles come from `session_index.jsonl`.
- **Tiles** follow their transcript file and update as it grows, whichever window is driving the session.
- **Sending**: each tile has its own agent process.
  - Each tile picks a model, a reasoning effort, a permission/sandbox mode and, for Claude, Chrome access.
  - Claude: one long-lived process per tile, driven the same way the Claude Code VS Code extension drives the CLI: `claude -p --input-format stream-json --output-format stream-json --verbose --resume <id> --permission-prompts none --permission-mode <mode> [--model <id>] [--effort <level>] [--chrome]`, one JSON line per message. Stop sends an interrupt and the process stays up.
    - SessionStart hooks, MCP servers and plugin loading happen once per tile, not once per message.
    - `CLAUDE_CODE_ARTIFACT=1` is set, because `-p`/SDK runs otherwise leave the Artifact tool off. A setting that turns Artifacts off still wins.
    - The process restarts when you change the tile's model, effort, mode or Chrome switch, after 30 idle minutes, or when the tile closes.
    - `--chrome` is added when the tile's **Chrome** switch is on. Chrome must be open with the Claude in Chrome extension signed in.
    - `npm run test:runner` checks the process lifecycle against a fake agent (`scripts/fake-agent.mjs`).
  - Codex: `codex exec resume --json -c sandbox_mode="<mode>" -c approval_policy="never" [-m <model>] [-c model_reasoning_effort="<level>"] <id> -`. The effort picker only lists the levels the chosen model supports, according to `~/.codex/models_cache.json`.
- **New chat** works the same way: `claude -p --session-id <uuid>` or `codex exec --json`, run in the folder you pick.
- **Binaries**: the `vibeStudio.claudePath` / `vibeStudio.codexPath` setting if set; otherwise the binary bundled with the Claude Code (`anthropic.claude-code`) or Codex (`openai.chatgpt`) extension; otherwise `PATH`.

## Working with many tiles

- **Unread dot**: a tile (and its sidebar row) gets a blue dot when the agent produces output you weren't watching. Clicking or scrolling to the end of the tile clears it.
- **Queue**: press Enter while the agent is busy and the message waits in the tile's queue. It's sent when the turn ends, one per turn. Remove items with ×. An error pauses the queue; press Send with an empty box to resume.
- **Prompt chips**: one-click saved prompts above the message box (`vibeStudio.prompts`). Click sends, or queues while busy. Alt/Shift-click puts the text in the box to edit first. Hidden in very short tiles.
- **Files strip**: under the header, every file the chat edited successfully, with +/− lines. Click a file to open its HEAD ↔ working tree diff.
- **Meter**: context used (percent once the window size is known), plus total tokens for Codex. Claude transcripts don't record the window size, so it's learned from the first reply sent from Vibe Studio.
- **Prompt cache**: on Claude tiles a clock pill sits beside the meter: "42m" while the prompt cache is likely warm (hover: "Prompt cache warm, about 42 min left"), a bare clock once it has lapsed (hover: "Prompt cache likely expired (idle 12m)"). The minutes tick down every 30 s without a new transcript line. Hidden for Codex and when the chat has no model call yet.
  - It is an estimate, worked out from the transcript: a call that wrote 1 hour cache tokens (`usage.cache_creation.ephemeral_1h_input_tokens`) means a 1 h lifetime, one that wrote only 5 minute tokens means 5 min, and a call that only read the cache (or an older log with no such field) keeps the previous lifetime (5 min to start with). Every call renews the cache, so it lapses one lifetime after the newest call. The call's time is when its reply was written, not when the request started, and sub-agents keep caches of their own, so treat the minutes as approximate.
- **Skills**: type `/` (Claude) or `$` (Codex) in a message box for a filtered list of that agent's skills and commands. Arrow keys move, Enter or Tab inserts, Escape closes. The **Skills** chip opens the whole list grouped by where each comes from. The list is read from the same places the CLIs load them:
  - Claude: `~/.claude/skills`, `~/.claude/commands`, the project's `.claude/skills` and `.claude/commands`, and every enabled plugin (`enabledPlugins` in settings, install paths from `plugins/installed_plugins.json`, skill folders from each plugin's manifest).
  - Codex: `~/.codex/skills` (including `.system`), the project's `.codex/skills` and `.agents/skills`, and plugins enabled in `config.toml`.
  - Skills built into the CLIs themselves aren't on disk, so they don't appear in the list.
- **@ files**: type `@` after a space in a message box for a picker of the chat's working folder (new chats: the folder you chose). Arrow keys move, Enter inserts `@path` (quoted when it has spaces; Codex gets the plain path), Tab on a folder opens it, Esc closes. Searching uses the ripgrep VS Code ships (skipping `.git`), falling back to a directory walk that skips `node_modules`, `dist` and the like.
- **Attachments** (Claude tiles): paste an image, drop files on the message box, or use the paperclip. Chips show above the box with a thumbnail or name and size; × removes one. Images (jpeg, png, gif, webp) up to 5 MB, PDFs and text or code files up to 10 MB, 20 MB in total; anything else is listed in the tile's banner. Sent as image, PDF and text document blocks, shown in the transcript as `[image]` / `[document]`. Queued messages keep their files. Codex tiles hide the paperclip.
- **Skills used**: the info strip starts with ⚡ and the skills or commands the chat ran. Claude: the Skill tool and non-built-in slash commands. Codex: picked skills and reads of a `SKILL.md`. Hover for the full list.
- **Agent map**: modelled on the Claude Code panel's. A pill in the message box's footer (status dot + "N agents", counting the working ones) opens it. Each sub-agent in the chat is a one-line row; clicking it opens the map on that agent.
  - **The map** is a tree diagram: the chat is the root row (`model · N tokens in context`), and every agent hangs off it with connector lines, nested under the agent that started it. Each row shows `duration · N tokens`, live while the agent works. Working agents sort first.
  - **Click an agent** for its card: status, type, model, foreground or background, who spawned it, what it is doing now, its result (or the failure in red), a collapsible **Prompt** and **Tool calls (N)**, **Open transcript**, and **Stop agent** while it works.
  - **Open transcript** shows the agent's own steps, refreshed while it runs. **Esc** steps back: transcript, card, map, closed. Click the chat row at the top of the map for the session summary.
  - **Stop agent** sends the same `stop_task` request the panel does. It only appears for chats whose Claude process Vibe Studio runs; for a chat driven from the Claude panel, stop it there.
  - **Working vs stopped**: a transcript only records that an agent started. An agent with no result whose transcript has been quiet for 2 minutes is shown as Stopped.
  - Claude: the Agent/Task tool call, results from the hand-back message or tool result, and each agent's steps and nested agents from `<session>/subagents/agent-<id>.jsonl` (its `.meta.json` names the spawn call, so a running agent is found before it reports).
  - Codex: `spawn_agent` plus `SubAgentActivity` events, and the steps from the agent's own thread. Codex stores the brief encrypted, so no prompt is shown.
  - `npm run test:agents` checks the nesting, status and token rules against a synthetic chat.
- **Usage**: one indicator in the top bar for the whole account, not per chat: `5h 8% · 7d 45%` with small bars, red from 80%. Hover for every window and when it resets; click to refresh. The numbers come from the Claude CLI itself (a throwaway `get_usage` request, so no prompt and no cost, every 5 minutes while the panel is visible) and from the `rate_limit_event`s every run streams. It uses the CLI's own login; Vibe Studio never reads credentials. Shows `Usage –` for API-key logins, which have no plan limits. Codex has no equivalent.
- **Today**: the button in the top bar opens a recap of today's chats, prompts, files touched, lines changed, the longest task and the most changed files.

## Reading a chat

- **Todos**: Claude's `TodoWrite` and Codex's `update_plan` show inline as a checklist headed "Todos done/total": checked and struck through when done, a half-filled box for the step in progress, an empty box for pending.
- **Times**: user messages and replies show their time (hover for the full date), and a date divider sits between days. `vibeStudio.showTimestamps` (default on) hides both; changing it applies right away.
- **Compaction**: Claude's compaction is one collapsible row, "Compacted chat · auto · 45k tokens freed", with the summary inside. Codex compactions stay a one-line note. "[Request interrupted by user]" shows as "Interrupted", and the tool-use variant as "Tool interrupted".
- **Copy**: hover a code block, an expanded Bash command or a reply for its Copy button (also reachable with the keyboard). It shows a check for a moment once copied.
- **Focus view**: the eye button in a tile's header (or `Ctrl+Alt+F` on the focused tile, else the last one you clicked) hides the machinery so a chat reads as prompts and replies, like Claude Code's Focus view.
  - Each run of tool calls and thinking folds into one row: "7 tool calls · 1 failed", "Thinking", or "N hidden steps" when it mixes thinking with todo lists. Click it to open the run in place; a "Collapse" row at its end folds it again. Opened runs are remembered until the page reloads.
  - Replies, your messages, notes, compaction rows, sub-agent rows, plan and question cards stay. Only the newest todo checklist stays; older ones fold into the runs.
  - While the agent works and the run is the newest thing in the chat, its row reads "Running Bash…" (the last tool without output) with a pulsing dot.
  - The choice is saved per tile. `vibeStudio.focusView` (default off) is what tiles with no choice of their own use; changing it applies right away. The tile stays at the end of the chat if it was there.
  - One place (`layoutRows` in `webview/main.ts`) decides which rows show, so folding and the merged Reads below never fight over a row: a row hides for one reason at a time, and a run that opens again keeps its Reads merged.
- **Plan and question cards** (Claude): `ExitPlanMode` and `AskUserQuestion` show as read-only cards instead of generic tool rows, built from the transcript only (you answer in Claude's own panel).
  - **Plan**: "Claude's Plan" with the saved file name when the transcript has one, the plan as markdown (folded with Show more / Show less once it is over 12 lines), and a status line: "Approved", "Stayed in plan mode" or "Waiting for approval".
  - **Question**: each question with its header chip and its options as radio (one choice) or checkbox (multi-select) rows, the picked ones highlighted and typed text listed under "Other". Once answered it sits under "Answered · N questions" (open by default); otherwise a status line says "Waiting for an answer", "No answer" or "Declined", with "Reason:" when the user gave one. If a result's structured answers can't be read, the result text is shown instead.
  - Anything unrecognised (a plan with no text, a tool error that isn't a rejection, a result in an unknown format) stays the generic tool row.
- **Reads**: finished Claude `Read` calls that follow each other become one row, "Read a.ts (lines 10-40), b.ts"; click a file to open it at that line. A Read that is still running, or failed, stays on its own row.
- **Tool rows**: Bash shows its description (the command is inside the row), Grep `"pattern" (in path, glob, type)`, Glob `pattern: "x"`, WebFetch "Web Fetch url", Skill "name skill", MCP tools "server [tool]" plus the first of query, message, channel, repo, url, path, title or text. An open Grep or Glob row starts with its result line ("3 lines of output", "Found 4 files", "No matches found").
- `npm run test:parser` checks the todo, timestamp, compaction, interrupt, tool-header, prompt-cache and plan/question rules against synthetic transcript lines.

## Just for fun

- **Companions**: every tile has a little creature sitting on its message box: a cat (Claude) or the robot Bit (Codex). It acts out what the agent is doing right now:
  - writing: typing on a laptop
  - reading or searching: magnifying glass
  - editing: hammering
  - other tools: juggling
  - thinking or waiting on sub-agents: thought dots
  - error: dizzy
  - just finished: dances
  - quiet for 2 minutes: naps

  Mini copies hop beside it for each running sub-agent. It grows as the chat ships code (50 / 500 / 2,000 changed lines, crown at the top level). Tap it for a boop.
  - Claude tiles get a cat in one of six coats (ginger, black, white, grey tabby, calico, siamese), and no two open tiles share a coat until there are more than six. Codex tiles get the robot Bit.
  - Sub-agents show up as kittens in the other coats.
  - Motion respects the OS "reduce motion" setting.

`dev/harness.html` previews the UI in a browser with your parsed transcripts. Run `npm run check:parsers -- --dump dev/data.json`, serve the folder, and open `/dev/harness.html`. `dev/` is git-ignored.

### Servers

The **Servers** button in the top bar shows which project or git worktree runs which dev server. Each row names the folder and its branch, with a green dot, the port and the process for every server listening inside it. **Open** goes to `localhost:port`, **Stop** ends that process, and a project with no server offers **Run dev / start / serve** from its `package.json`, started in a VS Code terminal named after the project. It lists your workspace folders, the folders of your open chats, and every worktree of those repos. It needs `lsof` and `git` (macOS and Linux).

### Arranging tiles

- **Drag a tile** by the grip at the left of its header and drop it before or after another tile; the order is kept. **Ctrl+Alt+Shift+Arrows** does the same from the keyboard.
- **Drag a message** (the grip appears when you hover it) onto another tile to quote it in that tile's message box. It is not sent.
- **Layouts** in the top bar saves the open chats, their order and the grid under a name, and restores them in one click.
- **Cat commentary**: a small bubble by each cat or robot says what its chat is doing ("Ginger is reading plan-section.tsx"). It changes at most every 8 seconds and makes no sound. Turn it off with `vibeStudio.catCommentary`.

### Comment on a report's points

Hover a bullet or numbered point in an agent's reply and click the speech-bubble icon to comment on it. Your comments gather above the message box and are added to the front of your next message ("My comments on points in your replies: …"); you can send them with no other text. `vibeStudio.reportInPoints` (on by default) also asks the agent to report in short bullet points, about 40 extra tokens a turn; it applies to chats started after you change it.

### Magic wand

The wand in the message box rewrites a rough prompt into a clear one, in place, with an **Undo** next to it. It never sends. It runs a one-shot Claude call on the fast model with your login (no tools, hooks or skills, so a few tokens), and works from Codex tiles too.

### Cat wardrobe

Double-click a cat (or the robot) to name it and, for cats, pick a coat, a hat and neckwear. Coats, hats and neckwear unlock with coins, on the spot, once; then any cat can wear them. The name shows in the cat's speech bubble. Each chat keeps its own cat. A cat that is asleep curls up, so hats and neckwear show only while it is awake.

### Continue in a new chat

When a chat's context passes 80%, a **Continue ↗** button appears in its info strip. It asks that chat for a short summary (a normal message, so it costs a few tokens), then opens a new chat in the same folder with the same agent, mode, model and effort, with the summary filled into the message box. Nothing is sent until you press Enter, so you can edit it first.

### Shelf

The **Shelf** button (or Ctrl+Alt+H) opens a drawer on the right for things you want to keep across chats. Add to it by dragging a message (from its grip) or an image or file onto the drawer or the Shelf button, by clicking the shelf icon that shows on a reply or a code block, or by pasting into the drawer. Use a card by dragging it onto any tile, or press **Insert** to put it in the chat you were last using: messages are quoted, code is fenced, images and files are attached. It keeps up to 30 items (2 MB each, 8 MB in all), saved with the extension.

### Keyboard shortcuts

Ctrl+Alt on every platform (press **Ctrl+Alt+/** in Vibe Studio for this list):

| Keys | Action |
|---|---|
| Ctrl+Alt+Enter | Full screen for the focused tile (Esc leaves) |
| Ctrl+Alt+Shift+Enter | Studio full screen: hides the lists and maximizes the editor (Esc leaves) |
| Ctrl+Alt+1 … 9 | Jump to tile N |
| Ctrl+Alt+Arrows | Move to the tile left, right, above or below |
| Ctrl+Alt+Shift+Arrows | Move this tile one place |
| Ctrl+Alt+N / W | New chat / close the focused tile |
| Ctrl+Alt+F | Focus view |
| Ctrl+Alt+S / U | Session list / usage limits |

### Usage

The usage meter shows Claude in orange and Codex in blue. Claude's numbers come from the CLI. Codex has no way to be asked, so its numbers are read from the newest Codex session on disk and show "as of the last Codex run"; a window that has since reset shows 0%.

### Keystroke Coins

An idle game in the top bar (turn it off with `vibeStudio.game`). Each character you type earns a coin; pasting and deleting earn nothing. Coins buy upgrades in the shop: bigger keys, coffee (typing combos), helper cats (coins a second per running tile), a night shift (coins while you are away), a lucky bone (a rare bonus when you send), and crowns for every cat. Away time pays up to 8 hours at a quarter of one tile's pace. Progress is saved with the extension. `vibeStudio.gameFloaters` shows a small +N beside the box as you type.

## Things to know

- Claude tiles ask you. When the agent needs a permission, has a question, or proposes a plan, a card appears above the message box and the tile shows "Needs you". Allow, always allow for the session, or deny (with a reason); answer questions; approve a plan or keep planning. The turn waits until you answer, and the card goes away if you stop the turn or close the tile. Codex tiles cannot ask: the sandbox decides, and anything outside it is denied.
- A tile goes amber ("Busy in another window") while some other process is writing to that session, and sending is disabled until it stops. One session should have one writer at a time.
- If a session is open and idle in the Claude or Codex panel and you reply from Vibe Studio, that panel will not show the new turn until you reopen the session there.
- Closing Vibe Studio does not stop a running turn.

## Adding another agent

Implement `AgentAdapter` (`src/adapters/common.ts`): list transcript files, read cheap metadata, parse lines into `ChatItem`s, and build the resume/new command lines. Then register it in `ADAPTERS` (`src/store.ts`) and add an `AgentId`.

`npm run check:parsers` runs discovery and parsing against the transcripts on this machine. No VS Code or network is involved.

## Privacy

Vibe Studio runs entirely on your machine. It reads the Claude Code and Codex session files already on your disk and sends messages by running those CLIs with your own login. It has no server and sends nothing anywhere else. The magic wand sends the prompt you are rewriting to Claude through the Claude CLI, the same way any message does.

## Not affiliated

Vibe Studio is an independent project. It is not made by, affiliated with or endorsed by Anthropic or OpenAI. "Claude" and "Codex" are used only to say which tools it works with.
