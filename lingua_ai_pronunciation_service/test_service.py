"""No model downloads/inference: stub Whisper, real multipart and PyAV decoding."""
import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
import io
import json
import logging
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import wave

import av
import httpx
import numpy as np

from audio import ServiceError, decode_audio
from config import ConfigurationError, Settings
import main


def settings(**changes):
    return replace(Settings(environment="test", token=secrets.token_urlsafe(32)), **changes)


def wav(seconds=0.1, rate=16000, channels=1):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(channels)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(b"\0\0" * int(seconds * rate) * channels)
    return buffer.getvalue()


def encoded(container, codec):
    buffer = io.BytesIO()
    with av.open(buffer, mode="w", format=container) as output:
        stream = output.add_stream(codec, rate=48000)
        stream.layout = "mono"
        for index in range(5):
            frame = av.AudioFrame.from_ndarray(np.zeros((1, 960), dtype=np.float32), format="fltp", layout="mono")
            frame.sample_rate = 48000
            frame.pts = index * 960
            for packet in stream.encode(frame):
                output.mux(packet)
        for packet in stream.encode(None):
            output.mux(packet)
    return buffer.getvalue()


class Model:
    def __init__(self, release=None, failure=None):
        self.calls = 0
        self.thread = None
        self.entered = threading.Event()
        self.release = release
        self.failure = failure

    def transcribe(self, audio, **options):
        self.calls += 1
        self.thread = threading.get_ident()
        assert audio.dtype == np.float32 and audio.ndim == 1 and len(audio) <= 480000
        assert options["beam_size"] == 5
        self.entered.set()
        if self.release:
            self.release.wait(3)
        if self.failure:
            raise self.failure
        return iter([SimpleNamespace(text="private-transcription-marker")]), SimpleNamespace(language="en", language_probability=1.0)


