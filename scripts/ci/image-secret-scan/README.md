# Public image secret gate — version 1.0.1

`scan-image-secrets.sh` inspects a saved image before publication. It scans **every layer independently**, including bytes later overwritten or deleted by whiteouts, and the complete image configuration. No image executable or container is started. Exit **0** means the configured scan completed without unresolved findings; **1** means findings; **2** means a scanner error or incomplete scan. Both 1 and 2 must block every push/publication path.

This is the shared local deliverable requested for CMA, Ornn, chrono-bucket and chrono-sandbox. Vendor the **complete reviewed directory**, including Python modules, Gitleaks rules and allowlist, into each repository through its normal review workflow. Do not copy only the shell entry point. This task has no assigned Git repository; the lead routes this bundle to repository owners and SA-01 for review.

## Dependencies and use

Requires Bash, Python 3.9+, and Gitleaks 8.25–8.x (validated with **8.30.1**). Archive input requires no Docker daemon. Local image references require Docker; zstd-compressed OCI layers also require `zstd`. No global package installation is performed by the scanner. Use the repository's approved pinned tool installer in CI.

```bash
docker image save --output candidate.tar example/image:local-candidate
./scan-image-secrets.sh candidate.tar --input-kind archive --output scan-report
# Or export an already-present local image without starting it:
./scan-image-secrets.sh example/image:local-candidate --output local-scan-report
```

The output directory must be new. The scanner writes `REPORT.json` and `REPORT.txt`; stdout contains only a short JSON result and stderr has safe progress counts. Do not run it with shell tracing. Image references are resolved once to an immutable local image ID before export. The scanner never pulls or pushes an image. For a remote image, an authorized deployment owner must first export it privately, then scan that archive before any public push.

Input formats are Docker `image save` tar archives and OCI image-layout tar archives, including gzip-compressed outer tar files. OCI gzip, zstd and uncompressed layer blobs are supported. **Every image in a Docker manifest and every referenced image/platform in an OCI index is inspected**, including nested indexes. Unknown artifact media types, missing blobs, malformed JSON, duplicate outer names, traversal names, digest mismatches and resource-limit exhaustion are errors, never CLEAN. OCI descriptor sizes/digests, Docker config filenames when content-addressed, and every uncompressed layer `diff_id` are checked. The archive SHA256 is computed before and after inspection and included in the report. `--expected-archive-sha256 HEX` adds an external artifact binding.

A local Docker export contains only the platforms available in that daemon. A multi-platform publisher must supply an OCI archive containing the entire intended index and all its blobs; a scan of one local platform must not approve another platform. `docker export` of a container and scans of a merged/root filesystem are unsuitable because they lose deleted-layer history.

## Inspection and output contract

Each layer is unpacked into its own private stage. Each tar member gets an independent synthetic file, so duplicate names cannot overwrite previous members. Reports use numeric image/layer/entry/member locators and SHA256 hashes of logical paths; original path strings are never published, including on errors. This representation avoids following links and prevents image-supplied `.gitleaksignore`, `.gitleaks.toml`, `.git`, vendor directories or file extensions from disabling scanning. A separate decoder identifies ZIP, gzip, tar (including legacy tar), bzip2, xz and zstd by magic bytes/header checksums, then recursively inspects their contents regardless of filename or suffix. Gitleaks receives each decoded file as a synthetic text file; its extension-based archive dispatch is disabled. Recognized malformed, encrypted or unsupported containers fail closed. ZIP central directories also identify prefixed/self-extracting ZIPs. Links, tar metadata and whiteouts are inventoried without creating devices or following symlinks/hardlinks. Empty regular whiteouts are deletion markers; they are counted rather than misclassified as empty private-key files. Earlier layer bytes still get scanned.

The full config JSON is scanned, plus decoded strings and assignments for **all** config properties: ENV, Labels, Cmd, Entrypoint, complete history/`created_by`, recorded ARG values, and arbitrary extensions. Joined command arrays catch split `--password VALUE` arguments. Only ARG values actually recorded in the image can be inspected; use BuildKit secret mounts instead of ARG/ENV for build credentials.

Detection combines:

- Gitleaks' built-in default rules (`extend.useDefault=true`) plus opaque-token, secret-assignment and hex-credential entropy rules. All files are passed with no size-based Gitleaks skip. Image-supplied inline `gitleaks:allow` directives and ignore files are disabled. Default upstream rule allowlists remain part of the pinned Gitleaks policy.
- Targeted paths: `*.pem`, `*.key`, `id_rsa*` and other SSH key families, `*.p12`, `*.pfx`, `.env*`, `.npmrc`, `.pypirc`, `.netrc`, `.docker/config.json`, kubeconfig, credentials/service-account JSON, `.git`, AWS/GCP/Azure credential paths, and Cargo credentials.
- Streaming private-key **header** detection, including binary files; service-account JSON content independent of filename; credential-bearing URLs; and secret-named config assignments, including low-entropy values.

