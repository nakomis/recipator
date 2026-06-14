#!/usr/bin/env python3
"""Quality eval of candidate models on the recipe semantic-search benchmark.

Includes the 4 open models (via sentence-transformers, same vectors the CoreML
models produce) AND Apple NLEmbedding (via ../embeddings/nl_embed.swift), so all
are scored on identical queries. Usage: st_eval.py [queries_big.json]
"""
import json, os, math, subprocess, sys, numpy as np
from sentence_transformers import SentenceTransformer

HERE = os.path.dirname(os.path.abspath(__file__))
EMB = os.path.join(HERE, "..", "embeddings")
recipes = json.load(open(os.path.join(EMB, "data", "recipes.json")))
qfile = sys.argv[1] if len(sys.argv) > 1 else os.path.join(EMB, "queries_big.json")
queries = json.load(open(qfile))["queries"]
manifest = {m["name"]: m for m in json.load(open(os.path.join(HERE, "out", "manifest.json")))}
titles = [r["title"] for r in recipes]


def field_text(r):
    ing = r.get("ingredients") or []
    return r["title"] + ". Ingredients: " + "; ".join(ing if isinstance(ing, list) else [str(ing)])


def is_rel(title, subs):
    t = title.lower()
    return any(s.lower() in t for s in subs)


def score(ranked, subs, k=5):
    rels = [is_rel(t, subs) for t in ranked[:k]]
    p = sum(rels) / k
    dcg = sum((1 if rels[i] else 0) / math.log2(i + 2) for i in range(len(rels)))
    ideal = sum(1 / math.log2(i + 2) for i in range(min(k, len(subs))))
    ndcg = min(1.0, dcg / ideal) if ideal else 0  # cap: dup recipes can push >1
    mrr = next((1 / (i + 1) for i, t in enumerate(ranked) if is_rel(t, subs)), 0.0)
    return p, ndcg, mrr


def validate():
    bad = []
    for q in queries:
        for s in q["relevant"]:
            if not any(s.lower() in t.lower() for t in titles):
                bad.append((q["query"], s))
    if bad:
        print("⚠️  relevant judgements matching NO recipe (fix these):")
        for query, s in bad:
            print(f"    [{query}] -> '{s}'")
    else:
        print(f"✓ ground truth valid: {len(queries)} queries, all relevant titles exist\n")
    return not bad


def nl_embed(texts):
    """Apple NLEmbedding via the swift script. Returns np matrix (nil rows -> zeros)."""
    items = "\n".join(json.dumps({"id": str(i), "text": t}) for i, t in enumerate(texts))
    proc = subprocess.run(["swift", os.path.join(EMB, "nl_embed.swift"), "en"],
                          input=items, capture_output=True, text=True)
    vecs = {}
    for line in proc.stdout.splitlines():
        if line.strip().startswith("{"):
            o = json.loads(line)
            v = o["vector"]
            vecs[int(o["id"])] = v if isinstance(v, list) else None
    dim = next((len(v) for v in vecs.values() if v), 512)
    out = np.zeros((len(texts), dim))
    for i, v in vecs.items():
        if v:
            out[i] = v
    return out


def eval_matrix(doc_vecs, qvecs):
    P = N = M = 0.0
    rows = []
    for i, q in enumerate(queries):
        qv = qvecs[i]
        if np.linalg.norm(qv) == 0:
            ranked = titles  # degenerate
        else:
            sims = doc_vecs @ qv
            ranked = [titles[j] for j in np.argsort(-sims)]
        p, n, m = score(ranked, q["relevant"])
        P += p; N += n; M += m
        rows.append((q["query"], n))
    nq = len(queries)
    return P / nq, N / nq, M / nq, rows


def main():
    validate()
    results = {}
    detail = {}

    # Apple NLEmbedding
    dv = nl_embed([field_text(r) for r in recipes])
    dv = dv / (np.linalg.norm(dv, axis=1, keepdims=True) + 1e-9)
    qv = nl_embed([q["query"] for q in queries])
    qv = qv / (np.linalg.norm(qv, axis=1, keepdims=True) + 1e-9)
    results["NLEmbedding"], detail["NLEmbedding"] = (eval_matrix(dv, qv)[:3], eval_matrix(dv, qv)[3])

    # Open models
    for name, spec in manifest.items():
        model = SentenceTransformer(spec["hf"])
        dv = model.encode([field_text(r) for r in recipes], normalize_embeddings=True)
        qv = model.encode([spec["prefix"] + q["query"] for q in queries], normalize_embeddings=True)
        p, n, m, rows = eval_matrix(dv, np.array(qv))
        results[name] = (p, n, m)
        detail[name] = rows

    print(f"{'model':<14} {'P@5':>6} {'nDCG@5':>7} {'MRR':>6}")
    for name in ["NLEmbedding", "minilm", "bge-small", "bge-base", "mxbai"]:
        p, n, m = results[name]
        print(f"{name:<14} {p:>6.3f} {n:>7.3f} {m:>6.3f}")

    # Per-query nDCG for the best small vs best big model, to spot weak queries
    print(f"\n{'query':<32} {'bge-small':>10} {'mxbai':>8}")
    for (q, ns), (_, nm) in zip(detail["bge-small"], detail["mxbai"]):
        print(f"{q:<32} {ns:>10.2f} {nm:>8.2f}")


if __name__ == "__main__":
    main()
