# Staging scan performance

The image pipeline uses standard `ubuntu-24.04` GitHub-hosted runners. API and web
build and scan concurrently. Each publication waits for its own qualified image
and one shared, parallel gate-test job. Publication uploads the exact archive
already built, smoke-tested and scanned in that run; it does not rebuild it.
The deployment job still requires both immutable publication receipts.

## Detector work

The scanner previously searched every staged path for every Gitleaks finding,
then hashed the containing file again for each finding. An exact path index and
one digest per physical file remove that repeated work even on a cold scan.

Develop runs can reuse Gitleaks evidence for identical staged blobs. The key binds
the blob SHA256, synthetic detector basename and layer stage. The cache identity
binds the exact scanner source, rules, Gitleaks executable and version, runtime,
detector flags and resource limits. A changed rule, input or identity is a miss.
The synthetic basename is included conservatively for path-sensitive rules;
inserting entries can reduce reuse. The current detector rules operate on each
input independently. Changes to detector semantics must retain that property or
disable this reuse.

Every physical layer and nested archive is still traversed and validated. Archive
digests, layer diff IDs, configuration, history, metadata, path checks, byte and
entry budgets, built-in content checks and nested decoding always run. The cache
only avoids repeating Gitleaks detection on identical layer inputs. Config and
history always run through Gitleaks. Cache hits recreate findings at each current
physical occurrence and apply the current allowlist. Artifact-specific reviewed
content policy and the final publication receipt are regenerated from the current
archive. Neither CLEAN decisions nor policy exemptions are cached.

## Producer trust

Only a `push` to this repository's `develop` can restore or upload detector
evidence. PR, release and manual runs do full detection. The restore helper reads
GitHub's run, job and artifact records, requiring the exact workflow, same
repository, develop push, source SHA and attempt, plus successful gate tests and
the matching image job. A deployment failure does not invalidate those completed
checks. The cache artifact's run association, bounded size and ZIP digest must
match GitHub's metadata. Only the single expected JSON member is read; archive
paths are never extracted. Missing, expired, malformed or untrusted evidence is a
full-scan miss. Lookup is bounded to five recent producers and short HTTP timeouts.

The artifact contains only fixed rule identifiers, line numbers and hashes. It
contains no image files, original paths, raw secrets or approval decisions. It is
retained for seven days through GitHub Actions artifacts, never a public registry.
The cache schema has 64 MiB and 100,000-entry limits. The scanner report includes
hit/miss counts and bytes plus detector and finding-mapping timings.

All actions retain their full commit pins. PR jobs receive no deployment or
registry credentials. Publication remains GHCR-only, and deployment continues
through the existing private controller contract.

## Measured API scan

One local run per mode on the same retained API archive (301,042,154 scanned
bytes), using macOS arm64, Python 3.9 and Gitleaks 8.30.1:

| Mode | Wall time | Layer detector hits | Layer detector misses |
| --- | ---: | ---: | ---: |
| Original full scan | 227.181 s | N/A | N/A |
| Indexed detector, cold cache | 55.971 s | 0 | 18,966 |
| Indexed detector, warm cache | 48.132 s | 18,966 | 0 |

Inventory, scanned bytes, completion, status, counts and every finding and
allowlisted entry matched across all three reports. Both optimized reports also
passed the existing artifact-specific content-policy resolver: 5,010 detected,
243 reviewed, 4,767 advisory, 1,718 allowlisted and zero blocking. These categories
follow the scanner's existing report schema; the allowlisted count is separate.

These are scanner measurements, not hosted merge-to-staging acceptance. Standard
hosted cold and warm runs must establish the end-to-end 5–10 minute target.
Changed-component selection and independent deployments require a corresponding
change to the deployment receipt contract. This change retains that contract and
does not claim those deployment optimizations or cross-run image reuse.
