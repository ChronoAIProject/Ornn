---
"ornn-api": patch
"ornn-web": patch
---

Harden the user-directory endpoints against enumeration: /users/search now rejects empty and single-character queries, and both /users/search and /users/resolve are rate-limited per user. The collaborator typeahead asks for at least 2 characters before searching.
