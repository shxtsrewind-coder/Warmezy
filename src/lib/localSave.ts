// Local save for what's inherently per-device: today's guesses, the practice
// game, streaks and the stats achievements are computed from. Identity and
// leaderboard standing live in Supabase (lib/supabase.ts ensureSession +
// lib/leaderboard.ts).
import type { Guess } from "./warm.ts";

const KEY = "warmezy.save.v1";

export type Outcome = "solved" | "gave_up" | null;

export interface GameProgress {
  guesses: Guess[];
  outcome: Outcome;
}

export interface DailyProgress extends GameProgress {
  date: string;
  number: number;
}

export interface SaveData {
  lastSolvedDate: string | null;
  streak: number;
  maxStreak: number;
  solves: number;
  bestGuesses: number | null;
  noHintSolves: number;
  practiceSolves: number;
  /** Practice puzzles already played, so new ones come first. */
  practiceSeen: number[];
  unlockedPractice: boolean;
  displayName: string | null;
  unlockedAchievements: string[];
  daily: DailyProgress | null;
  practice: (GameProgress & { number: number }) | null;
}

const DEFAULTS: SaveData = {
  lastSolvedDate: null,
  streak: 0,
  maxStreak: 0,
  solves: 0,
  bestGuesses: null,
  noHintSolves: 0,
  practiceSolves: 0,
  practiceSeen: [],
  unlockedPractice: false,
  displayName: null,
  unlockedAchievements: [],
  daily: null,
  practice: null,
};

function read(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable (private mode, etc.) */
  }
}

export function dailyFor(save: SaveData, date: string, number: number): DailyProgress {
  return save.daily && save.daily.date === date ? save.daily : { date, number, guesses: [], outcome: null };
}

export const hintsIn = (g: Guess[]) => g.filter((x) => x.hint).length;

export const localSave = {
  get: read,

  setDailyGuesses(date: string, number: number, guesses: Guess[]): SaveData {
    const data = read();
    const p = dailyFor(data, date, number);
    p.guesses = guesses;
    data.daily = p;
    write(data);
    return data;
  },

  /** Ends today's game. A solve extends the streak; giving up resets it. */
  finishDaily(date: string, number: number, outcome: Exclude<Outcome, null>): SaveData {
    const data = read();
    const p = dailyFor(data, date, number);
    if (p.outcome) return data;
    p.outcome = outcome;
    data.daily = p;
    if (outcome === "solved") {
      const yesterday = new Date(Date.parse(date + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
      data.streak = data.lastSolvedDate === yesterday ? data.streak + 1 : 1;
      data.lastSolvedDate = date;
      data.maxStreak = Math.max(data.maxStreak, data.streak);
      data.solves += 1;
      data.bestGuesses = data.bestGuesses === null ? p.guesses.length : Math.min(data.bestGuesses, p.guesses.length);
      if (hintsIn(p.guesses) === 0) data.noHintSolves += 1;
    } else {
      data.streak = 0;
    }
    write(data);
    return data;
  },

  startPractice(number: number): SaveData {
    const data = read();
    data.practice = { number, guesses: [], outcome: null };
    data.practiceSeen = [...new Set([...data.practiceSeen, number])];
    write(data);
    return data;
  },

  setPracticeGuesses(guesses: Guess[]): SaveData {
    const data = read();
    if (data.practice) data.practice.guesses = guesses;
    write(data);
    return data;
  },

  finishPractice(outcome: Exclude<Outcome, null>): SaveData {
    const data = read();
    if (data.practice && !data.practice.outcome) {
      data.practice.outcome = outcome;
      if (outcome === "solved") data.practiceSolves += 1;
    }
    write(data);
    return data;
  },

  setUnlockedAchievements(ids: string[]): SaveData {
    const data = read();
    data.unlockedAchievements = ids;
    write(data);
    return data;
  },

  /** Placeholder until a real payment processor is wired up — never call
   *  this from anywhere except a confirmed, server-verified purchase. */
  setUnlocked(value: boolean): SaveData {
    const data = read();
    data.unlockedPractice = value;
    write(data);
    return data;
  },
};
