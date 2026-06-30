# Infrastructure

Reference deployment assets for the AmpliFi off-chain services. **Testnet /
staging only** — see `PRODUCTION_READINESS.md`.

## Layout

- `k8s/services.yaml` — Deployments + Services for `pricing-api`, `risk-engine`,
  and the `keeper`, with readiness (`/ready`) + liveness (`/health`) probes,
  resource limits, non-root security contexts, and secrets pulled from the
  `amplifi-secrets` Secret.
- `caddy/Caddyfile` — Caddy reverse proxy providing automatic HTTPS (Let's
  Encrypt) and security headers (HSTS, nosniff, frame-deny) in front of the
  services.
- (repo root) `docker-compose.yml` — local multi-service bring-up.

## Quick start (Docker Compose)

```bash
docker compose up --build
# pricing-api → http://localhost:8801   risk-engine → http://localhost:8802
# metrics:  curl localhost:8801/metrics      readiness: curl localhost:8801/ready
```

## Kubernetes

```bash
kubectl create secret generic amplifi-secrets \
  --from-literal=api-keys=key1,key2 \
  --from-literal=keeper-key=0xYOUR_TESTNET_KEY \
  --from-literal=rpc-url=https://sepolia.base.org
kubectl apply -f infra/k8s/services.yaml
```

Put the Caddy proxy (or an Ingress with cert-manager) in front for TLS.

## Observability

Each service exposes Prometheus metrics at `GET /metrics`
(`http_requests_total`, `http_request_duration_ms`) and a readiness probe at
`GET /ready`. Point a Prometheus scrape at the `/metrics` endpoints and wire
alerts (error-rate, latency, keeper liveness) before any real-money launch.

## Secrets

Never commit keys. Use the cluster Secret (above), a cloud KMS/secrets manager,
or Docker/CI secrets. The keeper's signing key and RPC URL are injected at
runtime, not baked into images.
