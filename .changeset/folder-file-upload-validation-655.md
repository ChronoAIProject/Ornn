---
"ornn-web": patch
---

Guided creation supporting-file upload now validates duplicate filenames + per-file size (#655).

The Guided wizard's Step 3 file uploader accepted whatever the user dropped — including a second `run.js` into the same `scripts/` folder (silently stacked, would have produced two entries with the same path in the final ZIP) and a 55 MB blob (no warning, would have blown through the backend's 100 MB total cap on its own).

Both guards now live inside `FolderFileUpload`'s `handleFileSelect`, so click + drop paths share them:

1. **Duplicate filename inside the same target folder** → rejected with inline `<name> already exists in <folder>/. Remove it first to replace.` Auto-overwrite would silently drop content the user hadn't intentionally removed; making them hit Remove keeps the action explicit. Cross-folder duplicates stay allowed (different paths in the final ZIP).
2. **Per-file size cap of 10 MiB** → rejected with `<name> is <size> — over the 10 MiB per-file limit.` Backend / ZIP pipeline still caps total uncompressed at ~100 MB (#443 / #633); 10 MiB per file keeps a single oversize artifact from eating the whole budget and surfaces the cap early.

Both errors render under the drop zone with `aria-live="polite"`, auto-clear on the next successful upload or folder switch, and explicitly do NOT call `onUpload` — parent state stays untouched on rejection so there's nothing for the user to undo.

A persistent `Per-file limit: 10 MiB` hint now sits above the file list so the cap is discoverable before the user picks a file.

i18n: 3 new keys per locale (`guided.fileSizeHint`, `guided.fileTooLarge`, `guided.fileDuplicate`) in EN + ZH.

Pinned with `FolderFileUpload.test.tsx` (6 assertions covering accept under cap, same-folder dup reject, cross-folder dup allowed, size-cap reject, error-clears-on-success, hint always visible).
