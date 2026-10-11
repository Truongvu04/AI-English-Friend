# Technical Overview

## Architecture

```text
React + TypeScript + Vite frontend
              ↓ HTTP
Node.js backend
  ├─ Persona / conversation / memory persistence
  ├─ Ollama chat and translation
  ├─ Resource Manager and performance diagnostics
  ├─ faster-whisper service client
  └─ Kokoro service client
              ↓
MySQL + Ollama + local Python services
```

The browser does not call the Python services directly. Node owns the service lifecycle contract, STT leases, TTS coordination, persistence, and the fallback behavior exposed to the frontend.

## Components and default addresses

| Component | Technology | Default address/port |
| --- | --- | --- |
| Frontend | React, TypeScript, Vite | `http://127.0.0.1:5173/` |
| Backend | Node.js HTTP server | `http://127.0.0.1:3001/` |
| Ollama | External local provider | `http://127.0.0.1:11434/` |
| STT | FastAPI + faster-whisper | `http://127.0.0.1:8765/` |
| TTS | FastAPI + Kokoro ONNX | `http://127.0.0.1:8766/` |
| Database | External MySQL | configured through `server/.env` |

The backend port and Python service ports can be changed through the current environment configuration. The frontend development port is started as `5173` by the orchestration script.

## Provider responsibilities

- Ollama supplies local chat and translation generation.
- faster-whisper transcribes browser-recorded audio through the Node proxy.
- Kokoro synthesizes English speech in the TTS service.
- Browser SpeechRecognition and Web Speech are fallbacks when enabled.

These are integrated external technologies and model assets, not project-owned model training systems.

## Backend endpoints

The current backend exposes health and diagnostics including:

- `GET /health`
- `GET /api/config`
- `GET /api/system/models`
- `GET /api/system/performance`
- `GET /api/system/resources`
- `GET /api/stt/health`
- `POST /api/stt/prepare`
- `POST /api/stt/release`
- `POST /api/stt/transcribe`
- `GET /api/tts/health`
- `GET /api/tts/voices`
- `POST /api/tts/synthesize`
- `GET /api/personas`
- `POST /api/chat`
- `POST /api/chat/stream`
- `POST /api/translate`

The system-model endpoint reports provider names, model identifiers, asset basenames, and a configuration fingerprint. It does not expose full private paths, credentials, database contents, or conversation text.

## Resource lifecycle

The Resource Manager coordinates foreground generation with STT and TTS model residency. STT uses a lease so cancelled or abandoned recordings can be released safely. TTS and STT models can load and unload according to the active Hardware Profile and idle timers. Project-owned process metadata is stored under ignored `.runtime/` and is used to verify ownership before stopping a process.

## Hardware Profiles and Model Configuration

Hardware Profiles select resource policy, preload behavior, and idle-unload timing. `auto` maps RAM below 6 GiB to `low-memory`, 6 to below 16 GiB to `standard`, and 16 GiB or more to `high-performance`. Explicit profiles enforce their minimum RAM; detection failure safely selects `low-memory`.

Model Configuration selects the chat model, translation model, STT model, and TTS asset paths. The tracked defaults are in `config/model-config.defaults.json`; the optional ignored overlay is `config/model-config.local.json`. Startup creates a normalized fingerprint and protects against switching an active stack without stopping it.

## Persistence

The current schema contains seven tables: `users`, `user_settings`, `ai_personas`, `user_persona_settings`, `conversations`, `messages`, and `memories`. The schema does not include the removed Learning tables. Conversation and memory data are stored in MySQL; model inference remains local through the configured services.

## Process ownership

`start-all.ps1` starts or reuses the backend, frontend, STT, TTS, and external Ollama as appropriate. `status.ps1` labels ownership. `stop-all.ps1` stops only processes whose ownership and command identity can be verified, and explicitly leaves MySQL and external services alone.

## Performance diagnostics

The backend keeps bounded in-memory performance snapshots at `/api/system/performance` and resource/queue state at `/api/system/resources`. `scripts/benchmark-demo.ps1` is a diagnostic tool; it creates clearly labelled development conversation messages and does not simulate browser microphone input.

## Source packaging boundary

`package-source.ps1` selects tracked Git source, adds a top-level `AI-English-Friend/` directory, writes a manifest and checksum, and validates the extracted archive. The normal command requires a clean Git tree. The resulting source ZIP intentionally excludes `.git/`, local secrets, runtime state, environments, logs, user data, database dumps, and model binaries.
