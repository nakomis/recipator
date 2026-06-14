# Python container Lambda that embeds a recipe with mxbai-embed-large-v1.
# The model is baked into the image at build time so cold starts don't hit the network.
FROM public.ecr.aws/lambda/python:3.11

ENV HF_HOME=/opt/hf
ENV TOKENIZERS_PARALLELISM=false

COPY requirements.txt .
# CPU-only torch keeps the image as small as possible (no CUDA). The version must
# exist on the PyTorch CPU wheel index; this Lambda has no coremltools, so it is NOT
# tied to the torch 2.7 the CoreML conversion harness needs (see experiments/coreml).
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir sentence-transformers==3.0.1 boto3

# Pre-download the model into the image (needs network — must run before going offline).
RUN python -c "from sentence_transformers import SentenceTransformer; \
SentenceTransformer('mixedbread-ai/mxbai-embed-large-v1')"

# Runtime runs fully offline: the model is already baked into HF_HOME above, and the
# Lambda has no outbound network. Setting these after the download avoids blocking it.
ENV TRANSFORMERS_OFFLINE=1
ENV HF_HUB_OFFLINE=1

COPY handler.py ${LAMBDA_TASK_ROOT}/
CMD ["handler.handler"]
