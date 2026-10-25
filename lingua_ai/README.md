# lingua_ai

See [Production configuration](../PRODUCTION_CONFIGURATION.md) for mandatory
release `API_URL`, Android signing, and platform permission requirements. Release
startup rejects development endpoints; debug builds retain local convenience.

## Local release-quality validation

Use Flutter 3.41.7 / Dart 3.11.5 with the checked-in lock:

```sh
flutter pub get --enforce-lockfile
flutter test
flutter analyze
flutter test test/release_config_test.dart test/protocol_compatibility_test.dart
```

Android applicationId/namespace `com.example.lingua_ai` and iOS bundle ID
`com.example.linguaAi` are placeholders that block public/store release until
approved identities are assigned. Current version is `1.0.0+1`; no final release
number is chosen. Signing remains operator-owned; no debug-key release fallback.

## Release packaging

See [Release packaging and checklist](../RELEASE_PACKAGING.md) for artifact allowlists,
source-map policy, validated toolchains, build/version metadata and operator-only
identity/signing/configuration requirements.
