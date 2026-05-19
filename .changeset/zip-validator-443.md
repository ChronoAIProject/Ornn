---
"ornn-web": patch
---

Harden the client-side ZIP validator with two new guards (#443): (1) explicit zip-slip / unsafe-path rejection (entries with `..` segments, leading `/`, backslashes, or Windows drive letters) — defence-in-depth on top of JSZip's internal handling so a future unzip-library swap doesn't quietly turn into a path-traversal bug; (2) cumulative uncompressed-size cap (50 MB) read off `_data.uncompressedSize` during `forEach` so a zip-bomb never enters the extraction loop. New i18n keys `errors.zip.unsafePath` and `errors.zip.uncompressedTooLarge` (EN + ZH). 6 unit tests cover both guards.
