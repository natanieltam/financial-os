# Deployment (Production)

Target arsitektur PRD §64/§103: Windows laptop → Nuxt production server → PostgreSQL lokal → Tailscale (akses privat dari HP).

## Konfigurasi environment produksi

Salin `.env.example` → `.env` lalu isi:

| Variabel | Wajib | Catatan |
|---|---|---|
| DATABASE_URL | ya | `postgres://financialos:...@127.0.0.1:5432/financial_os` — role dedicated, bukan postgres superuser |
| SESSION_SECRET | ya | Minimal 32 char acak. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| KENARI_BASE_URL / KENARI_API_KEY / KENARI_MODEL | opsional | Tanpa key, endpoint AI 503 AI_UNAVAILABLE, aplikasi lain tetap jalan |
| HOST / PORT | opsional | default 0.0.0.0:3000. Untuk Tailscale cukup bind normal; firewall Windows: izinkan hanya subnet Tailscale / private |

Override runtime untuk server hasil build: `NUXT_KENARI_BASE_URL`, `NUXT_KENARI_API_KEY`, `NUXT_KENARI_MODEL` (prefix NUXT_ untuk runtime config).

## Build & jalankan

```bash
npm ci
npm run build
npm run start        # nuxt start (production server dari .output)
```

`npm run dev` HANYA untuk development — jangan pernah dipakai di produksi (PRD §65).

## Migrasi database

```bash
npm run db:generate  # saat skema berubah (hasilnya commit ke Git)
npm run db:migrate   # jalankan migrasi terhadap DATABASE_URL
```

Sebelum migrasi produksi (PRD §96): jalankan `scripts/backup.cmd`, cek isi migrasi, migrasi Drizzle bersifat transaksional per file.

## Startup otomatis & resilience (PRD §64)

Laptop produksi harus: menyala terus, auto-start layanan, restart saat gagal.

```powershell
# Jalankan sekali sebagai user produksi (Task Scheduler):
schtasks /Create /TN "FinancialOS-Server" /TR "C:\path\to\repo\scripts\start-prod.cmd" /SC ONSTART /RU %USERNAME%
```

- `scripts/start-prod.cmd`: cek `.output` ada, set NODE_ENV=production, start `node .output/server/index.mjs`, log ke `logs/production.log`.
- Restart-on-failure: `schtasks /Change /TN "FinancialOS-Server" /RI 5 /DU 1440` (retry tiap 5 menit) atau set recovery di Properties task.
- PostgreSQL (portable): `scripts/start-db.cmd` bisa ditambahkan ke Startup folder. Pastikan disk cukup & laptop tidak sleep: `powercfg /change standby-timeout-ac 0`.

## Tailscale (PRD §66)

1. Install Tailscale (gratis untuk personal use — bukan layanan berbayar wajib) di laptop + HP.
2. `tailscale up` di laptop; catat IP 100.x.y.z.
3. Akses aplikasi: `http://100.x.y.z:3000` dari HP di jaringan Tailscale yang sama.
4. **Jangan** install Tailscale di mesin PostgreSQL terpisah / jangan buka 5432 ke tailnet — hanya port aplikasi yang boleh diakses.

## Logging & error handling

- Server production menulis log ke `logs/production.log` (stdout/stderr).
- Error API selalu envelope aman; log server berisi detail internal untuk operator — jangan share log mentah ke client.
- Audit log finansial tersimpan di tabel `audit_logs` (lihat docs/SECURITY.md).

## Keamanan secret

- `.env` tidak pernah di-commit (sudah di `.gitignore`, diverifikasi `git ls-files .env` kosong).
- Jangan pernah menaruh password/API key di source, docs, atau script.

## Langkah manual yang TIDAK bisa diotomatisasi di mesin ini

1. Buat `.env` produksi di mesin target + isi SESSION_SECRET kuat (di luar Git).
2. Install Tailscale + login (butuh akun).
3. Register Task Scheduler (`schtasks` di atas) dan Startup folder untuk `start-db.cmd`.
4. Set firewall Windows: izinkan Node.js / port 3000 hanya untuk profil Private/Tailscale.
5. (Opsional) Isi KENARI_API_KEY asli jika ingin fitur AI aktif.

Status verifikasi di mesin development ini: `npm run build` sukses, server production (`.output/server/index.mjs`) start dan melayani login/ API dengan DB lokal — itu yang bisa diverifikasi tanpa mesin/akun produksi eksternal.
