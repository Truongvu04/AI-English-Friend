# Buyer Guide

This guide is for a developer receiving the AI English Friend source package. It describes the current Windows-oriented local workflow and avoids assuming access to the original developer's machine, credentials, model cache, or Git repository.

## 1. What you received

The source delivery contains the React/Vite frontend, Node.js backend, Python STT/TTS services, orchestration scripts, configuration templates, database schema, tests, and documentation.

The source delivery does not contain real `.env` files, the ignored local model override, Git metadata, `node_modules`, Python virtual environments, runtime state, logs, database dumps, user data, or model binaries. Ollama, MySQL, faster-whisper model files, and Kokoro assets are external prerequisites.

## 2. System overview

The frontend talks to the local Node.js backend. The backend owns persistence, personas, memory, translation, re-entry behavior, resource coordination, and calls to Ollama, faster-whisper, and Kokoro. The browser can fall back to browser speech features when the configured local voice service is unavailable.

## 3. Prerequisites

Install these before setup:

- Windows PowerShell and Command Prompt.
- Node.js 20 or newer, with npm.
- Python 3.10 or newer.
- MySQL, running separately from the project.
- Ollama, running locally or at the URL configured in `server/.env`.

The setup script checks Node.js, npm, Python, and Ollama. It creates project-local Python virtual environments and installs the pinned Python requirements when they are missing. It does not install system software or manage the MySQL Windows service.

## 4. First setup

From the extracted project root, run a safe preflight first:

```powershell
.\setup-all.cmd -CheckOnly -Profile auto
```

`-CheckOnly` does not create files, install dependencies, start services, or modify the database. Missing local `.env` files are reported without being created.

Run the real setup after reviewing the reported prerequisites:

```powershell
.\setup-all.cmd -Profile auto
```

When a local `.env` file is missing, setup creates it from the corresponding `.env.example` and preserves it on later runs. Review the generated files, especially `server/.env`, and enter the required MySQL connection values. Rerun setup after editing them. Never commit the resulting `.env` files.

Setup validates the Node workspace, STT/TTS environments, model configuration, Ollama availability, Kokoro assets, and database connectivity. It does not initialize an existing database unless `-InitDatabase` is explicitly supplied.

## 5. Database requirements

The fresh-install structure is [database/schema.sql](../database/schema.sql). The current baseline contains exactly seven core tables:

`users`, `user_settings`, `ai_personas`, `user_persona_settings`, `conversations`, `messages`, and `memories`.

The read-only check is:

```powershell
node scripts/check-database.js
```

Setup runs the equivalent check automatically. A fresh initialization is intentionally guarded:

```powershell
.\setup-all.cmd -Profile auto -InitDatabase
```

Use this only for a confirmed missing or empty `ai_english_friend` database. Initialization refuses a database that already contains tables. Do not drop or erase an existing database as part of normal setup.

## 6. Ollama and model setup

Start Ollama separately and verify the configured model profile:

```powershell
.\check-models.cmd -Profile auto
```

The check is read-only and does not start the application or download models. If a required Ollama model is missing, pull it explicitly:

```powershell
.\setup-all.cmd -Profile auto -PullModels
```

`start-all.cmd` never silently downloads multi-gigabyte Ollama models. Missing required models block startup.

## 7. Starting and checking the application

Start the stack with one profile:

```powershell
.\start-all.cmd -Profile auto
.\status.cmd
```

The default addresses are:

- Frontend: `http://127.0.0.1:5173/`
- Backend: `http://127.0.0.1:3001/`
- Ollama: `http://127.0.0.1:11434/`
- faster-whisper service: `http://127.0.0.1:8765/health`
- Kokoro service: `http://127.0.0.1:8766/health`

Open the frontend only after `status.cmd` reports it ready. Stop the project safely with:

```powershell
.\stop-all.cmd
```

Stop only verified project-owned processes. External/pre-existing Ollama, MySQL, or services on configured ports are intentionally left untouched.

## 8. Hardware Profiles

Supported profiles are `auto`, `low-memory`, `standard`, `high-performance`, and `custom`.

`auto` resolves by total physical RAM:

- below 6 GiB: `low-memory`
- 6 GiB to below 16 GiB: `standard`
- 16 GiB or more: `high-performance`

If Windows hardware detection fails, `auto` safely falls back to `low-memory`. Explicit `standard` requires at least 6 GiB and explicit `high-performance` requires at least 16 GiB; startup refuses below those thresholds. `custom` preserves environment-driven resource settings for advanced users.

A Hardware Profile controls resource policy, preload behavior, and idle-unload timing. Model Configuration separately determines the model and asset identifiers selected for a profile.

## 9. Model Configuration

The tracked defaults are in [config/model-config.defaults.json](../config/model-config.defaults.json). The optional template is [config/model-config.local.example.json](../config/model-config.local.example.json). To customize only selected values:

```powershell
Copy-Item config/model-config.local.example.json config/model-config.local.json
```

The new local file is ignored by Git and is not part of a source package. Edit only the fields you intend to override, then stop and restart the application:

```powershell
.\stop-all.cmd
# edit config/model-config.local.json
.\start-all.cmd -Profile standard
```

There is no live model hot-swap. Startup records a configuration fingerprint and refuses to run a mismatched active stack until the existing project-owned services are stopped.

## 10. Voice services

Speech-to-text uses faster-whisper with the default `base.en` model, CPU execution, and `int8` compute. The model loads on demand unless a profile or local configuration enables preload. The first model load may download external model data.

Text-to-speech uses Kokoro with the `kokoro-v1.0.int8.onnx` model and `voices-v1.0.bin` voice asset. These assets are external and are not included in the source package. The service loads them on demand. Browser SpeechRecognition and browser Web Speech are resilient fallbacks when enabled in configuration.

Voice input remains editable after transcription; it is not automatically sent merely because recording ended.

## 11. Normal daily workflow

```powershell
.\start-all.cmd -Profile auto
.\status.cmd
# use http://127.0.0.1:5173/
.\stop-all.cmd
```

Use the same profile for setup, model checking, and startup when diagnosing a profile-specific problem.

## 12. Packaging and re-delivery

`package-source.cmd` is a source-maintainer tool. It relies on Git metadata and requires a clean working tree by default. It creates a sanitized ZIP, checksum, and manifest under ignored `.packages/`. A buyer ZIP excludes `.git/`, so a recipient should not expect to run the packaging command directly without placing the source in a Git repository.

For troubleshooting, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md). For configuration details, see [CONFIGURATION_GUIDE.md](CONFIGURATION_GUIDE.md). License status and third-party responsibilities are covered by [LICENSE_STATUS.md](LICENSE_STATUS.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
