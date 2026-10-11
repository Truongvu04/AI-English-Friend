# Configuration Guide

This guide describes the configuration that is intentionally exposed to a buyer or developer. Real local values belong only in ignored `.env` files or `config/model-config.local.json`; never copy credentials into tracked files or documentation.

## Configuration layers

There are three separate concerns:

1. Hardware Profile controls resource behavior, preload, and idle-unload policy.
2. Model Configuration selects chat, translation, STT, and TTS models/assets.
3. Environment files provide infrastructure values, service addresses, secrets, and the fallback values used by the `custom` profile.

Hardware Profiles and Model Configuration are related at startup but are not interchangeable settings.

## Environment file procedure

Tracked templates are:

- `server/.env.example`
- `stt-service/.env.example`
- `tts-service/.env.example`
- `frontend/.env.example`

Normal `setup-all.cmd` creates a missing local `.env` from its template and preserves an existing file. `-CheckOnly` never creates them. Review and edit local files after setup; never commit them.

## Server environment

The important `server/.env` groups are:

| Variable | Purpose | Required/optional |
| --- | --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection used by the backend and database checks | Required |
| `OLLAMA_URL` | Ollama API base URL; defaults to the local Ollama address | Optional |
| `OLLAMA_CHAT_MODEL` | Environment fallback for chat model selection | Optional |
| `OLLAMA_TRANSLATION_MODEL` | Environment fallback for translation model selection | Optional |
| `OLLAMA_MODEL` | Legacy chat alias used only when `OLLAMA_CHAT_MODEL` is absent | Compatibility fallback |
| `PORT` | Backend HTTP port; default `3001` | Optional |
| `AI_STREAMING` | Selects the frontend streaming chat path when `true` | Optional |
| `AI_RESOURCE_MODE` | Resource mode for `custom`; accepted values include `auto`, `low-memory`, and `standard` | Optional |
| `AI_LOW_MEMORY_RAM_THRESHOLD_GB` | Resource-manager threshold used by `auto` resource mode | Optional |
| `STT_PROVIDER`, `FASTER_WHISPER_URL` | Backend STT provider and service URL | Optional |
| `TTS_PROVIDER`, `KOKORO_TTS_URL` | Backend TTS provider and service URL | Optional |
| `STT_BROWSER_FALLBACK`, `TTS_BROWSER_FALLBACK` | Enable browser voice fallbacks | Optional |
| `AI_DEMO_MODE` | Enables diagnostic idle-delay behavior only; it does not fake AI responses | Optional |

Chat and translation remain separate model fields even when both defaults currently use the same Ollama model.

## STT service environment

`stt-service/.env` controls the persistent faster-whisper service:

| Variable | Current default |
| --- | --- |
| `FASTER_WHISPER_MODEL` | `base.en` |
| `FASTER_WHISPER_LANGUAGE` | `en` |
| `FASTER_WHISPER_DEVICE` | `cpu` |
| `FASTER_WHISPER_COMPUTE_TYPE` | `int8` |
| `FASTER_WHISPER_PRELOAD` | `false` |
| `FASTER_WHISPER_BEAM_SIZE` | `5` |
| `FASTER_WHISPER_VAD_FILTER` | `true` |
| `FASTER_WHISPER_MIN_SILENCE_MS` | `500` |
| `FASTER_WHISPER_MAX_AUDIO_BYTES` | `20971520` |
| `FASTER_WHISPER_HOST` / `FASTER_WHISPER_PORT` | `127.0.0.1` / `8765` |

The server-side request limits and lease timers are configured separately in `server/.env` with `STT_MAX_AUDIO_BYTES`, `STT_MAX_RECORDING_MS`, `STT_REQUEST_TIMEOUT_MS`, `STT_IDLE_UNLOAD_MS`, and `STT_LEASE_TIMEOUT_MS`.

## TTS service environment

`tts-service/.env` controls Kokoro:

| Variable | Current default |
| --- | --- |
| `KOKORO_MODEL_PATH` | `models/kokoro-v1.0.int8.onnx` |
| `KOKORO_VOICES_PATH` | `models/voices-v1.0.bin` |
| `KOKORO_HOST` / `KOKORO_PORT` | `127.0.0.1` / `8766` |
| `KOKORO_PRELOAD` | `false` |
| `KOKORO_LANGUAGE` | `en-us` |
| `KOKORO_MAX_TEXT_CHARS` | `4000` |
| `KOKORO_INTRA_OP_THREADS` | `2` |

The model and voice files are external assets. Relative TTS paths resolve against the `tts-service` directory. Absolute paths are accepted by the current path validation. A relative example such as `models/kokoro-v1.0.int8.onnx` is portable and avoids machine-specific paths.

## Frontend environment

`frontend/.env.example` exposes one frontend setting:

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_API_URL` | Backend API base URL used by the frontend | `http://localhost:3001` |

## Hardware Profiles

Use `-Profile auto`, `low-memory`, `standard`, `high-performance`, or `custom` on setup, model checks, and startup. `auto` uses the 6 GiB and 16 GiB RAM boundaries. Explicit `standard` and `high-performance` refuse below their minimum RAM. Detection failures select `low-memory` safely.

`low-memory` uses demand-driven resources, no STT/TTS preload, and conservative idle unloading. `standard` uses balanced retention. `high-performance` uses longer warm retention but still preserves lease and lifecycle safety. `custom` leaves profile-controlled resource values to the environment.

## Model Configuration files

Tracked defaults live in `config/model-config.defaults.json`. The optional local overlay starts from `config/model-config.local.example.json`:

```powershell
Copy-Item config/model-config.local.example.json config/model-config.local.json
```

The local overlay is optional, ignored by Git, and excluded from source packages. It must contain schema version `1` and only supported profile/component keys.

Current tracked defaults are:

| Profile | Chat | Translation | STT | TTS |
| --- | --- | --- | --- | --- |
| `low-memory` | Ollama `qwen3:1.7b` | Ollama `qwen3:1.7b` | faster-whisper `base.en` | Kokoro paths inherited from environment |
| `standard` | Ollama `qwen3:4b` | Ollama `qwen3:4b` | faster-whisper `base.en` | Kokoro paths inherited from environment |
| `high-performance` | Ollama `qwen3:4b` | Ollama `qwen3:4b` | faster-whisper `base.en` | Kokoro paths inherited from environment |
| `custom` | Environment unless locally overridden | Environment unless locally overridden | Environment unless locally overridden | Environment unless locally overridden |

## Precedence and restart behavior

For a preset profile, a non-null local component override is merged over the tracked profile default. If the profile does not provide a value, the resolver falls back to the relevant environment value and then the source default.

For `custom`, explicit local component fields override environment values; absent local fields use environment values and source defaults. This makes `custom` the profile for advanced environment-driven configuration.

After changing either environment values or model configuration:

```powershell
.\stop-all.cmd
# edit the local configuration
.\check-models.cmd -Profile custom
.\start-all.cmd -Profile custom
```

There is no hot-swap. Startup records a normalized configuration fingerprint and refuses a mismatched active stack until project-owned services are stopped.

## Model checks and downloads

Use the read-only check for each profile you intend to run:

```powershell
.\check-models.cmd -Profile auto
.\check-models.cmd -Profile low-memory
.\check-models.cmd -Profile standard
.\check-models.cmd -Profile high-performance
.\check-models.cmd -Profile custom
```

Only explicit setup with `-PullModels` downloads missing Ollama models. STT and TTS setup may download their external assets when their local service setup is run; those assets remain outside the source package.
