import type { Episode } from "../episode";
import { coldAllHands, coldCreed, coldPrinter } from "./cold-opens";
import { panic } from "./panic";
import { pilot } from "./pilot";
import { shippingDay } from "./shipping-day";
import { theBug } from "./the-bug";
import { whichPink } from "./which-pink";

/** Every episode, in the order the Episodes menu lists them. The pilot is first and the default. */
export const EPISODES: Episode[] = [pilot, whichPink, theBug, panic, shippingDay, coldPrinter, coldAllHands, coldCreed];

export function episodeById(id: string): Episode | null {
  return EPISODES.find((e) => e.id === id) ?? null;
}
