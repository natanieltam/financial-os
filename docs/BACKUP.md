# Backup & Restore

PRD §62–§63, golden rule 11: backup wajib, restorasi wajib terverifikasi.

## Strategi

- **Apa yang di-backup:** seluruh database `financial_os` via `pg_dump -Fc` (custom format, kompresi).
- **Seberapa sering:** harian. Jadwalkan Task Scheduler:
  ```powershell
  schtasks /Create /TN "FinancialOS-Backup" /TR "C:\path\to\repo\scripts\backup.cmd" /SC DAILY /ST 02:00
  ```
- **Disimpan terpisah dari DB primary:** default target `%USERPROFILE%\OneDrive\FinancialOS-Backups\` — folder ini di-sync OneDrive (copy off-machine via cloud). PRD §62: laptop yang sama BUKAN backup yang cukup; sinkronisasi OneDrive + (opsional) salinan ke drive eksternal menutup syarat ini. Ubah via variabel `FINOS_BACKUP_DIR`.

## Backup (jalankan kapan saja)

```bat
scripts\backup.cmd
```

Output: file `financial_os-YYYYMMDD-HHMMSS.dump` + checksum. Menyimpan 30 dump terakhir (dihapus otomatis lebih tua).

## Restore ke database produksi (DARURAT)

```bat
set PGPASSWORD=<password role financialos>
%LOCALAPPDATA%\pgsql16\pg16\pgsql\bin\pg_restore.exe -h 127.0.0.1 -U financialos -d financial_os --clean --if-exists <file.dump>
```

PRD §96: JANGAN restore ke produksi tanpa backup baru dibuat dulu (`backup.cmd` jalan otomatis sebelum setiap restore manual yang hati-hati).

## Restore test (dilakukan berkala — minimal sebelum mengandalkan backup)

```bat
scripts\restore-test.cmd <file.dump>
```

Script ini:
1. Membuat database scratch `financial_os_restore_test` (BUKAN produksi, tidak menyentuh `financial_os` apalagi `spot_ams`),
2. me-restore dump ke sana,
3. memverifikasi jumlah baris tabel penting (users, accounts, transactions, budgets, goals) > 0 dan konsisten,
4. mencetak PASS/FAIL,
5. menghapus database scratch.

Sebuah dump SAH hanya jika restore-test PASS (PRD §63). Hasil restore test terakhir dicatat di laporan rilis/commit message.

## Catatan

- Dump tidak masuk Git (folder backup di luar repo / di-ignored).
- `spot_ams` (database lain di cluster yang sama) TIDAK pernah disentuh oleh script backup/restore ini — target selalu `financial_os` / `financial_os_restore_test`.
