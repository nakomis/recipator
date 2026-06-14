# Python container Lambda that embeds a recipe with mxbai-embed-large-v1.
# The model is baked into the image at build time so cold starts don't hit the network.
FROM public.ecr.aws/lambda/python:3.11

ENV HF_HOME=/opt/hf
ENV TRANSFORMERS_OFFLINE=1
ENV TOKENIZERS_PARALLELISM=false

COPY requirements.txt .
# CPU-only torch keeps the image as small as possible (no CUDA).
RUN pip install --no-cache-dir torch==2.7.0 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir sentence-transformers==3.0.1 boto3

# Pre-download the model into the image.
RUN python -c "from sentence_transformers import SentenceTransformer; \
SentenceTransformer('mixedbread-ai/mxbai-embed-large-v1')"

COPY handler.py ${LAMBDA_TASK_ROOT}/
CMD ["handler.handler"]
