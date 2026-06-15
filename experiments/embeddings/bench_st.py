#!/usr/bin/env python3
"""Benchmark candidate on-device embedding models on the recipe corpus.

Same corpus (data/recipes.json), same queries + relevance judgements (queries.json),
same scoring as evaluate.py (P@5 / R@5 / MRR / nDCG@5, binary relevance by title
substring), but encodes with sentence-transformers / model2vec so we can compare
models that aren't in Ollama (bge, EmbeddingGemma, Model2Vec).

Each model is tried independently — a gated/missing download is reported and skipped,
not fatal. Uses the SAME "combined" field as the live app (title + ingredients).
"""
import json, os, math, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")

# (label, kind, hf_id, query_prompt, doc_prompt)
#   kind: "st" = sentence-transformers, "st-prompt" = ST with named prompts, "m2v" = model2vec
# query_prompt/doc_prompt: prepended strings (sentence-transformers style). None = nothing.
MODELS = [
    ("mxbai (current, baseline)", "st", "mixedbread-ai/mxbai-embed-large-v1",
        "Represent this sentence for searching relevant passages: ", ""),
    ("minilm", "st", "sentence-transformers/all-MiniLM-L6-v2", "", ""),
    ("bge-small", "st", "BAAI/bge-small-en-v1.5",
        "Represent this sentence for searching relevant passages: ", ""),
    ("bge-base", "st", "BAAI/bge-base-en-v1.5",
        "Represent this sentence for searching relevant passages: ", ""),
    # EmbeddingGemma uses task-specific prompts built into ST as prompt_name query/document.
    ("embeddinggemma", "gemma", "google/embeddinggemma-300m", None, None),
    ("model2vec potion-8M", "m2v", "minishlab/potion-base-8M", "", ""),
    ("model2vec potion-32M", "m2v", "minishlab/potion-base-32M", "", ""),
]


def field_text(r):
    ing = r.get("ingredients") or []
    if not isinstance(ing, list):
        ing = [str(ing)]
    return r["title"] + ". Ingredients: " + "; ".join(ing)


def is_relevant(title, subs):
    t = title.lower()
    return any(s.lower() in t for s in subs)


def score(ranked_titles, relevant, k=5):
    rels = [is_relevant(t, relevant) for t in ranked_titles[:k]]
    total = len(relevant)
    hits = sum(rels)
    p = hits / k
    r = hits / total if total else 0
    mrr = 0.0
    for i, t in enumerate(ranked_titles):
        if is_relevant(t, relevant):
            mrr = 1.0 / (i + 1)
            break
    dcg = sum((1 if rels[i] else 0) / math.log2(i + 2) for i in range(min(k, len(rels))))
    ideal = sum(1 / math.log2(i + 2) for i in range(min(k, total)))
    ndcg = dcg / ideal if ideal else 0
    return p, r, mrr, ndcg


def encode_st(model, texts, prompt, normalize=True):
    full = [(prompt or "") + t for t in texts]
    v = model.encode(full, normalize_embeddings=normalize, show_progress_bar=False,
                     convert_to_numpy=True)
    return v.astype(np.float32)


def main():
    recipes = json.load(open(os.path.join(DATA, "recipes.json")))
    queries = json.load(open(os.path.join(HERE, "queries.json")))["queries"]
    titles = [r["title"] for r in recipes]
    docs = [field_text(r) for r in recipes]
    qtexts = [q["query"] for q in queries]

    results = []  # (ndcg, label, dim, p, r, mrr)
    notes = []

    for label, kind, hf, qp, dp in MODELS:
        t0 = time.time()
        try:
            if kind in ("st", "gemma"):
                from sentence_transformers import SentenceTransformer
                model = SentenceTransformer(hf)
                if kind == "gemma":
                    # EmbeddingGemma ships query/document prompts; use them.
                    dv = model.encode(docs, prompt_name="document", normalize_embeddings=True,
                                      convert_to_numpy=True, show_progress_bar=False).astype(np.float32)
                    qv = model.encode(qtexts, prompt_name="query", normalize_embeddings=True,
                                      convert_to_numpy=True, show_progress_bar=False).astype(np.float32)
                else:
                    dv = encode_st(model, docs, dp)
                    qv = encode_st(model, qtexts, qp)
            elif kind == "m2v":
                from model2vec import StaticModel
                model = StaticModel.from_pretrained(hf)
                dv = model.encode(docs).astype(np.float32)
                qv = model.encode(qtexts).astype(np.float32)
                # static vectors aren't unit-normalised; do it for cosine
                dv /= (np.linalg.norm(dv, axis=1, keepdims=True) + 1e-9)
                qv /= (np.linalg.norm(qv, axis=1, keepdims=True) + 1e-9)
            else:
                raise ValueError(kind)
        except Exception as e:
            msg = f"SKIPPED {label} ({hf}): {type(e).__name__}: {e}"
            print(msg, flush=True)
            notes.append(msg)
            continue

        dim = dv.shape[1]
        sims = qv @ dv.T  # (Q, N) cosine (all unit-normalised)
        agg = np.zeros(4)
        for qi, q in enumerate(queries):
            order = np.argsort(-sims[qi])
            ranked = [titles[j] for j in order]
            agg += np.array(score(ranked, q["relevant"]))
        agg /= len(queries)
        p, r, mrr, ndcg = agg
        results.append((ndcg, label, dim, p, r, mrr))
        print(f"OK  {label:<28} dim={dim:<5} nDCG@5={ndcg:.3f}  P@5={p:.3f} R@5={r:.3f} MRR={mrr:.3f}  ({time.time()-t0:.0f}s)", flush=True)

    print("\n=== RANKED BY nDCG@5 (combined: title + ingredients) ===", flush=True)
    print(f"{'model':<28} {'dim':>5} {'P@5':>6} {'R@5':>6} {'MRR':>6} {'nDCG@5':>7}")
    for ndcg, label, dim, p, r, mrr in sorted(results, reverse=True):
        print(f"{label:<28} {dim:>5} {p:>6.3f} {r:>6.3f} {mrr:>6.3f} {ndcg:>7.3f}")
    if notes:
        print("\n=== SKIPPED ===")
        for m in notes:
            print(" -", m)


if __name__ == "__main__":
    main()
