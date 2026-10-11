// Achievement definitions — computed from the per-device SaveData, so
// unlocking one doesn't require an account.
import type { SaveData } from "../lib/localSave.ts";

export interface Achievement {
  id: string;
  title: string;
  description: string;
  /** lucide-react icon name, resolved by the component that renders these. */
  icon: "Star" | "Flame" | "Zap" | "Gauge" | "Target" | "Trophy";
  isUnlocked: (save: SaveData) => boolean;
  /** Shown under a locked achievement, e.g. "Best streak: 2". */
  progress?: (save: SaveData) => string;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first_solve",
    title: "Red Hot",
    description: "Find your first secret word.",
    icon: "Star",
    isUnlocked: (s) => s.solves >= 1,
  },
  {
    id: "no_hints",
    title: "No Help Needed",
    description: "Solve a daily without hints.",
    icon: "Target",
    isUnlocked: (s) => s.noHintSolves >= 1,
  },
  {
    id: "under_30",
    title: "Warm Hands",
    description: "Solve a daily in 30 guesses or fewer.",
    icon: "Gauge",
    isUnlocked: (s) => s.bestGuesses !== null && s.bestGuesses <= 30,
    progress: (s) => (s.bestGuesses === null ? "No solves yet" : `Best: ${s.bestGuesses} guesses`),
  },
  {
    id: "under_10",
    title: "Mind Reader",
    description: "Solve a daily in 10 guesses or fewer.",
    icon: "Zap",
    isUnlocked: (s) => s.bestGuesses !== null && s.bestGuesses <= 10,
    progress: (s) => (s.bestGuesses === null ? "No solves yet" : `Best: ${s.bestGuesses} guesses`),
  },
  {
    id: "streak_3",
    title: "On a Roll",
    description: "Solve 3 days in a row.",
    icon: "Flame",
    isUnlocked: (s) => s.maxStreak >= 3,
    progress: (s) => `Best streak: ${s.maxStreak}`,
  },
  {
    id: "streak_7",
    title: "Week Streak",
    description: "Solve 7 days in a row.",
    icon: "Flame",
    isUnlocked: (s) => s.maxStreak >= 7,
    progress: (s) => `Best streak: ${s.maxStreak}`,
  },
  {
    id: "solves_25",
    title: "Dedicated",
    description: "Solve 25 dailies.",
    icon: "Trophy",
    isUnlocked: (s) => s.solves >= 25,
    progress: (s) => `${s.solves} / 25`,
  },
];

/** Ids of achievements newly true in `save` that weren't already unlocked. */
export function diffNewlyUnlocked(save: SaveData, prevUnlockedIds: string[]): string[] {
  const prev = new Set(prevUnlockedIds);
  return ACHIEVEMENTS.filter((a) => !prev.has(a.id) && a.isUnlocked(save)).map((a) => a.id);
}
