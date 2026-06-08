// api/translate.js — AI Translate (formal + informal + konteks)
// POST /api/translate
// Body: { text, from, to, mode, context }

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

  const text   = (body?.text||'').trim();
  const from   = body?.from||'id';   // 'id' | 'ja'
  const to     = body?.to||'ja';     // 'id' | 'ja'
  const mode   = body?.mode||'both'; // 'formal'|'casual'|'both'
  const context= (body?.context||'').trim();

  if(!text||text.length>600) return res.status(400).json({error:'Teks tidak valid'});
  if(!process.env.OPENROUTER_API_KEY) return res.status(500).json({error:'OPENROUTER_API_KEY tidak ada'});

  const fromLabel = from==='ja'?'Japanese':'Indonesian';
  const toLabel   = to==='ja'?'Japanese':'Indonesian';
  const ctxNote   = context ? `\nContext/Situation: ${context}` : '';

  const systemPrompt = `You are an expert Japanese-Indonesian translator with deep knowledge of:
- Japanese keigo (敬語) and casual speech (タメ口)
- Indonesian formal (baku) and casual/colloquial register
- Cultural nuances and situational appropriateness
- Natural, native-sounding expressions

Always respond ONLY in valid JSON with no extra text outside the JSON.`;

  const userPrompt = `Translate the following text from ${fromLabel} to ${toLabel}.
Text: "${text}"${ctxNote}

Rules:
- "formal": natural, polite, professional translation. For Japanese use keigo (です/ます/〜していただく etc). For Indonesian use bahasa baku.
- "casual": natural, friendly, conversational. For Japanese use plain/colloquial form. For Indonesian use everyday casual speech.
- "notes": 2-3 sentences explaining contextual nuances, when to use each version, or any important cultural/linguistic notes. Write in Indonesian.
- If mode is "formal" only, still provide casual as empty string "".
- If mode is "casual" only, still provide formal as empty string "".

Respond ONLY with this JSON:
{
  "formal": "...",
  "casual": "...",
  "notes": "..."
}`;

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
        max_tokens:800,
        temperature:0.3,
        messages:[
          {role:'system',content:systemPrompt},
          {role:'user',content:userPrompt}
        ]
      }),
      signal:AbortSignal.timeout(25000)
    });

    if(!response.ok){
      const err=await response.text();
      return res.status(response.status).json({error:'AI error: '+err.slice(0,200)});
    }

    const data=await response.json();
    const raw=data.choices?.[0]?.message?.content||'{}';

    // Parse JSON from AI response
    let result;
    try{
      const clean=raw.replace(/```json|```/g,'').trim();
      result=JSON.parse(clean);
    }catch(e){
      // Fallback: try to extract JSON
      const match=raw.match(/\{[\s\S]*\}/);
      result=match?JSON.parse(match[0]):{formal:'',casual:'',notes:'Gagal parse respons AI.'};
    }

    // Filter by mode
    if(mode==='formal') result.casual='';
    if(mode==='casual') result.formal='';

    return res.status(200).json(result);

  }catch(err){
    console.error('Translate error:',err.message);
    return res.status(502).json({error:'AI tidak tersedia: '+err.message});
  }
}
