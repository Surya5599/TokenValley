import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_MODEL,
  ROLE_LABEL,
  type Agent,
  type Company,
  type FoundCompanyInput,
  type ModelTier,
} from "@tokenvalley/shared";
import type { Town } from "../town.js";
import { loadRole, loadRoster } from "../roles.js";
import type { CompanyRegistry, CompanyRecord } from "./registry.js";

const PALETTES: Company["palette"][] = [
  { primary: "#2fb37a", secondary: "#1f6f4e", accent: "#9be7c4", floor: "#2b2f36", wall: "#3b4350" },
  { primary: "#4a7bd0", secondary: "#2f4f8a", accent: "#a9c4f5", floor: "#2a2b31", wall: "#4a4a58" },
  { primary: "#e0533d", secondary: "#8f2f22", accent: "#ffb3a3", floor: "#2e2a2a", wall: "#5a4646" },
  { primary: "#c9a227", secondary: "#8a6d12", accent: "#f3dd8a", floor: "#2d2c26", wall: "#56523f" },
  { primary: "#9b59b6", secondary: "#5e3370", accent: "#d7b3e8", floor: "#2b2630", wall: "#4b3f55" },
];

const NAMES = ["Dana", "Priya", "Milo", "Quinn", "Sasha", "Theo", "Ira", "Noor", "Felix", "Wren"];

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "company";
}

/**
 * Founds a live company: validates the folder, builds the cast from the
 * roster template, applies model overrides, emits the founding events, and
 * persists the record. Returns the record so the caller can start the CEO.
 */
export function foundCompany(town: Town, registry: CompanyRegistry, input: FoundCompanyInput): CompanyRecord {
  const workspacePath = resolve(input.workspacePath);
  if (!existsSync(workspacePath) || !statSync(workspacePath).isDirectory()) {
    throw new Error(`Workspace folder does not exist: ${input.workspacePath}`);
  }
  const roster = loadRoster(input.rosterTemplate);
  let slug = slugify(input.name);
  const taken = new Set([...town.companies.values()].map((c) => c.slug));
  for (let n = 2; taken.has(slug); n++) slug = `${slugify(input.name)}-${n}`;

  const id = town.nextId("co");
  const plot = town.companies.size;
  const company: Company = {
    id,
    slug,
    name: input.name,
    tagline: input.tagline,
    brief: input.brief,
    workspacePath,
    live: true,
    rosterTemplate: roster.name,
    palette: PALETTES[plot % PALETTES.length]!,
    budget: { maxTurns: input.maxTurns, maxTokens: input.maxTokens },
    spend: { turns: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
    priority: 5,
    phase: "founded",
    plot,
  };
  const now = Date.now();
  town.emit({ id: town.nextId("ev"), companyId: id, timestamp: now, type: "company_founded", company });

  const agents: Agent[] = [];
  let nameIdx = Math.floor(Math.random() * NAMES.length);
  const overrides: Record<string, ModelTier> = { ...roster.modelOverrides, ...input.modelOverrides };
  for (const role of [...roster.core, ...roster.npcs]) {
    const def = loadRole(role);
    const isNpc = def.kind === "npc";
    const agent: Agent = {
      id: town.nextId("ag"),
      companyId: id,
      role,
      kind: isNpc ? "npc" : "core",
      name: `${NAMES[nameIdx++ % NAMES.length]} (${ROLE_LABEL[role]})`,
      model: isNpc ? null : overrides[role] ?? def.model ?? DEFAULT_MODEL[role],
      effort: def.effort,
      status: "idle",
      currentTaskId: null,
      home: def.home,
      parentAgentId: null,
    };
    agents.push(agent);
    town.emit({ id: town.nextId("ev"), companyId: id, timestamp: Date.now(), type: "agent_spawned", agentId: agent.id, agent });
  }

  const record: CompanyRecord = { company, agents, tasks: [], events: [], sessions: {} };
  registry.save(record);
  return record;
}
