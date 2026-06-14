"""Async embed-Lambda: compute a recipe's mxbai vector and store it on the item.

Invoked (InvocationType=Event) by /extract after a recipe is saved. The vector is
the SAME space the on-device CoreML model produces (verified cosine 1.0000), so
the document embedding uses NO query prefix and is L2-normalised.

Stored as a DynamoDB Binary attribute: 1024 float32 little-endian (4096 bytes).
"""
import os
import json
import struct
from datetime import datetime, timezone

import boto3
from sentence_transformers import SentenceTransformer

MODEL_ID = "mixedbread-ai/mxbai-embed-large-v1"
MODEL_TAG = "mxbai-v1"
RECIPES_TABLE = os.environ["RECIPES_TABLE"]

_model = SentenceTransformer(MODEL_ID)  # loaded once per container
_dynamo = boto3.client("dynamodb")


def _field_text(title: str, ingredients) -> str:
    ing = ingredients or []
    if not isinstance(ing, list):
        ing = [str(ing)]
    return f"{title}. Ingredients: " + "; ".join(str(i) for i in ing)


def _load_item(user_id: str, recipe_id: str):
    """Fetch title + ingredients from the table (used by backfill, which sends keys only)."""
    res = _dynamo.get_item(
        TableName=RECIPES_TABLE,
        Key={"userId": {"S": user_id}, "recipeId": {"S": recipe_id}},
        ProjectionExpression="title, ingredients",
    )
    item = res.get("Item", {})
    title = item.get("title", {}).get("S", "")
    ingredients = [v.get("S", "") for v in item.get("ingredients", {}).get("L", [])]
    return title, ingredients


def handler(event, _context):
    # Accept either a direct payload or an SQS/event envelope.
    recipe = event if "recipeId" in event else json.loads(event.get("body", "{}"))
    recipe_id = recipe["recipeId"]
    user_id = recipe["userId"]

    # /extract passes title + ingredients inline; the backfill sends keys only, so
    # fall back to reading them from the item.
    title = recipe.get("title")
    ingredients = recipe.get("ingredients")
    if title is None or ingredients is None:
        title, ingredients = _load_item(user_id, recipe_id)

    text = _field_text(title, ingredients)
    vec = _model.encode(text, normalize_embeddings=True)
    blob = b"".join(struct.pack("<f", float(x)) for x in vec)

    _dynamo.update_item(
        TableName=RECIPES_TABLE,
        Key={"userId": {"S": user_id}, "recipeId": {"S": recipe_id}},
        UpdateExpression="SET embedding = :e, embeddingModel = :m, embeddedAt = :t",
        ExpressionAttributeValues={
            ":e": {"B": blob},
            ":m": {"S": MODEL_TAG},
            ":t": {"S": datetime.now(timezone.utc).isoformat()},
        },
    )
    print(f"embed:done recipeId={recipe_id} dim={len(vec)} model={MODEL_TAG}")
    return {"recipeId": recipe_id, "dim": len(vec), "model": MODEL_TAG}
