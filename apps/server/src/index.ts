import { WebSocketServer, type WebSocket } from "ws";
import { ClientMessage } from "@tokenvalley/shared";
import { join } from "node:path";
import { Town } from "./town.js";
import { FakeGenerator } from "./fake/generator.js";
import { CompanyRegistry, type CompanyRecord } from "./company/registry.js";
import { foundCompany } from "./company/founder.js";
import { runAgentTurn } from "./agent/turn.js";
import { REPO_ROOT } from "./roles.js";

const PORT = Number(process.env.TOKENVALLEY_PORT ?? 8787);
const MODE = process.env.TOKENVALLEY_MODE ?? "fake"; // "fake" in Phase 1; "live" arrives in Phase 2

const town = new Town();
const registry = new CompanyRegistry(join(REPO_ROOT, "data"));
const records = new Map<string, CompanyRecord>();
const wss = new WebSocketServer({ port: PORT });

// Restore live companies founded in earlier runs.
for (const rec of registry.list()) {
  records.set(rec.company.id, rec);
  town.companies.set(rec.company.id, rec.company);
  for (const a of rec.agents) town.agents.set(a.id, a);
  for (const t of rec.tasks) town.tasks.set(t.id, t);
  town.events.push(...rec.events.slice(-200));
  if (!town.focusedCompanyId) town.focusedCompanyId = rec.company.id;
}
if (records.size) console.log(`[tokenvalley] restored ${records.size} live compan${records.size === 1 ? "y" : "ies"}`);

/** The CEO's first turn after founding: acknowledge the founder and lay out goals. */
async function kickoff(rec: CompanyRecord): Promise<void> {
  const ceo = rec.agents.find((a) => a.role === "ceo");
  if (!ceo) return;
  town.emit({ id: town.nextId("ev"), companyId: rec.company.id, timestamp: Date.now(), type: "company_phase", phase: "planning" });
  try {
    await runAgentTurn({
      town, registry, record: rec, agent: ceo, maxTurns: 10,
      prompt: [
        "The founder has just founded this company and put it in charge of the project folder.",
        "1. Look at the folder briefly with Glob and Read (no shell): list top-level files and read the README if there is one.",
        "2. Send the founder a one-line acknowledgement using send_message with to=\"founder\".",
        "3. Create three to six goal tasks on the board with create_task, assigning owner roles from your colleagues.",
        "4. Send the PM one line asking them to break the goals into tasks.",
        "Then stop.",
      ].join("\n"),
    });
  } catch (err) {
    console.error(`[tokenvalley] CEO kickoff failed for ${rec.company.slug}:`, err);
  }
}

wss.on("connection", (ws: WebSocket) => {
  const send = (msg: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const unsubscribe = town.onMessage(send);

  ws.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return;
    }
    const result = ClientMessage.safeParse(parsed);
    if (!result.success) return;
    const msg = result.data;
    switch (msg.kind) {
      case "hello":
        send(town.snapshot());
        break;
      case "found_company": {
        try {
          const rec = foundCompany(town, registry, msg.input);
          records.set(rec.company.id, rec);
          town.focus(rec.company.id);
          send({ kind: "founded", companyId: rec.company.id });
          void kickoff(rec);
        } catch (err) {
          send({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        }
        break;
      }
      case "focus_company":
        town.focus(msg.companyId);
        break;
      case "set_agent_model": {
        const agent = town.agents.get(msg.agentId);
        if (agent) {
          town.emit({ id: town.nextId("ev"), companyId: agent.companyId, timestamp: Date.now(), type: "agent_model_changed", agentId: agent.id, model: msg.model });
        }
        break;
      }
      case "pause_company": {
        if (town.companies.has(msg.companyId)) {
          town.emit({ id: town.nextId("ev"), companyId: msg.companyId, timestamp: Date.now(), type: "company_phase", phase: "paused" });
        }
        break;
      }
      case "resume_company": {
        if (town.companies.has(msg.companyId)) {
          town.emit({ id: town.nextId("ev"), companyId: msg.companyId, timestamp: Date.now(), type: "company_phase", phase: "building" });
        }
        break;
      }
      case "resolve_approval":
      case "panic":
        // Wired to real agents in Phase 4.
        break;
    }
  });

  ws.on("close", unsubscribe);
});

if (MODE === "fake") {
  const gen = new FakeGenerator(town);
  gen.start();
  console.log(`[tokenvalley] fake event generator running`);
}

console.log(`[tokenvalley] server listening on ws://localhost:${PORT} (mode=${MODE})`);
