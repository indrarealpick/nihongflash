// api/tts.js — Vercel Serverless Function
// Proxy Google Translate TTS untuk kualitas audio premium.
// POST /api/tts  Body: { "word": "食べる" }
// Mengembalikan: audio/mpeg (MP3)

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const word = (body && typeof body.word === 'string') ? body.word.trim() : '';
  if (!word || word.length > 100) return res.status(400).json({ error: 'word wajib diisi' });

  const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=ja&client=gtx&ttsspeed=0.85`;

  try {
    const response = await fetch(ttsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://translate.google.com/'
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) throw new Error(`TTS status: ${response.status}`);

    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800'); // cache 7 hari di browser
    return res.status(200).send(Buffer.from(buffer));

  } catch (err) {
    console.error('TTS error:', err.message);
    return res.status(502).json({ error: 'TTS tidak tersedia' });
  }
}
