import asyncio
import gc
import io
import os
import time
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

try:
    import kokoro_onnx
    from kokoro_onnx import Kokoro
except Exception as import_error:  # pragma: no cover - surfaced through health/load
    Kokoro = None
    KOKORO_IMPORT_ERROR = str(import_error)
else:
    KOKORO_IMPORT_ERROR = None

MODEL_PATH = os.getenv("KOKORO_MODEL_PATH", str(Path(__file__).parent / "models" / "kokoro-v1.0.int8.onnx"))
VOICES_PATH = os.getenv("KOKORO_VOICES_PATH", str(Path(__file__).parent / "models" / "voices-v1.0.bin"))
HOST = os.getenv("KOKORO_HOST", "127.0.0.1")
PORT = int(os.getenv("KOKORO_PORT", "8766"))
PRELOAD = os.getenv("KOKORO_PRELOAD", "false").lower() == "true"
LANGUAGE = os.getenv("KOKORO_LANGUAGE", "en-us")
MAX_TEXT_CHARS = int(os.getenv("KOKORO_MAX_TEXT_CHARS", "4000"))
INTRA_OP_THREADS = max(1, int(os.getenv("KOKORO_INTRA_OP_THREADS", "2")))
PRECISION = "int8"


class SynthesizeRequest(BaseModel):
    text: str
    voice: str = "am_michael"
    speed: float = Field(default=1.0, ge=0.75, le=1.25)
    language: str = LANGUAGE


