#!/usr/bin/env python3
"""Convert candidate embedding models to CoreML for the on-device speedrun.

For each model:
  - wrap HF AutoModel with the model-appropriate pooling + L2 normalisation
  - trace at a fixed sequence length and convert to a .mlpackage
  - embed the 89-recipe corpus (title + ingredients) and save fixture JSON
  - export the shared bert-base-uncased vocab.txt once

Outputs land in experiments/coreml/out/.
Run AFTER: pip install transformers coremltools sentence-transformers
"""
import json, os, sys
import torch
import torch.nn as nn
from transformers import AutoModel, AutoTokenizer
import coremltools as ct
import transformers.modeling_utils as _mu

# BERT builds its additive attention mask with finfo(dtype).min (~-3.4e38), which
# overflows fp16 -> -inf -> NaN softmax on the ANE. Clamp to the fp16-safe -1e4.
def _safe_extended_mask(self, attention_mask, input_shape, device=None, dtype=None):
    if dtype is None:
        dtype = self.dtype
    ext = attention_mask[:, None, None, :].to(dtype)
    return (1.0 - ext) * -1e4
_mu.ModuleUtilsMixin.get_extended_attention_mask = _safe_extended_mask

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
RECIPES = os.path.join(HERE, "..", "embeddings", "data", "recipes.json")
SEQ_LEN = 64  # queries are short; recipes truncated to this for fixture parity

# name -> (hf id, pooling, query_prefix)
MODELS = {
    "minilm":    ("sentence-transformers/all-MiniLM-L6-v2", "mean", ""),
    "bge-small": ("BAAI/bge-small-en-v1.5", "cls", "Represent this sentence for searching relevant passages: "),
    "bge-base":  ("BAAI/bge-base-en-v1.5", "cls", "Represent this sentence for searching relevant passages: "),
    "mxbai":     ("mixedbread-ai/mxbai-embed-large-v1", "cls",
                  "Represent this sentence for searching relevant passages: "),
}


class EmbedWrapper(nn.Module):
    def __init__(self, model, pooling):
        super().__init__()
        self.model = model
        self.pooling = pooling

    def forward(self, input_ids, attention_mask):
        out = self.model(input_ids=input_ids, attention_mask=attention_mask, return_dict=False)
        hidden = out[0]  # last_hidden_state [B, T, H]
        if self.pooling == "cls":
            pooled = hidden[:, 0]
        else:  # mean pooling over non-pad tokens
            mask = attention_mask.unsqueeze(-1).type_as(hidden)
            pooled = (hidden * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
        return torch.nn.functional.normalize(pooled, p=2, dim=1)


def field_text(r):
    ing = r.get("ingredients") or []
    return r["title"] + ". Ingredients: " + "; ".join(ing if isinstance(ing, list) else [str(ing)])


def convert_one(name, hf_id, pooling, prefix, recipes, export_vocab):
    print(f"\n=== {name} ({hf_id}) ===", flush=True)
    tok = AutoTokenizer.from_pretrained(hf_id)
    model = AutoModel.from_pretrained(hf_id, attn_implementation="eager").eval()
    wrapper = EmbedWrapper(model, pooling).eval()

    ex = tok("warm up text", return_tensors="pt", padding="max_length",
             truncation=True, max_length=SEQ_LEN)
    ids = ex["input_ids"].to(torch.int32)
    mask = ex["attention_mask"].to(torch.int32)

    with torch.no_grad():
        traced = torch.jit.trace(wrapper, (ids, mask), strict=False)

    precision = ct.precision.FLOAT16 if os.environ.get("FP16") else ct.precision.FLOAT32
    mlmodel = ct.convert(
        traced,
        inputs=[
            ct.TensorType(name="input_ids", shape=(1, SEQ_LEN), dtype=int),
            ct.TensorType(name="attention_mask", shape=(1, SEQ_LEN), dtype=int),
        ],
        outputs=[ct.TensorType(name="embedding")],
        minimum_deployment_target=ct.target.iOS17,
        compute_units=ct.ComputeUnit.ALL,
        compute_precision=precision,
        convert_to="mlprogram",
    )
    pkg = os.path.join(OUT, f"{name}.mlpackage")
    mlmodel.save(pkg)
    dim = wrapper(ids, mask).shape[1]
    print(f"  saved {pkg}  dim={dim}", flush=True)

    # Recipe fixture embeddings (passages — no query prefix)
    vecs = {}
    with torch.no_grad():
        for r in recipes:
            enc = tok(field_text(r), return_tensors="pt", padding="max_length",
                      truncation=True, max_length=SEQ_LEN)
            v = wrapper(enc["input_ids"].to(torch.int32), enc["attention_mask"].to(torch.int32))
            vecs[r["recipeId"]] = v[0].tolist()
    json.dump({"dim": dim, "prefix": prefix, "vectors": vecs},
              open(os.path.join(OUT, f"recipes_{name}.json"), "w"))
    print(f"  wrote {len(vecs)} recipe vectors", flush=True)

    if export_vocab:
        vocab = tok.get_vocab()  # token -> id
        ordered = [None] * (max(vocab.values()) + 1)
        for t, i in vocab.items():
            ordered[i] = t
        with open(os.path.join(OUT, "vocab.txt"), "w") as f:
            f.write("\n".join(tok_ if tok_ is not None else "[UNK]" for tok_ in ordered))
        print(f"  exported vocab.txt ({len(ordered)} tokens)", flush=True)


def main():
    recipes = json.load(open(RECIPES))
    only = sys.argv[1:] or list(MODELS)
    first = True
    manifest = []
    for name in only:
        hf_id, pooling, prefix = MODELS[name]
        convert_one(name, hf_id, pooling, prefix, recipes, export_vocab=first)
        first = False
        manifest.append({"name": name, "hf": hf_id, "pooling": pooling, "prefix": prefix})
    json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=2)
    print("\nDONE. Outputs in", OUT)


if __name__ == "__main__":
    main()