class ConfigTests(unittest.TestCase):
    def production(self, **changes):
        return {"NODE_ENV": "production", "PRONUNCIATION_SERVICE_TOKEN": secrets.token_urlsafe(32),
                "WHISPER_CACHE_DIR": str(Path.cwd().resolve()), **changes}

    def test_production_token_required_and_redacted(self):
        for token in ("", "weak", "placeholder" * 5, "a" * 64):
            with self.subTest(token_length=len(token)):
                with self.assertRaises(ConfigurationError) as caught:
                    Settings.from_env(self.production(PRONUNCIATION_SERVICE_TOKEN=token))
                if token:
                    self.assertNotIn(token, str(caught.exception))
        good = Settings.from_env(self.production())
        self.assertNotIn(good.token, repr(good))

    def test_insecure_mode_requires_explicit_local_development(self):
        with self.assertRaises(ConfigurationError):
            Settings.from_env({})
        self.assertTrue(Settings.from_env({"PRONUNCIATION_ALLOW_INSECURE_LOCAL": "true"}).insecure_local)
        for env in (self.production(PRONUNCIATION_ALLOW_INSECURE_LOCAL="true"),
                    {"PRONUNCIATION_ALLOW_INSECURE_LOCAL": "true", "PRONUNCIATION_HOST": "0.0.0.0"}):
            with self.assertRaises(ConfigurationError):
                Settings.from_env(env)

    def test_config_bounds_and_no_cors_or_production_downloads(self):
        for field, value in (("CORS_ORIGINS", "*"), ("CORS_ORIGINS", "https://web.example.invalid"),
                             ("WHISPER_ALLOW_DOWNLOAD", "true"), ("WHISPER_CACHE_DIR", "relative"),
                             ("INFERENCE_CONCURRENCY", "999"), ("INFERENCE_TIMEOUT_SECONDS", "45"),
                             ("AUDIO_MAX_BYTES", str(11 * 1024 * 1024)), ("AUDIO_MAX_DURATION_SECONDS", "31"),
                             ("WHISPER_DEVICE", "auto"), ("PRONUNCIATION_PORT", "0")):
            with self.subTest(field=field), self.assertRaises(ConfigurationError):
                Settings.from_env(self.production(**{field: value}))
        self.assertFalse(Settings.from_env(self.production()).allow_download)

    def test_config_command_and_import_never_load_whisper(self):
        env = {**os.environ, **self.production()}
        result = subprocess.run([sys.executable, "config.py", "--production"], env=env, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(env["PRONUNCIATION_SERVICE_TOKEN"], result.stdout + result.stderr)
        result = subprocess.run([sys.executable, "-c", "import main,sys; assert 'faster_whisper' not in sys.modules"],
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_production_server_and_pinned_direct_dependencies(self):
        source = Path("main.py").read_text()
        self.assertIn("workers=1", source)
        self.assertIn("access_log=False", source)
        requirements = Path("requirements.txt").read_text().splitlines()
        self.assertTrue(all("==" in line for line in requirements if line and not line.startswith("#")))
        production_docs = Path("README.md").read_text().split("## Development")[0]
        self.assertNotIn("--reload", production_docs)

    def test_loader_uses_local_artifacts_and_one_native_model_worker(self):
        calls = []
        def whisper(*args, **kwargs):
            logging.getLogger('faster_whisper').warning('sensitive-model-path')
            calls.append((args, kwargs))
            return Model()
        with patch.dict(sys.modules, {'faster_whisper': SimpleNamespace(WhisperModel=whisper)}), \
                self.assertNoLogs('faster_whisper', level='WARNING'):
            main.load_model(Settings.from_env(self.production()))
        self.assertTrue(calls[0][1]['local_files_only'])
        self.assertEqual(calls[0][1]['num_workers'], 1)
        self.assertEqual(calls[0][1]['device'], 'cpu')


class AudioTests(unittest.TestCase):
    def decode(self, data, mime="audio/wav", config=None):
        return decode_audio(io.BytesIO(data), mime, config or settings(), time.monotonic() + 5)

    def test_valid_wav_and_generic_flutter_mime(self):
        self.assertEqual(len(self.decode(wav())), 1600)
        self.assertEqual(len(self.decode(wav(), "application/octet-stream")), 1600)

    def test_real_aac_webm_ogg_mp3_decode(self):
        for container, codec, mime in (("mp4", "aac", "audio/mp4"), ("webm", "libopus", "audio/webm"),
                                       ("ogg", "libopus", "audio/ogg"), ("mp3", "libmp3lame", "audio/mpeg")):
            with self.subTest(container=container):
                self.assertGreater(len(self.decode(encoded(container, codec), mime)), 0)

    def test_long_audio_rejected_before_inference(self):
        with self.assertRaises(ServiceError) as caught:
            self.decode(wav(1.1), config=settings(max_duration=1))
        self.assertEqual(caught.exception.code, "AUDIO_TOO_LONG")

    def test_exact_duration_boundary_has_no_float_rounding_rejection(self):
        self.assertEqual(len(self.decode(wav(30))), 480000)
        with self.assertRaises(ServiceError) as caught:
            self.decode(wav(30 + 1 / 16000))
        self.assertEqual(caught.exception.code, 'AUDIO_TOO_LONG')

    def test_invalid_binary_and_unsupported_format(self):
        for data in (b"random-invalid-binary", b"fLaC" + bytes(100), b"<svg>not audio</svg>"):
            with self.subTest(prefix=data[:4]), self.assertRaises(ServiceError) as caught:
                self.decode(data)
            self.assertEqual(caught.exception.code, "UNSUPPORTED_AUDIO")

    def test_mime_mismatch_and_malformed_container(self):
        for data, mime in ((wav(), "audio/mpeg"), (wav(), "text/html"),
                           (b"RIFF" + bytes(4) + b"WAVE" + bytes(32), "audio/wav")):
            with self.subTest(mime=mime), self.assertRaises(ServiceError):
                self.decode(data, mime)

    def test_channels_sample_rate_resource_bounds(self):
        for rate, channels in ((96000, 1), (16000, 3)):
            with self.subTest(rate=rate, channels=channels), self.assertRaises(ServiceError) as caught:
                self.decode(wav(rate=rate, channels=channels))
            self.assertEqual(caught.exception.code, "INVALID_AUDIO")

    def test_metadata_cannot_bypass_decoded_sample_budget(self):
        source = io.BytesIO(wav(1.1))
        real_open = av.open

        def open_without_duration(*args, **kwargs):
            container = real_open(*args, **kwargs)
            stream = container.streams.audio[0]
            proxy = SimpleNamespace(codec_context=stream.codec_context, duration=None, time_base=stream.time_base)

            class Container:
                streams = SimpleNamespace(audio=[proxy])
                def __enter__(self):
                    self.streams = type("Streams", (list,), {"audio": [proxy]})([proxy])
                    return self
                def __exit__(self, *args):
                    container.close()
                def decode(self, _):
                    return container.decode(stream)
            return Container()

        with patch("audio.av.open", side_effect=open_without_duration), self.assertRaises(ServiceError) as caught:
            decode_audio(source, "audio/wav", settings(max_duration=1), time.monotonic() + 5)
        self.assertEqual(caught.exception.code, "AUDIO_TOO_LONG")


class HttpTests(unittest.IsolatedAsyncioTestCase):
    @asynccontextmanager
    async def service(self, config=None, model=None, loader=None):
        config = config or settings()
        model = model or Model()
        app = main.create_app(config, loader or (lambda _: model))
        startup_complete = asyncio.Event()
        real_event = main.event

        def observe_startup(name, *args, **kwargs):
            real_event(name, *args, **kwargs)
            if name in ("model.ready", "model.unavailable"):
                startup_complete.set()

        with patch("main.event", side_effect=observe_startup):
            async with app.router.lifespan_context(app):
                # A safety bound diagnoses a stuck fixture; no guessed number of
                # scheduler turns determines whether model initialization finished.
                await asyncio.wait_for(startup_complete.wait(), timeout=5)
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://internal") as client:
                    try:
                        yield client, app.state.runtime, model
                    finally:
                        if model.release:
                            model.release.set()

    async def post(self, client, state, data=None, mime="audio/wav", headers=None, filename="audio.wav"):
        return await client.post("/transcribe", files={"audio": (filename, wav() if data is None else data, mime)},
                                 data={"language": "en"}, headers={"X-Service-Token": state.settings.token, **(headers or {})})

    async def test_auth_missing_wrong_valid_and_token_not_logged(self):
        async with self.service() as (client, state, model):
            with self.assertLogs("pronunciation", level="INFO") as logs:
                for token in ("", "wrong", "x" * 1000):
                    response = await self.post(client, state, headers={"X-Service-Token": token})
                    self.assertEqual(response.status_code, 401)
                    self.assertEqual(response.json(), {"code": "UNAUTHORIZED"})
                response = await self.post(client, state)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(model.calls, 1)
                self.assertNotIn(state.settings.token, str(logs.output) + str(response.headers))

    async def test_explicit_dev_insecure_mode(self):
        config = Settings.from_env({"PRONUNCIATION_ALLOW_INSECURE_LOCAL": "true"})
        async with self.service(config=config) as (client, state, _):
            self.assertEqual((await self.post(client, state)).status_code, 200)

    async def test_oversized_stream_file_rejected_and_permit_freed(self):
        async with self.service(config=settings(max_bytes=1024)) as (client, state, model):
            response = await self.post(client, state, b"x" * 2048)
            self.assertEqual(response.json(), {"code": "AUDIO_TOO_LARGE"})
            self.assertEqual(response.status_code, 413)
            self.assertEqual(state.active, 0)
            self.assertEqual(model.calls, 0)

    async def test_body_without_content_length_still_bounded(self):
        config = settings(max_bytes=1024)
        async with self.service(config=config) as (client, state, model):
            async def chunks():
                yield b'--boundary\r\nContent-Disposition: form-data; name="audio"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n'
                for _ in range(100):
                    yield bytes(1024)
            response = await client.post("/transcribe", content=chunks(), headers={
                "X-Service-Token": config.token, "Content-Type": "multipart/form-data; boundary=boundary"})
            self.assertEqual(response.status_code, 413)
            self.assertEqual(model.calls, 0)

    async def test_malformed_multipart_rejected_safely(self):
        async with self.service() as (client, state, _):
            response = await client.post('/transcribe', content=b'--boundary\r\nmalformed', headers={
                'X-Service-Token': state.settings.token, 'Content-Type': 'multipart/form-data; boundary=boundary'})
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json(), {'code': 'INVALID_AUDIO'})

    async def test_parser_timeout_closes_partial_spool_and_frees_admission(self):
        files = []
        real_spool = tempfile.SpooledTemporaryFile
        def spool(*args, **kwargs):
            file = real_spool(*args, **kwargs)
            files.append(file)
            return file
        async with self.service(config=settings(timeout=0.04)) as (client, state, model):
            async def chunks():
                yield b'--boundary\r\nContent-Disposition: form-data; name="audio"; filename="a.wav"\r\n\r\npartial'
                await asyncio.sleep(0.2)
                yield b'--boundary--\r\n'
            with patch('starlette.formparsers.SpooledTemporaryFile', side_effect=spool):
                response = await client.post('/transcribe', content=chunks(), headers={
                    'X-Service-Token': state.settings.token, 'Content-Type': 'multipart/form-data; boundary=boundary'})
            self.assertEqual(response.status_code, 504)
            self.assertTrue(files and all(file.closed for file in files))
            self.assertEqual(state.active, 0)
            self.assertEqual(model.calls, 0)

    async def test_validation_rejects_before_whisper(self):
        async with self.service(config=settings(max_duration=1)) as (client, state, model):
            for data, mime, status in ((wav(1.1), "audio/wav", 413), (b"binary", "audio/wav", 415),
                                       (wav(), "audio/mpeg", 415), (b"RIFF0000WAVE", "audio/wav", 400)):
                with self.subTest(status=status):
                    self.assertEqual((await self.post(client, state, data, mime)).status_code, status)
            self.assertEqual(model.calls, 0)

    async def test_spooled_temp_closed_success_decode_and_inference_failure(self):
        real_spool = tempfile.SpooledTemporaryFile
        for data, failure in ((wav(), None), (b"invalid", None), (wav(), RuntimeError("sensitive /private/path"))):
            files = []
            def spool(*args, **kwargs):
                kwargs["max_size"] = 1  # Force a real OS temp file in the test.
                file = real_spool(*args, **kwargs)
                files.append(file)
                return file
            with tempfile.TemporaryDirectory() as directory, patch("tempfile.tempdir", directory), \
                    patch("starlette.formparsers.SpooledTemporaryFile", side_effect=spool):
                async with self.service(model=Model(failure=failure)) as (client, state, _):
                    await self.post(client, state, data)
                    await asyncio.sleep(0)
                    self.assertTrue(files and all(file.closed for file in files))
                    self.assertEqual(list(Path(directory).iterdir()), [])

    async def test_blocking_inference_off_loop_and_liveness_during_capacity(self):
        release = threading.Event()
        async with self.service(model=Model(release=release)) as (client, state, model):
            work = asyncio.create_task(self.post(client, state))
            for _ in range(100):
                if model.entered.is_set():
                    break
                await asyncio.sleep(0.005)
            self.assertTrue(model.entered.is_set())
            self.assertNotEqual(model.thread, threading.get_ident())
            live = await asyncio.wait_for(client.get("/health/live"), timeout=0.2)
            self.assertEqual(live.status_code, 200)
            busy = await self.post(client, state)
            self.assertEqual(busy.status_code, 429)
            self.assertEqual(busy.json(), {"code": "SERVICE_BUSY"})
            self.assertEqual(busy.headers["Retry-After"], "1")
            release.set()
            self.assertEqual((await work).status_code, 200)
            self.assertEqual(state.active, 0)
            self.assertEqual((await self.post(client, state)).status_code, 200)

    async def test_timeout_retains_slot_and_temp_until_native_completion(self):
        release = threading.Event()
        entered = asyncio.Event()
        loop = asyncio.get_running_loop()

        class ControlledModel(Model):
            def transcribe(self, audio, **options):
                result = super().transcribe(audio, **options)
                loop.call_soon_threadsafe(entered.set)
                release.wait()  # Only the test's finally block permits native exit.
                return result

        model = ControlledModel()
        files = []
        real_spool = tempfile.SpooledTemporaryFile
        def spool(*args, **kwargs):
            kwargs['max_size'] = 1
            file = real_spool(*args, **kwargs)
            files.append(file)
            return file
        self.enterContext(patch('starlette.formparsers.SpooledTemporaryFile', side_effect=spool))
        real_timeout = asyncio.timeout

        @asynccontextmanager
        async def timeout_after_entry(delay):
            self.assertGreater(delay, 0)
            # Exercise real asyncio deadline cancellation, but arm it only after
            # decode completed and inference actually entered the native worker.
            async with real_timeout(None) as deadline:
                async def expire():
                    await entered.wait()
                    deadline.reschedule(loop.time())
                trigger = asyncio.create_task(expire())
                try:
                    yield
                finally:
                    trigger.cancel()
                    await asyncio.gather(trigger, return_exceptions=True)

        async with self.service(model=model) as (client, state, _):
            try:
                with patch('main.asyncio.timeout', side_effect=timeout_after_entry):
                    response = await asyncio.wait_for(self.post(client, state), timeout=5)
                self.assertTrue(entered.is_set())
                self.assertEqual(response.status_code, 504)
                self.assertEqual(response.json(), {"code": "INFERENCE_TIMEOUT"})
                self.assertEqual(state.active, 1)
                self.assertTrue(files and not files[0].closed)
                self.assertEqual((await self.post(client, state)).status_code, 429)
            finally:
                # Snapshot the worker future before releasing it. Its registered
                # completion callbacks close the spool and return the permit.
                pending = tuple(state.pending)
                release.set()
                if pending:
                    await asyncio.wait_for(asyncio.gather(*pending), timeout=5)
            self.assertEqual(state.active, 0)
            self.assertTrue(files[0].closed)
            self.assertEqual((await self.post(client, state)).status_code, 200)

    async def test_configured_two_slots_and_cancellation_accounting(self):
        release = threading.Event()
        async with self.service(config=settings(concurrency=2), model=Model(release=release)) as (client, state, model):
            a = asyncio.create_task(self.post(client, state))
            b = asyncio.create_task(self.post(client, state))
            for _ in range(100):
                if model.calls == 2:
                    break
                await asyncio.sleep(0.005)
            self.assertEqual(model.calls, 2)
            self.assertEqual((await self.post(client, state)).status_code, 429)
            a.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await a
            self.assertEqual(state.active, 2)
            release.set()
            self.assertEqual((await b).status_code, 200)
            for _ in range(100):
                if state.active == 0:
                    break
                await asyncio.sleep(0.005)
            self.assertEqual(state.active, 0)

    async def test_failure_frees_slot_and_redacts_exception(self):
        marker = secrets.token_urlsafe(24)
        async with self.service(model=Model(failure=RuntimeError(f"{marker} /private/files secret"))) as (client, state, _):
            with self.assertLogs("pronunciation", level="INFO") as logs:
                response = await self.post(client, state)
            self.assertEqual(response.json(), {"code": "INTERNAL_ERROR"})
            self.assertNotIn(marker, str(logs.output) + response.text)
            self.assertNotIn("/private", str(logs.output) + response.text)
            self.assertEqual(state.active, 0)

    async def test_model_once_ready_and_readiness_does_not_infer(self):
        loads = []
        model = Model()
        def loader(config):
            loads.append(config)
            return model
        async with self.service(model=model, loader=loader) as (client, _, _):
            for _ in range(5):
                self.assertEqual((await client.get("/health/ready")).status_code, 200)
            self.assertEqual(len(loads), 1)
            self.assertEqual(model.calls, 0)

    async def test_model_failure_not_ready_but_live(self):
        def loader(_):
            raise RuntimeError("private model path")
        async with self.service(loader=loader) as (client, state, _):
            self.assertEqual((await client.get("/health/ready")).status_code, 503)
            self.assertEqual((await client.get("/health/live")).status_code, 200)
            self.assertEqual((await self.post(client, state)).json(), {"code": "MODEL_NOT_READY"})

    async def test_model_loading_off_loop_and_late_load_cannot_become_ready(self):
        release = threading.Event()
        entered = threading.Event()
        model = Model()
        def loader(_):
            entered.set()
            release.wait(3)
            return model
        app = main.create_app(settings(model_load_timeout=0.04), loader)
        async with app.router.lifespan_context(app):
            try:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://internal") as client:
                    for _ in range(100):
                        if entered.is_set():
                            break
                        await asyncio.sleep(0.001)
                    self.assertTrue(entered.is_set())
                    self.assertEqual((await asyncio.wait_for(client.get('/health/live'), 0.1)).status_code, 200)
                    self.assertEqual((await client.get('/health/ready')).status_code, 503)
                    await asyncio.sleep(0.06)
                    release.set()
                    await asyncio.sleep(0.02)
                    self.assertEqual((await client.get('/health/ready')).status_code, 503)
                    self.assertEqual(model.calls, 0)
            finally:
                release.set()

    async def test_shutdown_not_ready_bounded_and_once(self):
        release = threading.Event()
        async with self.service(config=settings(timeout=0.03, shutdown_timeout=0.03), model=Model(release=release)) as (client, state, _):
            await self.post(client, state)
            with self.assertLogs("pronunciation", level="INFO") as logs:
                started = time.monotonic()
                await state.stop()
                await state.stop()
                self.assertLess(time.monotonic() - started, 0.2)
            self.assertEqual(sum('"event": "shutdown.requested"' in line for line in logs.output), 1)
            self.assertEqual((await client.get("/health/ready")).status_code, 503)
            self.assertEqual((await self.post(client, state)).json(), {"code": "MODEL_NOT_READY"})
            release.set()
            await asyncio.sleep(0.02)

    async def test_request_id_bounded_and_no_audio_transcription_logging(self):
        async with self.service() as (client, state, _):
            with self.assertLogs("pronunciation", level="INFO") as logs:
                for supplied in ("backend-request-1", "x" * 1000, "bad id", "", state.settings.token):
                    response = await self.post(client, state, headers={"X-Request-ID": supplied}, filename="../../private/path.wav")
                    self.assertEqual(response.status_code, 200)
                    request_id = response.headers["X-Request-ID"]
                    self.assertLessEqual(len(request_id), 64)
                    if supplied == "backend-request-1":
                        self.assertEqual(request_id, supplied)
                    else:
                        self.assertNotEqual(request_id, supplied)
            text = str(logs.output)
            self.assertNotIn("private-transcription-marker", text)
            self.assertNotIn("/private/path", text)
            self.assertNotIn(state.settings.token, text)
            self.assertTrue(all(len(line) < 512 for line in logs.output))


if __name__ == "__main__":
    unittest.main()
