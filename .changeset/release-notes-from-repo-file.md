---
---

CI: release workflow now reads `.github/release-notes-next.md` as the GitHub Release body, with a fall-back to a short link-to-CHANGELOG body when the file isn't curated. Replaces the raw-CHANGELOG dump that blew past GitHub's 125 000-char limit on v0.6.0.
