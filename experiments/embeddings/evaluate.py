#!/usr/bin/env python3
"""Evaluate embedding models on semantic recipe search.

For each query, embeds it with the SAME model used for the recipes, ranks recipes
by cosine similarity against each field, and scores against relevance judgements.

Metrics: Precision@5, Recall@5, MRR (first relevant rank), nDCG@5.
Also dumps qualitative top-5 for inspection.
"""
import json, os, math, subprocess, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OLLAMA = "http://localhost:11434/api/embeddings"
OLLAMA_MODELS = {"nomic": "nomic-embed-text", "mxbai": "mxbai-embed-large", "minilm": "all-minilm"}


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def ollama_embed(model, text):
    body = json.dumps({"model": model, "prompt": text}).encode()
    req = urllib.request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())["embedding"]


def nl_embed_query(text):
    proc = subprocess.run(["swift", os.path.join(HERE, "nl_embed.swift"), "en"],
                          input=json.dumps({"id": "q", "text": text}) + "\n",
                          capture_output=True, text=True)
    for line in proc.stdout.splitlines():
        if line.strip().startswith("{"):
            return json.loads(line)["vector"]
    return None


def is_relevant(title, relevant_substrs):
    t = title.lower()
    return any(s.lower() in t for s in relevant_substrs)


def score(ranked_titles, relevant_substrs, k=5):
    rels = [is_relevant(t, relevant_substrs) for t in ranked_titles[:k]]
    total_rel = len(relevant_substrs)
    hits = sum(rels)
    precision = hits / k
    recall = hits / total_rel if total_rel else 0
    # MRR over full ranking
    mrr = 0.0
    for i, t in enumerate(ranked_titles):
        if is_relevant(t, relevant_substrs):
            mrr = 1.0 / (i + 1)
            break
    # nDCG@k (binary relevance)
    dcg = sum((1 if rels[i] else 0) / math.log2(i + 2) for i in range(min(k, len(rels))))
    ideal = sum(1 / math.log2(i + 2) for i in range(min(k, total_rel)))
    ndcg = dcg / ideal if ideal else 0
    return precision, recall, mrr, ndcg


def main():
    recipes = json.load(open(os.path.join(DATA, "recipes.json")))
    id2title = {r["recipeId"]: r["title"] for r in recipes}
    emb = json.load(open(os.path.join(DATA, "embeddings.json")))
    queries = json.load(open(os.path.join(HERE, "queries.json")))["queries"]

    models = ["nl"] + list(OLLAMA_MODELS)
    fields = ["title", "ingredients", "combined"]  # method rarely the right match target

    # Pre-embed each query per model
    qvecs = {}
    for q in queries:
        qvecs[q["query"]] = {}
        qvecs[q["query"]]["nl"] = nl_embed_query(q["query"])
        for key, model in OLLAMA_MODELS.items():
            qvecs[q["query"]][key] = ollama_embed(model, q["query"])

    # Aggregate scores per (model, field)
    agg = {m: {f: {"p": 0, "r": 0, "mrr": 0, "ndcg": 0} for f in fields} for m in models}
    detail = []

    for q in queries:
        qd = {"query": q["query"], "note": q.get("note", ""), "results": {}}
        for m in models:
            qv = qvecs[q["query"]][m]
            for f in fields:
                field_emb = emb[m][f]
                scored = []
                for rid, vec in field_emb.items():
                    if vec is None or qv is None:
                        continue
                    scored.append((cosine(qv, vec), id2title.get(rid, rid)))
                scored.sort(reverse=True)
                ranked = [t for _, t in scored]
                p, r, mrr, ndcg = score(ranked, q["relevant"])
                agg[m][f]["p"] += p
                agg[m][f]["r"] += r
                agg[m][f]["mrr"] += mrr
                agg[m][f]["ndcg"] += ndcg
                qd["results"][f"{m}/{f}"] = {
                    "top5": ranked[:5],
                    "p@5": round(p, 2), "ndcg@5": round(ndcg, 2),
                }
        detail.append(qd)

    n = len(queries)
    print("\n=== AGGREGATE (mean over %d queries) ===" % n)
    print(f"{'model/field':<22} {'P@5':>6} {'R@5':>6} {'MRR':>6} {'nDCG@5':>7}")
    rows = []
    for m in models:
        for f in fields:
            a = agg[m][f]
            rows.append((a["ndcg"] / n, f"{m}/{f}", a["p"] / n, a["r"] / n, a["mrr"] / n, a["ndcg"] / n))
    for ndcg, name, p, r, mrr, nd in sorted(rows, reverse=True):
        print(f"{name:<22} {p:>6.3f} {r:>6.3f} {mrr:>6.3f} {nd:>7.3f}")

    json.dump(detail, open(os.path.join(DATA, "results.json"), "w"), indent=2, ensure_ascii=False)
    print("\nWrote per-query detail to data/results.json")

    # Print the semantic-trap queries qualitatively
    print("\n=== SEMANTIC TRAP / CROSS-LINGUAL queries (top-5, combined field) ===")
    for qd in detail:
        if qd["note"]:
            print(f"\nQ: {qd['query']}  — {qd['note']}")
            for m in models:
                r = qd["results"][f"{m}/combined"]
                print(f"  {m:7} P@5={r['p@5']}: {r['top5']}")


if __name__ == "__main__":
    main()
