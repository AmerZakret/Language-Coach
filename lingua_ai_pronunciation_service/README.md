# Internal pronunciation service

For rollout order, backup boundaries, worker capacity and incident response use the
[Phase 8F operator runbooks](../PRODUCTION_RUNBOOKS.md). Run configuration checks in
this service's own environment; do not inherit backend browser CORS configuration.

## Production

Python 3.12.4 and the complete hashed dependency closure in `requirements.txt` are the tested
baseline. Install in a fresh isolated virtual environment, from this directory:

```sh
python -m venv .venv
# Activate .venv, or use its explicit Python executable for both commands.
python -m pip install --require-hashes --only-binary=:all: --no-deps -r requirements-installer.txt
python -m pip install --require-hashes --only-binary=:all: -r requirements.txt
python -B -m pip check
```

The first install bootstraps exact pip 26.2.2 with a repository-pinned wheel hash.
Its vendored certifi and application certifi are both 2026.10.19. Pip is dependency
installation/provisioning tooling, never imported by service requests; upgrading
application certifi alone would not replace pip's private certificate bundle.
Do not upgrade global/system pip. Recreate old project venvs using these commands.
PyAV wheels include FFmpeg
libraries; CTranslate2/faster-whisper require supported native CPU instructions.
The default is CPU `base` / `int8`, two CPU threads, one model per process.
CUDA is opt-in and requires separately provisioned compatible NVIDIA libraries.

Set environment variables through the deployment secret/configuration mechanism:

| Variable | Policy/default |
|---|---|
| NODE_ENV | Explicit `production` for deployment |
| PRONUNCIATION_SERVICE_TOKEN | Required separate random 32-256 character ASCII base64/base64url/hex credential, at least 12 distinct characters; match backend; never JWT_SECRET |
| PRONUNCIATION_HOST / PRONUNCIATION_PORT | Explicit IP bind, defaults 127.0.0.1 / 8001; use private interface/container network |
| WHISPER_MODEL | `base`, or an immutable pre-provisioned local converted-model directory |
| WHISPER_DEVICE / WHISPER_COMPUTE_TYPE | `cpu` / `int8`; CPU also permits float32; CUDA requires deployment verification |
| WHISPER_CACHE_DIR | Explicit absolute persistent model-cache directory required in production |
| WHISPER_ALLOW_DOWNLOAD | false; production rejects true |
| MODEL_LOAD_TIMEOUT_SECONDS | 120, range 1-300; a late load never makes a timed-out startup ready |
| AUDIO_MAX_BYTES | 10 MiB maximum; may be reduced, minimum 1024 |
| AUDIO_MAX_DURATION_SECONDS | 30 seconds maximum; may be reduced to >=1 |
| INFERENCE_CONCURRENCY | 1 default, range 1-4 per process; admission includes upload/decode; no inference queue |
| INFERENCE_TIMEOUT_SECONDS | 35 total seconds (upload/decode/inference), range 1-40; keep below backend pronunciation deadline (45 seconds default) |
| SHUTDOWN_TIMEOUT_SECONDS | 5, range 1-10 seconds for active model/inference work |
| PRONUNCIATION_ALLOW_INSECURE_LOCAL | false; forbidden in production and on non-loopback binds |
| CORS_ORIGINS | Unset/empty; browser CORS unsupported, including wildcard |

Run these from this directory:

```sh
python -B config.py --production
python -B main.py
```

The first command validates config without loading/downloading a model. The second
uses Uvicorn with one worker, access logs disabled, 32 maximum concurrent ASGI
connections, 5-second keepalive and 10-second HTTP graceful shutdown. Service
events are JSON messages emitted through Python logging; configure the
`pronunciation` logger at INFO with a message-only formatter in the process
launcher/log collector. `python -B main.py` installs that formatter. Do not enable
debug/trace request logging at the proxy or ASGI layer.
Raw faster-whisper/multipart logs are disabled and PyAV retains its ignore-native-
logs mode; classified service events replace library exception/text dumps.

Pre-provision the exact faster-whisper converted model during an explicit build/
artifact preparation step, then mount it read-only with its cache. Loading uses
`local_files_only=True`; production validates nonempty `model.bin`, `config.json`
and `tokenizer.json` before native loading. A missing tokenizer must fail rather
than trigger faster-whisper's separate remote tokenizer fallback. Alias lookup
uses only the configured local Hub cache; a missing cache fails readiness with
`model.unavailable`, without trying a download. Prefer an
immutable local model directory plus an operator-recorded artifact digest. Named
model aliases do not pin an upstream revision; artifact pinning remains a deployment
responsibility. No extra warmup is performed: successful load gates readiness.

`GET /health/live` (and `/`) indicates event-loop liveness, even while loading or
after model failure. `GET /health/ready` returns 200 only after successful load and
executor initialization, and 503 while loading/failed/shutting down. It never runs
inference. Model load failure is explicit in the safe `model.unavailable` event;
restart after repairing artifacts. Readiness is independent of whether the sole
inference slot is temporarily occupied.

Only Nest calls `/transcribe`. Flutter/web continue using JWT-authenticated
`/pronunciation/assess` on Nest; they never receive the service token. Send
`X-Service-Token` over a private network, preferably TLS/mTLS if the network is not
fully trusted. Use firewall/network policy to prevent public access. No CORS or
end-user JWT is needed here. Rotate the dedicated credential through coordinated
backend/service restart; the service has no public credential endpoint.

## Audio and failure contract

Multipart admission authenticates and reserves capacity before parsing. Total
stream bytes are capped at the audio bound plus 64 KiB framing; one file and one
32-byte language field are permitted, headers capped at 4 KiB. File bytes are
bounded while streaming, with 64 KiB parser chunks and secure OS spooling after
1 MiB. No user filename controls a path or decoder; extension is ignored. An
audio MIME declaration must agree with detected content. Empty/octet-stream MIME
is accepted for existing Flutter multipart requests only after byte/decode checks.

