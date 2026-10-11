# Troubleshooting

Use the project-owned diagnostics first. Do not terminate all Node/Python processes, delete databases, or remove environments as a generic fix.

## Start with status

```powershell
.\status.cmd
```

The status output distinguishes `PROJECT-OWNED` services from `EXTERNAL / PRE-EXISTING` services. Project scripts intentionally leave external Ollama, MySQL, and unrelated processes untouched.

## Setup reports a missing command

Install the missing prerequisite and rerun setup:

- Node.js 20+ provides `node` and npm.
- Python 3.10+ provides `python`.
- Ollama provides the local Ollama command and API.
- MySQL must be installed and running separately; it is checked through the configured database values.

Use the `.cmd` wrappers when PowerShell execution policy blocks a `.ps1` launcher:

```powershell
.\setup-all.cmd -CheckOnly -Profile auto
```

## Local `.env` files are missing or contain placeholders

Normal setup creates missing files from tracked `.env.example` templates. `-CheckOnly` does not create them. Review `server/.env`, especially `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`, then rerun setup. Do not copy real values into the tracked examples.

## MySQL is unavailable or the database is incomplete

Run the read-only check:

```powershell
node scripts/check-database.js
```

Confirm that MySQL is running and that the local `server/.env` values are correct. A fresh initialization is only for a confirmed missing or empty target:

```powershell
.\setup-all.cmd -Profile auto -InitDatabase
```

Initialization refuses a database that already contains tables. Never drop an existing database as a troubleshooting shortcut.

## Ollama is unavailable or a model is missing

Check the API and configured profile:

```powershell
.\check-models.cmd -Profile auto
```

Start Ollama separately. If the check names a missing model, explicitly pull it through setup:

```powershell
.\setup-all.cmd -Profile auto -PullModels
```

`start-all.cmd` does not silently download models or substitute an unconfigured model.

## Hardware Profile refuses to start

Explicit `standard` requires at least 6 GiB RAM; explicit `high-performance` requires at least 16 GiB. Use `low-memory` on a smaller machine, or use `auto` so the resolver chooses safely. If hardware detection fails, `auto` falls back to `low-memory`.

`custom` is intended for advanced manual settings. It does not remove model, memory, or service safety checks.

## Active profile or model fingerprint mismatch

This is intentional protection against running a mixed stack. Stop project-owned services, edit the configuration, check the desired profile, and start again:

```powershell
.\stop-all.cmd
.\check-models.cmd -Profile standard
.\start-all.cmd -Profile standard
```

Do not bypass the mismatch by killing unrelated processes or deleting runtime metadata manually.

## Port conflict or external service detected

Default ports are backend `3001`, frontend `5173`, STT `8765`, TTS `8766`, and Ollama `11434`. `status.cmd` identifies services that are reachable but not owned by this project. Verify that the external service is the intended one, or stop it through its own management process before retrying.

Do not use broad commands such as `taskkill /IM node.exe`.

## Frontend is unavailable

Confirm that `start-all.cmd` completed and that `status.cmd` reports the frontend ready. The frontend normally listens at `http://127.0.0.1:5173/`. If the backend address differs, review `frontend/.env` and `VITE_API_URL`.

## STT is degraded or unavailable

The backend uses faster-whisper at `http://127.0.0.1:8765` by default and the browser SpeechRecognition fallback may remain available. Check:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/stt/health
```

For local STT setup, review `stt-service/.env`, the Python environment, `FASTER_WHISPER_MODEL`, and the CPU/`int8` settings. The first model load may download external model data. Do not expect model binaries in the source ZIP.

## TTS is degraded, voices are missing, or synthesis fails

Check the TTS service and voice list:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/tts/health
Invoke-RestMethod http://127.0.0.1:3001/api/tts/voices
```

Review `KOKORO_MODEL_PATH` and `KOKORO_VOICES_PATH` in `tts-service/.env` or the active model configuration. Relative paths resolve against `tts-service`. The browser Web Speech fallback may still operate when Kokoro is unavailable.

## Model configuration validation fails

Check that the JSON is valid schema version `1`, uses only supported profiles/components, and has valid model identifiers or TTS paths. Compare the local file with `config/model-config.local.example.json`. Restart after corrections; there is no live model hot-swap.

## Packaging refuses to run

Normal source packaging requires a clean Git working tree:

```powershell
.\package-source.cmd
```

This refusal is expected when documentation or other changes are uncommitted. Do not weaken the production behavior or recursively ZIP the workspace. After the changes are committed, rerun the command from the clean repository and verify the ZIP, checksum, manifest, and extraction validation.

## Packaging or delivery security concern

The source package must not contain real `.env` files, `config/model-config.local.json`, `.runtime/`, `.packages/`, environments, logs, database dumps, user data, `.git/`, or model binaries. If any appears in a package, stop delivery and investigate the source selection before distributing it.
