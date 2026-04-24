---
"ornn-web": minor
---

frontend: audit-gated share workflow — PR 2/3. Adds the `/shares/:requestId` detail page: status pill, audit findings (pulled from the cached audit record), and a justification form for owners when the request is in `needs-justification`. Existing justifications + reviewer decisions render read-only. Owner cancel action also lives here. The reviewer accept/reject controls land in PR #160c. Progresses #160 from the phase-3 frontend catch-up umbrella (#156).
