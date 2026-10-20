## Alur

```
User → Nuxt UI → Server API → AI Service → AIProvider (Kenari) → structured result
  → Zod validation → business validation → preview / clarification
  → [untuk mutasi] user konfirmasi → TransactionService → PostgreSQL
```

## Provider abstraction

- Interface `AIProvider` (`server/services/ai/ai.types.ts`); implementasi: `KenariProvider` (OpenAI-compatible chat completions).
- Konfigurasi runtime: `KENARI_BASE_URL`, `KENARI_API_KEY`, `KENARI_MODEL` (override runtime: `NUXT_KENARI_*`). Key hanya hidup di server; tidak pernah dikirim ke browser.
- Tanpa key: `requireAiProvider` melempar 503 `AI_UNAVAILABLE` — endpoint lain tetap jalan, tidak ada fabrikasi sukses.
- Error dinormalisasi: provider down/timeout → 503, rate limit provider → 429, respons tidak valid → 503; pesan aman tanpa payload/key/stack.

## Output tidak terpercaya (PRD §50)

- Setiap respons AI wajib lolos Zod schema ketat (transactionIntent / askAnswer).
- Parser TIDAK PERNAH mengarang data: info wajib yang kurang → `needsClarification=true` + pertanyaan konkret (amount null hanya sah saat clarification).
- Hasil parser dirender sebagai PREVIEW yang bisa diedit user; konfirmasi menyambung ke endpoint transaksi existing (validasi + otorisasi + idempotency berlaku).

## Ask Your Finances

- Konteks finansial disusun server-side dari data user yang diautentikasi (bukan dari jawaban AI).
- Jawaban AI adalah teks naratif — tidak pernah angka otoritatif (tampilan angka selalu dari API finansial deterministik).
- Konservasi privasi: konteks hanya milik user sesi; percakapan disimpan per user (`ai_conversations`/`ai_messages`) dan hanya bisa dibaca pemiliknya.

## Endpoint

- `POST /api/ai/transaction-parser` — parse bahasa Indonesia → intent transaksi (preview / clarification). Rate 10/menit.
- `POST /api/ai/ask` — tanya kondisi finansial. Rate 15/menit.
- `GET /api/ai/conversations`, `GET /api/ai/conversations/:id` — riwayat (ownership-scoped).

## Testing

- Unit: parser, normalisasi error, schema (mock fetch — bukan provider sungguhan).
- Integration: server build nyata + test double OpenAI-compatible lokal (:3199) yang deterministik — dipilih agar alur sukses & failure bisa diuji tanpa key sungguhan; ini fixture test, bukan stub di production path.
