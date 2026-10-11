# Third-Party Notices

This is an inventory of third-party technologies visible in the current source manifests. It is not a replacement for upstream license review and does not grant redistribution rights.

## JavaScript workspace

Versions and ranges below come from the tracked `package.json` files and `package-lock.json`:

- React and React DOM — frontend runtime.
- Vite and `@vitejs/plugin-react` — frontend development/build tooling.
- TypeScript — frontend type checking/build tooling.
- ESLint, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`, and Node type packages — lint/type tooling.
- `dotenv` — server environment loading.
- `mysql2` — Node/MySQL client.

The repository does not include a consolidated upstream license notice for these packages. Verify the installed package metadata and upstream notices before redistribution.

## Python services

The tracked requirements declare:

| Component | Declared requirement | Role |
| --- | --- | --- |
| faster-whisper | `1.2.1` | STT inference |
| av | `>=11,<19` | Audio decoding support |
| FastAPI | `0.115.6` | Python service API framework |
| uvicorn | `0.34.0` | ASGI server |
| kokoro-onnx | `0.6.1` | Kokoro ONNX runtime |
| numpy | `>=1.26,<3` | Numerical dependency for TTS/runtime support |

The requirements files establish versions, not complete redistribution clearance. Verify each package's current upstream license and notice requirements.

## External software and services

- Ollama is an external local inference service.
- MySQL is an external database service.
- Node.js, npm, Python, and PowerShell are host prerequisites.
- Browser SpeechRecognition and Web Speech are platform/browser capabilities used as fallbacks when enabled.

Their licenses and terms are not established by this repository's tracked manifests.

## External models and assets

- Ollama chat and translation models are selected by configuration, with current defaults including Qwen model identifiers. Model terms must be reviewed upstream.
- faster-whisper model identifiers such as `base.en` refer to external model data downloaded or cached outside the source package.
- Kokoro uses external `kokoro-v1.0.int8.onnx` and `voices-v1.0.bin` assets. The source package does not include them.

AI English Friend did not train these models and does not claim ownership of their weights. Model and voice-asset redistribution rights are not locally verified.

## Verification status

No legal conclusion is made here. License identifiers should not be copied from memory or treated as verified solely because a dependency is present in a local environment. The owner should obtain current upstream notices and include any required notices or attributions with the final commercial/public delivery.
