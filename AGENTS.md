# AGENTS.md

This file sets repository-wide rules for coding agents in weiling.

Read first: `README.md` and `docs/manuals/README.md`.

Working goal:
Small, accurate, verifiable changes aligned with the current architecture.

Priority:
1. User task
2. This file + relevant workspace `PATTERNS.md`
3. `README.md` and `docs/manuals/*`
4. Existing code patterns

Core rules:
- Supervisor owns runtime; web writes durable intents only.
- SQLite is the source of truth; persistence logic lives in `packages/db`.
- Use FastAgent only through external contracts.
- Derive bot paths through shared resolvers; do not persist host-specific paths or commit runtime data, secrets, or artifacts.
- Default scope: single-machine, multi-user control plane, one bot per child process, SQLite, Better Auth email/password, per-bot SSE.

Workspace rules:
- `apps/web`: no local process management; intents first, supervisor reconciles.
- `apps/supervisor`: consume runtime JSONL and runtime state; child env must be allowlisted.
- `packages/db`: narrow semantic APIs; fresh SQLite schema must work; keep migrations in sync.
- `packages/shared`: only stable cross-workspace contracts; no compatibility layers unless explicitly required.

Development norms:
- Prefer test-first for new behavior and bug fixes.
- Keep diffs small and focused.
- Use the smallest verification set that covers the change.
- Prefer existing patterns and shared contracts.
- Keep rules concise.

Do not:
- Let web own runtime.
- Treat in-memory state as cross-process truth.
- Add retired-behavior compatibility unless required.
- Present scratch notes as user-facing docs.
- Claim tests, builds, or smoke checks passed unless actually run.

Common commands:
- `pnpm install`
- `pnpm build`
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm db:generate`
- `pnpm db:migrate`
- `pnpm --filter @weiling-ai/web test`
- `pnpm --filter @weiling-ai/supervisor test`
- `pnpm --filter @weiling-ai/db test`
- `pnpm --filter @weiling-ai/shared typecheck`

Environment and deployment:
- Node 20.18.1 is recommended.
- Root `.env` is for local dev; `infra/compose/.env` is for Compose.
- `FASTAGENT_SANDBOX_MODE` supports `remote` and `disabled`; remote uses Bot-specific pool credentials.
- The default Compose path is the repo-local three-image topology.
- Read the Docker runbook before Compose changes.

Verification:
- Run the smallest matching verification set.
- UI/API changes: web `test` / `typecheck`, `build` only when needed.
- Runtime/supervisor changes: supervisor `test` / `typecheck`.
- DB changes: db `test` / `typecheck` and migrations when required.
- Shared contract changes: affected workspace tests.
- Run `pnpm test:fastagent-contract` only when the required env exists.
- Report precisely: passed / not run / blocked.

Documentation:
- Update workspace `CHANGELOG.md` and `PATTERNS.md` when executable code or behavior changes.
- Keep current facts in `README.md` and `docs/manuals/`.
