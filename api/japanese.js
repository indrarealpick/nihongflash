// api/japanese.js — Vercel Serverless Function
// Provider: OpenRouter (OpenAI-compatible) + Dictionary (Supabase)
// Endpoint: POST /api/japanese  Body: { "word": "食べる" }
// Mengembalikan: { "reading": "たべる", "meaning": "Makan", "source": "dictionary"|"ai" }

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  maxRetries: 2,
  timeout: 15000,
  defaultHeaders: {
    'HTTP-Referer': process.env.APP_URL || 'https://nihongflash.vercel.app',
    'X-Title': 'Nihongo Flash'
  }
});

const MODEL = 'openai/gpt-4.1';

// Supabase service-role client (opsional). Jika env tidak diisi,
// fitur dictionary di backend dilewati — perilaku tetap seperti semula.
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = (SUPA_URL && SUPA_KEY)
  ? createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } })
  : null;

const SYSTEM_PROMPT = `Anda adalah ahli bahasa Jepang.
Untuk kata Jepang yang diberikan:
1. Berikan cara baca dalam hiragana.
2. Berikan arti Bahasa Indonesia paling umum.
Jawab HANYA JSON valid dengan format persis:
{"reading":"","meaning":""}`;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY belum dikonfigurasi di server' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const word = (body && typeof body.word === 'string') ? body.word.trim() : '';
  if (!word) return res.status(400).json({ error: 'Field "word" wajib diisi' });
  if (word.length > 60) return res.status(400).json({ error: 'Kata terlalu panjang' });

  // 1) Cek dictionary dulu (jika tersedia) — hemat panggilan AI.
  if (supa) {
    try {
      const { data } = await supa
        .from('dictionary')
        .select('reading, meaning')
        .or(`kanji.eq.${word},reading.eq.${word}`)
        .limit(1)
        .maybeSingle();
      if (data && data.reading && data.meaning) {
        return res.status(200).json({ reading: data.reading, meaning: data.meaning, source: 'dictionary' });
      }
    } catch (_) { /* lanjut ke AI */ }
  }

  // 2) Tidak ditemukan → panggil GPT-4.1 lewat OpenRouter.
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Kata Jepang:\n${word}` }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content || '';
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return res.status(502).json({ error: 'Respons AI bukan JSON valid' });
      parsed = JSON.parse(m[0]);
    }
    const reading = typeof parsed.reading === 'string' ? parsed.reading.trim() : '';
    const meaning = typeof parsed.meaning === 'string' ? parsed.meaning.trim() : '';
    if (!reading || !meaning) return res.status(502).json({ error: 'Respons AI tidak lengkap' });

    // 3) Simpan hasil AI ke dictionary agar terus berkembang (best-effort).
    if (supa) {
      supa.from('dictionary')
        .upsert({ kanji: word, reading, meaning, jlpt_level: 'AI' }, { onConflict: 'kanji,reading', ignoreDuplicates: true })
        .then(() => {}, () => {});
    }

    return res.status(200).json({ reading, meaning, source: 'ai' });

  } catch (err) {
    const status = err?.status || err?.response?.status;
    if (status === 401) return res.status(500).json({ error: 'OPENROUTER_API_KEY tidak valid' });
    if (status === 429) return res.status(429).json({ error: 'Rate limit OpenRouter, coba lagi sebentar' });
    if (err?.name === 'APIConnectionTimeoutError' || /timeout/i.test(err?.message || '')) {
      return res.status(504).json({ error: 'Permintaan ke AI timeout' });
    }
    console.error('AI error:', err?.message || err);
    return res.status(500).json({ error: 'Gagal menghasilkan flashcard' });
  }
}
