# AI English Friend

AI English Friend is a local-first AI conversation companion for English practice. It is an AI friend first, not a formal teacher or hosted SaaS product. The current UI provides five fixed personas: Humorous Friend, Serious Friend, Empathetic Friend, Motivating Friend, and Thoughtful Friend.

The application runs locally on Windows-oriented PowerShell/CMD orchestration:

```text
Frontend (React + Vite)
        ↓
Backend (Node.js)
        ↓
Persona / Memory / Translation / Re-entry
        ↓
Hardware Profile + Model Configuration
        ↓
Resource Manager
        ↓
Ollama / faster-whisper / Kokoro
```

## Current providers

- Chat: Ollama
- Translation: Ollama
- Speech-to-text: faster-whisper
- Text-to-speech: Kokoro, with browser Web Speech fallback when enabled

Qwen, faster-whisper models, and Kokoro assets are external pretrained technologies integrated by this project. They are not trained or owned by AI English Friend.

## Quick start

The supported operational workflow is Windows-oriented. Install PowerShell, Node.js 20+, npm, Python 3.10+, MySQL, and Ollama first. The setup script validates the required commands and installs the locked Node/Python workspace dependencies when needed.

From the project root:

```powershell
.\setup-all.cmd -CheckOnly -Profile auto
.\setup-all.cmd -Profile auto
.\check-models.cmd -Profile auto
.\start-all.cmd -Profile auto
.\status.cmd
```

Open `http://127.0.0.1:5173/` after the frontend reports ready. Stop only project-owned services with:

```powershell
.\stop-all.cmd
```

If the first non-check setup creates `.env` files from the tracked examples, review the generated local configuration and rerun setup after entering the required MySQL values. Setup preserves existing `.env` files.

Missing Ollama models block startup. Pull them only when explicitly intended:

```powershell
.\setup-all.cmd -Profile auto -PullModels
```

## Documentation

- [Buyer Guide](docs/BUYER_GUIDE.md) — installation, first run, daily operation, and safe updates.
- [Configuration Guide](docs/CONFIGURATION_GUIDE.md) — environment variables, Hardware Profiles, and Model Configuration.
- [Troubleshooting](docs/TROUBLESHOOTING.md) — practical diagnostics and safe remediation.
- [Technical Overview](docs/TECHNICAL_OVERVIEW.md) — architecture, services, endpoints, and data flow.
- [Delivery Checklist](docs/DELIVERY_CHECKLIST.md) — source handoff and recipient verification.
- [License Status](docs/LICENSE_STATUS.md) — current project-license state.
- [Third-Party Notices](docs/THIRD_PARTY_NOTICES.md) — dependency, runtime, and model inventory.

## Source packaging

Maintainers can create a sanitized source package from a clean Git working tree:

```powershell
.\package-source.cmd
```

The command writes the ZIP, SHA-256 checksum, and manifest to ignored `.packages/`. It requires Git metadata and is therefore a source-maintainer workflow; a buyer ZIP intentionally does not contain `.git/` and should not be expected to repackage itself without being placed in a Git working tree.

## Repository boundaries

The source package contains source, configuration templates, scripts, schema, and documentation. It does not contain real `.env` files, local model overrides, `.runtime/`, `.packages/`, `node_modules`, Python virtual environments, logs, database dumps, user data, or model binaries. External model assets and MySQL are not bundled.

The project does not currently include a `LICENSE`, `NOTICE`, or other project-license file. See [License Status](docs/LICENSE_STATUS.md) before redistribution or commercial delivery. Third-party and model licensing must be reviewed separately; see [Third-Party Notices](docs/THIRD_PARTY_NOTICES.md).
