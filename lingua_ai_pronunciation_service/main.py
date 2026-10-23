"""Internal pronunciation service; importing this module never loads Whisper."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hmac
import json
import logging
import re
import time
import uuid
import av

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser
from python_multipart.exceptions import MultipartParseError

from audio import ServiceError, decode_audio
from config import Settings

logger = logging.getLogger("pronunciation")


def event(name, request_id=None, category=None, duration=None):
    # Only fixed categories, safe request IDs and numeric durations; no object dumps.
    record = {"timestamp": datetime.now(timezone.utc).isoformat(), "event": name}
    if request_id:
        record["requestId"] = request_id
    if category:
        record["category"] = category
    if duration is not None:
        record["durationMs"] = round(duration * 1000)
    try:
        logger.info(json.dumps(record))
    except Exception:
        pass  # Diagnostic sink failure must not change inference/lifecycle outcomes.


def load_model(settings):
    # Library warnings/debug may include model paths or decoded text. Our fixed
    # events replace those diagnostics; never enable transcript logging by default.
    logging.getLogger("faster_whisper").disabled = True
    from faster_whisper import WhisperModel
    return WhisperModel(settings.model, device=settings.device, compute_type=settings.compute_type,
                        download_root=settings.cache, local_files_only=not settings.allow_download,
                        cpu_threads=2, num_workers=1)


class BoundedParser(MultiPartParser):
    """Pinned Starlette parser with bounded bytes, headers, fields and cleanup."""
    def __init__(self, headers, stream, maximum):
        super().__init__(headers, stream, max_files=1, max_fields=1, max_part_size=32)
        self.maximum = maximum
        self.file_bytes = 0
        self.header_bytes = 0
        self.complete = False

    def on_part_data(self, data, start, end):
        if self._current_part.file is not None:
            self.file_bytes += end - start
            if self.file_bytes > self.maximum:
                raise ServiceError("AUDIO_TOO_LARGE", 413)
        super().on_part_data(data, start, end)

    def on_header_field(self, data, start, end):
        self.check_header(end - start)
        super().on_header_field(data, start, end)

    def on_header_value(self, data, start, end):
        self.check_header(end - start)
        super().on_header_value(data, start, end)

    def check_header(self, size):
        self.header_bytes += size
        if self.header_bytes > 4096:
            raise ServiceError("INVALID_AUDIO")

    def on_end(self):
        self.complete = True
        super().on_end()

    def close_files(self):
        for file in self._files_to_close_on_error:
            try:
                file.close()
            except Exception:
                event("temp.cleanup_failed", category="TEMP_STORAGE_FAILURE")


class Runtime:
    def __init__(self, settings, loader):
        self.settings = settings
        self.loader = loader
        self.executor = ThreadPoolExecutor(max_workers=settings.concurrency, thread_name_prefix="inference")
        self.model = None
        self.stopping = False
        self.active = 0
        self.pending = set()

    @property
    def ready(self):
        return self.model is not None and not self.stopping

    async def start(self):
        future = asyncio.get_running_loop().run_in_executor(self.executor, self.loader, self.settings)
        self.track(future)
        try:
            model = await asyncio.wait_for(asyncio.shield(future), self.settings.model_load_timeout)
            if not self.stopping:
                self.model = model
                event("model.ready")
        except (Exception, asyncio.CancelledError):
            event("model.unavailable", category="MODEL_NOT_READY")

    def track(self, future):
        self.pending.add(future)

        def done(completed):
            self.pending.discard(completed)
            if not completed.cancelled():
                completed.exception()  # Observe late exceptions after HTTP timeout.
        future.add_done_callback(done)

    def run(self, upload, language, deadline):
        try:
            audio = decode_audio(upload.file, upload.content_type, self.settings, deadline)
            if time.monotonic() >= deadline:
                raise ServiceError("INFERENCE_TIMEOUT", 504)
            segments, info = self.model.transcribe(audio, language=language, beam_size=5)
            text = []
            length = 0
            for segment in segments:
                if time.monotonic() >= deadline:
                    raise ServiceError("INFERENCE_TIMEOUT", 504)
                part = segment.text.strip()
                length += len(part) + 1
                if length > 4000:
                    raise ServiceError("INTERNAL_ERROR", 500)
                text.append(part)
            return {"recognizedText": " ".join(text).strip(), "detectedLanguage": info.language,
                    "languageProbability": info.language_probability}
        finally:
            try:
                upload.file.close()  # Worker owns spool until native inference exits.
            except Exception:
                event("temp.cleanup_failed", category="TEMP_STORAGE_FAILURE")

    async def stop(self):
        if self.stopping:
            return
        self.stopping = True
        event("shutdown.requested")
        if self.pending:
            _, pending = await asyncio.wait(tuple(self.pending), timeout=self.settings.shutdown_timeout)
            if pending:
                event("shutdown.timeout", category="NATIVE_WORK_CONTINUES")
        self.executor.shutdown(wait=False, cancel_futures=True)
        event("shutdown.completed")


def create_app(settings=None, model_loader=load_model):
    @asynccontextmanager
    async def lifespan(app):
        config = settings or Settings.from_env()
        logging.getLogger("python_multipart.multipart").disabled = True
        av.logging.set_level(None)  # PyAV's ignore-FFmpeg-logs mode, no raw decoder text.
        state = Runtime(config, model_loader)
        app.state.runtime = state
        startup = asyncio.create_task(state.start())
        try:
            yield
        finally:
            await state.stop()
            if not startup.done():
                startup.cancel()
            await asyncio.gather(startup, return_exceptions=True)

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def correlation(request, call_next):
        candidate = request.headers.get("x-request-id", "")
        state = getattr(app.state, "runtime", None)
        token = state.settings.token if state else ""
        request.state.request_id = (candidate if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}", candidate)
                                    and not (token and token in candidate)
                                    and not candidate.startswith(("eyJ", "AIza")) else str(uuid.uuid4()))
        try:
            response = await call_next(request)
        except Exception:
            event("request.failed", request.state.request_id, "INTERNAL_ERROR")
            response = JSONResponse({"code": "INTERNAL_ERROR"}, status_code=500)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/")
    @app.get("/health/live")
    async def live():
        return {"status": "ok"}

    @app.get("/health/ready")
    async def ready():
        state = getattr(app.state, "runtime", None)
        ok = bool(state and state.ready)
        return JSONResponse({"status": "ready" if ok else "not_ready"}, status_code=200 if ok else 503)

    @app.post("/transcribe")
    async def transcribe(request: Request):
        state = getattr(app.state, "runtime", None)
        request_id = request.state.request_id
        started = time.monotonic()
        parser = None
        transferred = False
        admitted = False
        try:
            if state is None:
                raise ServiceError("MODEL_NOT_READY", 503)
            config = state.settings
            supplied = request.headers.get("x-service-token", "")
            if not config.insecure_local or config.token:
                if (len(supplied) > 256 or not supplied.isascii() or not supplied
                        or not hmac.compare_digest(supplied, config.token)):
                    raise ServiceError("UNAUTHORIZED", 401)
            if not state.ready:
                raise ServiceError("MODEL_NOT_READY", 503)
            if state.active >= config.concurrency:
                raise ServiceError("SERVICE_BUSY", 429)
            state.active += 1  # Event-loop admission is atomic, before upload parsing.
            admitted = True
            deadline = started + config.timeout
            remaining = max(0, deadline - time.monotonic())
            async with asyncio.timeout(remaining):
                content_type = request.headers.get("content-type", "")
                if len(content_type) > 256 or not content_type.lower().startswith("multipart/form-data;"):
                    raise ServiceError("INVALID_AUDIO")
                length = request.headers.get("content-length")
                if length and (not length.isdecimal() or len(length) > 10
                               or int(length) > config.max_bytes + 65536):
                    raise ServiceError("AUDIO_TOO_LARGE", 413)

                async def stream():
                    total = 0
                    async for chunk in request.stream():
                        total += len(chunk)
                        if total > config.max_bytes + 65536:
                            raise ServiceError("AUDIO_TOO_LARGE", 413)
                        for offset in range(0, len(chunk), 65536):
                            yield chunk[offset:offset + 65536]

                parser = BoundedParser(request.headers, stream(), config.max_bytes)
                form = await parser.parse()
                upload = form.get("audio")
                language = form.get("language", "en")
                if (not parser.complete or not isinstance(upload, UploadFile)
                        or language not in ("en", "de", "fr", "es", "ar")
                        or set(form.keys()) - {"audio", "language"}):
                    raise ServiceError("INVALID_AUDIO")
                if state.stopping:
                    raise ServiceError("MODEL_NOT_READY", 503)
                future = asyncio.get_running_loop().run_in_executor(
                    state.executor, state.run, upload, language, deadline)
                state.track(future)
                def release(completed):
                    if completed.cancelled():
                        parser.close_files()  # Executor shutdown may cancel a queued job.
                    state.active -= 1
                future.add_done_callback(release)
                transferred = True
                result = await asyncio.shield(future)
                event("inference.completed", request_id, duration=time.monotonic() - started)
                return result
        except TimeoutError:
            error = ServiceError("INFERENCE_TIMEOUT", 504)
        except ServiceError as failure:
            error = failure
        except (MultiPartException, MultipartParseError):
            error = ServiceError("INVALID_AUDIO")
        except asyncio.CancelledError:
            event("inference.cancelled", request_id, "CLIENT_DISCONNECTED")
            raise
        except Exception:
            error = ServiceError("INTERNAL_ERROR", 500)
        finally:
            if not transferred:
                if parser:
                    parser.close_files()
                if admitted:
                    state.active -= 1
        event("inference.rejected", request_id, error.code, time.monotonic() - started)
        return JSONResponse({"code": error.code}, status_code=error.status,
                            headers={"Retry-After": "1"} if error.status == 429 else None)

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    config = Settings.from_env()
    uvicorn.run(app, host=config.host, port=config.port, workers=1, limit_concurrency=32,
                timeout_graceful_shutdown=10, timeout_keep_alive=5, access_log=False)
