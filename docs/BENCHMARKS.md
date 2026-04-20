# Benchmarks

This document defines the reproducible baseline benchmark for the free/self-hosted repository.

## Goal

- Track performance trends over time for critical paths.
- Keep a reference point for CPU/RAM and latency before major releases.

## Current Baseline (April 2026)

- Host: local Linux dev machine
- Node: v22.x
- Workload profile:
  - `GET /health` (timed, high concurrency)
  - `POST /api/v1/challenge/create` (timed)
  - Full flow: create -> solve -> token validate (fixed flow count)

## How to Run

From repository root:

```bash
pnpm --filter @savannaguard/server build
node scripts/bench/free-baseline.mjs
```

Optional custom output path:

```bash
node scripts/bench/free-baseline.mjs docs/perf/free-baseline-custom.json
```

## Output

The benchmark writes JSON to `docs/perf/free-baseline-YYYY-MM-DD.json` by default.

Fields include:

- Environment metadata (CPU cores, memory, Node version)
- Scenario-level throughput (`rps`)
- Latency summary (`min`, `p50`, `p95`, `p99`, `max`, `avg`)
- CPU usage (`user`, `system`, `total` ms)
- Memory usage (`maxRssMiB`, `endRssMiB`)

## Interpretation Notes

- `challenge/create` throughput is affected by rate limit behavior and adaptive PoW state.
- Full-flow includes PoW solving cost in the benchmark process, so it is closer to end-user experience than pure API microbench.
- Compare results by percentiles and resource deltas, not only by raw RPS.
