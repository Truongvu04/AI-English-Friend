# Local faster-whisper STT service

This is the persistent local speech-to-text service for AI English Friend. The Python process stays alive while the Whisper model is loaded and unloaded on demand. Node.js is the only client; the browser never calls this service directly.

Requirements:

- Python 3.10 or newer compatible with the pinned dependencies
- Windows PowerShell
- `faster-whisper==1.2.1` with `av>=11,<19`; faster-whisper 1.2.1 still passes `metadata_errors` to `av.open`, which is not supported by PyAV 19.

Setup:

```powershell
cd stt-service
.\setup.ps1
```

`setup.ps1` installs the pinned requirements, runs `pip check`, and prints the installed Python package versions. To verify an existing environment manually:

```powershell
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -c "import importlib.metadata as m; print('faster-whisper', m.version('faster-whisper')); print('av', m.version('av'))"
```

Start the service:

```powershell
.\start.ps1
```

Verify service health at `http://127.0.0.1:8765/health`. The service stays alive with the model unloaded and loads it through `/model/load` when Node prepares a recording. The low-memory profile uses `base.en` on CPU with `int8`; `small.en` and `medium.en` remain explicit quality options for suitable hardware. The first load may download the model:

```text
FASTER_WHISPER_MODEL=base.en
FASTER_WHISPER_DEVICE=cpu
FASTER_WHISPER_COMPUTE_TYPE=int8
FASTER_WHISPER_PRELOAD=false
```

The transcription endpoint accepts raw audio bytes at `POST /transcribe`. It uses English language forcing, beam size 5, VAD with a 500 ms minimum silence duration, and no word timestamps. Audio is processed in memory and is not persisted.

Node owns the runtime STT lease. A lease is created by `/api/stt/prepare`, sent to Node as `X-STT-Lease-Id` for transcription, and released through `/api/stt/release`. The lease expires automatically if the frontend disappears.
