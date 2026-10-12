import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ModelTier } from "@tokenvalley/shared";

/**
 * Runs one agent turn as a child process of the unmodified `claude` binary in
 * headless mode. This is the only place the app touches Claude Code, and it
 * never reads or stores credentials: the binary uses whatever `claude login`
 * set up on this machine.
 */

export type RunnerOptions = {
  /** The prompt for this turn. */
  prompt: string;
  /** Appended to Claude Code's default system prompt: role, company, task context. */
  systemPrompt: string;
  model: ModelTier | string;
  /** Working directory the agent may touch. */
  cwd: string;
  /** Extra directories to allow, e.g. the company workspace when cwd differs. */
  addDirs?: string[];
  /** Tool allow-list. MCP tools are `mcp__<server>__<tool>`. */
  allowedTools: string[];
  maxTurns: number;
  /** Resume an existing session so a core-cast agent keeps its memory. */
  resumeSessionId?: string;
  /** MCP servers to attach, keyed by server name. */
  mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  /** Where to write the temp mcp config file. */
  tempDir: string;
  /** Hard spend guard the CLI enforces on its own estimates. */
  maxBudgetUsd?: number;
  claudeBinary?: string;
};

export type StreamLine =
  | { type: "system"; subtype: string; session_id?: string; [k: string]: unknown }
  | { type: "assistant"; message: { content: ContentBlock[] }; session_id?: string; [k: string]: unknown }
  | { type: "user"; message: { content: ContentBlock[] | string }; [k: string]: unknown }
  | { type: "result"; subtype: string; session_id?: string; num_turns?: number; total_cost_usd?: number; usage?: Usage; result?: string; is_error?: boolean; [k: string]: unknown }
  | { type: string; [k: string]: unknown };

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: string; [k: string]: unknown };

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type RunResult = {
  sessionId: string | null;
  numTurns: number;
  totalCostUsd: number;
  usage: Usage;
  finalText: string;
  isError: boolean;
  exitCode: number | null;
};

export interface RunnerEvents {
  line: [StreamLine];
  text: [string];
  tool_use: [{ id: string; name: string; input: Record<string, unknown> }];
  tool_result: [{ toolUseId: string; content: unknown; isError: boolean }];
  stderr: [string];
}

export class ClaudeRunner extends EventEmitter<RunnerEvents> {
  private child: ChildProcess | null = null;

  async run(opts: RunnerOptions): Promise<RunResult> {
    const bin = opts.claudeBinary ?? process.env.TOKENVALLEY_CLAUDE_BIN ?? "claude";
    const args = [
      "-p",
      "--verbose",
      "--output-format", "stream-json",
      "--model", opts.model,
      "--max-turns", String(opts.maxTurns),
      "--append-system-prompt", opts.systemPrompt,
      "--permission-mode", "acceptEdits",
    ];
    if (opts.allowedTools.length) args.push("--allowedTools", ...opts.allowedTools);
    if (opts.addDirs?.length) args.push("--add-dir", ...opts.addDirs);
    if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);
    if (opts.maxBudgetUsd) args.push("--max-budget-usd", String(opts.maxBudgetUsd));
    let cfgPath: string | null = null;
    if (opts.mcpServers) {
      const tmp = join(opts.tempDir, "tmp");
      mkdirSync(tmp, { recursive: true });
      cfgPath = join(tmp, `mcp-${process.pid}-${Date.now()}.json`);
      writeFileSync(cfgPath, JSON.stringify({ mcpServers: opts.mcpServers }, null, 2));
      args.push("--mcp-config", cfgPath, "--strict-mcp-config");
    }
    args.push(opts.prompt);

    const child = spawn(bin, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      // No shell: arguments contain prompts with quotes and newlines. On Windows,
      // CreateProcess resolves `claude` to `claude.exe` on PATH by itself. If your
      // install is a .cmd shim, point TOKENVALLEY_CLAUDE_BIN at the real executable.
      shell: false,
      env: { ...process.env },
    });
    this.child = child;

    const result: RunResult = { sessionId: null, numTurns: 0, totalCostUsd: 0, usage: {}, finalText: "", isError: false, exitCode: null };

    child.stderr?.on("data", (d) => this.emit("stderr", String(d)));

    const rl = createInterface({ input: child.stdout! });
    for await (const raw of rl) {
      if (!raw.trim()) continue;
      let line: StreamLine;
      try {
        line = JSON.parse(raw) as StreamLine;
      } catch {
        continue;
      }
      this.emit("line", line);
      if (line.session_id && typeof line.session_id === "string") result.sessionId = line.session_id;

      if (line.type === "assistant") {
        const blocks = (line as { message: { content: ContentBlock[] } }).message?.content ?? [];
        for (const b of blocks) {
          if (b.type === "text") this.emit("text", (b as { text: string }).text);
          if (b.type === "tool_use") this.emit("tool_use", b as { id: string; name: string; input: Record<string, unknown> });
        }
      } else if (line.type === "user") {
        const content = (line as { message: { content: ContentBlock[] | string } }).message?.content;
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b.type === "tool_result") {
              const tr = b as { tool_use_id: string; content: unknown; is_error?: boolean };
              this.emit("tool_result", { toolUseId: tr.tool_use_id, content: tr.content, isError: !!tr.is_error });
            }
          }
        }
      } else if (line.type === "result") {
        const r = line as Extract<StreamLine, { type: "result" }>;
        result.numTurns = r.num_turns ?? 0;
        result.totalCostUsd = r.total_cost_usd ?? 0;
        result.usage = r.usage ?? {};
        result.finalText = typeof r.result === "string" ? r.result : "";
        result.isError = !!r.is_error || (r.subtype !== "success");
      }
    }

    result.exitCode = await new Promise<number | null>((resolve) => child.on("close", resolve));
    this.child = null;
    if (cfgPath) {
      try { unlinkSync(cfgPath); } catch { /* already gone */ }
    }
    return result;
  }

  kill(): void {
    this.child?.kill();
  }
}
