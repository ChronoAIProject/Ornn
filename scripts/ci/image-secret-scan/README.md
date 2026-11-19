# Public image secret gate — version 1.0.3

`scan-image-secrets.sh` inspects a saved image before publication. It scans **every layer independently**, including bytes later overwritten or deleted by whiteouts, and the complete image configuration. No image executable or container is started. Exit **0** means the configured scan completed with no **blocking** findings; **1** means blocking findings; **2** means a scanner or classification error. The default blocking mode is `all`, preserving the existing strict behavior. Both 1 and 2 must block every push/publication path.

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

ZIP members are independently decoded with bounded standard-library stored/deflate/bzip2/LZMA readers. Actual stream EOF, compressed extent consumption, decoded size, CRC, local header and data-descriptor values must agree; ZIP64 and prefixed archives remain supported. ZIP LZMA decoding caps decoder memory at 256 MiB. Outer image tar files, layer tar files and nested tar files must contain two zero end blocks followed only by bounded zero padding. Unexplained trailing data or malformed framing produces an incomplete error report before detector-cache reuse can approve it.

## Inspection and output contract

Each layer is unpacked into its own private stage. Each tar member gets an independent synthetic file, so duplicate names cannot overwrite previous members. Reports use numeric image/layer/entry/member locators and SHA256 hashes of logical paths; original path strings are never published, including on errors. This representation avoids following links and prevents image-supplied `.gitleaksignore`, `.gitleaks.toml`, `.git`, vendor directories or file extensions from disabling scanning. A separate decoder identifies ZIP, gzip, tar (including legacy tar), bzip2, xz and zstd by magic bytes/header checksums, then recursively inspects their contents regardless of filename or suffix. Gitleaks receives each decoded file as a synthetic text file; its extension-based archive dispatch is disabled. Recognized malformed, encrypted or unsupported containers fail closed. ZIP central-directory structure also identifies prefixed/self-extracting ZIPs consistently across Python versions. An incidental ZIP end marker in an ordinary binary (including Python bytecode) is not sufficient: those bytes remain fully subject to raw Gitleaks and targeted scanning. Recognized malformed ZIPs still fail closed; ZIP64 records are delegated to the standard-library decoder. Decode errors name the format with a fixed identifier such as `nested-zip-decode-failed`, never file contents. Links, tar metadata and whiteouts are inventoried without creating devices or following symlinks/hardlinks. Empty regular whiteouts are deletion markers; they are counted rather than misclassified as empty private-key files. Earlier layer bytes still get scanned.

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

Version 1 exact-entry policies remain supported. In 1.0.2 the only exact-entry rules accepted are `gitleaks.image-high-entropy`, `gitleaks.generic-api-key` and `path.key-or-certificate`. All provider-specific credentials, PATs, cloud keys, private-key headers, service-account content, credential URLs, secret assignments and credential-file paths are non-allowlistable. Unknown rules are rejected, so a newly added provider rule cannot inherit an exception. A changed value or changed file invalidates an exact exception. Do not treat an unknown token as public just to turn CI green. Public certificate path and entropy findings need separate rule-specific entries; this does not exempt a private key header in the same file. Approved exceptions appear in the report by allowlist ID, and the complete allowlist/rules hashes bind the scan policy. Hash known-public material locally; do not add secret values to the allowlist or print raw detector reports.

### Reviewed generic-entropy glob entries (policy version 2)

Version 2 also accepts `path_glob` entries **only for `gitleaks.image-high-entropy`**, with a mandatory exact `file_sha256`, nonempty `reason` and `review` reference. These calibrations apply after every detector has run; they never skip a file, its archive decoding, config scanning, or another rule. The review must cover the full exact file. File hashes are scanner-computed SHA256 values, not trusted hashes inferred from asset filenames. Any content change requires a fresh entry and review.

Globs must have at least two concrete parent directories and may use `*` or `?` only in a leaf filename containing a dot. Directory wildcards, `**`, character classes, traversal and nested-container `!` paths are refused. Thus `usr/share/nginx/html/assets/*.js` or `app/dist/*.map` can match only reviewed exact files in those directories, never subdirectories or decoded members. Lockfile checksum findings can use an exact value/path entry; suppressing a whole changing lockfile is not supported.

Illustrative schema below is **not an active exception**. Replace the file hash with the reviewed file's actual digest and bind an actual reviewer receipt before adoption. SA-01 must approve each Ornn entry on the grouped triage; the supplied default policy adds **no Ornn-specific exceptions**.

```json
{
  "version": 2,
  "entries": [{
    "id": "reviewed-public-static-constant",
    "rule": "gitleaks.image-high-entropy",
    "scope": "layer",
    "path_glob": "usr/share/nginx/html/assets/*.js",
    "file_sha256": "REPLACE_WITH_REVIEWED_FILE_SHA256",
    "reason": "Describe the public constants and exact-file inspection.",
    "review": "Reference the approving review and its digest."
  }]
}
```

A `review` string records provenance; the scanner cannot authenticate a reviewer. The repository's protected review process must authorize the policy and protect its hash. The report binds the entire policy by SHA256 and records each applied exception ID with opaque path/file identity. Even if a reviewed entropy file contains a PAT or private-key header, the credential-specific finding remains unresolved and blocks publication.

