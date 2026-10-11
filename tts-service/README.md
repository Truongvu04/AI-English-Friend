# Local Kokoro TTS service

This persistent FastAPI service is the primary local TTS provider for AI English Friend. It uses `kokoro-onnx==0.6.1`, the CPU `kokoro-v1.0.int8.onnx` model, and `voices-v1.0.bin`. The model is loaded on demand and is not stored in the database.

## Setup

```powershell
cd tts-service
.\setup.ps1
```

The local `.env` controls `KOKORO_MODEL_PATH` and `KOKORO_VOICES_PATH`. The tracked example uses paths relative to `tts-service`; setup downloads missing official `model-files-v1.1` assets to those configured paths or prints a manual PowerShell command when download is unavailable.

## Run

```powershell
.\start.ps1
```

The default service is `http://127.0.0.1:8766`. The model remains unloaded until Node prepares TTS. Verify with `/health`, `/voices`, `/model/load`, `/synthesize`, and `/model/unload`.

Review the project third-party notice before redistribution. This repository does not independently verify upstream license terms for the Kokoro runtime or model assets.
