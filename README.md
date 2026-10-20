# Financial OS

**Self-hosted personal financial intelligence application** — catat pemasukan & pengeluaran, kelola akun, atur budget dan target, proyeksikan cashflow, dan tanya AI soal keuanganmu.

> **Status:** Fungsional penuh (Phase 1–21). Auth, database, seluruh modul keuangan, AI layer opsional, backup/restore, dan test suite sudah jalan.

---

## Fitur

| Modul | Isi |
| --- | --- |
| **Dashboard** | Ringkasan cashflow, net worth, transaksi terbaru, dan tagihan mendatang |
| **Transactions** | CRUD income/expense, transfer antar akun, filter & pencarian |
| **Accounts** | Bank, e-wallet, cash, kartu kredit; saldo, arsip, dan restore akun |
| **Categories** | Kategori income/expense (termasuk kategori sistem) untuk klasifikasi transaksi |
| **Budgets** | Limit per kategori dengan periode dan progres pemakaian |
| **Recurring** | Template transaksi berulang + proses pembuatan transaksi terjadwal |
| **Bills** | Tagihan dengan status overdue / due soon / upcoming / paid dan aksi bayar |
| **Forecast** | Proyeksi cashflow ke depan dari pola transaksi dan item berulang |
| **Ask AI** | Tanya keuangan dengan bahasa natural + parser transaksi dari teks bebas |
| **Goals** | Target tabungan dengan progres dan proyeksi waktu tercapai |
| **Health** | Skor kesehatan finansial, tren net worth, dan rasio-rasio keuangan |
| **Reports** | Analitik: tren cashflow, pengeluaran per kategori, distribusi akun, performa budget |
| **Settings** | Ganti password akun (mengeluarkan perangkat lain dari sesi aktif) |

**UI/UX:** layout responsif — sidebar tetap di desktop, drawer burger di layar kecil — plus light/dark mode dengan toggle yang tersimpan.

---

## Stack

- **Framework:** Nuxt 4 (Vue 3, TypeScript strict, Nitro)
- **UI:** Tailwind CSS 4 + shadcn-vue / Reka UI
- **Database:** PostgreSQL 16 + Drizzle ORM (NUMERIC untuk uang, bukan float)
- **Auth:** session cookie HttpOnly (Argon2id untuk password, HMAC-SHA256 untuk token sesi)
- **AI (opsional):** API kompatibel OpenAI (Kenari)
- **Chart:** ECharts
- **Test:** Vitest (unit/integration) + Playwright (E2E browser)
- **Lint/Format:** ESLint + Prettier
- **Backup:** `pg_dump` (custom format) via script Python/batch

---

## Mulai

### Prasyarat

- Node.js ≥ 20 (di mesin ini: 26.7.0)
- PostgreSQL ≥ 15 (di mesin ini: PostgreSQL 16 portable)
- Git

### 1. Clone & install

```bash
git clone https://github.com/natanieltam/financial-os.git
cd financial-os
npm install
```

### 2. Konfigurasi environment

```bash
cp .env.example .env
```

Isi nilainya:

| Variabel | Wajib | Keterangan |
| --- | --- | --- |
| `DATABASE_URL` | ya | Connection string PostgreSQL, mis. `postgres://user:pass@127.0.0.1:5432/financial_os` |
| `SESSION_SECRET` | ya | Minimal 32 karakter acak. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `KENARI_BASE_URL` / `KENARI_API_KEY` / `KENARI_MODEL` | tidak | Tanpa key, endpoint AI balas `503 AI_UNAVAILABLE` dan fitur lain tetap jalan normal |

`.env` sudah di-`gitignore` — jangan pernah commit isinya. Override runtime pada server hasil build memakai prefix `NUXT_` (`NUXT_KENARI_API_KEY`, dst).

### 3. Migrasi database

```bash
npm run db:migrate
```

### 4. Jalankan

```bash
npm run dev          # http://localhost:3000
```

Saat pertama dibuka tanpa sesi, aplikasi mengarahkan ke `/welcome` (pilih sign in atau create account). Pada database kosong, plugin seed development otomatis membuat user demo `demo@example.com` / `demo1234` beserta akun, transaksi, budget, dan goal contoh. Matikan dengan `DISABLE_DEMO_SEED=1`.

### 5. Build & jalankan produksi

```bash
npm run build        # menghasilkan .output/
npm run start        # node .output/server/index.mjs
```

---

## Test

```bash
npm run lint         # ESLint
npm run typecheck    # vue-tsc + tsc untuk skema DB
npm run build        # WAJIB dulu — test integration menembak .output/server/index.mjs
npm test             # Vitest: 151 test di 9 file
npm run test:e2e     # Playwright: 3 skenario browser (register, navigasi, login)
```

`npm test` menjalankan server hasil build di port 3100; `test:e2e` di port 3300 (`E2E_PORT` bisa diubah).

---

## Struktur proyek

```
app/          Frontend Nuxt — pages, layouts, components, composables
server/       API Nitro — api/ (endpoint), services/ (domain logic), utils/, middleware/, plugins/
db/           Drizzle — client, schema/ (13 tabel), migrations/, seed/
shared/       Skema & tipe isomorfik (DTO, enum, util uang)
tests/        Vitest (unit/integration) + e2e/ (Playwright)
scripts/      backup.cmd/py, restore-test, start-db/stop-db, start-prod, smoke-db
docs/         Dokumentasi teknis
public/       Aset statis
```
