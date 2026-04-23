# OpenSandbox

OpenSandbox is installed via Helm chart, not plain K8s YAML.

## Install

```bash
helm upgrade --install opensandbox \
  https://github.com/alibaba/OpenSandbox/releases/download/helm/opensandbox/0.1.0/opensandbox-0.1.0.tgz \
  --namespace opensandbox-system --create-namespace \
  -f deployment/opensandbox/values.yaml
```

## Uninstall

```bash
helm uninstall opensandbox -n opensandbox-system
```

## Verify

```bash
kubectl get pods -n opensandbox-system
```

chrono-sandbox connects to OpenSandbox via:
```
http://opensandbox-server.opensandbox-system.svc:80
```
