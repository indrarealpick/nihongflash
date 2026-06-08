// api/example.js — AI fallback contoh kalimat untuk Lookup
// POST /api/example  Body: { word, reading, meaning }
// Return: { example_jp, example_id }

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

  const word    = (body?.word||'').trim();
  const reading = (body?.reading||'').trim();
  const meaning = (body?.meaning||'').trim();

  if(!word) return res.status(400).json({error:'word wajib diisi'});
  if(!process.env.OPENROUTER_API_KEY) return res.status(500).json({error:'OPENROUTER_API_KEY tidak ada'});

  const systemPrompt = `You write ONE natural, everyday Japanese example sentence for Japanese learners (JLPT N5-N3).
Rules:
- Natural, used in real daily life
- Use です/ます form (polite but NOT stiff, NOT high business keigo)
- Short and easy to understand
- Must naturally use the target word
- NOT anime language, NOT slang, NOT overly casual, NOT exam-like
Always respond ONLY in valid JSON, no extra text.`;

  const userPrompt = `Target word: "${word}"${reading?` (reading: ${reading})`:''}${meaning?` — meaning: ${meaning}`:''}

Create ONE example sentence using this word.
Respond ONLY with JSON:
{"example_jp":"...","example_id":"..."}
where "example_id" is the natural Indonesian translation of the sentence.`;

  try{
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions',{
      method:'POST',
      headers:{
        'Authorization':`Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type':'application/json',
        'HTTP-Referer':'https://nihongflash.vercel.app',
        'X-Title':'Nihongo Flash Lookup'
      },
      body:JSON.stringify({
        model:'openai/gpt-4.1',
        max_tokens:300,
        temperature:0.5,
        messages:[
          {role:'system',content:systemPrompt},
          {role:'user',content:userPrompt}
        ]
      }),
      signal:AbortSignal.timeout(20000)
    });

    if(!response.ok){
      const err=await response.text();
      return res.status(response.status).json({error:'AI error: '+err.slice(0,200)});
    }

    const data=await response.json();
    const raw=data.choices?.[0]?.message?.content||'{}';
    let result;
    try{ result=JSON.parse(raw.replace(/```json|```/g,'').trim()); }
    catch(e){ const m=raw.match(/\{[\s\S]*\}/); result=m?JSON.parse(m[0]):{example_jp:'',example_id:''}; }

    return res.status(200).json({
      example_jp: result.example_jp||'',
      example_id: result.example_id||''
    });

  }catch(err){
    console.error('Example error:',err.message);
    return res.status(502).json({error:'AI tidak tersedia: '+err.message});
  }
}