Allowed byte-detected containers/codecs: WAV PCM (8/16/24/32-bit integer or float32),
M4A/MP4 AAC, WebM/Matroska Opus/Vorbis, Ogg Opus/Vorbis, MP3. One audio stream only;
video/extra streams and unsupported signatures/codecs are rejected. PyAV uses an
explicit demuxer, bounded probing, disabled external references/protocols and one
decoder thread. Actual decoded duration/sample count is authoritative even if
metadata omits duration. Inputs must have 1-2 channels and 8-48 kHz sample rate;
per-frame samples are bounded. Output is preallocated for at most 480,000 mono
16 kHz float32 samples (1.92 MB). Decode and inference run off the event loop.
The existing beam size/scoring contract is retained; Nest still computes scores.

Requests fail fast at capacity with 429 SERVICE_BUSY / Retry-After: 1. Codes are
UNAUTHORIZED (401), INVALID_AUDIO (400), AUDIO_TOO_LARGE/AUDIO_TOO_LONG (413),
UNSUPPORTED_AUDIO (415), MODEL_NOT_READY (503), INFERENCE_TIMEOUT (504) and
INTERNAL_ERROR (500). No exception text, paths, transcription or token is logged
or returned in errors. Success returns the existing recognizedText,
detectedLanguage and languageProbability fields. A safe bounded X-Request-ID is
accepted/generated and returned; token/JWT-like values are replaced. Events contain
only time, fixed event/category, ID and duration. Health requests are not logged.

HTTP timeout/cancellation does **not** kill Python threads or native decoder/model
compute. The worker retains its slot and spool until it actually finishes, closing
the file in `finally`. Repeated timeouts cannot create an inference backlog.
Decode loops also check the deadline. Normal parser/error/cancellation paths close
all spools; OS-generated names never use client paths. Abrupt hard termination has
OS/filesystem cleanup limitations; use a private ephemeral temp mount with an
operator-managed stale-file policy, never a shared public uploads directory.

Lifespan shutdown marks not-ready, denies new inference, waits a bounded interval
then shuts down the executor without blocking indefinitely. Already-running native
threads may continue and can delay Python interpreter exit. Orchestrators must
provide a final hard process deadline beyond Uvicorn + service drain windows
(e.g. 25 seconds). Do not multiply ASGI workers casually: each loads another model
and has independent limits. Native parser/inference memory/CPU containment also
requires process/container limits; library checks are not a native-code sandbox.

## Development

Use the same token as backend, or explicitly set
`PRONUNCIATION_ALLOW_INSECURE_LOCAL=true` on a loopback-only local service. Model
downloads require deliberate `WHISPER_ALLOW_DOWNLOAD=true` in development only.
For iteration only: `uvicorn main:app --reload --host 127.0.0.1 --port 8001`.

Install `requirements-dev.txt`, then run `python -B -m unittest -v test_service`.
Bootstrap the same pinned installer first. HTTPX is already in the locked runtime
Hub dependency graph; the development requirements add no unpinned dependencies.
Tests use synthetic local audio, real PyAV decode and stub model loading/inference;
no model is downloaded and no provider is called.

## Dependency integrity and security (11A-R2)

`requirements.in` lists the reviewed exact direct/transitive versions. To update,
edit only intended pins, then run `python -B scripts/lock-python.py` from the
repository root. The stdlib generator fetches published wheel SHA-256 hashes from
PyPI without selecting newer package versions; review the diff and clean-install.
`requirements.txt` enforces hashes and binary wheels. Hashes cover all published
platform wheels, not only the generator host; the supported baseline is CPython
3.12 on Windows/Linux x86_64. Windows-only colorama uses a marker. Linux wheel
hashes and dependency metadata closure are checked separately from Windows tests;
native CPU/GPU execution still requires deployment-platform validation. Other
platforms/source builds need a separately reviewed lock, not disabled hash checks.

`python -B ../scripts/check-python.py` checks every installed transitive version,
dependency constraint, input/lock agreement, installer pin, workflow YAML, action
SHA pins and read-only permissions. Run it after installation from this directory.
Security updates require read-only advisory lookup, feature reachability review,
clean installs and full tests; never accept resolver-driven major changes blindly.

R2 patches certifi, AnyIO, fsspec, python-multipart and supported Starlette without
changing FastAPI, HTTPX, faster-whisper or native inference packages. Remaining
registry findings are conditional: filelock 3.29.0 (GHSA-v4x8-3wr5-3wq8,
GHSA-9vhv-jxww-xfm5, GHSA-567q-5qvw-pf92) and setuptools 82.0.1
(GHSA-h35f-9h28-mq5c, GHSA-xmj3-9gf7-h52w). SQLite ReadWriteLock is unused;
Hub uses FileLock with a SoftFileLock fallback for unsupported filesystems.
Production uses a provisioned, trusted, immutable model/cache mount, not concurrent
downloads. The setuptools findings concern building/installing untrusted artifacts;
this workflow permits only reviewed hashed wheels. Defer the filelock major update
and setuptools work to R3; these are not demonstrated service request exposures.

Python TLS/provisioning and reproducibility staging dependency holds are cleared
by this declared set and offline artifact checks. This does not authorize staging
traffic or certify a real deployment's model provenance, filesystem or credentials.

## Release packaging

See [Release packaging and checklist](../RELEASE_PACKAGING.md) for artifact allowlists,
source-map policy, validated toolchains, build/version metadata and operator-only
identity/signing/configuration requirements.
