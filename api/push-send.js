// api/push-send.js — Kirim push notification ke semua subscriber
// POST /api/push-send  { secret, title?, body? }
// Panggil via cron (GitHub Actions / cron-job.org) setiap hari jam 19.00

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method!=='POST') return res.status(405).end();

  let body=req.body;
  if(typeof body==='string'){try{body=JSON.parse(body);}catch{body={};}}

  // Proteksi endpoint dengan secret token
  if(body?.secret!==process.env.PUSH_SECRET) return res.status(401).json({error:'Unauthorized'});

  const supabaseUrl=process.env.SUPABASE_URL, serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublic=process.env.VAPID_PUBLIC_KEY, vapidPrivate=process.env.VAPID_PRIVATE_KEY;
  const vapidSubject=process.env.VAPID_SUBJECT||'mailto:nihongodeck@gmail.com';
  if(!supabaseUrl||!serviceKey||!vapidPublic||!vapidPrivate) return res.status(500).json({error:'Env tidak lengkap'});

  // Dynamic import web-push
  const webpush = await import('web-push').then(m=>m.default||m);
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  // Ambil semua subscription
  const sbHeaders={'apikey':serviceKey,'Authorization':'Bearer '+serviceKey};
  const subsR=await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?select=user_id,subscription`,{headers:sbHeaders});
  const subs=await subsR.json();
  if(!Array.isArray(subs)||!subs.length) return res.status(200).json({sent:0,message:'Tidak ada subscriber'});

  const payload=JSON.stringify({
    title: body?.title || 'Nihongo Deck 📚',
    body: body?.body || 'Waktunya belajar! Review kartu kamu sekarang.',
    url:'/'
  });

  let sent=0, failed=0;
  await Promise.allSettled(subs.map(async({subscription})=>{
    try{
      await webpush.sendNotification(subscription, payload);
      sent++;
    }catch(e){
      failed++;
      // Subscription kadaluarsa → hapus
      if(e.statusCode===410||e.statusCode===404){
        await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?subscription->>endpoint=eq.${encodeURIComponent(subscription.endpoint)}`,
          {method:'DELETE',headers:sbHeaders});
      }
    }
  }));
  return res.status(200).json({sent,failed,total:subs.length});
}
