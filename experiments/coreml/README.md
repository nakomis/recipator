# On-device embedding speedrun (THROWAWAY)

Branch `recp-19-speedrun` exists only to measure **on-device** latency of query
embedding + cosine search for candidate models, on real hardware. Throw it away after.

## What it does

Bundles four CoreML sentence-embedding models + pre-computed recipe embeddings, adds a
stopwatch button (top-left of the recipe list) that opens a benchmark sheet. Tapping **RUN**
times, per model:

- **load** — cold model load (ms)
- **embed** — mean query-embedding time over 5 queries (ms) ← the number that matters
- **search 89** — cosine over the real 89-recipe corpus (ms)
- **search 5k** — cosine over 5,000 tiled vectors (ms), to see how lookup scales

It also shows the top hit for your typed query, so you can eyeball result quality per model.

## Models (all fp16, ANE-eligible)

| name      | HF id                                   | dim  | params | ~size |
|-----------|-----------------------------------------|------|--------|-------|
| minilm    | sentence-transformers/all-MiniLM-L6-v2  | 384  | 22 M   | 43 MB |
| bge-small | BAAI/bge-small-en-v1.5                  | 384  | 33 M   | 63 MB |
| bge-base  | BAAI/bge-base-en-v1.5                   | 768  | 109 M  | 207 MB|
| mxbai     | mixedbread-ai/mxbai-embed-large-v1      | 1024 | 335 M  | 637 MB|

The app is ~1 GB. That's fine for a one-off sideload; **do not ship this branch.**

## Regenerating the models

The `.mlpackage` blobs are gitignored (too big for git). Regenerate them:

```bash
cd experiments/coreml
python3 -m venv .venv
.venv/bin/pip install "torch==2.7.0" "coremltools==9.0" "transformers==4.44.2" "sentence-transformers==3.0.1" "numpy<2"
FP16=1 .venv/bin/python convert.py            # all four -> out/
.venv/bin/python verify.py mxbai              # parity + sanity NN check
cp -R out/*.mlpackage ../../ios/Recipator/Speedrun/Models/
cp out/recipes_*.json out/vocab.txt out/manifest.json ../../ios/Recipator/Speedrun/Data/
```

### Conversion gotchas (already handled in convert.py)
- coremltools 9 isn't tested with torch 2.11 (the asdf default) — it hits unsupported ops.
  Use the pinned **torch 2.7** venv above.
- BERT builds its additive attention mask with `finfo.min` (~-3.4e38), which overflows fp16
  → `NaN` on the ANE. `convert.py` monkeypatches `get_extended_attention_mask` to clamp to
  `-1e4` (fp16-safe). Verified: CoreML output matches sentence-transformers at cosine 1.0000.

## What we expect to learn

Whether the big model (mxbai, 335 M) is usably fast on-device or whether we're forced down to
bge-small / minilm. Recipe vectors are pre-computed server-side, so the on-device cost is
*only* the query embed + the cosine scan — this tells us if mxbai's better quality is
affordable per-keystroke, or only viable with debounce / on-submit search.

Decision on the live model stays open until these numbers are in. The live store must keep the
model swappable **before first deploy** (changing it later means re-embedding everything).
