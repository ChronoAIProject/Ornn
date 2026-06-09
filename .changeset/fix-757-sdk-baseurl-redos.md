---
"@chronoai/ornn-sdk": patch
---

TS SDK baseUrl normalization strips trailing slashes with a linear loop instead of a regex, removing a polynomial ReDoS vector on pathological all-slash inputs (#757)
