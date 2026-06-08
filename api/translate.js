// api/translate.js — AI Translate gaya DeepL (natural) + cara baca
// POST /api/translate
// Body teks : { text, from, to }
// Body foto : { image (data URL base64), to }
// Return    : { translation, reading, romaji, detected? }

function setCors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}

export default async function handler(req, res){
  setCors(res);
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method!=='POST') return res.status(405).end();

  let body=req.body;
  if(typeof body==='string'){try{body=JSON.parse(body);}catch{body={};}}

  const text  = (body?.text||'').trim();
  const image = body?.image||'';
  const from  = body?.from||'id';
  const to    = body?.to||'ja';

  if(!process.env.OPENROUTER_API_KEY) return res.status(500).json({error:'OPENROUTER_API_KEY tidak ada'});
  if(!text && !image) return res.status(400).json({error:'Teks atau foto wajib diisi'});
  if(text && text.length>600) return res.status(400).json({error:'Teks terlalu panjang'});

  const fromLabel = from==='ja'?'Japanese':'Indonesian';
  const toLabel   = to==='ja'?'Japanese':'Indonesian';

  const systemPrompt = `You are a world-class translator like DeepL, specialized in Japanese and Indonesian.
Your translations are NATURAL and NATIVE-sounding — how a real Japanese/Indonesian person would actually say it in daily life.
NEVER translate literally or in a stiff, textbook/bookish way. Capture the true meaning, tone, and nuance, choosing the most natural register for the situation.
For Japanese output, use natural everyday Japanese (not overly formal unless context demands it).
Always respond ONLY in valid JSON, no extra text.`;

  // Field rules:
  // - translation: the natural translation in the target language
  // - reading: if the translation is JAPANESE, give full hiragana reading (furigana). Else "".
  // - romaji: if the translation is JAPANESE, give romaji. Else "".

  let messages;
  if(image){
    messages = [
      { role:'system', content: systemPrompt },
      { role:'user', content: [
        { type:'text', text:
`This image contains text (likely Japanese or Indonesian).
1. Extract ALL text exactly as written → field "detected".
2. Auto-detect source language. If Japanese → translate to natural Indonesian. If Indonesian → translate to natural Japanese.
3. "reading": if the translation is Japanese, full hiragana reading; otherwise "".
4. "romaji": if the translation is Japanese, romaji; otherwise "".

Respond ONLY with JSON:
{"detected":"...","translation":"...","reading":"...","romaji":"..."}` },
        { type:'image_url', image_url:{ url: image } }
      ]}
    ];
  } else {
    const userPrompt =
`Translate from ${fromLabel} to ${toLabel}, naturally like a native speaker (DeepL-style, NOT literal/stiff).
Text: "${text}"

- "translation": the natural translation in ${toLabel}.
- "reading": if translation is Japanese, full hiragana reading (furigana) of the whole sentence; otherwise "".
- "romaji": if translation is Japanese, romaji of the whole sentence; otherwise "".

Respond ONLY with JSON:
{"translation":"...","reading":"...","romaji":"..."}`;
    messages = [
      { role:'system', content: systemPrompt },
      { role:'user', content: userPrompt }
    ];
  }

  try{
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions',{
      method:'POST',
      headers:{
        'Authorization':`Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type':'application/json',
        'HTTP-Referer':'https://nihongflash.vercel.app',
        'X-Title':'Nihongo Flash Translator'
      },
      body:JSON.stringify({
        model:'openai/gpt-4.1',
        max_tokens: image?700:500,
        temperature:0.4,
        messages
      }),
      signal:AbortSignal.timeout(image?40000:25000)
    });

    if(!response.ok){
      const err=await response.text();
      return res.status(response.status).json({error:'AI error: '+err.slice(0,200)});
    }

    const data=await response.json();
    const raw=data.choices?.[0]?.message?.content||'{}';
    let result;
    try{ result=JSON.parse(raw.replace(/```json|```/g,'').trim()); }
    catch(e){ const m=raw.match(/\{[\s\S]*\}/); result=m?JSON.parse(m[0]):{translation:'',reading:'',romaji:''}; }

    return res.status(200).json(result);

  }catch(err){
    console.error('Translate error:',err.message);
    return res.status(502).json({error:'AI tidak tersedia: '+err.message});
  }
}
