// Generates the ranking files the game downloads, from the committed data/:
//
//   public/data/words.txt     the guessable words, one per line (index = line)
//   public/data/d/<n>.bin     daily puzzle n: every word index, closest first
//   public/data/p/<n>.bin     practice puzzle n, same format
//
// Each .bin is little-endian Uint16 word indices sorted by cosine similarity
// to that puzzle's secret word (GloVe 300d), so entry 0 is the secret word
// itself and a word's rank is its position + 1. One file is ~100 KB, so a
// player only ever downloads the day they're playing.
//
// Runs before `vite build` (see package.json). Takes well under a minute.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = join(root, "data");
const out = join(root, "public", "data");

const meta = JSON.parse(readFileSync(join(data, "meta.json"), "utf8"));
const vocab = readFileSync(join(data, "vocab.txt"), "utf8").trim().split("\n");
const buf = readFileSync(join(data, "vectors.i8"));
const V = new Int8Array(buf.buffer, buf.byteOffset, buf.length);
const answers = JSON.parse(readFileSync(join(data, "answers.json"), "utf8"));
const D = meta.dims;
const N = vocab.length;
if (V.length !== N * D) throw new Error(`vectors.i8 has ${V.length} bytes, expected ${N * D}`);
if (N > 65535) throw new Error("vocabulary too big for Uint16 rank files");
const index = new Map(vocab.map((w, i) => [w, i]));

function ranking(word) {
  const a = index.get(word);
  if (a === undefined) throw new Error(`secret word not in vocabulary: ${word}`);
  const sims = new Int32Array(N);
  const ao = a * D;
  for (let i = 0; i < N; i++) {
    const o = i * D;
    let s = 0;
    for (let k = 0; k < D; k++) s += V[o + k] * V[ao + k];
    sims[i] = s;
  }
  sims[a] = 2147483647; // the secret word is always rank 1
  const order = new Uint32Array(N);
  for (let i = 0; i < N; i++) order[i] = i;
  // Most similar first; equal scores keep frequency order.
  order.sort((x, y) => sims[y] - sims[x] || x - y);
  return Uint16Array.from(order);
}

function write(dir, list) {
  mkdirSync(dir, { recursive: true });
  list.forEach((word, i) => {
    const file = join(dir, `${i + 1}.bin`);
    const r = ranking(word);
    writeFileSync(file, Buffer.from(r.buffer));
  });
}

// `npm run dev` passes --if-missing so restarts don't redo the work.
if (process.argv.includes("--if-missing") && existsSync(join(out, "count.json"))) process.exit(0);

const t0 = Date.now();
mkdirSync(out, { recursive: true });
copyFileSync(join(data, "vocab.txt"), join(out, "words.txt"));
write(join(out, "d"), answers.daily);
write(join(out, "p"), answers.practice);
writeFileSync(join(out, "count.json"), JSON.stringify({ daily: answers.daily.length, practice: answers.practice.length, words: N }) + "\n");
console.log(`warmezy: ${answers.daily.length} daily + ${answers.practice.length} practice rankings over ${N} words in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (!existsSync(join(out, "d", "1.bin"))) process.exit(1);
