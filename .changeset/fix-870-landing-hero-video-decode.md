---
"ornn-web": patch
---

Fix the landing hero video freezing on phones and other devices. The 4K upscale shipped an H.264 Level 6.0 / 5184px-wide asset that exceeds the hardware decoder limits of phones and most laptops, so the hero stayed stuck on the poster frame everywhere except the author's desktop. Reverted the video and poster to a universally-decodable 1080p encode (2592×1080, H.264 High Level 5.0), so the intro now autoplays for everyone.
