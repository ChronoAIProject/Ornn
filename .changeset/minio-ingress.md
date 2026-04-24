---
---

infra: local deploy — re-add the minio ingress and move chrono-storage to sign presigned URLs with `http://minio.ornn-cluster.local` so browsers can actually fetch skill packages. Adds port 80 on the minio Service (targetPort 9000) and a `hostAliases` entry on the chrono-storage deployment so both in-cluster and in-browser traffic hit the same host. Local-only; production uses real S3 where the endpoint is already browser-reachable.
