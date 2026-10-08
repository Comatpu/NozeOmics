# Automatic updates

Status: v0.2.0 published on GitHub Releases on 2026-10-08. The public feed,
publisher signature, actual app download, healthy UI startup/activation,
preserved test data and all four published asset hashes were verified.

## User flow

1. Open the portable `NozeOmics.exe`.
2. A small startup window checks the stable release feed.
3. Download and verify a newer version, then open it automatically.
4. When offline or when verification/download fails, open the installed version.
5. A failed new startup returns to the previous version. The failed manifest is
   blocked until a different signed release is offered.

The application sends readiness only after its first successful UI refresh.
Already-running work is kept running; an update is applied on a fresh desktop
startup. MCP connections and background launches use the installed version and
do not initiate online downloads.

## Files

The user's top-level layout remains:

```
NozeOmics.exe
NozeOmics_data/
```

`NozeOmics_data/updates` stores verified ZIP downloads, signed activation
receipts, the runtime baseline receipt and a diagnostic log. Extracted program
files use the disposable Windows temporary cache. Application files never
overwrite project data. Cached application installations are immutable;
unchanged runtime files are shared with hard links where possible.

The outer EXE is a launcher. The displayed software version belongs to the
selected application, so it can be newer than the launcher's Windows file
version. Future launcher-protocol or data-schema changes require a separately
planned compatible migration; schema 1 is enforced by this implementation.

## Release contents

- `latest.json`: signed metadata, with version, compatibility, download URLs,
  byte counts and SHA-256 hashes.
- `NozeOmics-app.zip`: a complete application snapshot without Electron,
  Python, R or user data. UI/logic updates normally use this small ZIP.
- `NozeOmics-runtime.zip`: a complete runtime/application snapshot for changed
  runtime dependencies. A subsequent minor update uses the small ZIP again.
- `NozeOmics.exe`: initial portable distribution with the trusted public key.

The signature is RSA-3072/SHA-256. The launcher embeds the public key and pins
asset URLs to the configured GitHub release repository. HTTPS redirects may
not downgrade to HTTP. Downloaded bytes are verified before extraction.
Archive extraction rejects traversal, alternate streams, reserved Windows
names, case-colliding paths, symlinks and oversized content.

## Version and build procedure

`release.json` is the source of version/compatibility settings. Use:

```
python scripts/set_version.py 0.2.1
node scripts/package.mjs
python scripts/build_portable.py
node scripts/release.mjs
```

Run packaging in a separate checkout or after closing the development app;
the packaging tool replaces the unpacked development release directory.
Use `--runtime-id windows-x64-r2` only when the bundled runtimes change.
Do not reuse a ZIP from an older build to publish new UI/logic changes.

The local release-signing key is `.local/release-signing/private.pem`. Preserve
it securely; it is excluded from all build/release files. The public key is
`release-public-key.json`. Key changes need an explicit trust migration.

Build commands do **not** upload files or publish releases. Publishing is a
separate step, after review and tests: create stable tag `v<version>` in the
configured release-only repository, upload the four files, and publish only
after all assets are complete. Do not replace an already-published version;
increase the version. Never upload the source checkout, projects, caches or
signing key. GitHub's automatically added repository-source ZIP contains only
the release repository's README, not the private source checkout.

## Tests

```
node tests/test_updates.mjs
node tests/test_updates.mjs --startup
node tests/test_update_downloads.mjs
node tests/test_github_release.mjs
```

Tests cover real Windows extraction, signatures, numeric version ordering,
unsafe archives, preserved data, Unicode paths, interrupted downloads, offline
startup, healthy Electron/Python UI startup, failed startup rollback, and a
runtime upgrade followed by a small app update. Network tests use a local
fixture server and a separately compiled diagnostic executable. Its HTTP test
exception is removed by the preprocessor from the production launcher; the
production EXE has no feed override. The GitHub gate uses the production
publisher/feed and a disposable data/Codex configuration folder. It simulates
an older installed version to exercise download and activation without changing
the user's current app or data.