Findings include scope, image/layer/entry indices, optional nested member indices, an opaque `path-sha256:<hex>` identifier, rule name, optional line and optional file SHA256. Compute the SHA256 of a known logical UTF-8 path locally to match it; no raw-path mapping is exported. Reports never include Gitleaks `Secret`, `Match`, source lines, ENV values, history commands or link target contents. Path confidentiality is independent of successful detection: filenames, config pointers and nested member names are always hashed, even when a detector times out, returns a partial/malformed report, or refuses a depth limit. Only safe fixed error identifiers are emitted, never raw tool errors. Reports intentionally omit the input reference and archive filename.

All raw layer/config data and the raw Gitleaks report live in a mode-0700 temporary directory under a 077 umask. Exact-value allowlisting requires reading Gitleaks' private `Secret` field internally; **that raw report is never published**. Temporary data is deleted on normal completion, findings, errors, SIGTERM or Ctrl-C. An uncatchable SIGKILL/machine failure can leave a private scratch directory; remove owned `image-secret-scan-*` directories after confirming no scanner is using them. Never upload them as CI artifacts.

Defaults: 20 GiB cumulative scanned bytes/archive cap, 1,000,000 entries, 900 seconds per external command, magic-based nested container depth 3 and Gitleaks content decode depth 5. Use `--max-bytes`, `--max-entries`, `--timeout` and `--tmpdir` for larger images. Malformed/encrypted/unsupported recognized containers, nested depth exhaustion, and Gitleaks warnings about skipped content fail with 2; limits never authorize a bypass. Temporary peak disk can include the exported archive, one compressed/uncompressed layer and that layer's extracted files. Encryption, unknown encodings and arbitrary opaque data still require security review: a heuristic scan is not mathematical proof that any possible credential is absent.

## Public-value allowlist

`allowlist.json` is a versioned policy file with a reason for every entry. The supplied entries are narrowly scoped, nonfunctional documentation examples for a reserved public URL and a public OAuth client identifier; they do not exempt production URLs or arbitrary client IDs. Actual repository values require review. A public OAuth **client ID** is not a client secret.

Each entry must bind an exact `rule`, `scope`, logical `path`, unique `id`, nonempty `reason`, and **one** of:

- `match_sha256`: SHA256 of the exact UTF-8 value Gitleaks identified (or complete file bytes for a targeted-path rule).
- `file_sha256`: SHA256 of a fully reviewed exact file, permitting only that rule in that exact path/content. This supports public certificate-only PEMs, checksums and public bundle constants without a wildcard directory exemption. For a decoded nested finding this is the decoded member file hash, and the exact logical path includes the full `container!member` chain.

Rules never use path globs or regex value exemptions. A changed value or changed file invalidates the exception. `content.private-key-header`, `content.service-account`, `content.credential-url` and `config.secret-assignment` cannot be allowlisted. Do not treat an unknown token as public just to turn CI green. Public certificate path and entropy findings need separate rule-specific entries; this does not exempt a private key header in the same file. Approved exceptions appear in the report by allowlist ID, and the complete allowlist/rules hashes bind the scan policy. Hash known-public material locally; do not add secret values to the allowlist or print raw detector reports.

## GitHub Actions: scan and publish the same saved artifact

[github-actions-step.yml](github-actions-step.yml) is ready to paste as a job step after checkout, approved dependency setup and registry login. Set `PUBLIC_STAGING_IMAGE_REPOSITORY`, and vendor this bundle at `.github/scripts/scan-image-secrets`. Adjust only the authorized build context/Dockerfile as required by the application.

The step builds once with a unique publication tag, records the immutable local ID, saves an archive, scans that archive, validates the report against its SHA256, reloads the same archive, checks the restored ID, and pushes. **There is no rebuild between scan and push.** Keep these operations in one job with exclusive ownership of the tag. Protect the scanner, rules and allowlist with code review; untrusted PR code must not be able to edit the gate in a privileged publishing job. Every alias/multi-platform/publication workflow must use the same reviewed gate, including manual reruns. Do not use `continue-on-error`, `|| true`, or a later unconditional push.

Retain the sanitized `REPORT.json`/`REPORT.txt`, scanner bundle hash, archive hash, exact local/config/manifest identities and the registry push digest as provenance. Do not upload the tarball or extracted content to public artifacts. Remote registries may use different manifest serialization; the registry receipt must still bind the scanned config and layers.

## Verification and maintenance

```bash
./self-test.sh
# Optional development tools, installed in a project-local environment:
python3 -m coverage run -m unittest discover -s tests -v
python3 -m coverage report
ruff check .
ruff format --check .
bash -n scan-image-secrets.sh self-test.sh
```

Self-tests require Docker and zstd. They generate nonfunctional fake key bytes at runtime, build image archives, **load a clean and a dirty fixture image into Docker**, scan through the real image-reference interface and remove those images. No fixture container is started and no real secret is embedded in source. Tests cover deleted/overwritten members, config/history, default and entropy rules, binary headers, nested archives, warnings, malformed inputs, allowlist boundaries and output redaction. The publication-step test uses a Docker stub to prove findings, scanner errors and tar tampering prevent push; it performs no registry writes. The scan engine injects archive/detector/policy components so a different backend can implement the same contract without changing archive traversal. Every source file stays below 500 lines. `pyproject.toml` enforces at least 80% coverage for the production scanner.
