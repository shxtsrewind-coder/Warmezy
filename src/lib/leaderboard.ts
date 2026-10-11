// Daily leaderboard — backed by Supabase (the project shared with the other
// bgameworld games; see supabase/migrations for the warmezy_* tables). Writes
// go through a SECURITY DEFINER RPC that reads the player's identity and
// display name from the session itself, never from client-supplied values.
import { supabase } from "./supabase.ts";

export interface LeaderboardEntry {
  playerId: string;
  displayName: string;
  guesses: number;
  hints: number;
  isYou: boolean;
}

/** Records the signed-in player's finished daily. Only the first finish of
 *  the day counts — the RPC ignores any later submission. */
export async function submitScore(opts: { puzzleDate: string; guesses: number; hints: number; solved: boolean }): Promise<void> {
  const { error } = await supabase.rpc("submit_warmezy_score", {
    p_puzzle_date: opts.puzzleDate,
    p_guesses: opts.guesses,
    p_hints: opts.hints,
    p_solved: opts.solved,
  });
  if (error) throw error;
}

export async function ensureProfile(): Promise<string | null> {
  const { data, error } = await supabase.rpc("warmezy_ensure_profile");
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** Solvers only: fewest guesses, then fewest hints. */
export async function getDailyLeaderboard(puzzleDate: string, currentPlayerId: string | null, limit = 10): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc("warmezy_daily_leaderboard", { p_puzzle_date: puzzleDate, p_limit: limit });
  if (error) throw error;
  return (data ?? []).map((row: { player_id: string; display_name: string; guesses: number; hints: number }) => ({
    playerId: row.player_id,
    displayName: row.display_name,
    guesses: row.guesses,
    hints: row.hints,
    isYou: row.player_id === currentPlayerId,
  }));
}

export interface DailyStats {
  players: number;
  solved: number;
  averageGuesses: number;
}

export async function getDailyStats(puzzleDate: string): Promise<DailyStats | null> {
  const { data, error } = await supabase.rpc("warmezy_daily_stats", { p_puzzle_date: puzzleDate });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { players: Number(row.players) || 0, solved: Number(row.solved) || 0, averageGuesses: Math.round(Number(row.average_guesses) || 0) };
}

export interface AllTimeLeaderboardEntry {
  playerId: string;
  displayName: string;
  solves: number;
  averageGuesses: number;
  isYou: boolean;
}

/** All-time standings: most solves, then the lowest average guesses. */
export async function getAllTimeLeaderboard(currentPlayerId: string | null, limit = 10): Promise<AllTimeLeaderboardEntry[]> {
  const { data, error } = await supabase.rpc("warmezy_alltime_leaderboard", { p_limit: limit });
  if (error) throw error;
  return (data ?? []).map((row: { player_id: string; display_name: string; solves: number; average_guesses: number }) => ({
    playerId: row.player_id,
    displayName: row.display_name,
    solves: Number(row.solves),
    averageGuesses: Math.round(Number(row.average_guesses)),
    isYou: row.player_id === currentPlayerId,
  }));
}
