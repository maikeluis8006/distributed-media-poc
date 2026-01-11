# distributed-media-poc
Distributed multimedia system for routing video to any TV and audio to any zone
(wired or Bluetooth), coordinated by a central controller and driven by voice
commands parsed by an LLM.

This repository contains a proof of concept with a clear path toward a
production-ready architecture.

## Local setup (POC)

### System dependencies

This POC uses external native tools for speech:

- STT (Speech-to-Text): `whisper.cpp` (GPU build recommended)
- TTS (Text-to-Speech): `piper`

#### Install Piper (Ubuntu/Pop!_OS)
```bash
sudo apt update
sudo apt install -y piper

#### STT: whisper.cpp

git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp

# CPU build (optional)
cmake -B build
cmake --build build -j

# CUDA build (recommended)
cmake -B build-cuda -DGGML_CUDA=ON
cmake --build build-cuda -j

cd whisper.cpp
sh ./models/download-ggml-model.sh medium

# Coordinator
COORDINATOR_BASE_URL=http://localhost:8080

# LLM Adapter
USE_TABBY=true
TABBY_BASE_URL=http://localhost:5000
TABBY_MODEL=your-model-name
TABBY_API_KEY=

# STT Service
WHISPER_BINARY_PATH=/home/<user>/projects/agents/whisper.cpp/build-cuda/bin/whisper-cli
WHISPER_MODEL_PATH=/home/<user>/projects/agents/whisper.cpp/models/ggml-medium.bin
WHISPER_THREADS=20

cd apps/coordinator && npm install && npm start
cd apps/llm-adapter && npm install && npm start
cd apps/audio-zone && npm install && npm start
cd apps/tv-player && npm install && npm start
cd apps/stt-service && npm install && npm start

