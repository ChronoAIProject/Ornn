# Ornn content classification catalog and scanner 1.0.3 adapter

The proposed v2 extension is described in [BUNDLE-CANDIDATES.md](BUNDLE-CANDIDATES.md).
It preserves the existing exact-file entries and adds one explicitly reviewed
candidate-value scope for rebuilt Vite bundles, conditional on whole-bundle parsing
and exact noncomputed member-expression spans for every occurrence. Its new catalog/adapter approval
is pending SA-03; existing approval pins do not authorize the extension. The
remaining historical description below documents the original v1 catalog.

Status: REVIEW CANDIDATE. This package does not grant publication approval.

`ornn-content-policy.json` deterministically derives from SA-01's 371 approved smoke-image occurrences. It contains 369 occurrence-specific entries under 334 component/path/rule/file-content keys. Repeated candidates additionally retain candidate SHA256 and line constraints. Two identical occurrences deduplicate; every original finding ID remains recorded. `build_catalog.py` reproduces the JSON byte-for-byte from the named evidence. `REPRODUCIBILITY.json` records this check.

Catalog SHA256: `bfdb8f657bdbf627ec92daf858edeb7cfd284c2b10e25970f2026a62afaffa07`.
Required public allowlist SHA256: `0db6a7a261c27645c36d075aac5a16746907b21875560ba95e49cc7e91e6000f`.

The original SA-01 verdict approves exact smoke archives. A matching confirmation of the catalog and adapter is required before using its packets. Under v1, an identical candidate hash alone cannot approve a changed file. V2 permits only an explicitly approved candidate hash, rule, component and bounded bundle path scope; every new value outside that approval remains unresolved. REAL classifications remain blocking. High entropy is retained as advisory under owner Policy A. Detection remains unchanged; the packet reader also accepts owner-designated reviewer SA-03 and preserves the actual reviewer identity.

## Why the adapter is needed

Scanner 1.0.3 accepts only archive-bound `image-secret-classifications-v1` packets. The content catalog cannot be passed directly to `--classifications`. The adapter reads a completed, unclassified 1.0.3 scan and the exact saved archive, verifies the scanner files and archive hash, revalidates image/config/layer identities using the existing ImageArchive implementation, then computes actual file identities. It emits a normal scanner-compatible `classifications.json` and calls unchanged `image_secrets.gate.assess` to produce the assessed REPORT.json. All original detections are retained. This is assessment of a full scan, not another detector scan.

Regular files are hashed independently at their numeric tar entry, including overwritten duplicate entries. Whiteouts are applied only to virtual link resolution; findings from earlier layers remain in the report. Symlinks resolve inside the virtual image to their exact target content at that layer, never through the host filesystem. Hardlinks, cycles, missing targets, nested metadata not matching the original file identity, and unsupported identities remain unclassified. No extracted image files survive cleanup. Every archive is hashed before and after readback.

## Confirmation contract

SA-01 supplies a committed JSON review containing these fields (additional review details are permitted):

```json
{
  "verdict": "GO_CONTENT_POLICY",
  "reviewer": "solution-architect-01",
  "catalog_sha256": "<exact catalog hash>",
  "adapter_files": {"content_catalog.py": "<sha256>", "content_identity.py": "<sha256>", "resolve_content_policy.py": "<sha256>"}
}
```

`MANIFEST.json` supplies the exact proposed adapter hashes. A reviewer name string is not sufficient: the protected workflow must use the checked-in reviewed catalog, adapter and confirmation, whose bytes are covered by source review. The packet records the confirmation-file hash and catalog identity. Never accept these pins from an image, environment-controlled download or an arbitrary scan report.

## Developer-23 integration

Vendor `tool/`, catalog and the subsequently approved confirmation next to the frozen scanner. Run the unmodified detector on the saved archive exactly once. Retain its complete raw report separately. Accept detector exit 0 or 1 for this assessment stage only; exit 2 immediately fails the job. Do not upload/push the image at this point.

```bash
scan_rc=0
bash scripts/ci/image-secret-scan/scan-image-secrets.sh "$archive" \
  --input-kind archive --blocking-rules credential \
  --allowlist scripts/ci/ornn-image-allowlist.json \
  --expected-archive-sha256 "$archive_sha" \
  --output staging-image-out/secret-scan-raw || scan_rc=$?
case "$scan_rc" in 0|1) ;; *) exit 2 ;; esac
python3 scripts/ci/content-policy/resolve_content_policy.py \
  --scanner scripts/ci/image-secret-scan \
  --archive "$archive" --report staging-image-out/secret-scan-raw/REPORT.json \
  --catalog scripts/ci/ornn-content-policy.json \
  --review scripts/ci/ornn-content-policy-review.json \
  --component "$COMPONENT" --output staging-image-out/secret-scan
```

The adapter exits 0 only for an assessed CLEAN result, 1 for unreviewed/REAL findings, and 2 for any error. `--proposal` instead of `--review` emits only a REVIEW_REQUIRED resolution and exits 1; it cannot emit a clean report or classification packet.

Update `staging_scan_receipt.py` before enabling this flow: validate checked-in catalog/adapter/confirmation hashes against RESOLUTION.json; verify hashes of raw report, assessed report and classifications.json; verify resolution archive hash equals metadata and the saved archive; require complete=true/proposal=false/CLEAN and no unresolved findings. Pass the exact packet and confirmation hashes into the existing `verify_decision(scan, classification_sha256, review_sha256)`. Its expected policy must include those two fields in addition to rules and allowlist. The publish receipt must retain these pins and recheck the exact saved archive. Do not merely accept a self-reported classifications hash. Keep raw report plus assessed report/packet/resolution as sanitized evidence; never upload failed image archives publicly. No rebuild between scan and push.

## Validation and remaining native blockers

15 synthetic-image tests pass, including a full real-gitleaks detector run followed by the adapter and unchanged scanner packet reader; content substitution, symlink substitution/cycle, duplicate entries, whiteouts, opaque directories, missing identities, changed policy, REAL, and error cases. Coverage is 96%; Ruff passes. All source modules are below 500 lines. Synthetic test reviews are temporary and authorize nothing outside the test.

Latest available CI run 44096478304 is source head638faf184aa676a448a41e341d138b331940685b; artifact names identify merge build3af6132a2e1f12ace359bf5a74601b915bd4193a. Both complete raw receipts use the corrected allowlist. API has242 blockers:89 match the catalog using report-provided file hashes;153 need exact archive readback. Web has129 blockers:4 hash matches,123 need archive readback, and2 changed JavaScript bundle path/file identities need fresh SA-01 approval. See LATEST-NATIVE-REPORT-COMPARISON.json for hashes and numeric locators only. These comparisons are NOT publication receipts.

The failed CI jobs skipped saved-image artifact upload. The exact native archives were not available locally at delivery. Consequently full local native identity verification and zero-unreviewed-blocker acceptance are NOT claimed. Run the adapter in CI while the saved archive is present, or provide those exact private archives for local proposal evaluation. The two changed bundles must remain blocked until reviewed; no broad exemption is included.

Re-run the checks with a local environment containing coverage/Ruff:

```bash
TEST_SCANNER=/absolute/path/to/candidate-1.0.3 python3 -m unittest discover -s tests
ruff check tool tests build_catalog.py
```

Targeted tar-metadata matches are deliberately ineligible for payload classifications: a reviewed file hash does not approve credential bytes added to PAX headers. The regression suite covers this case.
