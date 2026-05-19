---
"ornn-api": patch
---

Validate the shape of `appPrivateKey` on `POST /github/repo` (#441). The mirror settings endpoint previously accepted any non-empty string; pastes with stray whitespace, embedded NULs, missing BEGIN/END markers, or a truncated body wrote garbage into settings and surfaced much later as opaque crypto errors during mirror runs. The new `validateGitHubAppPrivateKey` helper enforces an 8 KB cap, rejects C0 control bytes, requires PKCS#1 / PKCS#8 PEM markers, and round-trips through `crypto.createPrivateKey` to catch shape-passing-but-broken keys before they're persisted. Empty string still clears the key. 12 unit tests cover happy + rejection paths.
