// Warmezy rules and data loading. The ranking files are generated at build
// time by scripts/gen-days.mjs (GloVe 300d similarity over 50,000 words):
//
//   /data/words.txt      guessable words, one per line
//   /data/count.json     how many daily and practice puzzles exist
//   /data/d/<n>.bin      daily puzzle n: Uint16 word indices, closest first
//   /data/p/<n>.bin      practice puzzle n
//
// A word's rank is its position in the puzzle's file + 1, so rank 1 is the
// secret word.
import { BLOCKED_WORDS } from "../data/blocked.ts";

export const LAUNCH_DATE = "2026-10-11";

export interface Words {
  list: string[];
  index: Map<string, number>;
  daily: number;
  practice: number;
}

export interface Puzzle {
  kind: "daily" | "practice";
  /** Daily: the puzzle number players see. Practice: the practice file number. */
  number: number;
  ranking: Uint16Array;
  /** rankOf[wordIndex] = 1-based rank. */
  rankOf: Int32Array;
  secret: string;
}

let wordsPromise: Promise<Words> | null = null;

/** Loads the word list once per page. */
export function loadWords(): Promise<Words> {
  if (!wordsPromise) {
    wordsPromise = Promise.all([
      fetch("/data/words.txt").then((r) => {
        if (!r.ok) throw new Error(`words ${r.status}`);
        return r.text();
      }),
      fetch("/data/count.json").then((r) => {
        if (!r.ok) throw new Error(`count ${r.status}`);
        return r.json() as Promise<{ daily: number; practice: number }>;
      }),
    ]).then(([text, count]) => {
      const list = text.trim().split("\n");
      return { list, index: new Map(list.map((w, i) => [w, i])), daily: count.daily, practice: count.practice };
    });
    wordsPromise.catch(() => {
      wordsPromise = null; // let a retry fetch again
    });
  }
  return wordsPromise;
}

/** Daily puzzles cycle through the daily list (so the game never runs out). */
export function dailyFile(number: number, dailyCount: number): number {
  return ((((number - 1) % dailyCount) + dailyCount) % dailyCount) + 1;
}

export async function loadPuzzle(words: Words, kind: "daily" | "practice", number: number): Promise<Puzzle> {
  const file = kind === "daily" ? dailyFile(number, words.daily) : number;
  const r = await fetch(`/data/${kind === "daily" ? "d" : "p"}/${file}.bin`);
  if (!r.ok) throw new Error(`puzzle ${r.status}`);
  const ranking = new Uint16Array(await r.arrayBuffer());
  const rankOf = new Int32Array(words.list.length);
  for (let i = 0; i < ranking.length; i++) rankOf[ranking[i]] = i + 1;
  return { kind, number, ranking, rankOf, secret: words.list[ranking[0]] };
}

// ---------------------------------------------------------------------------
// Guesses
// ---------------------------------------------------------------------------

export interface Guess {
  word: string;
  rank: number;
  /** Given by the hint button rather than typed. */
  hint?: boolean;
}

/** Lower-case letters only; "Dogs!" → "dogs". */
export function cleanGuess(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z]/g, "");
}

export type GuessResult = { ok: true; guess: Guess } | { ok: false; reason: "empty" | "unknown" | "repeat"; existing?: Guess };

export function makeGuess(words: Words, puzzle: Puzzle, guesses: Guess[], raw: string): GuessResult {
  const word = cleanGuess(raw);
  if (!word) return { ok: false, reason: "empty" };
  const prior = guesses.find((g) => g.word === word);
  if (prior) return { ok: false, reason: "repeat", existing: prior };
  // A plural we don't know often has a singular we do.
  let i = words.index.get(word);
  let used = word;
  if (i === undefined && word.endsWith("s") && words.index.has(word.slice(0, -1))) {
    used = word.slice(0, -1);
    i = words.index.get(used);
    const again = guesses.find((g) => g.word === used);
    if (again) return { ok: false, reason: "repeat", existing: again };
  }
  if (i === undefined) return { ok: false, reason: "unknown" };
  return { ok: true, guess: { word: used, rank: puzzle.rankOf[i] } };
}

