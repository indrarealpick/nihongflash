// api/tts.js — Vercel Serverless Function
// Google Translate TTS (primary) + Supabase Storage cache
// POST /api/tts  Body: { "text": "食べる" }
// Mengembalikan: audio/mpeg
//
// Catatan: OpenRouter/GPT-4.1 adalah model TEKS, bukan audio.
// Google TTS menghasilkan kualitas suara identik dengan Google Translate,
// gratis, dan tidak membutuhkan API key tambahan.

import { createClient } from '@supabase/supabase-js';

// ---------- Supabase Storage cache ----------
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = (SUPA_URL && SUPA_KEY)
  ? createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } })
  : null;
const BUCKET = 'tts-cache';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function cacheKey(text) {
  return encodeURIComponent(text.trim().slice(0, 120)) + '.mp3';
}

async function getCached(key) {
  if (!supa) return null;
  try {
    const { data, error } = await supa.storage.from(BUCKET).download(key);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch { return null; }
}

async function putCache(key, buffer) {
  if (!supa) return;
  try {
    await supa.storage.from(BUCKET)
      .upload(key, buffer, { contentType: 'audio/mpeg', upsert: true });
  } catch {}
}

// Google Translate TTS — kualitas identik Google Translate, gratis
async function googleTts(text, speed = '0.9') {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=ja&client=gtx&ttsspeed=${speed}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://translate.google.com/'
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`Google TTS gagal: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const text = (body && typeof body.text === 'string') ? body.text.trim() : '';
  if (!text || text.length > 200) {
    return res.status(400).json({ error: 'Field "text" wajib diisi (max 200 karakter)' });
  }

  const key = cacheKey(text);

  // 1. Cek cache Supabase Storage
  const cached = await getCached(key);
  if (cached) {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=2592000');
    res.setHeader('X-TTS-Cache', 'HIT');
    res.setHeader('X-TTS-Source', 'cache');
    return res.status(200).send(cached);
  }

  // 2. Generate via Google TTS
  let audioBuffer;
  try {
    audioBuffer = await googleTts(text);
  } catch (err) {
    console.error('TTS error:', err.message);
    return res.status(502).json({ error: 'TTS tidak tersedia saat ini' });
  }

  // 3. Simpan ke cache (async, tidak blokir response)
  putCache(key, audioBuffer).catch(() => {});

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=2592000');
  res.setHeader('X-TTS-Cache', 'MISS');
  res.setHeader('X-TTS-Source', 'google');
  return res.status(200).send(audioBuffer);
}
