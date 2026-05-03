@AGENTS.md

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build (includes type check) |
| `npm run start` | Run the built app |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` — no-emit type check |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest in watch mode |

## Code quality expectations

- `npm run lint` must finish with **0 errors**. Pre-existing warnings are tolerated; do not introduce new ones.
- `npm run typecheck` must pass with **0 errors**.
- `npm test` must pass.
- For new features, write tests in Vitest. Tests live in `tests/**/*.test.ts` or co-located as `lib/**/*.test.ts`.
- **Don't retrofit tests onto existing code.** Tests come with new feature work, not as backfill.

## Project documentation

- [`docs/SYSTEM.md`](docs/SYSTEM.md) — full engineering reference (architecture, schemas, crons, env vars).
- [`CONTEXT.md`](CONTEXT.md) — domain glossary (cohorts, products, MailerLite constraints, audience policy).
- [`docs/adr/`](docs/adr/) — architectural decision records.
