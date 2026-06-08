---
"ornn-api": patch
---

Redemption-code generation now draws each character with crypto.randomInt for an unbiased uniform draw over the alphabet, clearing CodeQL js/biased-cryptographic-random (#757)
