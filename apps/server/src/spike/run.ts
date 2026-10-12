import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { ClaudeRunner } from "../agent/claude-runner.js";

/**
 * Phase 0 spike. Proves the whole runtime chain on your own Claude Code login:
 *
 *   orchestrator -> spawn `claude -p` (headless, stream-json)
 *               -> attach the orchestrator MCP tool server
 *               -> restrict tools, pick a cheap model, cap turns
 *               -> observe a real tool call and real usage numbers
 *
 * Run with: pnpm spike
 * This uses your subscription. It is capped at 6 turns on haiku.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const dataDir = join(repoRoot, "data");
mkdirSync(dataDir, { recursive: true });

const mcpServerEntry = join(here, "..", "mcp", "server.ts");
const tsxBin = process.platform === "win32" ? "npx.cmd" : "npx";

const runner = new ClaudeRunner();

runner.on("tool_use", (t) => console.log(`\n[tool_use] ${t.name} ${JSON.stringify(t.input)}`));
runner.on("tool_result", (r) => console.log(`[tool_result] ${r.isError ? "ERROR " : ""}${JSON.stringify(r.content).slice(0, 200)}`));
runner.on("text", (t) => console.log(`[text] ${t}`));
runner.on("stderr", (s) => process.stderr.write(`[claude stderr] ${s}`));
runner.on("line", (l) => {
  if (l.type === "system" && (l as { subtype?: string }).subtype === "init") {
    const init = l as { model?: string; mcp_servers?: unknown; tools?: string[]; permissionMode?: string };
    console.log(`[init] model=${init.model} permissionMode=${init.permissionMode}`);
    console.log(`[init] mcp_servers=${JSON.stringify(init.mcp_servers)}`);
    console.log(`[init] mcp tools=${(init.tools ?? []).filter((t) => t.startsWith("mcp__")).join(", ")}`);
  }
});

const started = Date.now();
const result = await runner.run({
  model: process.env.TOKENVALLEY_SPIKE_MODEL ?? "haiku",
  maxTurns: 6,
  cwd: repoRoot,
  tempDir: dataDir,
  allowedTools: ["mcp__tokenvalley__send_message", "mcp__tokenvalley__create_task"],
  systemPrompt: [
    "You are the Product Manager at Pied Prompter, a company in TokenValley.",
    "Style: you schedule a meeting for everything, but keep it to one short line.",
    "Job: you own the task board. Use ONLY the tools provided. Do not read or write files.",
  ].join("\n"),
  prompt: "Spike check: send the CEO a one-line message saying the board is ready, then create one task titled 'Write product spec' owned by pm. Then stop.",
  mcpServers: {
    tokenvalley: {
      command: tsxBin,
      args: ["tsx", mcpServerEntry],
      env: {
        TOKENVALLEY_COMPANY: "pied-prompter",
        TOKENVALLEY_AGENT: "pm",
        TOKENVALLEY_TOOL_LOG: join(dataDir, "spike-tools.jsonl"),
      },
    },
  },
});

console.log("\n=== spike result ===");
console.log(JSON.stringify({
  ok: !result.isError,
  exitCode: result.exitCode,
  sessionId: result.sessionId,
  numTurns: result.numTurns,
  totalCostUsdEstimate: result.totalCostUsd,
  usage: result.usage,
  seconds: ((Date.now() - started) / 1000).toFixed(1),
}, null, 2));
process.exit(result.isError ? 1 : 0);
