# SavannaGuard Documentation

SavannaGuard Community is a source-available, self-hosted bot protection layer
with Proof-of-Work challenges, behavioral scoring, an admin dashboard, and
optional peer-to-peer federation.

## Start Here

- [API Reference](./api.md) - Current public, admin, and federation endpoints.
- [Deployment Guide](./deployment.md) - Docker, reverse proxy, environment, and production checklist.
- [Benchmarks](./BENCHMARKS.md) - Free baseline benchmark methodology and sample output.
- [Federation Protocol](../FEDERATION.md) - P2P signature sync details.
- [Security Policy](../SECURITY.md) - How to report vulnerabilities.
- [Contributing](../CONTRIBUTING.md) - Local setup, tests, and PR expectations.

## Quick Start

```bash
git clone https://github.com/etherman-os/SavannaGuard
cd SavannaGuard
cp .env.example .env
pnpm install
pnpm build
pnpm --filter @savannaguard/server start
```

Before exposing the service, set a strong `SECRET_KEY` and `ADMIN_PASSWORD` in
`.env`.

## Repository Notes

This repository is source-available, not OSI open source. Community self-hosting
and internal use are allowed under the repository license. Hosted/managed resale
requires a separate commercial agreement; see [LICENSE](../LICENSE) and
[COMMERCIAL_USE.md](../COMMERCIAL_USE.md).

Planning and commercial materials live in separate docs and are not required for
running the community edition.