export function bestRank(guesses: Guess[]): number {
  return guesses.reduce((b, g) => Math.min(b, g.rank), Infinity);
}

const blocked = new Set(BLOCKED_WORDS.split(" "));

/** A word closer than your best: around half your best rank (300 if you
 *  haven't guessed yet), skipping words already guessed, never the answer. */
export function hintWord(words: Words, puzzle: Puzzle, guesses: Guess[]): Guess | null {
  const best = bestRank(guesses);
  if (best <= 2) return null;
  const target = best === Infinity ? 300 : Math.max(2, Math.floor(best / 2));
  const seen = new Set(guesses.map((g) => g.word));
  // Look outward from the target rank, nearer first.
  for (let d = 0; d < puzzle.ranking.length; d++) {
    for (const r of d === 0 ? [target] : [target - d, target + d]) {
      if (r < 2 || r >= best || r > puzzle.ranking.length) continue;
      const w = words.list[puzzle.ranking[r - 1]];
      if (!seen.has(w) && !blocked.has(w)) return { word: w, rank: r, hint: true };
    }
    if (target - d < 2 && target + d >= best) break;
  }
  return null;
}

/** The secret word's nearest neighbours, for the end screen. */
export function closestWords(words: Words, puzzle: Puzzle, count: number): { word: string; rank: number }[] {
  const out: { word: string; rank: number }[] = [];
  for (let r = 1; r <= puzzle.ranking.length && out.length < count; r++) {
    const w = words.list[puzzle.ranking[r - 1]];
    if (!blocked.has(w)) out.push({ word: w, rank: r });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Temperature
// ---------------------------------------------------------------------------

export interface Band {
  key: "found" | "boiling" | "hot" | "warm" | "cool" | "cold";
  label: string;
  color: string;
  emoji: string;
}

export const BANDS: Band[] = [
  { key: "found", label: "Found it", color: "#2f9e6e", emoji: "🎯" },
  { key: "boiling", label: "Boiling", color: "#ff5a36", emoji: "🔥" },
  { key: "hot", label: "Hot", color: "#e8743f", emoji: "🟥" },
  { key: "warm", label: "Warm", color: "#e0a83a", emoji: "🟧" },
  { key: "cool", label: "Cool", color: "#4aa3c9", emoji: "🟦" },
  { key: "cold", label: "Cold", color: "#4b6a9b", emoji: "🧊" },
];

export function band(rank: number): Band {
  if (rank <= 1) return BANDS[0];
  if (rank <= 50) return BANDS[1];
  if (rank <= 300) return BANDS[2];
  if (rank <= 1500) return BANDS[3];
  if (rank <= 5000) return BANDS[4];
  return BANDS[5];
}

/** 1 for the answer down to ~0 for the farthest word, on a log scale. */
export function closeness(rank: number, total: number): number {
  return Math.max(0.03, 1 - Math.log(rank) / Math.log(total));
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function puzzleNumber(date: string): number {
  return Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(LAUNCH_DATE + "T00:00:00Z")) / 86400000) + 1;
}

export function msUntilNextPuzzle(now: number = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}

/** Spoiler-free share: guesses, hints, and how many guesses fell in each band. */
export function buildShareText(opts: { number: number; solved: boolean; guesses: Guess[]; hints: number }): string {
  const counts = new Map<string, number>();
  for (const g of opts.guesses) {
    const b = band(g.rank);
    if (b.key !== "found") counts.set(b.emoji, (counts.get(b.emoji) ?? 0) + 1);
  }
  const bars = BANDS.slice(1)
    .filter((b) => counts.get(b.emoji))
    .map((b) => `${b.emoji} ${counts.get(b.emoji)}`)
    .join("  ");
  const head = opts.solved
    ? `Got it in ${opts.guesses.length} guess${opts.guesses.length === 1 ? "" : "es"}${opts.hints ? ` (${opts.hints} hint${opts.hints === 1 ? "" : "s"})` : ""}`
    : `Gave up after ${opts.guesses.length} guesses`;
  return `Warmezy #${opts.number} ${opts.solved ? "🎯" : "🧊"}\n${head}\n${bars}\nhttps://warmezy.bgameworld.com/`;
}
