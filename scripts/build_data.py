"""Builds Warmezy's data files (run once, results committed):

  data/vocab.txt      guessable words, most frequent first (one per line)
  data/vectors.i8     their GloVe 300d vectors, unit length, as int8 (vocab × 300 bytes)
  data/answers.json   {"daily": [...], "practice": [...]} secret words
  data/blocked.txt    words never shown as a hint or in the closest-words list

Sources (all open):
  - GloVe 6B 300d (Wikipedia + Gigaword), Stanford NLP, via the gensim-data
    GitHub release glove-wiki-gigaword-300
  - ENABLE word list (public domain) and google-10000-english 20k list: which
    GloVe tokens count as real English words
  - dariusk/corpora objects, animals, nouns and foods lists, plus the hand list
    below: the pool of secret words

Usage: build_data.py <glove300.gz> <dl dir> <out data dir>
"""
import gzip
import json
import random
import sys
from pathlib import Path

import numpy as np

GLOVE, DL, OUT = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
TOP = 120000          # GloVe rows considered (file order = corpus frequency)
MAX_VOCAB = 50000     # Uint16 rank files: keep well under 65,536

enable = {w.strip() for w in open(DL / "dict/enable1.txt") if w.strip()}
g20k = {w.strip() for w in open(DL / "g10k/20k.txt") if w.strip()}

BLOCK = set("""
sex sexy sexual nude naked porn rape raped rapist kill killed killer killing kills murder murdered murderer
dead death die died dies dying corpse suicide drug drugs cocaine heroin weed stoned drunk booze
gun guns shoot shooting shot bomb bombs bullet bullets knife stab stabbed blood bloody gore
nazi nazis hitler slave slaves slavery racist racism terror terrorist terrorists torture abuse abused
breast breasts boob boobs penis vagina butt butts fart pee poop urine vomit puke
damn hell bitch bastard crap pissed whore slut sucks sucker screw screwed
virgin nipple nipples orgasm condom erotic lust horny pregnant abortion
lesbian gay gays queer dyke fag homo jew jews islam muslim christ jesus god gods satan devil
hooker pimp stripper fuck fucked fucker fucking dick cock suck pussy asshole goddamn prick cunt shit piss tits
anal anus semen sperm pubic crotch panties thong meth junkie wank twat slag hoe hoes thug nigger negro
rapes raping molest molested pedophile incest genocide massacre beheaded behead lynch lynching
""".split())

# ---------------------------------------------------------------------------
# Vocabulary + vectors
# ---------------------------------------------------------------------------
words, vecs = [], []
with gzip.open(GLOVE, "rt", encoding="utf8") as f:
    f.readline()
    for i, line in enumerate(f):
        if i >= TOP or len(words) >= MAX_VOCAB:
            break
        w, rest = line.split(" ", 1)
        if not (w.isalpha() and w.isascii() and w.islower() and 2 <= len(w) <= 18):
            continue
        if w not in enable and w not in g20k:
            continue
        words.append(w)
        vecs.append(np.asarray(rest.split(), dtype=np.float32))
M = np.vstack(vecs)
M /= np.linalg.norm(M, axis=1, keepdims=True)
scale = 127.0 / np.abs(M).max()
Q = np.clip(np.round(M * scale), -127, 127).astype(np.int8)
index = {w: i for i, w in enumerate(words)}
print(f"vocab {len(words)} words, int8 scale {scale:.1f}")

# ---------------------------------------------------------------------------
# Secret words
# ---------------------------------------------------------------------------
HAND = """
beach mountain forest island desert river ocean lake valley volcano jungle canyon waterfall glacier meadow
kitchen garden bedroom bathroom window door roof stairs ladder fence chimney basement balcony attic
school hospital airport market library museum castle palace bridge tower prison farm factory bakery stadium
train bicycle rocket airplane helicopter boat ship truck tractor subway taxi ambulance submarine scooter
guitar piano drum violin trumpet flute camera clock mirror pillow blanket umbrella hammer candle wallet
ticket letter newspaper magazine pencil notebook envelope stamp map compass telescope microscope battery
football tennis basketball baseball golf boxing swimming chess puzzle marathon trophy medal referee
doctor teacher farmer pilot chef nurse soldier police lawyer artist singer dancer actor writer scientist
king queen prince princess knight wizard dragon ghost pirate robot alien giant monster vampire zombie
rainbow thunder lightning storm cloud snow rain wind hurricane tornado sunshine fog frost earthquake
planet moon star comet galaxy satellite astronaut universe sun eclipse orbit telescope
fire water ice sand stone gold silver diamond iron copper glass paper plastic wood steel cotton silk
coffee tea chocolate cheese pizza bread rice soup salt sugar honey egg milk butter cake cookie candy
juice sandwich burger noodles pasta salad pepper onion garlic tomato potato carrot lemon orange grape
banana mango pineapple coconut strawberry cherry peach watermelon pumpkin corn bean mushroom
dog cat horse cow pig sheep goat chicken duck rabbit mouse lion tiger elephant giraffe zebra monkey
bear wolf fox deer snake frog turtle whale dolphin shark octopus eagle owl parrot penguin bee butterfly
spider ant crocodile camel kangaroo panda squirrel bat hippo rhino lobster crab jellyfish peacock swan
heart brain bone tooth hand foot eye ear nose finger shoulder knee skin hair beard smile tears
family friend baby mother father brother sister wedding birthday holiday party festival funeral
music dance song poem story movie theatre painting photograph sculpture concert circus carnival
money bank coin price market shop gift prize treasure crown throne flag map passport
computer phone internet email website keyboard screen television radio camera video robot software
winter summer spring autumn morning night midnight sunrise sunset weekend calendar season
school lesson exam homework teacher student classroom university college science history math
sleep dream memory idea secret mystery magic luck danger adventure journey vacation picnic
""".split()

