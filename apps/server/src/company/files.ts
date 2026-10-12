import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FoundCompanyInput, ModelTier, type Company } from "@tokenvalley/shared";
import { REPO_ROOT } from "../roles.js";

/**
 * File-based founding. `companies/<slug>/company.md` founds a company; the
 * server watches the directory and reports status back to `status.md`.
 */

export const COMPANIES_DIR = join(REPO_ROOT, "companies");

export type CompanyFile = { slug: string; path: string; input: FoundCompanyInput };

function parseFrontMatter(md: string): { meta: Record<string, string | Record<string, string>>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: md.trim() };
  const meta: Record<string, string | Record<string, string>> = {};
  let current: string | null = null;
  for (const raw of m[1]!.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, ""); // strip trailing comments
    if (!line.trim()) continue;
    const nested = line.match(/^\s+([\w-]+):\s*(.+)$/);
    if (nested && current) {
      (meta[current] as Record<string, string>)[nested[1]!] = nested[2]!.trim();
      continue;
    }
    const top = line.match(/^([\w-]+):\s*(.*)$/);
    if (!top) continue;
    const [, key, value] = top;
    if (value!.trim() === "") {
      meta[key!] = {};
      current = key!;
    } else {
      meta[key!] = value!.trim().replace(/^["']|["']$/g, "");
      current = null;
    }
  }
  return { meta, body: m[2]!.trim() };
}

export function readCompanyFile(path: string): CompanyFile {
  const { meta, body } = parseFrontMatter(readFileSync(path, "utf8"));
  const str = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string) : undefined);
  const slug = dirname(path).split(/[\\/]/).pop()!;
  const workspaceRaw = str("workspace") ?? `../../workspaces/${slug}`;
  const workspacePath = resolve(dirname(path), workspaceRaw);
  if (!existsSync(workspacePath)) mkdirSync(workspacePath, { recursive: true });

  const modelsRaw = typeof meta.models === "object" ? (meta.models as Record<string, string>) : {};
  const modelOverrides: Record<string, ModelTier> = {};
  for (const [role, model] of Object.entries(modelsRaw)) {
    const parsed = ModelTier.safeParse(model);
    if (parsed.success) modelOverrides[role] = parsed.data;
  }

  const input = FoundCompanyInput.parse({
    name: str("name") ?? slug,
    tagline: str("tagline") ?? "",
    brief: body || "No brief given. Ask the founder what to build.",
    workspacePath,
    rosterTemplate: str("roster") ?? "startup",
    modelOverrides,
    maxTurns: str("budget_turns") ? Number(str("budget_turns")) : 100,
  });
  return { slug, path, input };
}

export function listCompanyFiles(): CompanyFile[] {
  if (!existsSync(COMPANIES_DIR)) return [];
  const out: CompanyFile[] = [];
  for (const entry of readdirSync(COMPANIES_DIR)) {
    if (entry.startsWith("_") || entry.startsWith(".")) continue;
    const dir = join(COMPANIES_DIR, entry);
    if (!statSync(dir).isDirectory()) continue;
    const file = join(dir, "company.md");
    if (!existsSync(file)) continue;
    try {
      out.push(readCompanyFile(file));
    } catch (err) {
      console.error(`[tokenvalley] could not read ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

/** Calls onNew for every company.md that appears (debounced), including existing ones at start. */
export function watchCompanyFiles(onNew: (file: CompanyFile) => void): () => void {
  mkdirSync(COMPANIES_DIR, { recursive: true });
  const seen = new Set<string>();
  const scan = () => {
    for (const f of listCompanyFiles()) {
      if (seen.has(f.slug)) continue;
      seen.add(f.slug);
      onNew(f);
    }
  };
  scan();
  let timer: NodeJS.Timeout | null = null;
  const watcher = watch(COMPANIES_DIR, { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(scan, 500);
  });
  return () => watcher.close();
}

/** Human-readable status next to the company file, for people who never open the UI. */
export function writeStatusFile(slug: string, company: Company, lines: string[]): void {
  const dir = join(COMPANIES_DIR, slug);
  if (!existsSync(dir)) return;
  const pct = company.budget.maxTurns ? Math.round((company.spend.turns / company.budget.maxTurns) * 100) : 0;
  const body = [
    `# ${company.name}: status`,
    ``,
    `Phase: **${company.phase}**  `,
    `Turns: ${company.spend.turns} / ${company.budget.maxTurns} (${pct}%)  `,
    `Estimated cost: $${company.spend.estimatedUsd.toFixed(2)}  `,
    `Updated: ${new Date().toISOString()}`,
    ``,
    `## Recent activity`,
    ...lines.map((l) => `- ${l}`),
    ``,
  ].join("\n");
  writeFileSync(join(dir, "status.md"), body);
}
