import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock, Sparkles, Flame, WifiOff, Award, Share2, Check, X, Lightbulb, Flag, CircleHelp, Users, Thermometer, RefreshCw, Infinity as InfinityIcon } from "lucide-react";
import { GuessList } from "../components/GuessList.tsx";
import { Leaderboard } from "../components/Leaderboard.tsx";
import { AuthModal } from "../components/AuthModal.tsx";
import { Confetti } from "../components/Confetti.tsx";
import { AchievementToastStack } from "../components/AchievementToast.tsx";
import { AchievementsModal } from "../components/AchievementsModal.tsx";
import {
  band,
  bestRank,
  buildShareText,
  closestWords,
  hintWord,
  loadPuzzle,
  loadWords,
  makeGuess,
  msUntilNextPuzzle,
  puzzleNumber,
  todayUtc,
  BANDS,
  type Guess,
  type Puzzle,
  type Words,
} from "../lib/warm.ts";
import { localSave, dailyFor, hintsIn, type Outcome, type SaveData } from "../lib/localSave.ts";
import { submitScore, ensureProfile, getDailyStats, type DailyStats } from "../lib/leaderboard.ts";
import { supabase, ensureSession, currentUser, withTimeout, BOOT_STEP_MS } from "../lib/supabase.ts";
import { formatCountdown } from "../hooks/useTimer.ts";
import { ACHIEVEMENTS, diffNewlyUnlocked, type Achievement } from "../data/achievements.ts";
import { shareResult } from "../lib/share.ts";

type Mode = "daily" | "practice";
type Phase = "auth_checking" | "choice" | "ready";

const PLAY_CHOICE_KEY = "warmezy.playChoice";
const SEEN_HELP_KEY = "warmezy.seenHelp";

const OTHER_GAMES = [
  { name: "Wordezy", url: "https://wordezy.bgameworld.com/" },
  { name: "Wordezy Search", url: "https://wordezysearch.bgameworld.com/" },
  { name: "Wordezy Ladder", url: "https://wordezyladder.bgameworld.com/" },
  { name: "Letterezy", url: "https://letterezy.bgameworld.com/" },
  { name: "Mergezy", url: "https://mergezy.bgameworld.com/" },
  { name: "Sortezy", url: "https://sortezy.bgameworld.com/" },
  { name: "Lingoezy", url: "https://lingoezy.bgameworld.com/" },
  { name: "When & Where", url: "https://whenandwhere.bgameworld.com/" },
];

/** A thermometer filling from cold blue to hot red. */
const Wordmark: React.FC = () => (
  <span className="relative w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "linear-gradient(180deg, #ff5a36, #e0a83a 50%, #4aa3c9)" }} aria-hidden="true">
    <Thermometer className="w-5 h-5 text-ink" strokeWidth={2.5} />
  </span>
);

/** One game's live state: data, guesses, latest guess and message. */
function useWarmGame(words: Words | null, kind: Mode, number: number | null) {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [error, setError] = useState(false);
  const [latest, setLatest] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "bad" | "info" } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setPuzzle(null);
    setLatest(null);
    setMessage(null);
    if (!words || number === null) return;
    let cancelled = false;
    setError(false);
    loadPuzzle(words, kind, number)
      .then((p) => !cancelled && setPuzzle(p))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [words, kind, number, attempt]);

  return { puzzle, error, latest, setLatest, message, setMessage, retry: () => setAttempt((a) => a + 1) };
}

