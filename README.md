# 🇯🇵 Nihongo Flash

**Belajar Bahasa Jepang Lebih Cepat.**

PWA Flashcard Bahasa Jepang dengan desain Neubrutalism. Frontend single-file (GitHub Pages) + Auth & Database (Supabase) + AI auto-fill cara baca & arti (OpenRouter `openai/gpt-4.1` via Vercel Serverless).

---

## 1. Struktur Folder

```
nihongo-flash/
├── index.html            ← Frontend lengkap (HTML+CSS+JS vanilla)
├── manifest.json         ← PWA manifest
├── service-worker.js     ← Offline cache
├── icon.svg              ← Logo (vektor)
├── icon-192.png          ← Icon PWA / apple-touch
├── icon-512.png          ← Icon PWA (maskable)
├── supabase-setup.sql    ← Skema DB + RLS + trigger
├── api/
│   └── japanese.js       ← Vercel Serverless Function (OpenAI)
├── package.json          ← Dependency backend (openai)
├── vercel.json           ← Konfigurasi Vercel + CORS
└── README.md
```

Satu repo dipakai untuk **dua deploy**: GitHub Pages menyajikan file statis (`index.html`, dll), Vercel menyajikan folder `api/`.

---

## 2. Setup Supabase

1. Buat project di **https://supabase.com** → **New Project**.
2. Buka **SQL Editor → New query**, tempel seluruh isi `supabase-setup.sql`, klik **Run**.
   (Membuat tabel `profiles`, `categories`, `flashcards`, RLS, dan trigger profil otomatis.)
3. **Matikan verifikasi email** (sesuai spesifikasi): **Authentication → Sign In / Providers → Email** → matikan **Confirm email** (`email_confirm = false`) → **Save**.
4. Ambil kredensial: **Project Settings → API**:
   - `Project URL`  → isi ke `SUPABASE_URL`
   - `anon public`  → isi ke `SUPABASE_ANON_KEY`

> `anon key` aman dipakai di frontend karena seluruh akses dilindungi **Row Level Security** — user hanya bisa membaca/mengubah datanya sendiri.

---

## 3. Setup Google Login

1. **Google Cloud Console** → buat **OAuth Client ID** (tipe **Web application**).
   - **Authorized redirect URI**:
     `https://<PROJECT-REF>.supabase.co/auth/v1/callback`
   - Salin **Client ID** & **Client Secret**.
2. Supabase → **Authentication → Providers → Google** → **Enable**, tempel Client ID & Secret → **Save**.
3. Supabase → **Authentication → URL Configuration → Redirect URLs**: tambahkan URL GitHub Pages Anda, contoh:
   `https://USERNAME.github.io/nihongo-flash/`
   (juga `http://localhost:*` jika ingin uji lokal).

---

## 4. Setup Vercel (Backend AI — OpenRouter)

1. Push repo ini ke GitHub (lihat langkah 5).
2. **https://vercel.com → Add New → Project → Import** repo tersebut.
3. **Environment Variables** → tambahkan:
   - Key: `OPENROUTER_API_KEY` — Value: API key OpenRouter Anda (dari https://openrouter.ai/keys).
   - *(opsional)* `APP_URL` — URL aplikasi Anda, dipakai sebagai header `HTTP-Referer` ke OpenRouter.
4. **Deploy.** Endpoint Anda akan menjadi:
   `https://<nama-project>.vercel.app/api/japanese`
5. Uji cepat:
   ```bash
   curl -X POST https://<nama-project>.vercel.app/api/japanese \
     -H "Content-Type: application/json" \
     -d '{"word":"食べる"}'
   # → {"reading":"たべる","meaning":"Makan"}
   ```

> Backend memanggil OpenRouter di `https://openrouter.ai/api/v1/chat/completions` dengan model `openai/gpt-4.1`. **API key hanya dibaca dari Environment Variable di server — tidak pernah disimpan di frontend.**

---

## 5. Isi Konfigurasi Frontend

Buka `index.html`, cari blok `const CONFIG` (dekat atas `<script>`), isi 3 nilai:

```js
const CONFIG = {
  SUPABASE_URL:      'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGci....',
  API_URL:           'https://nama-project.vercel.app/api/japanese'
};
```

---

## 6. Deploy ke GitHub Pages

```bash
cd nihongo-flash
git init
git add .
git commit -m "Nihongo Flash"
git branch -M main
git remote add origin https://github.com/USERNAME/nihongo-flash.git
git push -u origin main
```

Lalu di GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch** → pilih **main** / **/(root)** → **Save**.

Aplikasi live di: `https://USERNAME.github.io/nihongo-flash/`

> Setelah tahu URL Pages, pastikan URL itu sudah dimasukkan ke **Supabase → Redirect URLs** (langkah 3) agar Google Login berhasil redirect kembali.

---

## 7. Pasang sebagai App (PWA)

- **Android (Chrome):** muncul prompt "Pasang", atau menu ⋮ → **Install app / Add to Home screen**.
- **iPhone (Safari):** tombol **Share** → **Add to Home Screen**.

---

## Fitur

- Auth email/password + Google OAuth, sesi persisten (tak perlu login ulang).
- Kategori: tambah / edit / hapus (dengan konfirmasi) + jumlah flashcard.
- Flashcard: cukup pilih kategori & ketik kata Jepang — **AI mengisi cara baca + arti otomatis**.
- Belajar dengan **3D flip animation**, tandai ✓ Hafal / ✗ Belum Hafal (tersimpan otomatis).
- Cari realtime, filter kategori, sort terbaru / A-Z / status.
- Dashboard & Progress dengan progress bar + **canvas donut chart** + statistik per kategori.
- Export / Import JSON (backup & restore) dengan validasi file.
- Toast & modal bergaya Neubrutalism, offline cache, install prompt.
- Keamanan **RLS**: data tiap user terisolasi.

---

## Catatan

- Jika AI sedang gagal/timeout, aplikasi menawarkan input **manual** agar flashcard tetap bisa disimpan.
- Model AI: `openai/gpt-4.1` via **OpenRouter** (ubah di `api/japanese.js` konstanta `MODEL` bila perlu).
