FROM nvidia/cuda:12.1.0-cudnn8-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

# Remove stale CUDA apt sources bundled in the base image — we don't install
# any CUDA packages via apt so these only cause GPG signature failures.
RUN rm -f /etc/apt/sources.list.d/cuda*.list /etc/apt/sources.list.d/nvidia-ml.list

# The ubuntu-keyring in this 2023 base image is stale — Ubuntu rotated its
# archive signing key after this image was built. Bootstrap a keyring refresh
# with auth bypassed, then re-enable proper verification for all subsequent steps.
RUN apt-get update -o Acquire::AllowInsecureRepositories=true \
        -o Acquire::AllowDowngradeToInsecureRepositories=true || true \
    && apt-get install -y --allow-unauthenticated ubuntu-keyring ca-certificates \
    && apt-get clean

RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-dev \
    cmake build-essential \
    libopenblas-dev liblapack-dev \
    libx11-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

# Build dlib with CUDA support — slow (~5 min) but necessary for GPU face detection.
RUN pip3 install --upgrade pip packaging && \
    git clone --depth 1 https://github.com/davisking/dlib.git /tmp/dlib && \
    cd /tmp/dlib && \
    mkdir build && cd build && \
    cmake .. -DDLIB_USE_CUDA=1 -DUSE_AVX_INSTRUCTIONS=1 && \
    cmake --build . --config Release -- -j $(nproc) && \
    cmake --install . && \
    cd /tmp/dlib && \
    pip3 install --no-build-isolation . && \
    rm -rf /tmp/dlib

# Install face_recognition_models first (no dlib dep), then face_recognition
# without --no-deps would overwrite our CUDA-compiled dlib with a CPU wheel.
RUN pip3 install face_recognition_models && \
    pip3 install --no-deps face_recognition

COPY requirements.txt /tmp/requirements.txt
RUN pip3 install -r /tmp/requirements.txt

WORKDIR /app
RUN mkdir -p /app/known_faces

COPY worker.py .

CMD ["python3", "-u", "worker.py"]
