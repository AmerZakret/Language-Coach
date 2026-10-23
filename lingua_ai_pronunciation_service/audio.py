"""Bounded local media decoding. No shell, network input, or client paths."""
import time
from fractions import Fraction
import av
import numpy as np


class ServiceError(Exception):
    def __init__(self, code, status=400):
        self.code = code
        self.status = status
        super().__init__(code)


FORMATS = {
    "wav": {"pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_u8"},
    "mov": {"aac"}, "matroska": {"opus", "vorbis"},
    "ogg": {"opus", "vorbis"}, "mp3": {"mp3", "mp3float"},
}
MIME = {
    "audio/wav": {"wav"}, "audio/x-wav": {"wav"}, "audio/wave": {"wav"},
    "audio/mp4": {"mov"}, "audio/x-m4a": {"mov"}, "audio/m4a": {"mov"},
    "audio/webm": {"matroska"}, "audio/ogg": {"ogg"},
    "audio/opus": {"ogg", "matroska"}, "audio/mpeg": {"mp3"}, "audio/mp3": {"mp3"},
}


def detected_format(head):
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[4:8] == b"ftyp":
        return "mov"
    if head[:4] == b"\x1aE\xdf\xa3":
        return "matroska"
    if head[:4] == b"OggS":
        return "ogg"
    if head[:3] == b"ID3" or (len(head) > 1 and head[0] == 255 and head[1] & 224 == 224):
        return "mp3"
    raise ServiceError("UNSUPPORTED_AUDIO", 415)


def decode_audio(source, content_type, settings, deadline):
    head = source.read(32)
    source.seek(0)
    media = detected_format(head)
    mime = (content_type or "").split(";", 1)[0].strip().lower()
    if mime not in ("", "application/octet-stream") and media not in MIME.get(mime, set()):
        raise ServiceError("UNSUPPORTED_AUDIO", 415)
    maximum = settings.max_duration * 16000
    samples = np.empty(maximum, dtype=np.float32)
    count = 0
    source_duration = Fraction(0)

    def check_deadline():
        if time.monotonic() >= deadline:
            raise ServiceError("INFERENCE_TIMEOUT", 504)

    def append(frame):
        nonlocal count
        check_deadline()
        if count + frame.samples > maximum:
            raise ServiceError("AUDIO_TOO_LONG", 413)
        values = frame.to_ndarray().reshape(-1)
        samples[count:count + len(values)] = values.astype(np.float32) / 32768.0
        count += len(values)

    try:
        with av.open(source, mode="r", format=media, options={
            "probesize": "131072", "analyzeduration": "1000000",
            "protocol_whitelist": "pipe", "enable_drefs": "0", "use_absolute_path": "0",
        }) as container:
            if len(container.streams.audio) != 1 or len(container.streams) != 1:
                raise ServiceError("UNSUPPORTED_AUDIO", 415)
            stream = container.streams.audio[0]
            codec = stream.codec_context
            codec.thread_count = 1
            if codec.name not in FORMATS[media]:
                raise ServiceError("UNSUPPORTED_AUDIO", 415)
            if not 8000 <= codec.sample_rate <= 48000 or not 1 <= codec.channels <= 2:
                raise ServiceError("INVALID_AUDIO")
            if stream.duration is not None and stream.time_base is not None:
                if stream.duration * stream.time_base > settings.max_duration:
                    raise ServiceError("AUDIO_TOO_LONG", 413)
            resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
            for frame in container.decode(stream):
                check_deadline()
                if (not 8000 <= frame.sample_rate <= 48000 or len(frame.layout.channels) > 2
                        or frame.samples > 65536):
                    raise ServiceError("INVALID_AUDIO")
                source_duration += Fraction(frame.samples, frame.sample_rate)
                if source_duration > settings.max_duration:
                    raise ServiceError("AUDIO_TOO_LONG", 413)
                frame.pts = None
                for normalized in resampler.resample(frame):
                    append(normalized)
            for normalized in resampler.resample(None):
                append(normalized)
    except ServiceError:
        raise
    except Exception:
        raise ServiceError("INVALID_AUDIO") from None
    if not count:
        raise ServiceError("INVALID_AUDIO")
    return samples[:count]
