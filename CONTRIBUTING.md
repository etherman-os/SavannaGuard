# Contributing

SavannaGuard Community is source-available security software. Contributions are
welcome when they improve the self-hosted community edition and stay within the
license boundary.

## Local Setup

```bash
pnpm install
cp .env.example .env
pnpm build
pnpm --filter @savannaguard/server start
```

Set `SECRET_KEY` and `ADMIN_PASSWORD` in `.env` before testing anything exposed
outside your machine.

## Checks

Run these before opening a pull request:

```bash
pnpm typecheck
pnpm test
```

Docker federation integration tests require Docker Compose and explicit opt-in:

```bash
docker compose -f docker-compose.test.yml up -d --build
RUN_DOCKER_TESTS=1 \
NODE_A_URL=http://localhost:3001 \
NODE_B_URL=http://localhost:3002 \
NODE_A_PEER_URL=http://node-a:3000 \
NODE_B_PEER_URL=http://node-b:3000 \
FEDERATION_PSK=test-psk-key-for-federation-testing \
ADMIN_PASSWORD=admin \
SYNC_WAIT_MS=5000 \
pnpm --filter @savannaguard/server test -- --testNamePattern="federation-docker"
docker compose -f docker-compose.test.yml down --remove-orphans --volumes
```

Use `docker-compose` instead of `docker compose` if your environment does not
have the Compose plugin.

## Pull Request Expectations

- Keep changes focused on one behavior or documentation area.
- Add or update tests for behavior changes, especially auth, scoring,
  federation, token validation, and request parsing.
- Keep public docs aligned with real endpoint names, response fields, and
  environment variables.
- Do not commit generated local databases, real `.env` values, logs, or
  production telemetry.
- Avoid adding external services to the community runtime path.

## Security Changes

For security-sensitive fixes, prefer a private report first. Do not open a public
PR with a working exploit unless maintainers have agreed that public disclosure
is appropriate.

## License Boundary

Contributions are licensed under the same source-available license as this
repository unless a separate written agreement says otherwise. Hosted/managed
resale and paid control-plane features belong outside the community repo.
