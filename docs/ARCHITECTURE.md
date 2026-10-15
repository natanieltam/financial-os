# Architecture — Financial OS

## Style

Modular monolith. One Nuxt application (frontend + server API), one PostgreSQL database.
No microservices, no mandatory paid services.

```
Browser → Nuxt (app/) → Server API (server/) → Services → Domain Logic → Drizzle → PostgreSQL
                                      └→ AI Service (optional) → Kenari
```

## Golden rules (binding)

1. Frontend never talks to PostgreSQL directly.
2. AI never talks to PostgreSQL and never receives DB credentials.
3. AI never computes authoritative financial numbers (deterministic server logic does).
4. Authorization always happens server-side, from the session (never trust client `user_id`).
5. Money uses precise representation (PostgreSQL NUMERIC), never JS floats.
6. Financial mutations are atomic (DB transactions / rollback).
7. Secrets never enter Git; PostgreSQL never publicly exposed.
8. AI-generated transactions require explicit user confirmation.

## Directory layout

| Path      | Purpose                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| `app/`    | Vue frontend: pages, components (ui/dashboard/transactions/...), composables, layouts, types                         |
| `server/` | API routes, middleware, services (auth/accounts/transactions/budgets/goals/reports/forecast/ai), repositories, utils |
| `db/`     | Drizzle schema, migrations, seed (from Phase 2)                                                                      |
| `shared/` | Code used by both app and server: Zod schemas, types, constants                                                      |
| `tests/`  | unit / integration / e2e                                                                                             |
| `docs/`   | Documentation reflecting the actual implementation                                                                   |

## Status

- Phase 1: framework foundation — Nuxt 4 + TypeScript + Tailwind + lint/format + layout skeleton.
- Phase 2 (current): PostgreSQL database schema + Drizzle migrations (see `docs/DATABASE.md`).
- Not yet implemented: API, authentication, financial features, AI layer, tests.

Each phase updates this document to match what actually exists.
