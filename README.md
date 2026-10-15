# Financial OS

Self-hosted personal financial intelligence application: **TRACK → UNDERSTAND → PREDICT → PLAN → ACT**.

> Status: **Phase 1 — Project Foundation.** Framework scaffold only.
> No financial features, authentication, database, or AI are implemented yet.

## Stack

- Nuxt 4 (Vue 3, TypeScript, Nitro)
- Tailwind CSS + shadcn-vue / Reka UI (component system)
- ESLint + Prettier
- PostgreSQL + Drizzle ORM (planned, Phase 2)
- Vitest + Playwright (planned)
- Kenari OpenAI-compatible API as optional AI layer (planned)

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
```

## Checks

```bash
npm run typecheck
npm run lint
npm run build
```

## Environment

Copy `.env.example` to `.env` and fill values. `.env` is git-ignored; never commit secrets.

## Documentation

- `docs/ARCHITECTURE.md` — architecture and project layout

## Project layout

```
app/       Nuxt frontend (pages, components, composables)
server/    Server API, services, domain logic
db/        Drizzle schema, migrations, seed (Phase 2)
shared/    Isomorphic schemas, types, constants
tests/     unit / integration / e2e (planned)
docs/      Documentation
```
