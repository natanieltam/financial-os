# Database — Financial OS

## Instance

- PostgreSQL 16 (portable), local only (127.0.0.1:5432, never public).
- Data dir: `%LOCALAPPDATA%\pgsql16\data`
- Start/stop: `scripts\start-db.cmd` / `scripts\stop-db.cmd`
- App database: `financial_os`, owned by dedicated login `financialos` (NOT superuser).
- Credentials live in `.env` (git-ignored). Never in Git.

## Pitfall — TEMP=/tmp crashes PostgreSQL on this machine

git-bash exports `TEMP=/tmp`. A postmaster started from git-bash inherits it and every
new backend dies with `0xC0000142` (DLL init failure), killing the whole cluster.
Always start PostgreSQL via `scripts\start-db.cmd` (or PowerShell with TEMP set to a
real Windows path).

## Stack

- Drizzle ORM (schema in `db/schema/`, client in `db/client.ts`).
- All money columns are `NUMERIC(20,2)` — the driver returns strings; JS floats are
  never used for financial math (PRD §17).

## Migration workflow (safe, forward-only)

```bash
npm run db:generate   # generate SQL migration from schema changes -> db/migrations/
npm run db:migrate    # apply pending migrations to financial_os
npm run db:studio     # optional: browse data (local only)
```

Rules:

- Never edit an already-applied migration; generate a new one.
- Never drop tables/columns containing user data without explicit approval.
- Migrations run against the app user; production data is never touched by tooling
  without a reviewed backup/restore plan (PRD §64).

## Tables (Phase 2)

users, sessions, accounts, categories, transactions, budgets, budget_items, goals,
recurring_transactions, bills, audit_logs, ai_conversations, ai_messages.

Ownership: every user-owned table carries `user_id` FK. `transactions.account_id` is
`ON DELETE RESTRICT` (history survives), `category_id`/`recurring_transaction_id` are
`ON DELETE SET NULL`.
