import { ROLE_LABEL, type Agent } from "@tokenvalley/shared";

/**
 * The story's DOM: cold-open title card, end card, and the lower-third name
 * cards that introduce a character the first time they speak.
 */

/** Office-style role titles by first name; anyone else gets the shared role label. */
const TITLES: Record<string, string> = {
  michael: "Regional Manager",
  dwight: "Assistant to the Regional Engineer",
  jim: "Product Manager, Reluctantly",
  pam: "Designer, Formerly Reception",
  angela: "Head of Quality. Keeps a List.",
  oscar: "Accountant",
  erin: "Receptionist",
  kevin: "Intern. Brought Chili.",
  creed: "IT Support (Unverified)",
  stanley: "Crossword Specialist",
  toby: "Human Resources",
  ryan: "Temp",
  kelly: "Customer Relations",
};

function firstName(name: string): string {
  return name.trim().split(/[\s(]/)[0] ?? name;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class StoryCards {
  private readonly title: HTMLElement;
  private readonly end: HTMLElement;
  private readonly lower: HTMLElement;
  private readonly lowerName: HTMLElement;
  private readonly lowerRole: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly introduced = new Set<string>();
  /** Story-time deadlines, so skipping beats hides these too. */
  private lowerUntil = -1;
  private captionUntil = -1;
  private time = 0;
  nameCardsOn = false;

  constructor(root: HTMLElement) {
    this.title = el("div", "story-title");
    root.append(this.title);
    this.end = el("div", "story-end");
    root.append(this.end);
    this.lower = el("div", "story-lower");
    this.lowerName = el("div", "name");
    this.lowerRole = el("div", "role");
    this.lower.append(this.lowerName, this.lowerRole);
    root.append(this.lower);
    this.caption = el("div", "story-caption");
    root.append(this.caption);
  }

  /** Advances story time and retires the lower third and caption when due. */
  update(dt: number): void {
    this.time += dt;
    if (this.lowerUntil >= 0 && this.time >= this.lowerUntil) {
      this.lowerUntil = -1;
      this.lower.classList.remove("in");
    }
    if (this.captionUntil >= 0 && this.time >= this.captionUntil) {
      this.captionUntil = -1;
      this.caption.classList.remove("in");
    }
  }

  /** An interview caption, bottom centre, for talking heads. */
  showCaption(text: string, seconds: number): void {
    this.caption.textContent = text;
    this.caption.classList.add("in");
    this.captionUntil = this.time + seconds;
  }

  /** The cold-open card: dark, "TokenValley" small, the episode title large, the tagline, a subtle wordmark. */
  showTitle(title: string, tagline: string): void {
    this.title.replaceChildren(el("div", "small", "TokenValley"), el("div", "big", title), el("div", "tag", tagline), el("div", "mark", "TokenValley"));
    this.title.classList.add("in");
  }

  hideTitle(): void {
    this.title.classList.remove("in");
  }

  showEnd(title: string): void {
    this.end.replaceChildren(el("div", "small", "TokenValley"), el("div", "big", title), el("div", "tag", "Dunder Mindflin · Limitless paper in a paperless world."));
    this.end.classList.add("in");
  }

  /** Lower third for an agent, once per episode, only while name cards are on. */
  introduce(a: Agent, force = false): void {
    if (!this.nameCardsOn && !force) return;
    if (this.introduced.has(a.id)) return;
    this.introduced.add(a.id);
    const first = firstName(a.name);
    this.lowerName.textContent = first;
    this.lowerRole.textContent = TITLES[first.toLowerCase()] ?? ROLE_LABEL[a.role];
    this.lower.classList.add("in");
    this.lowerUntil = this.time + 2;
  }

  setNameCards(on: boolean): void {
    this.nameCardsOn = on;
    if (!on) {
      this.lower.classList.remove("in");
      this.lowerUntil = -1;
    }
  }
}
