#!/usr/bin/env python3
"""Sanity-check a converted CoreML model: parity vs sentence-transformers + NN search."""
import json, os, sys, numpy as np
import coremltools as ct
from transformers import AutoTokenizer
from sentence_transformers import SentenceTransformer

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
SEQ = 64
NAME = sys.argv[1] if len(sys.argv) > 1 else "minilm"
manifest = {m["name"]: m for m in json.load(open(os.path.join(OUT, "manifest.json")))}
hf, prefix = manifest[NAME]["hf"], manifest[NAME]["prefix"]

tok = AutoTokenizer.from_pretrained(hf)
ml = ct.models.MLModel(os.path.join(OUT, f"{NAME}.mlpackage"))
st = SentenceTransformer(hf)


def coreml_embed(text):
    enc = tok(text, return_tensors="np", padding="max_length", truncation=True, max_length=SEQ)
    out = ml.predict({"input_ids": enc["input_ids"].astype(np.int32),
                      "attention_mask": enc["attention_mask"].astype(np.int32)})
    v = np.array(list(out.values())[0]).flatten()
    return v / (np.linalg.norm(v) + 1e-9)


q = "korean food"
cm = coreml_embed(prefix + q)
ref = st.encode(prefix + q, normalize_embeddings=True)
print(f"[{NAME}] cosine(CoreML, sentence-transformers) for query = {float(np.dot(cm, ref)):.4f}  (want >0.99)")

# NN search against shipped recipe fixtures
fix = json.load(open(os.path.join(OUT, f"recipes_{NAME}.json")))
ids = list(fix["vectors"].keys())
mat = np.array([fix["vectors"][i] for i in ids])
recipes = {r["recipeId"]: r["title"] for r in json.load(open(os.path.join(HERE, "..", "embeddings", "data", "recipes.json")))}
for query in ["korean food", "apple dessert", "something with chickpeas"]:
    qv = coreml_embed(prefix + query)
    sims = mat @ qv
    top = np.argsort(-sims)[:3]
    print(f"  '{query}': " + ", ".join(f"{recipes[ids[i]]} ({sims[i]:.2f})" for i in top))