HAND2 = """
sofa table chair bed lamp shelf carpet curtain towel soap toothbrush bucket broom kettle spoon fork plate bowl cup
bottle jar basket box bag key lock rope chain needle thread button zipper scissors glue tape comb perfume jewelry
necklace ring bracelet watch glasses hat shoe boot sock glove scarf jacket coat shirt dress skirt trousers jeans
uniform pajamas helmet mask backpack suitcase tent tree flower rose grass leaf seed root branch bush cactus palm
cave cliff hill field swamp pond stream wave tide shore rock pebble mud dust smoke ash lava crystal city village
town street road highway park zoo garage office hotel restaurant cafe cinema station harbor port pool gym stage
studio laboratory warehouse mall supermarket stew porridge pancake waffle donut muffin pie jam cereal yogurt
popcorn steak sausage fish shrimp sushi curry spice vinegar oil flour yeast dough biscuit cracker nut peanut
almond olive avocado lettuce cabbage spinach cucumber pea plantain yam cassava ginger engineer mechanic carpenter
plumber electrician firefighter judge president mayor captain sailor fisherman baker butcher tailor barber waiter
cashier banker journalist photographer designer architect dentist surgeon pharmacist coach athlete champion laptop
tablet printer cable charger speaker headphones microphone drone engine motor wheel tire brake bulb switch socket
generator fan fridge oven stove microwave toaster blender car bus van motorcycle canoe yacht ferry jet glider
balloon parachute sled skateboard wagon carriage love peace freedom hope fear anger joy art sport game time
power energy health beauty truth justice future language culture nature weather color shape speed distance
number word name voice sound light shadow heat silence noise smell taste touch lightning breakfast lunch dinner
picnic kitchen oven bread village farmer cattle harvest crop wheat rice tractor well market stall trader customer
""".split()

corp = DL / "corpora/data"
pool = list(HAND)
pool += [o for o in json.load(open(corp / "objects/objects.json"))["objects"] if " " not in o]
pool += json.load(open(corp / "animals/common.json"))["animals"]
for f in ["fruits", "vegetables", "breads_and_pastries"]:
    j = json.load(open(corp / f"foods/{f}.json"))
    pool += [x for x in j[[k for k in j if k != "description"][0]] if " " not in x]
pool += HAND2

pool_set = {w.lower() for w in pool}
seen, answers = set(), []
for w in pool:
    w = w.lower()
    if w in seen or w in BLOCK or w not in index:
        continue
    # Familiar enough to guess, and not a plural of a word already in the pool.
    if index[w] > 20000 or len(w) < 3 or len(w) > 11:
        continue
    if w.endswith("s") and (w[:-1] in pool_set or w[:-2] in pool_set):
        continue
    seen.add(w)
    answers.append(w)

random.Random(20261011).shuffle(answers)
practice = answers[:150]
daily = answers[150:]
print(f"{len(answers)} secret words: {len(daily)} daily, {len(practice)} practice")
print("first daily:", daily[:30])

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "vocab.txt").write_text("\n".join(words) + "\n")
Q.tofile(OUT / "vectors.i8")
(OUT / "answers.json").write_text(json.dumps({"daily": daily, "practice": practice}, indent=0) + "\n")
(OUT / "blocked.txt").write_text("\n".join(sorted(BLOCK & set(words))) + "\n")
(OUT.parent / "src/data/blocked.ts").write_text(
    "// Generated from data/blocked.txt — words never shown as a hint or in the closest-words list.\n"
    f"export const BLOCKED_WORDS = \"{' '.join(sorted(BLOCK & set(words)))}\";\n"
)
(OUT / "meta.json").write_text(json.dumps({"dims": int(Q.shape[1]), "words": len(words), "scale": float(scale)}) + "\n")
print("vectors.i8", Q.nbytes // 1024, "KB")
