import { WebSocketServer, type WebSocket } from "ws";
import { ClientMessage } from "@tokenvalley/shared";
import { Town } from "./town.js";
import { FakeGenerator } from "./fake/generator.js";

const PORT = Number(process.env.TOKENVALLEY_PORT ?? 8787);
const MODE = process.env.TOKENVALLEY_MODE ?? "fake"; // "fake" in Phase 1; "live" arrives in Phase 2

const town = new Town();
const wss = new WebSocketServer({ port: PORT });

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
