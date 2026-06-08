const CACHE = 'nihongo-flash-v22';
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];
const CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(APP_SHELL).catch(()=>{});
    for(const url of CDN_URLS){
      try{ const r=await fetch(url,{mode:'cors'}); if(r.ok) await c.put(url,r); }catch(e){}
    }
  }));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method!=='GET') return;
  const url = new URL(req.url);
  if(url.pathname.includes('/api/')||url.hostname.includes('supabase.co')||url.hostname.includes('googleapis.com')||url.hostname.includes('gstatic.com')) return;
  if(req.mode==='navigate'){
    e.respondWith(fetch(req).then(r=>{ const c=r.clone(); caches.open(CACHE).then(cx=>cx.put(req,c)).catch(()=>{}); return r; }).catch(()=>caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(cached=>{
    if(cached) return cached;
    return fetch(req).then(r=>{ if(r.ok){const c=r.clone();caches.open(CACHE).then(cx=>cx.put(req,c)).catch(()=>{});} return r; }).catch(()=>cached||new Response('',{status:503}));
  }));
});
