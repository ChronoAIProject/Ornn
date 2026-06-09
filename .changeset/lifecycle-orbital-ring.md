---
"ornn-web": minor
---

feat(web): interactive skill-lifecycle orbital ring on the landing hero

Overlay an orbital "skill lifecycle" ring on the looping hero video: eight
agent-facing stages (search → preview → audit → install → execute → build →
publish → share, and back to search) around a hairline circle, with an ember
comet orbiting clockwise to signal the loop. Hovering / focusing / tapping a
stage ignites the node, draws a connector to the centre, and morphs the hub
into a detail card (agent-API hint + CTA) for that stage. Dark + light themes,
reduced-motion fallback, mobile tap support, and EN + ZH copy.

Also replace the two centred landing announcement modals with a single global
announcement banner: a collapsed top-right headline pill that expands on hover
into a dismissable stack, aggregating the hardcoded launch announcement and the
dynamic announcements, shown on every page.