class KokoroRuntime:
    def __init__(self) -> None:
        self.model: Any | None = None
        self.model_status = "unloaded"
        self.error_code: str | None = None
        self.error: str | None = None
        self.model_lock = asyncio.Lock()
        self.synthesis_lock = asyncio.Lock()
        self.voice_cache: list[str] | None = None

    def health(self) -> dict[str, Any]:
        return {
            "status": "ready",
            "serviceStatus": "ready",
            "modelStatus": self.model_status,
            "provider": "kokoro",
            "model": Path(MODEL_PATH).name,
            "precision": PRECISION,
            "language": LANGUAGE,
            "errorCode": self.error_code,
            "error": self.error,
        }

    def voices(self) -> list[str]:
        if self.voice_cache is not None:
            return self.voice_cache
        path = Path(VOICES_PATH)
        if not path.exists():
            raise RuntimeError(f"Voice asset not found: {path}")
        with np.load(path, allow_pickle=False) as archive:
            self.voice_cache = sorted(str(name) for name in archive.files)
        return self.voice_cache

    async def load(self) -> dict[str, Any]:
        async with self.model_lock:
            if self.model is not None and self.model_status in {"ready", "synthesizing"}:
                return self.health()
            self.model_status = "loading"
            self.error_code = None
            self.error = None
            try:
                if Kokoro is None:
                    raise RuntimeError(KOKORO_IMPORT_ERROR or "kokoro-onnx is unavailable")
                if not Path(MODEL_PATH).exists():
                    raise FileNotFoundError(MODEL_PATH)
                if not Path(VOICES_PATH).exists():
                    raise FileNotFoundError(VOICES_PATH)
                self.voices()
                import onnxruntime as ort
                options = ort.SessionOptions()
                options.intra_op_num_threads = INTRA_OP_THREADS
                def configured_session(model_path: str):
                    return ort.InferenceSession(
                        model_path,
                        sess_options=options,
                        providers=["CPUExecutionProvider"],
                    )
                kokoro_onnx.create_session = configured_session
                self.model = Kokoro(
                    MODEL_PATH,
                    VOICES_PATH,
                )
                self.model_status = "ready"
                return self.health()
            except Exception as error:
                self.model = None
                self.model_status = "error"
                self.error_code = "TTS_MODEL_LOAD_FAILED"
                self.error = str(error)
                raise

    async def unload(self) -> dict[str, Any]:
        # Keep the lock order synthesis -> model so unload never releases a model
        # while an ONNX inference is still using it.
        async with self.synthesis_lock:
            async with self.model_lock:
                self.model_status = "unloading"
                model = self.model
                self.model = None
                try:
                    close = getattr(model, "close", None)
                    if callable(close):
                        close()
                finally:
                    gc.collect()
                    self.model_status = "unloaded"
                    self.error_code = None
                    self.error = None
        return self.health()

    async def synthesize(self, request: SynthesizeRequest) -> tuple[bytes, float, float, int]:
        text = request.text.strip()
        if not text:
            raise HTTPException(400, detail={"code": "TTS_INVALID_TEXT", "error": "Text is required"})
        if len(text) > MAX_TEXT_CHARS:
            raise HTTPException(400, detail={"code": "TTS_INVALID_TEXT", "error": "Text is too long"})
        if request.language.lower() != LANGUAGE.lower():
            raise HTTPException(400, detail={"code": "TTS_INVALID_TEXT", "error": "Only en-us is supported"})
        if request.voice not in self.voices():
            raise HTTPException(400, detail={"code": "TTS_INVALID_VOICE", "error": "Voice is not available"})
        if not 0.75 <= request.speed <= 1.25:
            raise HTTPException(400, detail={"code": "TTS_INVALID_TEXT", "error": "Speed must be between 0.75 and 1.25"})
        async with self.synthesis_lock:
            if self.model is None or self.model_status != "ready":
                try:
                    await self.load()
                except Exception as error:
                    raise HTTPException(503, detail={"code": "TTS_MODEL_NOT_READY", "error": "Kokoro model is not ready"}) from error
            self.model_status = "synthesizing"
            started = time.perf_counter()
            inference = asyncio.create_task(asyncio.to_thread(
                self.model.create,
                text,
                voice=request.voice,
                speed=request.speed,
                lang=request.language,
            ))
            try:
                try:
                    samples, sample_rate = await asyncio.shield(inference)
                except asyncio.CancelledError:
                    # ONNX work is not interruptible from Python. Wait for the worker
                    # thread before releasing synthesis_lock so unload remains safe.
                    await asyncio.shield(inference)
                    raise
                audio = np.asarray(samples, dtype=np.float32)
                audio = np.clip(audio, -1.0, 1.0)
                pcm = (audio * 32767).astype(np.int16).tobytes()
                output = io.BytesIO()
                with wave.open(output, "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(int(sample_rate))
                    wav.writeframes(pcm)
                duration_ms = len(audio) / int(sample_rate) * 1000
                processing_ms = (time.perf_counter() - started) * 1000
                return output.getvalue(), duration_ms, processing_ms, int(sample_rate)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self.model_status = "error"
                self.error_code = "TTS_SYNTHESIS_FAILED"
                self.error = str(error)
                raise HTTPException(503, detail={"code": "TTS_SYNTHESIS_FAILED", "error": "Speech synthesis failed"}) from error
            finally:
                if self.model is not None and self.model_status == "synthesizing":
                    self.model_status = "ready"


runtime = KokoroRuntime()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if PRELOAD:
        try:
            await runtime.load()
        except Exception:
            pass
    yield
    await runtime.unload()


app = FastAPI(title="AI English Friend Kokoro TTS", lifespan=lifespan)


@app.get("/health")
async def health():
    return runtime.health()


@app.get("/voices")
async def voices():
    try:
        return {"voices": runtime.voices(), "language": LANGUAGE}
    except Exception as error:
        raise HTTPException(503, detail={"code": "TTS_SERVICE_UNAVAILABLE", "error": "Voice assets are unavailable"}) from error


@app.post("/model/load")
async def load_model():
    try:
        return await runtime.load()
    except Exception as error:
        raise HTTPException(503, detail={"code": "TTS_MODEL_LOAD_FAILED", "error": "Kokoro model could not be loaded"}) from error


@app.post("/model/unload")
async def unload_model():
    return await runtime.unload()


@app.post("/synthesize")
async def synthesize(request: SynthesizeRequest):
    audio, duration_ms, processing_ms, sample_rate = await runtime.synthesize(request)
    return Response(
        content=audio,
        media_type="audio/wav",
        headers={
            "X-TTS-Duration-Ms": str(round(duration_ms)),
            "X-TTS-Processing-Ms": str(round(processing_ms)),
            "X-TTS-Voice": request.voice,
            "X-TTS-Sample-Rate": str(sample_rate),
        },
    )
