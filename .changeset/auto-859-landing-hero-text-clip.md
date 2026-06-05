---
"ornn-web": patch
---

Fix landing hero text being clipped at short/wide viewport ratios: re-encode the intro video + poster to a 2.4:1 canvas (blurred-scene edge fill) so the burned-in captions survive object-cover cropping, and drop the min-height that forced the hero past the viewport. Video stays full-bleed.
