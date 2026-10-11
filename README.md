# Warmezy

A daily hot-and-cold word game for [bgameworld.com](https://bgameworld.com), alongside the Wordezy games, Letterezy, Mergezy and When & Where.

There's one secret word a day, the same for every player. Type any word and it gets a rank by how close its meaning is: #1 is the secret word itself, and the lower the number, the hotter you are. Ranks are coloured from 🔥 boiling (top 50) through hot, warm and cool to 🧊 cold (beyond 5,000).

- **Daily**: free. Hints give a word about halfway between your best guess and the answer (they count as guesses). You can give up to see the word. After a solve you can see the 50 closest words. A reload keeps your guesses. Results share spoiler-free: guess count, hints, and how many guesses fell in each band.
- **Practice**: secret words that are never anyone's daily, as many as you like. Behind a one-time $2 unlock, which is a stub until payments are set up (same as the other games).
- **Leaderboard and crowd stats**: same Supabase project and account system as the other games. Today's solvers ranked by fewest guesses, then fewest hints; only a player's first finish each day counts.
- **Achievements, streaks**: stored on the device.

## How the ranks work

Similarity is the cosine between [GloVe](https://nlp.stanford.edu/projects/glove/) word vectors (6B tokens, 300 dimensions, trained on Wikipedia and Gigaword). Words that appear in similar sentences sit close together, so a word can rank high because it's related in meaning or just because it turns up nearby (news text pulls "house" toward "senate").

- `scripts/build_data.py` (run once; outputs committed) picks the 50,000 most frequent GloVe words that are real English words (ENABLE list or the google-10000-english 20k list), stores their vectors as int8 in `data/vectors.i8` (14 MB), and builds the secret-word lists in `data/answers.json` from everyday nouns.
- `scripts/gen-days.mjs` runs before every build (about 30 seconds). For each secret word it sorts all 50,000 words by similarity and writes `public/data/d/<n>.bin` (daily) and `public/data/p/<n>.bin` (practice): little-endian Uint16 word indices, closest first. The game downloads the word list once and only the ranking file for the puzzle being played (about 100 KB).
- There are 527 daily words (about a year and a half), after which they cycle. To add more, extend the word lists in `build_data.py` and re-run it.

Data: GloVe is released under the Open Data Commons Public Domain Dedication and License; ENABLE is public domain; the noun, object, animal and food lists come from [dariusk/corpora](https://github.com/dariusk/corpora) (CC0).

## Run it locally

```bash
npm install
cp .env.example .env.local   # same Supabase URL and anon key as the other games
npm run dev                   # generates public/data the first time
```

Rebuilding the data from scratch needs the GloVe file (`glove-wiki-gigaword-300.gz` from the gensim-data GitHub releases) and the word lists named in `build_data.py`.

## Database

The leaderboard needs `supabase/migrations/20261011_warmezy.sql`. Run it once in the Supabase SQL editor for the shared project. It only creates new `warmezy_*` objects and is safe to run twice. Until it's run, the game still works and the leaderboard and crowd stats stay hidden.

## Deploy (Cloudflare)

Same setup as the other games:

1. Push this repo to GitHub.
2. In Cloudflare, create a Worker from the repo. Build command `npm run build` (it generates the ranking files first), deploy command `npx wrangler deploy` (see `wrangler.jsonc`).
3. Add the `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` build variables.
4. Add the custom domain `warmezy.bgameworld.com`.
5. In Google Search Console, submit `https://warmezy.bgameworld.com/sitemap.xml`.

## SEO

`index.html` has the title and description, canonical URL, Open Graph and X/Twitter cards with `public/og-image.jpg`, `VideoGame` structured data, a `<noscript>` description, icons and a web manifest. `public/robots.txt` and `public/sitemap.xml` point at the subdomain.
