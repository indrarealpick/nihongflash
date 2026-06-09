// api/push-subscribe.js — Simpan/hapus push subscription
// POST /api/push-subscribe  { user_id, subscription }  → simpan
// DELETE /api/push-subscribe { user_id }                → hapus

function setCors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}

export default async function handler(req, res){
  setCors(res);
  if(req.method==='OPTIONS') return res.status(204).end();
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return res.status(500).json({error:'Supabase env tidak terkonfigurasi'});

  let body=req.body;
  if(typeof body==='string'){try{body=JSON.parse(body);}catch{body={};}}

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {'apikey':serviceKey,'Authorization':'Bearer '+serviceKey,'Content-Type':'application/json'};

  if(req.method==='DELETE'){
    const { user_id } = body;
    if(!user_id) return res.status(400).json({error:'user_id wajib'});
    await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${user_id}`,{method:'DELETE',headers});
    return res.status(200).json({ok:true});
  }

  if(req.method==='POST'){
    const { user_id, subscription } = body;
    if(!user_id||!subscription?.endpoint) return res.status(400).json({error:'user_id dan subscription wajib'});
    const r=await fetch(`${supabaseUrl}/rest/v1/push_subscriptions`,{
      method:'POST', headers:{...headers,'Prefer':'resolution=merge-duplicates'},
      body:JSON.stringify({user_id,subscription,created_at:new Date().toISOString()})
    });
    return res.status(r.ok?200:500).json(r.ok?{ok:true}:{error:'Gagal menyimpan subscription'});
  }
  return res.status(405).end();
}
