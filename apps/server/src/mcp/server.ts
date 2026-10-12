import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

/**
 * The orchestrator tool server. Each agent process gets its own instance over
 * stdio via --mcp-config. The company identity comes from env, so an agent can
 * never address another company: there is no parameter for it.
 *
 * Phase 0/1: tools validate input, log the call to a JSONL file (if
 * TOKENVALLEY_TOOL_LOG is set), and return a short acknowledgement. The
 * orchestrator also observes every tool_use in the stream-json output, so the
 * canonical event source is the stream, not this file.
 * Phase 2: these handlers talk to the company's task board and message log.
 */

const COMPANY = process.env.TOKENVALLEY_COMPANY ?? "unknown-company";
const AGENT = process.env.TOKENVALLEY_AGENT ?? "unknown-agent";
const LOG = process.env.TOKENVALLEY_TOOL_LOG;
const BOARD_FILE = process.env.TOKENVALLEY_BOARD_FILE;

function record(tool: string, input: unknown): void {
  if (!LOG) return;
  appendFileSync(LOG, JSON.stringify({ ts: Date.now(), company: COMPANY, agent: AGENT, tool, input }) + "\n");
}

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });

const server = new McpServer({ name: "tokenvalley", version: "0.1.0" });

server.tool(
  "send_message",
  "Send a short message to a colleague by role (ceo, pm, engineer, qa, designer, or a hire's role).",
  { to: z.string().describe("Recipient role"), text: z.string().max(600) },
  async ({ to, text }) => {
    record("send_message", { to, text });
    return ok(`Message delivered to ${to}.`);
  },
);

server.tool(
  "create_task",
  "Create a task on the company board.",
  {
    title: z.string().max(120),
    owner_role: z.string().optional(),
    depends_on: z.array(z.string()).optional(),
    note: z.string().max(600).optional(),
  },
  async (input) => {
    record("create_task", input);
    return ok(`Task created: "${input.title}" (id task_pending)`);
  },
);

server.tool(
  "update_task",
  "Update a task's status or add linked files.",
  { task_id: z.string(), status: z.enum(["backlog", "in_progress", "blocked", "review", "done"]).optional(), files: z.array(z.string()).optional(), note: z.string().optional() },
  async (input) => {
    record("update_task", input);
    return ok(`Task ${input.task_id} updated.`);
  },
);

server.tool(
  "handoff",
  "Hand a task to another role with a note.",
  { task_id: z.string(), to_role: z.string(), note: z.string().max(600) },
  async (input) => {
    record("handoff", input);
    return ok(`Task ${input.task_id} handed to ${input.to_role}.`);
  },
);

server.tool(
  "call_meeting",
  "Call a meeting with a list of roles about a topic.",
  { attendees: z.array(z.string()).min(1), topic: z.string().max(200) },
  async (input) => {
    record("call_meeting", input);
    return ok(`Meeting called: ${input.topic}.`);
  },
);

server.tool(
  "request_approval",
  "Ask the founder to approve a plan, build, or release. Only the CEO should call this.",
  { summary: z.string().max(1200) },
  async (input) => {
    record("request_approval", input);
    return ok("Approval requested. The company pauses until the founder responds.");
  },
);

server.tool(
  "hire",
  "Hire a temporary worker for one task. Allowed roles: backend, frontend, marketing, legal, hr, it, intern.",
  { role: z.enum(["backend", "frontend", "marketing", "legal", "hr", "it", "intern"]), task: z.string().max(600), model: z.enum(["opus", "sonnet", "haiku"]).optional() },
  async (input) => {
    record("hire", input);
    return ok(`Hired a ${input.role} for: ${input.task}`);
  },
);

server.tool(
  "read_board",
  "Read the company task board.",
  {},
  async () => {
    record("read_board", {});
    if (!BOARD_FILE || !existsSync(BOARD_FILE)) return ok("Board is empty.");
    try {
      const rec = JSON.parse(readFileSync(BOARD_FILE, "utf8")) as { tasks?: { id: string; title: string; status: string; ownerRole: string | null }[]; agents?: { role: string; name: string; status: string; kind: string }[] };
      const tasks = (rec.tasks ?? []).map((t) => `- ${t.id} [${t.status}] ${t.title} (owner: ${t.ownerRole ?? "none"})`);
      const people = (rec.agents ?? []).filter((a) => a.kind !== "npc" && a.status !== "retired").map((a) => `- ${a.role}: ${a.name} (${a.status})`);
      return ok(["## Tasks", ...(tasks.length ? tasks : ["- (none)"]), "", "## People", ...people].join("\n"));
    } catch {
      return ok("Board could not be read.");
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
