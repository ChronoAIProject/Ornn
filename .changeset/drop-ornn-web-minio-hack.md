---
"ornn-web": patch
---

Drop the MinIO-specific proxy from `ornn-web/nginx.conf` and its frontend companion `toBrowserAccessibleUrl` in `useSkillPackage.ts`. These were local-dev bandaids that got baked into the production nginx image, causing deploys to fail with `host not found in upstream "minio"` on clusters without a MinIO service. Local dev now exposes MinIO through a dedicated ingress (`deployment/dependencies/minio/ingress.yaml`) at `minio.ornn-cluster.local`.
