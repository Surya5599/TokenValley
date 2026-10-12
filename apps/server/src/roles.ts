import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RoleId, ModelTier, type Effort, type AgentKind } from "@tokenvalley/shared";

/**
 * Loads the cast from packages/agents. Role files are markdown with a small
 * front matter block; rosters are JSON. No code lives there so forks can edit
 * the cast without touching the server.
 */

export type RoleDef = {
  role: RoleId;
  kind: AgentKind;
  model: ModelTier | null;
  effort: Effort;
  tools: string[];
  home: string;
  style: string;
  job: string;
};

export type Roster = {
  name: string;
  description: string;
  core: RoleId[];
  npcs: RoleId[];
  hireable: RoleId[];
  modelOverrides: Record<string, ModelTier>;
  maxLiveAgents: number;
};

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");
const AGENTS_DIR = join(REPO_ROOT, "packages", "agents");

function parseFrontMatter(md: string): { meta: Record<string, string>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2]! };
}

function section(body: string, heading: string): string {
  const re = new RegExp(`##\\s+${heading}\\s*\\r?\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
  return (body.match(re)?.[1] ?? "").trim();
}

export function loadRole(role: RoleId): RoleDef {
  const path = join(AGENTS_DIR, "roles", `${role}.md`);
  const { meta, body } = parseFrontMatter(readFileSync(path, "utf8"));
  const tools = (meta.tools ?? "[]").replace(/^\[|\]$/g, "").split(",").map((t) => t.trim()).filter(Boolean);
  const model = meta.model && meta.model !== "null" ? ModelTier.parse(meta.model) : null;
  return {
    role,
    kind: (meta.kind as AgentKind) ?? "core",
    model,
    effort: (meta.effort as Effort) ?? "medium",
    tools,
    home: meta.home ?? "floating_1",
    style: section(body, "Style"),
    job: section(body, "Job"),
  };
}

export type Persona = { name?: string; style: string; job: string };

function personaFile(companySlug: string, role: RoleId): string {
  return join(REPO_ROOT, "companies", companySlug, "agents", `${role}.md`);
}

/**
 * The persona a company actually uses for a role: the role file, overridden
 * by companies/<slug>/agents/<role>.md when it exists. Edit that file by hand
 * or through the UI; it is read fresh at every turn.
 */
export function loadPersona(companySlug: string, role: RoleId): Persona {
  const def = loadRole(role);
  const file = personaFile(companySlug, role);
  if (!existsSync(file)) return { style: def.style, job: def.job };
  try {
    const { meta, body } = parseFrontMatter(readFileSync(file, "utf8"));
    const style = section(body, "Style");
    const job = section(body, "Job");
    return { name: meta.name, style: style || def.style, job: job || def.job };
  } catch {
    return { style: def.style, job: def.job };
  }
}

export function savePersona(companySlug: string, role: RoleId, persona: Persona): string {
  const file = personaFile(companySlug, role);
  mkdirSync(join(file, ".."), { recursive: true });
  const fm = persona.name ? `---\nname: ${persona.name}\n---\n\n` : "";
  writeFileSync(file, `${fm}## Style\n${persona.style.trim()}\n\n## Job\n${persona.job.trim()}\n`);
  return file;
}

export function loadAllRoles(): Map<RoleId, RoleDef> {
  const out = new Map<RoleId, RoleDef>();
  for (const f of readdirSync(join(AGENTS_DIR, "roles"))) {
    if (!f.endsWith(".md")) continue;
    const id = RoleId.safeParse(f.replace(/\.md$/, ""));
    if (id.success) out.set(id.data, loadRole(id.data));
  }
  return out;
}

export function loadRoster(name: string): Roster {
  const path = join(AGENTS_DIR, "rosters", `${name}.json`);
  if (!existsSync(path)) throw new Error(`Unknown roster template: ${name}`);
  return JSON.parse(readFileSync(path, "utf8")) as Roster;
}

export function listRosters(): string[] {
  return readdirSync(join(AGENTS_DIR, "rosters")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
}
