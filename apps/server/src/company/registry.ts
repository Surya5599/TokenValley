import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Agent, Company, Event, Message, Task } from "@agentsitcom/shared";

/**
 * Persists founded (live) companies between server restarts as plain JSON
 * under data/. One file per company, so companies never share a store.
 * SQLite replaces this in Phase 2 proper; the shape stays the same.
 */

export type CompanyRecord = {
  company: Company;
  agents: Agent[];
  tasks: Task[];
  events: Event[];
  /** Claude Code session id per core agent, so resumed turns keep memory. */
  sessions: Record<string, string>;
  /** Chat channels beyond #general: one per meeting. */
  channels: { channel: string; title: string; memberIds: string[]; open: boolean }[];
  /** Unread messages per agent id. Persisted so a restart loses nothing. */
  inbox: Record<string, Message[]>;
};

export class CompanyRegistry {
  constructor(private dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
  }

  private file(slug: string): string {
    return join(this.dataDir, `company-${slug}.json`);
  }

  fileFor(slug: string): string {
    return this.file(slug);
  }

  list(): CompanyRecord[] {
    const out: CompanyRecord[] = [];
    const idx = join(this.dataDir, "companies.json");
    if (!existsSync(idx)) return out;
    const slugs = JSON.parse(readFileSync(idx, "utf8")) as string[];
    for (const slug of slugs) {
      const f = this.file(slug);
      if (existsSync(f)) {
        const rec = JSON.parse(readFileSync(f, "utf8")) as CompanyRecord;
        rec.channels ??= [];
        rec.inbox ??= {};
        for (const a of rec.agents) {
          a.style ??= "";
          a.job ??= "";
        }
        out.push(rec);
      }
    }
    return out;
  }

  save(rec: CompanyRecord): void {
    const slug = rec.company.slug;
    const trimmed: CompanyRecord = { ...rec, events: rec.events.slice(-2000) };
    writeFileSync(this.file(slug), JSON.stringify(trimmed, null, 2));
    const idx = join(this.dataDir, "companies.json");
    const slugs = existsSync(idx) ? (JSON.parse(readFileSync(idx, "utf8")) as string[]) : [];
    if (!slugs.includes(slug)) writeFileSync(idx, JSON.stringify([...slugs, slug], null, 2));
  }
}