## Owner-authorized Policy A (`--blocking-rules=credential`)

Version 1.0.3 implements the owner's 20:48 publication decision. This mode is explicit and never activated by image contents. Default `--blocking-rules=all` still blocks all unresolved detector findings.

```bash
./scan-image-secrets.sh candidate.tar --input-kind archive --output policy-a-report \
  --blocking-rules=credential --allowlist ornn-reviewed-allowlist.json
```

Detection is identical in both modes: every layer, deleted content, config/history, nested decoding, integrity check, targeted detector and default/entropy Gitleaks rule still runs. Any scanner error remains exit2. The only automatically advisory rule is **`gitleaks.image-high-entropy`**. Provider/cloud tokens, PATs, JWTs, private-key headers, credential URLs, generic API keys, secret/hex assignments and unknown rules remain blocking. Unresolved path heuristics remain blocking pending proof of their contents; a `.pem` suffix alone is not proof of a public certificate.

`REPORT.json` preserves the full `findings` and `allowlisted` arrays, and adds `blocking_rules`, `blocking_findings`, `advisory_findings`, `reviewed_classifications` and `counts`. `CLEAN`/exit0 in credential mode means the **Policy A blocking set is empty**, not that no detector findings exist. Generic entropy remains recorded. The text report prioritizes blocking paths/rules and gives separate counts. Consumers must validate the requested mode, `complete`, `exit_code`, empty `blocking_findings`, archive hash and policy hashes; they must not require the full `findings` array to be empty in Policy A.

### Exact per-finding review packets

SA-01 must approve every classification individually. Use `--classifications reviewed-classifications.json` only after its **exact file hash** is approved. This is separate from the existing exact-value allowlist. No credential-specific rule is disabled by a glob or directory exemption.

A packet binds the archive SHA256, scanner version, Gitleaks-rule hash, allowlist hash and individual finding IDs from that artifact's 1.0.3 report. A finding ID covers the opaque path, rule, numeric image/layer/member location, line, available file hash and candidate hash. Different candidates on the same line have different IDs. Packets cannot transfer to rebuilt images or changed policies; stale or duplicate entries, unknown labels, missing review metadata and malformed packets fail with exit2. Unclassified findings continue to block.

```json
{
  "schema": "image-secret-classifications-v1",
  "archive_sha256": "COPY_FROM_THE_EXACT_REPORT",
  "scanner_version": "1.0.3",
  "gitleaks_rules_sha256": "COPY_FROM_REPORT_POLICY",
  "allowlist_sha256": "COPY_FROM_REPORT_POLICY",
  "review": {
    "reviewer": "solution-architect-01",
    "reference": "REFERENCE_TO_APPROVING_REVIEW",
    "report_sha256": "SHA256_OF_APPROVING_REVIEW"
  },
  "entries": [{
    "finding_id": "COPY_FROM_THE_EXACT_FINDING",
    "classification": "public-material",
    "reason": "Describe the exact inspected public content without values."
  }]
}
```

Permitted classifications are `library-example`, `test-fixture`, `public-material` and `REAL`. The first three record a reviewed non-blocking disposition; **REAL always blocks**, even when the original rule was generic entropy. Public certificates/signing keys become non-blocking only through existing exact approved policy entries or an exact public-material classification, while actual private keys stay blocking. No real image classifications ship in the default bundle.

Review metadata is provenance, not a cryptographic reviewer authentication scheme. The protected workflow must enforce SA-01 approval of the exact packet and protect it as it protects scanner/allowlist code. The scanner exports only the packet/review hashes and classification labels; it never exports reasons or reference text, which may contain sensitive data. Every classification remains visible with its finding in the receipt.

Prepare review packets from a complete scan of the **saved artifact**, then re-scan that same artifact with the approved packet. Do not rebuild between review, scan and push. Prune unnecessary tests/docs/examples before their layer is committed, or omit them from the runtime-stage copy: a deletion in a later layer does not erase their earlier bytes.

## GitHub Actions: scan and publish the same saved artifact

[github-actions-step.yml](github-actions-step.yml) is ready to paste as a job step after checkout, approved dependency setup and registry login. Set `PUBLIC_STAGING_IMAGE_REPOSITORY`, and vendor this bundle at `.github/scripts/scan-image-secrets`. Adjust only the authorized build context/Dockerfile as required by the application.

The step defaults to `all`. Set `IMAGE_SECRET_BLOCKING_RULES=credential` only under the owner-authorized policy; optionally set `IMAGE_SECRET_CLASSIFICATIONS` to the approved packet for this exact saved artifact. The binding check verifies the requested mode and empty blocking set. The step builds once with a unique publication tag, records the immutable local ID, saves an archive, scans that archive, validates the report against its SHA256, reloads the same archive, checks the restored ID, and pushes. **There is no rebuild between scan and push.** Keep these operations in one job with exclusive ownership of the tag. Protect the scanner, rules and allowlist with code review; untrusted PR code must not be able to edit the gate in a privileged publishing job. Every alias/multi-platform/publication workflow must use the same reviewed gate, including manual reruns. Do not use `continue-on-error`, `|| true`, or a later unconditional push.

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
