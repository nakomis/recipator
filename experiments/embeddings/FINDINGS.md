# Embedding model comparison for recipe semantic search

**Date:** 2026-06-14
**Corpus:** 89 real recipes pulled from `recipator-recipes-prod`.
**Goal:** Decide (a) which embedding model to use, (b) whether to embed title / ingredients / method
separately or combined, for on-device semantic search.

## TL;DR

1. **Apple `NLEmbedding` is not viable.** Its sentence embeddings score ~0 on most semantic
   queries (0.0 nDCG on 7 of 10). The original plan — compute query embeddings on-device with
   `NLEmbedding` — is dead. We need a real sentence-transformer.
2. **The open models are excellent.** `mxbai-embed-large` is best; `nomic-embed-text` and
   `all-MiniLM-L6-v2` are close and far smaller.
3. **A single combined title+ingredients embedding is enough.** Per-field embeddings aren't
   worth the complexity. Method text adds nothing useful.

## Results (mean over 10 queries with relevance judgements)

| model / field            |  P@5  |  R@5  |  MRR  | nDCG@5 |
|--------------------------|------:|------:|------:|-------:|
| mxbai / title            | 0.700 | 0.765 | 0.950 | 0.870  |
| mxbai / title+ingredients| 0.660 | 0.736 | 1.000 | 0.865  |
| minilm / title+ingredients| 0.600 | 0.667 | 0.920 | 0.774  |
| nomic / title+ingredients| 0.600 | 0.689 | 0.870 | 0.766  |
| nomic / title            | 0.540 | 0.596 | 0.900 | 0.718  |
| minilm / title           | 0.580 | 0.647 | 0.858 | 0.716  |
| **nl / title**           | 0.260 | 0.276 | 0.578 | 0.333  |
| **nl / title+ingredients**| 0.080 | 0.063 | 0.228 | 0.087  |

(`nl` = Apple `NLEmbedding`, 512-dim. `minilm` = all-MiniLM-L6-v2 384-dim. `nomic` = 768-dim.
`mxbai` = 1024-dim. "title+ingredients" is the field labelled `combined` in the raw data.)

Note `NLEmbedding` gets *worse* as text gets longer (title 0.33 → title+ingredients 0.087):
its sentence embeddings degrade badly on anything beyond a short phrase.

## The decisive queries

These are why averages hide the real story. Apple `NLEmbedding` returns essentially random
recipes; the open models nail the semantics.

**"korean food"** — no recipe title contains "korean":
- `nl`:    Savoyard Potatoes, Pork belly sous vide, Chickpea salad … (0.0)
- `mxbai`: **Kimchi-Braised Chicken, Quick Kimchi Pancakes**, Stir Fried Spicy Pork, Egg fried rice (1.0 nDCG)

**"welsh beef"** — cross-lingual; some titles are in Welsh:
- `nl`:    Savoyard Potatoes, Pork belly sous vide … (0.0)
- `mxbai`: Tasty Welsh Beef Biscuit, Welsh Beef Burrito, **Brisged Cig Eidion Cymru** … (0.83 nDCG)
  → it matched the *Welsh-language* title from an English query.

**"apple dessert"**, **"seafood pasta"**, **"mushroom dish"**, **"spicy slow-cooked beef"**,
**"cheesy comfort food bake"** — `nl` scores 0.0 on every one; `mxbai` scores 0.5–1.0.

## Decisions

### Model
Recipe embeddings are pre-computed server-side and shipped to the device. **But the search query
must be embedded on-device with the *same* model** (same vector space) — otherwise cosine
similarity is meaningless. That couples the two ends:

- We cannot use `mxbai` server-side and a small model on-device — incompatible vectors.
- So we standardise on ONE model used on **both** server and device.
- `mxbai-embed-large` (1024-dim, ~670 MB) is too big to bundle on-device.
- **Recommendation: `all-MiniLM-L6-v2` (384-dim, ~22–90 MB) or `bge-small-en-v1.5`** — small
  enough to convert to CoreML and bundle, good enough quality (0.77 nDCG here), tiny vectors
  (384 floats = 1.5 KB/recipe). Used identically server-side (sentence-transformers) and
  on-device (CoreML).

`NLEmbedding` is rejected outright.

### Field split
A **single combined `title + ingredients` embedding**. Title-only is comparable on quality but
title+ingredients wins on ingredient-driven queries ("something with chickpeas", "korean food"
→ kimchi via ingredients). Separate per-field embeddings and a method embedding are not worth
the storage or query complexity for this corpus.

## Reproducing

```bash
cd experiments/embeddings
# 1. pull corpus (already saved to data/recipes.json):
#    AWS_PROFILE=nakom.is-admin aws dynamodb scan --table-name recipator-recipes-prod --region eu-west-2
# 2. compute embeddings (needs Ollama with nomic-embed-text, mxbai-embed-large, all-minilm):
python3 embed.py
# 3. evaluate:
python3 evaluate.py
```

Relevance judgements live in `queries.json`. Raw per-query top-5 in `data/results.json`.
