# AI English Friend

## Structure

- `frontend/` — React + TypeScript + Vite UI and assets.
- `server/` — Node.js API server and Ollama local LLM integration.

## Setup

1. Install Ollama from [ollama.com](https://ollama.com/).
2. Pull the default local model: `ollama pull qwen3:4b`.
3. Copy `server/.env.example` to `server/.env` if needed.
4. The backend resolves `OLLAMA_CHAT_MODEL` first, then the legacy `OLLAMA_MODEL` alias, and finally defaults to `qwen3:4b`.
5. Optionally copy `frontend/.env.example` to `frontend/.env` to change the API URL.

## Run

```bash
npm run dev:server
npm run dev:frontend
```

For local faster-whisper voice input, use a separate PowerShell terminal:

```powershell
cd stt-service
.\setup.ps1
.\start.ps1
```

Then start the Node server and frontend as usual. Check `http://127.0.0.1:8765/health` before testing voice. The normal flow is: Speak → Transcribing… → review/edit → Enter → existing Qwen streaming → existing browser TTS.

For local Kokoro voice output, use another PowerShell terminal:

```powershell
cd tts-service
.\setup.ps1
.\start.ps1
```

The setup keeps the model outside the repository at `D:\AI_Models\Kokoro`, downloads only missing assets, and starts the service on `http://127.0.0.1:8766`. Kokoro is the primary TTS path; browser Web Speech is the resilient fallback. Audio is synthesized in memory and is not persisted.

The frontend uses Vite. The backend runs on `http://localhost:3001` and talks to Ollama at `http://localhost:11434`.

## Repository hygiene

- `server/.env.example`, `stt-service/.env.example`, and `tts-service/.env.example` are safe configuration templates. Local `.env` files are intentionally ignored and must never be committed or included in a source export.
- Runtime dependencies, Python virtual environments, build output, logs, caches, downloaded model weights, archives, and database backups are local artifacts. They are excluded from clean source exports.
- The final database baseline is documented in `DATABASE_DESIGN_CURRENT.md`; use `database/schema.sql` for a fresh install, `database/PRECHECK_BEFORE_BASELINE.sql` before an existing-database cleanup, `database/migrations/003_finalize_ai_friend_baseline.sql` for the reviewed manual migration, and `database/VERIFY_AFTER_BASELINE.sql` afterward. Root-level SQL files, `database/ai_english_friend_current.sql`, `database/UPDATE_CURRENT_DATABASE.sql`, and migrations `001`/`002` remain historical references until the user verifies the new baseline.

## AI Engine

- `ChatProvider` currently wraps the local `OllamaChatProvider`; a future cloud provider can be added without changing chat persistence or memory code.
- Chat uses real Ollama NDJSON streaming at `POST /api/chat/stream`; `POST /api/chat` remains the compatibility non-streaming endpoint.
- `AI_STREAMING=true` selects the streaming endpoint; `AI_STREAMING=false` makes the frontend use the normal completed-response endpoint without a fake stream. The frontend reads this through `GET /api/config`.
- Default chat and translation model: `qwen3:4b`. Ordinary chat sends `think: false`; translation uses a deterministic low-temperature profile and the existing message translation cache.
- Low-memory local development may override only `server/.env` with `OLLAMA_CHAT_MODEL=qwen3:1.7b` and `OLLAMA_TRANSLATION_MODEL=qwen3:1.7b`; the product/source default remains `qwen3:4b`.
- `OLLAMA_NUM_CTX` defaults to `2048` to keep Qwen KV-cache memory bounded on local machines.
- Persona Brain V3 is deterministic and ephemeral. It combines persona, CEFR, recent messages, summary, relevant persona memory, relationship familiarity, mood and intent heuristics without an extra classifier call.
- Title, memory and summary work is queued with background priority and deferred while foreground AI generation is active.
- Voice input uses the local persistent `stt-service/` faster-whisper service as the primary STT path. The browser records a binary audio Blob, Node proxies it to Python, and the returned transcript stays in the existing editable voice draft until Enter is pressed.
- Browser `SpeechRecognition` remains the fallback when faster-whisper or MediaRecorder is unavailable. Voice never auto-sends after recording or transcription.
- Faster-whisper uses the current low-memory development profile `base.en` + CPU `int8` with `FASTER_WHISPER_PRELOAD=false` and is loaded on demand. `AI_RESOURCE_MODE=auto` selects low-memory mode below `AI_LOW_MEMORY_RAM_THRESHOLD_GB` (8 GB), coordinates Whisper/Qwen residency, and unloads idle Whisper after `STT_IDLE_UNLOAD_MS` (20 seconds). STT uses a runtime lease with `STT_LEASE_TIMEOUT_MS` (3 minutes); cancelled sessions release it safely. `small.en` remains an accuracy option and `medium.en` is for stronger hardware. The first load may download the model.

MySQL persistence is enabled. Each user/persona pair has a persistent conversation thread; messages, persona-isolated memories, summaries and adaptive re-entry state are stored in MySQL. TTS model residency is coordinated with Whisper and low-memory Ollama requests; after the configured idle window the Kokoro model is unloaded.

## Performance diagnostics

Batch 4.1 keeps a bounded in-memory performance snapshot at `GET http://localhost:3001/api/system/performance`. It records only timings, counts, status, and safe numeric sub-metrics; conversation text and audio are never stored. `GET /api/system/resources` also reports background queue state and foreground-pending state.

`AI_DEMO_MODE=false` is the default. When enabled, it only increases the background idle delay using `AI_DEMO_BACKGROUND_IDLE_DELAY_MS`; it does not fake responses, skip STT/Qwen/Kokoro, or disable memory, title, or summary maintenance.

For repeatable local measurements:

```powershell
.\scripts\benchmark-demo.ps1
.\scripts\benchmark-demo.ps1 -RunAll
```

Chat benchmark runs create clearly labelled development conversation messages. The script never simulates browser microphone input; the real voice regression remains a manual UI test.

## Verify

```bash
GET http://localhost:3001/health
POST http://localhost:3001/api/chat
```

The chat request accepts `message`, `level`, `conversationId`, `personaId`, `messageType`, and optional `audioDurationMs`. Conversations and messages persist in MySQL, and the same persona thread is shared by text and voice turns.

## Local development quick commands

Run these from any working directory by invoking the scripts with their path:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup-all.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup-all.ps1 -CheckOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-all.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\status.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\stop-all.ps1
```

If the local PowerShell execution policy already allows project scripts, the shorter `.\setup-all.ps1`, `.\start-all.ps1`, `.\status.ps1`, and `.\stop-all.ps1` forms are equivalent.

`setup-all.ps1` validates Node.js, npm, Python, Ollama, workspace dependencies, STT/TTS environments, configured models, and MySQL connectivity. It never imports `database/schema.sql` into an existing database by default. Use `-InitDatabase` only for a confirmed missing or empty `ai_english_friend` database; initialization refuses any database that already contains tables. Use `-PullModels` only when explicitly intending to download configured Ollama models.

Batch 4.3 adds hardware-aware startup profiles. `-Profile auto` detects total physical RAM in binary GiB and resolves `<6 GB` to `low-memory`, `6–<16 GB` to `standard`, and `>=16 GB` to `high-performance`. On detection failure it warns and safely falls back to `low-memory`. Explicit `standard` or `high-performance` starts refuse before launching services when the machine does not meet the RAM minimum. `-Profile custom` preserves the existing `.env` model and resource settings without runtime preset overrides.

Use the same profile on setup and start when needed:

```powershell
.\setup-all.cmd -CheckOnly -Profile auto
.\start-all.cmd -Profile auto
.\status.cmd
.\stop-all.cmd
```

The selected profile is injected into child processes without rewriting `.env` files. Active profile metadata is stored only in ignored `.runtime/hardware-profile.json`; it contains profile/model/resource settings and hardware facts, never secrets. A missing required Ollama model stops startup before the remaining stack is launched and prints the exact `ollama pull` command.

Batch 4.4 centralizes supported model selection in `config/model-config.defaults.json`. Copy `config/model-config.local.example.json` to the ignored `config/model-config.local.json` to make partial, machine-specific overrides; the local file is optional and must not contain secrets. The schema version is `1`, and supported providers are Ollama for chat/translation, faster-whisper for STT, and Kokoro for TTS. Preset model configuration takes precedence over existing `.env` model values; `custom` inherits `.env` unless its local profile contains an explicit override. Use `.\check-models.cmd -Profile auto` to validate configured Ollama availability and Kokoro assets without downloading anything. Only `setup-all.cmd -PullModels` may pull configured Ollama models.

The safe runtime model summary is available at `GET http://localhost:3001/api/system/models`. It reports provider names, model identifiers, asset basenames, and the normalized configuration fingerprint; it never reports full private paths, credentials, database data, or conversation content.

For a sanitized source handoff, run `.\package-source.cmd` from a clean Git working tree. It writes the tracked-source ZIP, SHA-256 checksum, and package manifest to the ignored `.packages/` directory and validates the extracted archive before returning success.

The setup layer never installs system software automatically, never overwrites existing `.env` files, never manages the MySQL Windows service, and does not change application runtime behavior. `start-all.ps1` reuses healthy external Ollama/STT/TTS services and records only project-started process ownership under ignored `.runtime/`. `stop-all.ps1` stops only verified project-owned processes.

The `.cmd` launchers (`setup-all.cmd`, `start-all.cmd`, `status.cmd`, and `stop-all.cmd`) run the same PowerShell source scripts with process-local `-ExecutionPolicy Bypass`, forward arguments, and return the PowerShell exit code. They do not change machine or user execution policy and do not require Administrator access.

For an isolated fresh-schema check, run `node scripts/test-init-database-disposable.js`. It uses only the clearly named disposable database `ai_english_friend_setup_test`, refuses to touch it if it already exists, verifies the 7-table baseline and second-run refusal, then removes only that disposable database.
