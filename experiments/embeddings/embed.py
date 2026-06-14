#!/usr/bin/env python3
"""Compute embeddings for the recipe corpus across multiple models and fields.

Models:
  - nl        Apple NLEmbedding (512-dim) via swift nl_embed.swift
  - nomic     Ollama nomic-embed-text (768-dim)
  - mxbai     Ollama mxbai-embed-large (1024-dim)
  - minilm    Ollama all-minilm (384-dim)

Fields embedded per recipe: title, ingredients, method, combined (title+ingredients).
Writes data/embeddings.json: {model: {field: {recipeId: [vector]}}}
"""
import json, subprocess, urllib.request, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OLLAMA = "http://localhost:11434/api/embeddings"

OLLAMA_MODELS = {"nomic": "nomic-embed-text", "mxbai": "mxbai-embed-large", "minilm": "all-minilm"}


def load_recipes():
    return json.load(open(os.path.join(DATA, "recipes.json")))


def field_text(r, field):
    if field == "title":
        return r["title"]
    if field == "ingredients":
        ing = r.get("ingredients") or []
        return r["title"] + ". Ingredients: " + "; ".join(ing if isinstance(ing, list) else [str(ing)])
    if field == "method":
        m = r.get("method") or []
        return r["title"] + ". Method: " + " ".join(m if isinstance(m, list) else [str(m)])
    if field == "combined":
        ing = r.get("ingredients") or []
        return r["title"] + ". Ingredients: " + "; ".join(ing if isinstance(ing, list) else [str(ing)])
    raise ValueError(field)


def ollama_embed(model, text):
    # Truncate defensively: embedding models have limited context (mxbai ~512 tok).
    text = (text or "").strip()[:4000] or "empty"
    body = json.dumps({"model": model, "prompt": text}).encode()
    for attempt in range(3):
        try:
            req = urllib.request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read())["embedding"]
        except Exception as e:
            if attempt == 2:
                print(f"  WARN ollama {model} failed after retries: {e}")
                return None
            time.sleep(1)


def nl_embed_batch(items, lang="en"):
    """items: list of (id, text). Returns dict id->vector via swift script."""
    proc = subprocess.Popen(["swift", os.path.join(HERE, "nl_embed.swift"), lang],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    inp = "\n".join(json.dumps({"id": i, "text": t}) for i, t in items)
    out, _ = proc.communicate(inp)
    result = {}
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("{"):
            o = json.loads(line)
            result[o["id"]] = o["vector"]
    return result


def main():
    recipes = load_recipes()
    fields = ["title", "ingredients", "method", "combined"]
    emb = {m: {f: {} for f in fields} for m in (["nl"] + list(OLLAMA_MODELS))}

    # NLEmbedding: batch per field through one swift process each
    for f in fields:
        items = [(r["recipeId"], field_text(r, f)) for r in recipes]
        t0 = time.time()
        emb["nl"][f] = nl_embed_batch(items)
        nils = sum(1 for v in emb["nl"][f].values() if v is None)
        print(f"nl/{f}: {len(emb['nl'][f])} vecs ({nils} nil) in {time.time()-t0:.1f}s")

    # Ollama models
    for key, model in OLLAMA_MODELS.items():
        for f in fields:
            t0 = time.time()
            for r in recipes:
                emb[key][f][r["recipeId"]] = ollama_embed(model, field_text(r, f))
            print(f"{key}/{f}: {len(emb[key][f])} vecs in {time.time()-t0:.1f}s")

    json.dump(emb, open(os.path.join(DATA, "embeddings.json"), "w"))
    print("Wrote embeddings.json")


if __name__ == "__main__":
    main()
