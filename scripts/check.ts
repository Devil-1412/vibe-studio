// Runs discovery + parsing against the real transcripts on this machine (no vscode, no network).
// Usage: npm run check:parsers [-- --dump <outfile>]
import * as fs from 'fs';
import * as path from 'path';
import { buildAgentMap, claudeAgentFile, codexAgentFile } from '../src/agents';
import { claude } from '../src/adapters/claude';
import { codex } from '../src/adapters/codex';
import type { AgentAdapter } from '../src/adapters/common';
import { listSkills } from '../src/skills';
import { TailReader } from '../src/tail';
import type { AgentMap, ChatItem } from '../src/types';

async function main() {
  const dumpAt = process.argv.indexOf('--dump');
  const dump: Record<string, unknown> = {};
  for (const adapter of [claude, codex] as AgentAdapter[]) {
    await adapter.refreshTitles?.();
    const files = (await adapter.listFiles()).sort((a, b) => b.mtimeMs - a.mtimeMs);
    // Codex sub-agents are threads with their own rollout file
    const threadFile = new Map(files.map((f) => [`codex:${path.basename(f.file, '.jsonl').slice(-36)}`, f.file]));
    let t = Date.now();
    const metas = [];
    for (const f of files) {
      const meta = await adapter.readMeta(f.file, f.size);
      if (meta) metas.push({ ...meta, title: adapter.titleFor?.(meta.id) || meta.title, file: f.file, mtimeMs: f.mtimeMs, size: f.size });
    }
    console.log(`\n## ${adapter.label}: ${files.length} files → ${metas.length} sessions (meta in ${Date.now() - t}ms)`);
    for (const m of metas.slice(0, 5)) console.log(`  - ${m.title}  [${m.cwd}]`);
    const known = (await adapter.knownModels()).map((m) => `${m.label} (${m.value})`);
    const seen = [...new Set(metas.map((m) => m.model).filter((m): m is string => !!m))].map((m) => `${adapter.modelLabel(m)} (${m})`);
    console.log(`  models known: ${known.join(', ') || '—'}`);
    console.log(`  models seen in sessions: ${seen.join(', ') || '—'}`);

    // Parse the 3 most recent and the largest session fully.
    const largest = [...metas].sort((a, b) => b.size - a.size)[0];
    // ...and the Claude chat with the most sub-agents, which shows the Agent map's nesting best
    const subCount = (file: string) => {
      try {
        return fs.readdirSync(file.replace(/\.jsonl$/, '') + '/subagents').length;
      } catch {
        return 0;
      }
    };
    const busiest = adapter.id === 'claude' ? [...metas].sort((a, b) => subCount(b.file) - subCount(a.file))[0] : undefined;
    const sample = [...new Set([...metas.slice(0, 3), largest, busiest])].filter((x): x is NonNullable<typeof x> => !!x);
    const sessions = [];
    for (const m of sample) {
      t = Date.now();
      const parser = adapter.createParser();
      await new TailReader(m.file).read((line) => parser.feed(line));
      const counts: Record<string, number> = {};
      for (const i of parser.items) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
      const tools = parser.items.filter((i): i is Extract<ChatItem, { kind: 'tool' }> => i.kind === 'tool');
      const noOutput = tools.filter((i) => i.output === undefined).length;
      console.log(
        `  parsed ${(m.size / 1e6).toFixed(1)}MB in ${Date.now() - t}ms: ${JSON.stringify(counts)}; tools without output: ${noOutput}`,
      );
      const firstUser = parser.items.find((i) => i.kind === 'user');
      if (firstUser) console.log(`    first user: ${JSON.stringify(firstUser.text.slice(0, 120))}`);
      const someTools = tools.slice(0, 4).map((i) => `${i.name}: ${i.summary}`);
      if (someTools.length) console.log(`    tools: ${someTools.join(' | ')}`);
      const longest = [...parser.turns].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
      const files = [...parser.files.values()];
      console.log(
        `    usage: ${JSON.stringify(parser.usage)}; turns: ${parser.turns.length}; longest: ${
          longest ? Math.round((longest.end - longest.start) / 1000) + 's' : '—'
        }; files: ${files.length} (+${files.reduce((n, f) => n + f.adds, 0)} −${files.reduce((n, f) => n + f.dels, 0)})`,
      );
      if (files.length) console.log(`    e.g. ${files.slice(0, 3).map((f) => `${f.path.split('/').pop()} +${f.adds} −${f.dels}`).join(', ')}`);
      if (parser.skillsUsed.size) console.log(`    skills used: ${[...parser.skillsUsed].join(', ')}`);
      const agents = parser.items.filter((i): i is Extract<ChatItem, { kind: 'agent' }> => i.kind === 'agent');
      let agentMap: AgentMap | undefined;
      const agentLogs: Record<string, ChatItem[]> = {};
      if (agents.length) {
        agentMap = await buildAgentMap({
          agent: adapter.id,
          items: parser.items,
          main: { title: m.title, model: parser.model, context: parser.usage.context, busy: false },
          canStop: false,
          resolve: (it) => (adapter.id === 'claude' ? claudeAgentFile(m.file, it) : codexAgentFile((k) => threadFile.get(k), it)),
        });
        const byStatus: Record<string, number> = {};
        for (const a of agentMap.agents) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
        const nested = agentMap.agents.filter((a) => a.parentId).length;
        console.log(`    agent map: ${agentMap.agents.length} agents (${nested} nested) ${JSON.stringify(byStatus)}`);
        for (const a of agentMap.agents.slice(0, 4)) {
          console.log(`      ${a.parentId ? '└ ' : ''}${a.agentType}/${a.description} [${a.status}] ${a.tokens ?? '?'} tok, ${a.toolUses ?? '?'} tools, ${a.model ?? '?'}`);
        }
        // sub-agent transcripts for the harness's transcript view
        for (const a of agentMap.agents.slice(0, 60)) {
          const f = adapter.id === 'claude' ? claudeAgentFile(m.file, agents.find((x) => x.id === a.id) ?? ({ id: a.id, agentId: a.agentId } as never)) : undefined;
          if (!f) continue;
          const p = adapter.createParser({ sidechain: true });
          await new TailReader(f.file).read((line) => p.feed(line));
          agentLogs[a.agentId!] = p.items.slice(-40);
        }
      }
      sessions.push({
        agentLogs,
        agentMap,
        agents: agentMap?.agents.map((a) => ({ id: a.id, description: a.description, status: a.status })),
        key: `${adapter.id}:${m.id}`,
        items: parser.items.slice(-120),
        usage: parser.usage,
        files: [...parser.files.values()],
        skills: [...parser.skillsUsed],
      });
    }
    dump[adapter.id] = {
      sessions: metas.map((m) => ({
        key: `${adapter.id}:${m.id}`,
        agent: adapter.id,
        id: m.id,
        title: m.title,
        cwd: m.cwd,
        project: m.cwd.split('/').pop(),
        updatedAt: m.mtimeMs,
        status: 'idle',
      })),
      transcripts: sessions,
    };
  }
  for (const agent of ['claude', 'codex'] as const) {
    const list = await listSkills(agent, process.cwd());
    const sources = [...new Set(list.map((s) => s.source))];
    console.log(`\n## ${agent} skills: ${list.length} from ${sources.join(', ')}`);
    for (const src of sources) console.log(`  ${src}: ${list.filter((s) => s.source === src).slice(0, 4).map((s) => s.name).join(', ')}`);
    dump[`${agent}Skills`] = list;
  }
  if (dumpAt > 0) {
    fs.writeFileSync(process.argv[dumpAt + 1], JSON.stringify(dump));
    console.log(`\nwrote ${process.argv[dumpAt + 1]}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
