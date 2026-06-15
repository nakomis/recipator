# Python container Lambda that embeds a recipe with BAAI/bge-base-en-v1.5.
# The model is baked into the image at build time so cold starts don't hit the network.
#
# Python 3.13 (not 3.11): the current scientific stack (numpy 2.4, scikit-learn 1.9,
# pulled in by sentence-transformers) only ships wheels for 3.12+. On 3.11 pip falls
# back to source builds, which fail — this minimal image has no C compiler. This Lambda
# uses torch, not TensorFlow, so the "TF needs 3.11" caveat doesn't apply here.
FROM public.ecr.aws/lambda/python:3.13

ENV HF_HOME=/opt/hf
ENV TOKENIZERS_PARALLELISM=false

COPY requirements.txt .
# CPU-only torch keeps the image as small as possible (no CUDA). The version must
# exist on the PyTorch CPU wheel index; this Lambda has no coremltools, so it is NOT
# tied to the torch 2.7 the CoreML conversion harness needs (see experiments/coreml).
# torch 2.7.1: earliest line with cp313 CPU wheels is 2.6 (2.5.1 has none), 2.7.1 is a
# stable choice. numpy capped <2.3 so it resolves to a 2.2.x cp313 wheel the pinned
# torch is happy with — and nothing is built from source.
RUN pip install --no-cache-dir torch==2.7.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir "numpy<2.3" sentence-transformers==3.0.1 boto3

# Pre-download the model files into the image (needs network — must run before going
# offline). snapshot_download only fetches files into HF_HOME; it does NOT load the
# model into memory the way SentenceTransformer(...) would, so the build stays well
# under Docker's memory limit. The runtime (4 GB Lambda) loads it from this cache.
#
# Fetch ONLY the safetensors + config + tokenizer the torch path uses. The repo also
# ships pytorch_model.bin (duplicate weights), onnx/, openvino/ and TF formats — ~5GB
# of dead weight that would push the image over Lambda's 10GB limit.
RUN python -c "from huggingface_hub import snapshot_download; \
snapshot_download('BAAI/bge-base-en-v1.5', \
ignore_patterns=['*.bin','pytorch_model*','onnx/*','*.onnx','openvino/*','*.h5','tf_model*','*.msgpack','*.ot','rust_model*'])"

# Runtime runs fully offline: the model is already baked into HF_HOME above, and the
# Lambda has no outbound network. Setting these after the download avoids blocking it.
ENV TRANSFORMERS_OFFLINE=1
ENV HF_HUB_OFFLINE=1

COPY handler.py ${LAMBDA_TASK_ROOT}/
CMD ["handler.handler"]