export const GamePage: React.FC = () => {
  const [phase, setPhase] = useState<Phase>("auth_checking");
  // Sign-in couldn't be reached: the game plays, the leaderboard waits.
  const [offline, setOffline] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("Player");
  const [hasProfile, setHasProfile] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  const [mode, setMode] = useState<Mode>("daily");
  const [save, setSave] = useState(() => localSave.get());
  const [today] = useState(() => todayUtc());
  const number = puzzleNumber(today);
  const progress = dailyFor(save, today, number);

  const [words, setWords] = useState<Words | null>(null);
  const [wordsError, setWordsError] = useState(false);
  const daily = useWarmGame(words, "daily", number);
  const practice = useWarmGame(words, "practice", save.practice?.number ?? null);

  const [stats, setStats] = useState<DailyStats | null>(null);
  const [leaderboardKey, setLeaderboardKey] = useState(0);
  const [scoreStatus, setScoreStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [showAchievements, setShowAchievements] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [newlyUnlocked, setNewlyUnlocked] = useState<Achievement[] | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "shared" | "copied" | "failed">("idle");
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchWords = useCallback(() => {
    setWordsError(false);
    loadWords().then(setWords).catch(() => setWordsError(true));
  }, []);
  useEffect(fetchWords, [fetchWords]);

  const refreshStats = useCallback(() => {
    getDailyStats(today).then(setStats).catch(() => setStats(null));
  }, [today]);

  const unlockAchievements = useCallback((updated: SaveData) => {
    const prev = updated.unlockedAchievements;
    const newIds = diffNewlyUnlocked(updated, prev);
    if (newIds.length === 0) return updated;
    setNewlyUnlocked(ACHIEVEMENTS.filter((a) => newIds.includes(a.id)));
    return localSave.setUnlockedAchievements([...prev, ...newIds]);
  }, []);

  const submitDaily = useCallback(
    (guesses: Guess[], solved: boolean) => {
      setScoreStatus("saving");
      submitScore({ puzzleDate: today, guesses: guesses.length, hints: hintsIn(guesses), solved })
        .then(() => {
          setScoreStatus("saved");
          setLeaderboardKey((k) => k + 1);
          refreshStats();
        })
        .catch(() => setScoreStatus("failed"));
    },
    [today, refreshStats]
  );

  const resubmitToday = useCallback(() => {
    const p = dailyFor(localSave.get(), todayUtc(), puzzleNumber(todayUtc()));
    if (p.outcome && p.guesses.length > 0) submitDaily(p.guesses, p.outcome === "solved");
  }, [submitDaily]);

  /** `quiet` retries in the background (the Retry link, coming back online)
   *  without swapping the game out for the loading screen. */
  const bootAuth = useCallback(async (quiet = false) => {
    if (!quiet) setPhase("auth_checking");
    try {
      const session = await ensureSession();
      if (!session.ok) {
        // Offline, blocked or down. The puzzle doesn't need the server, so
        // play locally; scores sync once a later retry gets through.
        setOffline(true);
        setPhase("ready");
        return;
      }
      setOffline(false);
      const user = await currentUser();
      const anon = user?.is_anonymous ?? true;
      setUserId(user?.id ?? null);
      const name = await withTimeout(ensureProfile(), BOOT_STEP_MS, null);
      if (name) {
        setDisplayName(name);
        setHasProfile(true);
        resubmitToday();
      }
      refreshStats();
      const choiceDone = typeof window !== "undefined" && sessionStorage.getItem(PLAY_CHOICE_KEY) === "true";
      setPhase(!anon || choiceDone || name || quiet ? "ready" : "choice");
    } catch (err) {
      console.error("Failed to establish session:", err);
      setOffline(true);
      setPhase("ready");
    }
  }, [refreshStats, resubmitToday]);

  useEffect(() => {
    bootAuth();
  }, [bootAuth]);

  useEffect(() => {
    if (!offline) return;
    const retry = () => bootAuth(true);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [offline, bootAuth]);

  useEffect(() => {
    if (phase !== "ready") return;
    try {
      if (!localStorage.getItem(SEEN_HELP_KEY)) {
        localStorage.setItem(SEEN_HELP_KEY, "1");
        setShowHelp(true);
      }
    } catch {
      /* storage blocked — skip the auto help */
    }
  }, [phase]);

  const handleAuthResolved = useCallback(
    (opts: { isAnonymous: boolean; displayName?: string }) => {
      if (typeof window !== "undefined") sessionStorage.setItem(PLAY_CHOICE_KEY, "true");
      setShowAuth(false);
      setPhase("ready");
      if (!opts.displayName && opts.isAnonymous) return;
      if (opts.displayName) setDisplayName(opts.displayName);
      setHasProfile(true);
      supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
      resubmitToday();
    },
    [resubmitToday]
  );

  // ---- Playing -----------------------------------------------------------

  const game = mode === "daily" ? daily : practice;
  const guesses: Guess[] = mode === "daily" ? progress.guesses : (save.practice?.guesses ?? []);
  const outcome: Outcome = mode === "daily" ? progress.outcome : (save.practice?.outcome ?? null);
  const hints = hintsIn(guesses);

  const finish = (o: Exclude<Outcome, null>, all: Guess[]) => {
    if (mode === "daily") {
      const updated = unlockAchievements(localSave.finishDaily(today, number, o));
      setSave(updated);
      if (hasProfile) submitDaily(all, o === "solved");
    } else {
      setSave(unlockAchievements(localSave.finishPractice(o)));
    }
    if (o === "solved") {
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 1800);
    }
  };

  const record = (next: Guess[]) => {
    setSave(mode === "daily" ? localSave.setDailyGuesses(today, number, next) : localSave.setPracticeGuesses(next));
  };

  const submitGuess = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!words || !game.puzzle || outcome) return;
    const r = makeGuess(words, game.puzzle, guesses, input);
    if (!r.ok) {
      if (r.reason === "unknown") game.setMessage({ text: `“${input.trim()}” isn't in our word list`, tone: "bad" });
      else if (r.reason === "repeat" && r.existing) {
        game.setLatest(r.existing.word);
        game.setMessage({ text: `Already guessed — #${r.existing.rank.toLocaleString("en-GB")}`, tone: "info" });
      }
      if (r.reason !== "empty") setInput("");
      return;
    }
    const next = [...guesses, r.guess];
    setInput("");
    game.setMessage(null);
    game.setLatest(r.guess.word);
    record(next);
    if (r.guess.rank === 1) finish("solved", next);
  };

  const useHint = () => {
    if (!words || !game.puzzle || outcome) return;
    const h = hintWord(words, game.puzzle, guesses);
    if (!h) {
      game.setMessage({ text: "You're right next to it — no closer hint to give!", tone: "info" });
      return;
    }
    const next = [...guesses, h];
    game.setLatest(h.word);
    game.setMessage({ text: `Hint: “${h.word}” is #${h.rank.toLocaleString("en-GB")}`, tone: "info" });
    record(next);
  };

  const giveUp = () => {
    setConfirmGiveUp(false);
    finish("gave_up", guesses);
  };

  const startPractice = () => {
    if (!words) return;
    const seen = new Set(save.practiceSeen);
    const fresh = Array.from({ length: words.practice }, (_, i) => i + 1).filter((n) => !seen.has(n));
    const pool = fresh.length ? fresh : Array.from({ length: words.practice }, (_, i) => i + 1);
    setSave(localSave.startPractice(pool[Math.floor(Math.random() * pool.length)]));
  };

  const handleShare = async () => {
    if (!progress.outcome) return;
    const text = buildShareText({ number, solved: progress.outcome === "solved", guesses: progress.guesses, hints: hintsIn(progress.guesses) });
    const result = await shareResult(text);
    setShareState(result);
    setTimeout(() => setShareState("idle"), 2200);
  };

  const handleUnlock = () => {
    // Stub — no payment processor wired up yet. Replace with a real
    // server-verified purchase flow before this ever ships.
    alert("Payments aren't set up yet — practice words will unlock for $2 once that's wired in.");
  };

  // ---- Screens -------------------------------------------------------------

  if (phase === "auth_checking") {
    return (
      <div className="min-h-screen bg-ink text-paper flex items-center justify-center">
        <Wordmark />
      </div>
    );
  }
  if (phase === "choice") {
    return <AuthModal currentDisplayName={displayName} onResolved={handleAuthResolved} />;
  }

  const modalOpen = showAuth || showAchievements || showHelp || confirmGiveUp;
  const total = words?.list.length ?? 50000;
  const best = bestRank(guesses);

  const statsLine = stats && stats.players > 0 && (
    <p className="text-xs font-mono text-muted flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5" aria-label="Today's players">
      <span className="inline-flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5" />
        {stats.players} player{stats.players === 1 ? "" : "s"} today
      </span>
      <span>· {stats.solved} found it</span>
      {stats.solved > 0 && <span>· avg {stats.averageGuesses} guesses</span>}
    </p>
  );

  const loading = (wordsError || game.error) ? (
    <section className="w-full bg-surface border border-rule rounded-xl p-6 text-center space-y-3">
      <p className="text-sm text-muted">Couldn't load the word list. Check your connection.</p>
      <button
        type="button"
        onClick={() => {
          if (wordsError) fetchWords();
          game.retry();
        }}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-correct hover:bg-correct-dim text-white text-sm font-medium"
      >
        <RefreshCw className="w-4 h-4" />
        Try again
      </button>
    </section>
  ) : (
    <p className="text-sm font-mono text-muted animate-pulse" role="status">
      Warming up…
    </p>
  );

  const play = game.puzzle && words && (
    <>
      {outcome ? (
        <EndCard
          puzzle={game.puzzle}
          words={words}
          outcome={outcome}
          guesses={guesses}
          footer={
            mode === "daily" ? (
              <>
                <button type="button" onClick={handleShare} className="inline-flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-correct hover:bg-correct-dim text-white font-medium text-sm transition-colors">
                  {shareState === "copied" ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                  {shareState === "copied" ? "Copied — paste it anywhere" : shareState === "failed" ? "Couldn't copy — try again" : "Share result"}
                </button>
                <button type="button" onClick={() => setMode("practice")} className="w-full py-2 rounded-lg border border-rule text-sm text-paper/90 hover:border-muted/60 transition-colors">
                  Keep playing — Practice words
                </button>
                <DailyFooter hasProfile={hasProfile} scoreStatus={scoreStatus} onJoin={() => setShowAuth(true)} statsLine={statsLine} />
              </>
            ) : (
              <button type="button" onClick={startPractice} className="inline-flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-correct hover:bg-correct-dim text-white font-medium text-sm transition-colors">
                <InfinityIcon className="w-4 h-4" />
                Another practice word
              </button>
            )
          }
        />
      ) : (
        <>
          <form onSubmit={submitGuess} className="w-full flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (game.message?.tone === "bad") game.setMessage(null);
              }}
              placeholder={guesses.length === 0 ? "Type any word" : "Try another word"}
              aria-label="Your guess"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              maxLength={24}
              disabled={modalOpen}
              className="flex-1 min-w-0 px-4 py-3 rounded-full bg-surface border border-rule text-paper text-base focus:outline-none focus:border-correct"
            />
            <button type="submit" disabled={modalOpen || !input.trim()} className="px-5 rounded-full bg-correct hover:bg-correct-dim text-white font-medium transition-colors disabled:opacity-40">
              Guess
            </button>
          </form>
          <div className="w-full flex items-center justify-between gap-3 -mt-1">
            <p className="text-sm font-mono text-paper/90" aria-label="Guesses">
              {guesses.length} guess{guesses.length === 1 ? "" : "es"}
              {hints > 0 && <span className="text-present"> · {hints} hint{hints === 1 ? "" : "s"}</span>}
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={useHint} disabled={modalOpen} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-present-dim/50 bg-present-soft text-sm text-present hover:border-present transition-colors">
                <Lightbulb className="w-4 h-4" />
                Hint
              </button>
              <button type="button" onClick={() => setConfirmGiveUp(true)} disabled={modalOpen} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-rule text-sm text-muted hover:text-paper transition-colors">
                <Flag className="w-4 h-4" />
                Give up
              </button>
            </div>
          </div>
          <div className="h-5 -mt-1 text-sm font-mono" role="status" aria-live="polite">
            {game.message ? (
              <span className={game.message.tone === "bad" ? "text-danger" : "text-present"}>{game.message.text}</span>
            ) : guesses.length === 0 ? (
              <span className="text-muted">Lower numbers are closer. #1 is the secret word.</span>
            ) : best !== Infinity ? (
              <span style={{ color: band(best).color }}>Closest so far: #{best.toLocaleString("en-GB")}</span>
            ) : null}
          </div>
        </>
      )}
      <GuessList guesses={guesses} total={total} latest={outcome ? null : game.latest} />
      {!outcome && guesses.length === 0 && <Legend />}
    </>
  );

  return (
    <div className="min-h-screen bg-ink text-paper flex flex-col items-center px-4 py-6 gap-4">
      <header className="w-full max-w-xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Wordmark />
          <h1 className="font-display font-semibold text-lg truncate">Warmezy</h1>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {save.streak > 0 && (
            <div className="flex items-center gap-1 text-sm text-present font-mono" title="Daily streak">
              <Flame className="w-4 h-4" />
              {save.streak}
            </div>
          )}
          <button type="button" onClick={() => setShowHelp(true)} className="text-muted hover:text-paper transition-colors" aria-label="How to play">
            <CircleHelp className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => setShowAchievements(true)}
            className="flex items-center gap-1.5 text-sm text-muted hover:text-paper transition-colors"
            aria-label="Achievements"
          >
            <Award className="w-4 h-4" />
            {save.unlockedAchievements.length}/{ACHIEVEMENTS.length}
          </button>
        </div>
      </header>

      {showConfetti && <Confetti durationMs={1800} />}
      {newlyUnlocked && newlyUnlocked.length > 0 && <AchievementToastStack achievements={newlyUnlocked} onDone={() => setNewlyUnlocked(null)} />}
      {showAchievements && <AchievementsModal save={save} onClose={() => setShowAchievements(false)} />}
      {showAuth && <AuthModal currentDisplayName={displayName} onResolved={handleAuthResolved} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {confirmGiveUp && (
        <Dialog label="Give up?" onCancel={() => setConfirmGiveUp(false)}>
          <h2 className="font-display font-semibold text-lg">Give up?</h2>
          <p className="text-sm text-muted">The word will be revealed{mode === "daily" ? " and today won't count as a solve" : ""}.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setConfirmGiveUp(false)} className="py-2.5 rounded-lg border border-rule text-sm text-paper/90 hover:border-muted/60 transition-colors">
              Keep going
            </button>
            <button type="button" onClick={giveUp} className="py-2.5 rounded-lg bg-danger hover:bg-danger/80 text-white font-medium text-sm transition-colors">
              Reveal it
            </button>
          </div>
        </Dialog>
      )}

      <div className="flex items-center gap-1 p-1 bg-surface border border-rule rounded-lg">
        {(["daily", "practice"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === m ? "bg-correct text-white" : "text-muted hover:text-white"}`}
          >
            {m === "daily" ? `Daily No. ${number}` : "Practice"}
            {m === "practice" && !save.unlockedPractice && <Lock className="w-3.5 h-3.5" />}
          </button>
        ))}
      </div>

      <main className="w-full max-w-xl flex flex-col items-center gap-4">
        {offline && (
          <div role="status" className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-rule bg-surface text-xs text-muted">
            <WifiOff className="w-4 h-4 shrink-0 text-present" aria-hidden="true" />
            <span className="flex-1">Playing offline. Your game saves on this device; the leaderboard comes back when you reconnect.</span>
            <button type="button" onClick={() => bootAuth(true)} className="shrink-0 font-medium text-paper underline underline-offset-2">
              Retry
            </button>
          </div>
        )}
        {mode === "daily" && (game.puzzle && words ? play : loading)}
        {mode === "daily" && progress.outcome && <Leaderboard date={today} currentPlayerId={userId} refreshKey={leaderboardKey} />}
        {mode === "daily" && !progress.outcome && statsLine}

        {mode === "practice" && !save.unlockedPractice && (
          <section className="w-full max-w-sm bg-surface border border-rule rounded-xl p-6 text-center space-y-4 mt-2">
            <div className="w-12 h-12 rounded-full bg-present-soft border border-present-dim/50 flex items-center justify-center text-present mx-auto">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-display font-semibold text-lg">Practice words</h2>
              <p className="text-sm text-muted mt-1.5">Play as many secret words as you like, with hints and the closest-words reveal. The daily stays free forever.</p>
            </div>
            <button type="button" onClick={handleUnlock} className="w-full py-2.5 px-4 rounded-md bg-correct hover:bg-correct-dim text-white font-medium text-sm transition-colors">
              Unlock practice for $2
            </button>
          </section>
        )}
        {mode === "practice" && save.unlockedPractice && !save.practice && (
          <section className="w-full bg-surface border border-rule rounded-xl p-6 text-center space-y-4 animate-rise-in">
            <h2 className="font-display font-semibold text-xl">Practice words</h2>
            <p className="text-sm text-muted">A secret word that isn't anyone's daily.{save.practiceSolves ? ` You've found ${save.practiceSolves}.` : ""}</p>
            <button type="button" onClick={startPractice} disabled={!words} className="inline-flex items-center justify-center gap-2 w-full max-w-xs py-3 rounded-lg bg-correct hover:bg-correct-dim text-white font-medium transition-colors disabled:opacity-50">
              <InfinityIcon className="w-4 h-4" />
              Start a practice word
            </button>
          </section>
        )}
        {mode === "practice" && save.unlockedPractice && save.practice && (game.puzzle && words ? play : loading)}
      </main>

      <footer className="w-full max-w-xl mt-auto pt-6 border-t border-rule/60 text-center space-y-2">
        <p className="text-xs text-muted">More free games on bgameworld</p>
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
          {OTHER_GAMES.map((g) => (
            <a key={g.url} href={g.url} className="text-paper/80 hover:text-correct transition-colors">
              {g.name}
            </a>
          ))}
          <a href="https://bgameworld.com/" className="text-muted hover:text-paper transition-colors">
            All games
          </a>
        </nav>
      </footer>
    </div>
  );
};

