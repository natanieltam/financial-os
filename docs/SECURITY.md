# Security

Kebijakan keamanan Financial OS. PRD §12–§18, §59–§61, §91, §102.

## Authentication

- Password di-hash **Argon2id** (`@node-rs/argon2`, default Argon2id) — tidak pernah disimpan/ dikirim plaintext.
- Login rate-limited: 5 percobaan / 15 menit per email, 20 / 15 menit per IP.
- Register: 30 / menit per IP. Ganti password: 5 / 15 menit per IP.
- Session: token acak 32 byte; yang disimpan di DB hanya HMAC-SHA256(token, SESSION_SECRET).
- Cookie `finos_session`: HttpOnly, SameSite=Lax, Path=/, Secure saat NODE_ENV=production, maxAge 30 hari.
- Expiry server-side dicek di setiap resolve sesi (`expires_at` + `revoked_at`); logout mencabut sesi di DB, bukan cuma cookie.
- Ganti password mencabut SEMUA sesi lain (POST /api/auth/password).

## Authorization

- Identitas selalu dari sesi server-side (`requireUser`). `user_id` dari client tidak pernah dipercaya (golden rule 13).
- Semua query financial di-scope `user_id` dari sesi; akses lintas user balik 404 (tidak membocorkan keberadaan data).
- Berlaku untuk: accounts, categories, transactions, budgets, goals, recurring, bills, forecast, AI conversations.

## Input security

- Semua body/query divalidasi Zod sebelum menyentuh DB (ID harus UUID — param non-UUID = 404 sebelum query).
- Uang: string decimal 2dp di API, `numeric(18,2)` di DB, BigInt cents untuk aritmetika — float JS tidak pernah dipakai.
- SQL: 100% Drizzle parameterized — tidak ada string SQL dari input.

## CSRF

- SameSite=Lax + HttpOnly cookie (browser tidak mengirim cookie lintas situs untuk POST).
- Plugin `server/plugins/origin-check.ts`: request non-GET dengan header Origin lintas origin = 403.
- Tidak ada CORS header yang di-allow untuk origin asing.

## AI security

- AI server-side hanya; API key di runtimeConfig server, tidak pernah di `public` config — tidak masuk client bundle.
- AI tidak punya akses DB/ kredensial DB; output AI adalah input tidak terpercaya yang di-Zod-validate.
- Prompt injection tidak bisa bypass authorization: akun/kategori hasil parser di-resolve terhadap kepemilikan user server-side, dan mutasi AI wajib konfirmasi user → TransactionService.
- AI tidak bisa menghitung angka finansial otoritatif — semua perhitungan deterministik server-side.

## Database security

- PostgreSQL listen hanya localhost (default `listen_addresses = 'localhost'`); pg_hba hanya menerima 127.0.0.1/::1 + local md5.
- Tidak pernah diekspos publik / lewat Tailscale.
- Constraints: FK dengan ON DELETE behavior, unique (email, idempotency key), check amount > 0, soft delete `deleted_at` untuk transaksi.
- 18 index untuk query ownership + pencarian.

## Rate limiting (PRD §61)

| Endpoint | Limit |
|---|---|
| login | 5/email/15m + 20/IP/15m |
| register | 30/IP/menit |
| password change | 5/IP/15m |
| AI parse | 10/IP/menit |
| AI ask | 15/IP/menit |
| transaction create/update/delete | 120/IP/menit |
| recurring process | 10/IP/menit |

## Audit logging

Tercatat per user + IP, tanpa secret/body mentah: login, logout, failed_login, password_change, account_created/updated/archived (user & bank account), category_*, transaction_created/updated/deleted, transfer_created, budget_*, goal_*, recurring_*, bill_*.

## Error handling

- Semua error dikemas envelope `{ success:false, error:{ code, message } }` — stack trace, SQL, path, credential tidak pernah sampai ke client.
- Pesan error ditulis manual, bukan copy exception internal.

## Secret handling

- `.env` di-gitignore (termasuk `.env.*`, kecuali `.env.example`).
- `SESSION_SECRET` wajib ≥32 char; jangan pernah memakai nilai contoh di produksi.

## Known gaps (jujur)

- CSP tidak dipasang: Nuxt menyuntik script per halaman, CSP ketat butuh nonce plumbing dan berisiko memutus hydration. Dihitung sadar, dicatat di sini.
- Belum ada 2FA/WebAuthn — di luar scope PRD.
