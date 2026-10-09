# Local Kokoro TTS service

This persistent FastAPI service is the primary local TTS provider for AI English Friend. It uses `kokoro-onnx==0.6.1`, the CPU `kokoro-v1.0.int8.onnx` model, and `voices-v1.0.bin`. The model is loaded on demand and is not stored in the database.

## Setup

```powershell
cd tts-service
.\setup.ps1
```

The local `.env` points to `D:\AI_Models\Kokoro`. Copy `.env.example` for a portable relative-path setup. If the model files are missing, setup downloads the official `model-files-v1.1` assets or prints the exact manual PowerShell command when download is unavailable.

## Run

```powershell
.\start.ps1
```

The default service is `http://127.0.0.1:8766`. The model remains unloaded until Node prepares TTS. Verify with `/health`, `/voices`, `/model/load`, `/synthesize`, and `/model/unload`.

Kokoro ONNX runtime is MIT licensed and the Kokoro model is Apache 2.0; verify the upstream notices before redistribution.