const Legend: React.FC = () => (
  <ul className="w-full grid grid-cols-3 gap-1.5 text-[11px] font-mono" aria-label="What the colours mean">
    {BANDS.slice(1).map((b, i) => (
      <li key={b.key} className="flex items-center gap-1.5 text-muted">
        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: b.color }} />
        {b.label} <span className="text-faint">{["≤50", "≤300", "≤1,500", "≤5,000", "5,000+"][i]}</span>
      </li>
    ))}
  </ul>
);

const Dialog: React.FC<{ label: string; onCancel: () => void; children: React.ReactNode }> = ({ label, onCancel, children }) => (
  <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-50 bg-white/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
    <div className="w-full max-w-sm bg-surface border border-rule rounded-2xl p-6 space-y-4 text-center" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  </div>
);

const HelpModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div role="dialog" aria-modal="true" aria-label="How to play" className="fixed inset-0 z-50 bg-white/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
    <div className="w-full max-w-md bg-surface border border-rule rounded-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-lg">How to play</h2>
        <button type="button" onClick={onClose} className="text-muted hover:text-paper transition-colors" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>
      <ul className="text-sm text-paper/80 space-y-2.5">
        <li>There's one secret word a day, the same for everyone.</li>
        <li>
          Type any word. It gets a <b className="text-paper">rank</b> by how close its meaning is to the secret word: <b className="text-paper">#1</b> is the
          word itself, and the lower the number, the hotter you are.
        </li>
        <li>Ranks come from how words are used together in millions of sentences, so a word can be close in meaning or just often found nearby.</li>
        <li>Stuck? A hint gives you a word about halfway between your best guess and the answer. It counts as a guess.</li>
      </ul>
      <Legend />
      <button type="button" onClick={onClose} className="w-full py-2.5 rounded-lg bg-correct hover:bg-correct-dim text-white font-medium text-sm transition-colors">
        Let's play
      </button>
    </div>
  </div>
);

