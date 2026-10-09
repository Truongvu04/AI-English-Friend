import asyncio
import io
import os
import re
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from faster_whisper import WhisperModel


def load_env_file():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file()

MODEL_NAME = os.getenv("FASTER_WHISPER_MODEL", "base.en")
LANGUAGE = os.getenv("FASTER_WHISPER_LANGUAGE", "en")
DEVICE = os.getenv("FASTER_WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("FASTER_WHISPER_COMPUTE_TYPE", "int8")
PRELOAD = os.getenv("FASTER_WHISPER_PRELOAD", "false").lower() == "true"
BEAM_SIZE = int(os.getenv("FASTER_WHISPER_BEAM_SIZE", "5"))
VAD_FILTER = os.getenv("FASTER_WHISPER_VAD_FILTER", "true").lower() == "true"
MIN_SILENCE_MS = int(os.getenv("FASTER_WHISPER_MIN_SILENCE_MS", "500"))
MAX_AUDIO_BYTES = int(os.getenv("FASTER_WHISPER_MAX_AUDIO_BYTES", str(20 * 1024 * 1024)))
HOST = os.getenv("FASTER_WHISPER_HOST", "127.0.0.1")
PORT = int(os.getenv("FASTER_WHISPER_PORT", "8765"))

model = None
model_status = "unloaded"
model_error_code = None
model_error_message = None
model_operation_lock = asyncio.Lock()
transcription_lock = asyncio.Lock()


def normalize_text(parts):
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def transcribe_sync(audio_bytes):
    segments, info = model.transcribe(
        io.BytesIO(audio_bytes),
        language=LANGUAGE,
        beam_size=BEAM_SIZE,
        vad_filter=VAD_FILTER,
        vad_parameters={"min_silence_duration_ms": MIN_SILENCE_MS},
        word_timestamps=False,
    )
    parts = [segment.text for segment in segments]
    text = normalize_text(parts)
    duration = float(getattr(info, "duration", 0.0) or 0.0)
    return text, duration


def safe_load_error(error):
    detail = str(error).lower()
    if "memory" in detail or "allocate" in detail or "out of" in detail:
        return "STT_MODEL_LOAD_FAILED", "Speech model could not be loaded on this machine"
    return "STT_MODEL_LOAD_FAILED", "Speech model could not be loaded"


def load_model_sync():
    return WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE)


async def load_model():
    global model, model_status, model_error_code, model_error_message
    if model_status == "ready" and model is not None:
        return
    model_status = "loading"
    model_error_code = None
    model_error_message = None
    started_at = time.perf_counter()
    try:
        model = await asyncio.to_thread(load_model_sync)
        model_status = "ready"
        print(f"[stt] model ready: {MODEL_NAME} device={DEVICE} compute_type={COMPUTE_TYPE} load_ms={round((time.perf_counter() - started_at) * 1000)}", flush=True)
    except Exception as error:
        model = None
        model_error_code, model_error_message = safe_load_error(error)
        model_status = "error"
        print(f"[stt] model failed to load: {error}", flush=True)
        raise HTTPException(status_code=503, detail={"code": model_error_code, "message": model_error_message}) from error


async def unload_model():
    global model, model_status, model_error_code, model_error_message
    async with model_operation_lock:
        async with transcription_lock:
            model = None
            model_status = "unloaded"
            model_error_code = None
            model_error_message = None
            import gc
            gc.collect()
            print("[stt] model unloaded", flush=True)


@asynccontextmanager
async def lifespan(_app):
    if PRELOAD:
        async with model_operation_lock:
            try:
                await load_model()
            except HTTPException:
                pass
    yield


app = FastAPI(title="AI English Friend faster-whisper STT", lifespan=lifespan)


@app.get("/health")
async def health():
    return {
        "status": "ready",
        "serviceStatus": "ready",
        "modelStatus": model_status,
        "modelErrorCode": model_error_code,
        "modelError": model_error_message,
        "provider": "faster-whisper",
        "model": MODEL_NAME,
        "device": DEVICE,
        "computeType": COMPUTE_TYPE,
    }


@app.post("/model/load")
async def model_load():
    async with model_operation_lock:
        await load_model()
    return {"status": "ready", "modelStatus": model_status, "model": MODEL_NAME}


@app.post("/model/unload")
async def model_unload():
    await unload_model()
    return {"status": "ready", "modelStatus": model_status, "model": MODEL_NAME}


@app.post("/transcribe")
async def transcribe(request: Request):
    global model_status
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_AUDIO_BYTES:
                raise HTTPException(status_code=413, detail={"code": "STT_INVALID_AUDIO", "message": "Audio recording is too large"})
        except ValueError as error:
            raise HTTPException(status_code=400, detail={"code": "STT_INVALID_AUDIO", "message": "Invalid content length"}) from error
    audio_bytes = await request.body()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail={"code": "STT_INVALID_AUDIO", "message": "Audio recording is empty"})
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail={"code": "STT_INVALID_AUDIO", "message": "Audio recording is too large"})

    async with model_operation_lock:
        if model is None or model_status != "ready":
            raise HTTPException(status_code=503, detail={"code": "STT_MODEL_NOT_READY", "message": "Speech model is not ready"})
        started_at = time.perf_counter()
        previous_status = model_status
        model_status = "transcribing"
        try:
            async with transcription_lock:
                text, duration = await asyncio.to_thread(transcribe_sync, audio_bytes)
        except Exception as error:
            print(f"[stt] transcription failed: {error}", flush=True)
            detail = str(error).lower()
            code = "STT_INVALID_AUDIO" if "audio" in detail or "decode" in detail else "STT_TRANSCRIPTION_FAILED"
            model_status = "ready"
            raise HTTPException(status_code=422, detail={"code": code, "message": "Audio could not be transcribed"}) from error
        finally:
            if model_status == "transcribing":
                model_status = previous_status

    if not text:
        raise HTTPException(status_code=422, detail={"code": "STT_NO_SPEECH", "message": "No speech was detected"})

    processing_ms = round((time.perf_counter() - started_at) * 1000)
    print(f"[stt] transcription: {processing_ms}ms", flush=True)
    return {
        "text": text,
        "language": LANGUAGE,
        "duration": duration,
        "processingMs": processing_ms,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)
