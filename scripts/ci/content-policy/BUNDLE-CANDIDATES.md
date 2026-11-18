# Reviewed candidate identity in rebuilt web bundles

This is a review candidate. It does not replace the committed approval pins or
authorize publication. SA-03 must confirm the exact adapter and catalog before
the confirmation file and its checksum are updated.

The existing catalog binds component, exact path, detector rule and entire file
SHA256, optionally candidate SHA256 and line. A normal Vite rebuild changes the
file hash and generated filename even when the finding's candidate bytes are
identical. Repeating exact-file approvals therefore makes unrelated changes block
publication.

The v2 catalog adds `bundle_candidates`. Each entry binds an exact candidate
SHA256, exact rule, web component and one normalized JavaScript chunk path. The
only supported rule is `gitleaks.image-secret-assignment`; classification must be
`public-material`. A path pattern has the form
`usr/share/nginx/html/assets/<literal-chunk-stem>-*.js`; the wildcard matches
exactly eight ASCII letters, digits, underscores or hyphens. It never matches
directories, other extensions, nested archive members or a different chunk stem.
Unknown fields, broad wildcards and duplicate entries are rejected. A scoped
entry conflicting with a known REAL candidate in that chunk family is rejected.

The initial proposal contains one value only: candidate SHA256
`17b51881d8b1b599771cdabc403654dec66d1711c5a64d973a3864a9a99cd47d`
in `sections-*.js`. Four existing exact-file entries already classify these
candidate bytes as public material. They remain in the catalog unchanged. This
proposal explicitly extends that decision to identical candidate bytes in rebuilt
versions of the same chunk; it does not infer approvals for other values.

Every build still performs the full detector scan. The resolver reads the exact
archive, validates all layer/config identities, hashes the current regular-file
payload at the numeric tar entry, and verifies the reported current file hash and
path. It then parses the **whole current bundle** with the offline, pinned
`@babel/parser` 7.29.3 used for the original content review. The parser distribution
is vendored unchanged, checked against the existing `bun.lock` SHA512 integrity,
and included (with its runner, provenance and license) in the adapter approval
hashes. No bundle is imported or executed; no parser download or install runs in
the assessment job.

The adapter reconstructs the pinned assignment-rule captures and requires an exact
noncomputed `MemberExpression` at each real capture span. Babel and regex offsets
both use UTF-16, so Unicode before the capture does not shift the proof. A prefix
of a computed member or call cannot stand in for the whole value. Every occurrence
of the same candidate bytes in that file must pass, even on another line or when
multiple captures collapse into one detector row. A string, comment, template,
computed use or malformed bundle remains unresolved. One valid expression elsewhere
cannot authorize an unsafe occurrence. Missing matches, invalid UTF-8, parser
failures, the 16 MiB input limit or the 30 second parser timeout grant no scope.

Only after these checks does it record a hashed normalized scope for the finding. Links,
metadata occurrences whose hash differs from the payload, and nested findings do
not acquire this scope. Duplicate tar entries and earlier layers retain their own
identities. No stale file hash or line number is used as a reusable approval key.

Exact catalog entries retain precedence. A fallback can classify only the same
candidate bytes and rule in the reviewed scope. A new value or provider credential
is still detected and follows existing blocking rules. File-level findings without
a candidate digest remain exact-file-only. All detected findings stay in reports.

The resolver creates a new archive-bound classification packet for every build.
The publication receipt replays the exact reviewed matcher using the current file
identities and normalized-scope evidence. The checked-in catalog hash, adapter
hashes (including the exact parser and syntax runner), review-file checksum and
scanner source hashes must all match. SA-03 is
accepted alongside SA-01 as the owner-designated content reviewer; the packet
preserves the actual reviewer identity. Synthetic approvals exist only in tests.

Tests cover changed filename/file digest/line with identical candidate bytes; new
values in that same file; provider credentials; changed chunk, rule or component;
missing current identities; links and nested/metadata payloads; duplicate paths
and whiteouts; REAL conflicts; broad or malformed catalog entries; proposal-only
behavior; archive-bound packet/receipt replay; quoted/comment/computed/regex/template
and malformed contexts; safe and unsafe duplicate captures; UTF-16 span parity;
parser failure; and a bundle that would write a file if executed, whose file is
never created during syntax proof.
