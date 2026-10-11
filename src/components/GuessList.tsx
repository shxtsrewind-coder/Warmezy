import React from "react";
import { Lightbulb } from "lucide-react";
import { band, closeness, type Guess } from "../lib/warm.ts";

/** One guess: the word, its rank and a temperature bar. */
export const GuessRow: React.FC<{ guess: Guess; total: number; highlight?: boolean }> = ({ guess, total, highlight }) => {
  const b = band(guess.rank);
  return (
    <li
      className={`relative flex items-center justify-between gap-3 px-3 py-2 rounded-lg overflow-hidden font-mono text-sm ${
        highlight ? "ring-2 ring-paper/70" : ""
      }`}
      aria-label={`${guess.word}, rank ${guess.rank}, ${b.label}${guess.hint ? ", hint" : ""}`}
    >
      <span className="absolute inset-y-0 left-0 rounded-lg opacity-30" style={{ width: `${closeness(guess.rank, total) * 100}%`, background: b.color }} aria-hidden="true" />
      <span className="absolute inset-0 rounded-lg border border-rule pointer-events-none" aria-hidden="true" />
      <span className="relative flex items-center gap-2 min-w-0">
        <span className="truncate text-paper">{guess.word}</span>
        {guess.hint && <Lightbulb className="w-3.5 h-3.5 text-present shrink-0" aria-hidden="true" />}
      </span>
      <span className="relative shrink-0 flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide" style={{ color: b.color }}>
          {b.label}
        </span>
        <span className="tabular-nums text-paper/90 min-w-[3.75rem] text-right">#{guess.rank.toLocaleString("en-GB")}</span>
      </span>
    </li>
  );
};

/** The latest guess on its own, then every guess closest first. */
export const GuessList: React.FC<{ guesses: Guess[]; total: number; latest: string | null }> = ({ guesses, total, latest }) => {
  const sorted = [...guesses].sort((a, b) => a.rank - b.rank);
  const last = latest ? guesses.find((g) => g.word === latest) : null;
  return (
    <div className="w-full space-y-3">
      {last && (
        <ul aria-label="Latest guess">
          <GuessRow guess={last} total={total} highlight />
        </ul>
      )}
      {sorted.length > 0 && (
        <ul className="space-y-1.5" aria-label="Your guesses, closest first">
          {sorted.map((g) => (
            <GuessRow key={g.word} guess={g} total={total} highlight={false} />
          ))}
        </ul>
      )}
    </div>
  );
};