const EndCard: React.FC<{ puzzle: Puzzle; words: Words; outcome: Exclude<Outcome, null>; guesses: Guess[]; footer: React.ReactNode }> = ({
  puzzle,
  words,
  outcome,
  guesses,
  footer,
}) => {
  const [showClosest, setShowClosest] = useState(false);
  const closest = useMemo(() => (showClosest ? closestWords(words, puzzle, 50) : []), [showClosest, words, puzzle]);
  const hints = hintsIn(guesses);
  return (
    <section className="w-full bg-surface border border-rule rounded-xl p-6 space-y-5 animate-rise-in">
      <div className="text-center space-y-2">
        <p className="text-xs font-mono text-muted uppercase tracking-wide">
          {puzzle.kind === "daily" ? `Warmezy No. ${puzzle.number}` : "Practice word"} · {outcome === "solved" ? "found it" : "revealed"}
        </p>
        <p className="font-display font-semibold text-4xl text-correct break-words">{puzzle.secret.toUpperCase()}</p>
        <p className="text-sm text-muted">
          {outcome === "solved"
            ? `in ${guesses.length} guess${guesses.length === 1 ? "" : "es"}${hints ? ` with ${hints} hint${hints === 1 ? "" : "s"}` : ", no hints"}`
            : `after ${guesses.length} guess${guesses.length === 1 ? "" : "es"}`}
        </p>
      </div>
      {footer}
      <button type="button" onClick={() => setShowClosest((s) => !s)} className="w-full text-sm text-correct hover:underline">
        {showClosest ? "Hide the closest words" : "See the 50 closest words"}
      </button>
      {showClosest && (
        <ol className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-mono" aria-label="Closest words">
          {closest.map((c) => (
            <li key={c.word} className="flex justify-between gap-2">
              <span className="truncate" style={{ color: band(c.rank).color }}>
                {c.word}
              </span>
              <span className="text-faint">#{c.rank}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

const DailyFooter: React.FC<{ hasProfile: boolean; scoreStatus: "idle" | "saving" | "saved" | "failed"; onJoin: () => void; statsLine: React.ReactNode }> = ({
  hasProfile,
  scoreStatus,
  onJoin,
  statsLine,
}) => {
  const [countdown, setCountdown] = useState(() => msUntilNextPuzzle());
  useEffect(() => {
    const id = setInterval(() => setCountdown(msUntilNextPuzzle()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="text-center space-y-1.5">
      {statsLine}
      <p className="text-xs font-mono text-muted">Next word in {formatCountdown(countdown)}</p>
      {!hasProfile ? (
        <button type="button" onClick={onJoin} className="text-xs text-correct hover:underline">
          Create a free account to put today's result on the leaderboard
        </button>
      ) : scoreStatus === "failed" ? (
        <p className="text-xs text-muted">Saved on this device — the leaderboard couldn't be reached.</p>
      ) : null}
    </div>
  );
};
