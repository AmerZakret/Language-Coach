"""Configuration validation only: never loads a model or contacts a service."""
import argparse
from dataclasses import dataclass, field
import ipaddress
import os
from pathlib import Path
import re


class ConfigurationError(ValueError):
    pass


@dataclass(frozen=True)
class Settings:
    environment: str
    token: str = field(repr=False)
    insecure_local: bool = False
    host: str = "127.0.0.1"
    port: int = 8001
    model: str = "base"
    device: str = "cpu"
    compute_type: str = "int8"
    cache: str | None = None
    allow_download: bool = False
    max_bytes: int = 10 * 1024 * 1024
    max_duration: int = 30
    concurrency: int = 1
    timeout: float = 35
    shutdown_timeout: float = 5
    model_load_timeout: float = 120

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env

        def fail(name):
            raise ConfigurationError(f"Invalid or missing configuration: {name}")

        def flag(name, default=False):
            value = env.get(name, str(default).lower())
            if value not in ("true", "false"):
                fail(name)
            return value == "true"

        def integer(name, default, low, high):
            value = str(env.get(name, default))
            if not re.fullmatch(r"[0-9]{1,10}", value) or not low <= int(value) <= high:
                fail(name)
            return int(value)

        mode = env.get("NODE_ENV", "development")
        if mode not in ("development", "test", "production"):
            fail("NODE_ENV")
        production = mode == "production"
        host = env.get("PRONUNCIATION_HOST", "127.0.0.1")
        try:
            loopback = ipaddress.ip_address(host).is_loopback
        except ValueError:
            fail("PRONUNCIATION_HOST")
        insecure = flag("PRONUNCIATION_ALLOW_INSECURE_LOCAL")
        if insecure and (production or not loopback):
            fail("PRONUNCIATION_ALLOW_INSECURE_LOCAL")
        token = env.get("PRONUNCIATION_SERVICE_TOKEN", "")
        if not token and not insecure:
            fail("PRONUNCIATION_SERVICE_TOKEN")
        if token and (not re.fullmatch(r"[A-Za-z0-9_+/=-]{32,256}", token)
                      or len(set(token)) < 12
                      or re.search(r"placeholder|change.?me|your[_-]|example|default", token, re.I)
                      or token == env.get("JWT_SECRET")):
            fail("PRONUNCIATION_SERVICE_TOKEN")
        if env.get("CORS_ORIGINS", "").strip():
            fail("CORS_ORIGINS")  # Internal service, no browser CORS.
        model = env.get("WHISPER_MODEL", "base")
        if not model or len(model) > 512 or "\x00" in model or "://" in model:
            fail("WHISPER_MODEL")
        device = env.get("WHISPER_DEVICE", "cpu")
        compute = env.get("WHISPER_COMPUTE_TYPE", "int8")
        if device not in ("cpu", "cuda"):
            fail("WHISPER_DEVICE")
        if compute not in ("int8", "float32", "float16", "int8_float16"):
            fail("WHISPER_COMPUTE_TYPE")
        if device == "cpu" and compute not in ("int8", "float32"):
            fail("WHISPER_COMPUTE_TYPE")
        cache = env.get("WHISPER_CACHE_DIR")
        if (production and not cache) or (cache and (not Path(cache).is_absolute() or "\x00" in cache)):
            fail("WHISPER_CACHE_DIR")
        download = flag("WHISPER_ALLOW_DOWNLOAD")
        if production and download:
            fail("WHISPER_ALLOW_DOWNLOAD")
        return cls(
            environment=mode, token=token, insecure_local=insecure, host=host,
            port=integer("PRONUNCIATION_PORT", 8001, 1, 65535), model=model,
            device=device, compute_type=compute, cache=cache, allow_download=download,
            max_bytes=integer("AUDIO_MAX_BYTES", 10 * 1024 * 1024, 1024, 10 * 1024 * 1024),
            max_duration=integer("AUDIO_MAX_DURATION_SECONDS", 30, 1, 30),
            concurrency=integer("INFERENCE_CONCURRENCY", 1, 1, 4),
            timeout=integer("INFERENCE_TIMEOUT_SECONDS", 35, 1, 40),
            shutdown_timeout=integer("SHUTDOWN_TIMEOUT_SECONDS", 5, 1, 10),
            model_load_timeout=integer("MODEL_LOAD_TIMEOUT_SECONDS", 120, 1, 300),
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--production", action="store_true")
    args = parser.parse_args()
    try:
        settings = Settings.from_env()
        if args.production and settings.environment != "production":
            raise ConfigurationError("Production validation requires NODE_ENV=production")
    except ConfigurationError as error:
        parser.exit(1, str(error) + "\n")
    print("Configuration valid. No model loaded, no downloads or connections made.")
