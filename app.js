/* ============================ CONFIG ============================ */
const CONFIG = {
  SUPABASE_URL:      'https://upecfwgmpmkksgemhmeu.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_J-5H76Dnk2t3qXHyX8VDbw_wLCQSSCK',
  API_URL:           'https://nihongflash.vercel.app/api/japanese'
};

/* SRS schedule: hari berdasarkan level */
const SRS_DAYS = [0, 1, 3, 7, 14, 30, 60];

let sb;
try {
  sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
} catch(e) {
  console.error('Supabase init gagal:', e);
}

const State = {
  user:null, profile:null, categories:[], flashcards:[], notes:[],
  study:{ list:[], idx:0, flipped:false },
  review:{ list:[], idx:0, shown:false },
  fcLimit:60,
  dictLimit:50, dictResults:[],
  deck:{ level:'N5', all:[], list:[], idx:0, flipped:false, total:0 },
  deckProgress:{},
  ttsSpeed: parseFloat(localStorage.getItem('nf_tts_speed')||'1.0'),
  theme: localStorage.getItem('nf_theme')||'light',
  autoplay: localStorage.getItem('nf_autoplay')==='1'
};

/* ============================ HELPERS ============================ */
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const esc = s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function applyTheme(t){
  State.theme = (t==='dark')?'dark':'light';
  document.documentElement.setAttribute('data-theme', State.theme);
  localStorage.setItem('nf_theme', State.theme);
  const meta=document.querySelector('meta[name="theme-color"]'); if(meta) meta.setAttribute('content', State.theme==='dark'?'#0F1115':'#6366F1');
  // redraw charts with theme colors if visible
  try{ if($('#week-chart')) drawWeekChart(); }catch(e){}
}
const todayStr = ()=> new Date().toISOString().slice(0,10);
function addDays(n){ const d=new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
function daysBetween(a,b){ return Math.round((new Date(b)-new Date(a))/86400000); }

function show(screen){ $$('.screen').forEach(s=>s.classList.remove('active')); const el=$('#screen-'+screen); if(el)el.classList.add('active'); window.scrollTo(0,0); }
function setNavVisible(v){ $('#bottom-nav').classList.toggle('hidden',!v); }
function setActiveNav(screen){ $$('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.nav===screen)); }

/* ---------- KANA → ROMAJI (untuk smart search) ---------- */
const KANA = {
'あ':'a','い':'i','う':'u','え':'e','お':'o','か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko',
'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go','さ':'sa','し':'shi','す':'su','せ':'se','そ':'so',
'ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo','た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
'だ':'da','ぢ':'ji','づ':'zu','で':'de','ど':'do','な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no',
'は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho','ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo',
'ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po','ま':'ma','み':'mi','む':'mu','め':'me','も':'mo',
'や':'ya','ゆ':'yu','よ':'yo','ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro',
'わ':'wa','を':'o','ん':'n','ー':'-',
'きゃ':'kya','きゅ':'kyu','きょ':'kyo','しゃ':'sha','しゅ':'shu','しょ':'sho','ちゃ':'cha','ちゅ':'chu','ちょ':'cho',
'にゃ':'nya','にゅ':'nyu','にょ':'nyo','ひゃ':'hya','ひゅ':'hyu','ひょ':'hyo','みゃ':'mya','みゅ':'myu','みょ':'myo',
'りゃ':'rya','りゅ':'ryu','りょ':'ryo','ぎゃ':'gya','ぎゅ':'gyu','ぎょ':'gyo','じゃ':'ja','じゅ':'ju','じょ':'jo','びゃ':'bya','びゅ':'byu','びょ':'byo','ぴゃ':'pya','ぴゅ':'pyu','ぴょ':'pyo'
};
function kataToHira(s){ return s.replace(/[\u30a1-\u30f6]/g, c=>String.fromCharCode(c.charCodeAt(0)-0x60)); }
function toRomaji(input){
  let s = kataToHira(input||''); let out=''; let i=0;
  while(i<s.length){
    const two = s.substr(i,2);
    if(KANA[two]){ out+=KANA[two]; i+=2; continue; }
    const ch = s[i];
    if(ch==='っ' || ch==='ッ'){ const nx=KANA[s.substr(i+1,2)]||KANA[s[i+1]]; if(nx){ out+=nx[0]; } i++; continue; }
    out += (KANA[ch]!==undefined?KANA[ch]:ch); i++;
  }
  return out.toLowerCase();
}

/* ---------- AUDIO — Remote TTS (Google quality) + Web Speech fallback ---------- */
const Speech = {
  ok: ('speechSynthesis' in window),
  voices: [], voice: null,
  audioCache: new Map(),   // cache audio per kata agar tidak re-fetch
  PRIORITY: [/kyoko/i, /google.*日本語/i, /google.*japanese/i, /haruka/i, /o-ren|otoya/i, /ja[-_]?jp/i, /^ja\b/i],
  get ttsUrl(){ return CONFIG.API_URL.replace('/japanese','/tts'); },
  init(){
    if(!this.ok) return;
    const load=()=>{
      this.voices = speechSynthesis.getVoices().filter(v => (v.lang||'').toLowerCase().startsWith('ja'));
      this.pickDefault(); populateVoicePicker();
    };
    load(); speechSynthesis.onvoiceschanged = load;
  },
  pickDefault(){
    const saved = localStorage.getItem('nf_voice');
    if(saved){ const v=this.voices.find(x=>(x.voiceURI===saved)||(x.name===saved)); if(v){ this.voice=v; return; } }
    for(const re of this.PRIORITY){ const v=this.voices.find(x=>re.test(x.name)||re.test(x.lang)); if(v){ this.voice=v; return; } }
    this.voice = this.voices[0] || null;
  },
  setVoice(key){
    const v=this.voices.find(x=>(x.voiceURI===key)||(x.name===key));
    if(v){ this.voice=v; localStorage.setItem('nf_voice', v.voiceURI||v.name); }
    else { localStorage.removeItem('nf_voice'); this.pickDefault(); }
  },
  // Putar audio via OpenAI TTS (backend) → fallback Web Speech API
  async speak(text){
    if(!text) return;
    const speed = State?.ttsSpeed || 1.0;
    try{
      // cek cache
      if(this.audioCache.has(text)){
        const a = new Audio(this.audioCache.get(text));
        a.playbackRate = speed; a.play().catch(()=>{}); return;
      }
      const res = await fetch(this.ttsUrl, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ text }),      // field "text" sesuai API baru
        signal: AbortSignal.timeout(8000)
      });
      if(!res.ok) throw new Error('TTS remote gagal');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      this.audioCache.set(text, url);
      const a = new Audio(url);
      a.playbackRate = speed; a.play().catch(()=>{});
      return;
    } catch(e){}
    // fallback ke Web Speech API (offline)
    if(!this.ok){ return; }
    try{
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang='ja-JP'; if(this.voice) u.voice=this.voice;
      u.rate = speed;
      speechSynthesis.speak(u);
    } catch(e){}
  }
};
function populateVoicePicker(){
  const sel=document.getElementById('set-voice'); if(!sel) return;
  if(!Speech.voices.length){ sel.innerHTML='<option>Tidak ada voice Jepang</option>'; return; }
  const cur=(Speech.voice&&(Speech.voice.voiceURI||Speech.voice.name))||'';
  sel.innerHTML='<option value="">Otomatis (terbaik)</option>'+Speech.voices.map(v=>{
    const key=v.voiceURI||v.name; return `<option value="${key.replace(/"/g,'')}" ${key===cur?'selected':''}>${v.name}</option>`;
  }).join('');
}

/* ---------- TOAST / MODAL / OVERLAY ---------- */
function toast(msg,type='info',ms=2600){
  const icons={success:'✓',error:'✕',warning:'!',info:'i'};
  const el=document.createElement('div'); el.className='toast '+type;
  el.innerHTML=`<div class="ic">${icons[type]||'i'}</div><div>${esc(msg)}</div>`;
  $('#toasts').appendChild(el); setTimeout(()=>{el.classList.add('out');setTimeout(()=>el.remove(),250);},ms);
}
function modal({title,body='',confirmText='OK',cancelText='Batal',danger=false,onConfirm}){
  return new Promise(resolve=>{
    const root=$('#modal-root');
    root.innerHTML=`<div class="modal-back"><div class="modal nb"><h3>${esc(title)}</h3>${body?`<div>${body}</div>`:''}
      <div class="actions"><button class="btn btn-ghost" data-act="cancel">${esc(cancelText)}</button><button class="btn ${danger?'btn-danger':'btn-primary'}" data-act="ok">${esc(confirmText)}</button></div></div></div>`;
    const close=v=>{root.innerHTML='';resolve(v);};
    $('.modal-back',root).addEventListener('click',e=>{if(e.target.classList.contains('modal-back'))close(false);});
    $('[data-act="cancel"]',root).onclick=()=>close(false);
    $('[data-act="ok"]',root).onclick=async()=>{ if(onConfirm){const r=await onConfirm(root); if(r===false)return;} close(true); };
  });
}
function overlay(t){ $('#overlay-root').innerHTML=`<div class="overlay"><div class="loader-card nb"><div class="spinner"></div><div class="lt">${esc(t)}</div></div></div>`; }
function overlayOff(){ $('#overlay-root').innerHTML=''; }

/* ============================ AUTH ============================ */
async function doRegister(){
  const name=$('#reg-name').value.trim(), email=$('#reg-email').value.trim(), pass=$('#reg-pass').value, pass2=$('#reg-pass2').value;
  if(!name)return toast('Nama wajib diisi','warning'); if(!email)return toast('Email wajib diisi','warning');
  if(pass.length<6)return toast('Password minimal 6 karakter','warning'); if(pass!==pass2)return toast('Konfirmasi password tidak cocok','error');
  overlay('Membuat akun…');
  const {data,error}=await sb.auth.signUp({email,password:pass,options:{data:{name}}});
  overlayOff(); if(error)return toast(error.message,'error',4000);
  if(data.session){ toast('Akun dibuat! 🎉','success'); await afterLogin(data.session.user); }
  else { const {data:d2,error:e2}=await sb.auth.signInWithPassword({email,password:pass}); if(e2)return toast('Akun dibuat. Silakan login.','info'); await afterLogin(d2.user); }
}
async function doLogin(){
  const email=$('#log-email').value.trim(), pass=$('#log-pass').value;
  if(!email||!pass)return toast('Email & password wajib diisi','warning');
  overlay('Masuk…'); const {data,error}=await sb.auth.signInWithPassword({email,password:pass});
  overlayOff(); if(error)return toast(error.message,'error',4000); toast('Berhasil masuk','success'); await afterLogin(data.user);
}
async function doGoogle(){ const {error}=await sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin+window.location.pathname}}); if(error)toast(error.message,'error',4000); }
async function doLogout(){
  const ok=await modal({title:'Logout?',body:'<p>Anda akan keluar dari akun ini.</p>',confirmText:'Logout',danger:true}); if(!ok)return;
  await sb.auth.signOut(); State.user=State.profile=null; State.categories=[];State.flashcards=[];State.notes=[];State.deckProgress={};
  setNavVisible(false); show('welcome'); toast('Anda telah logout','info');
}
async function ensureProfile(user){
  const {data}=await sb.from('profiles').select('*').eq('id',user.id).maybeSingle();
  if(data){State.profile=data;return;}
  const name=user.user_metadata?.name||user.user_metadata?.full_name||(user.email||'').split('@')[0];
  const {data:ins}=await sb.from('profiles').upsert({id:user.id,name}).select().maybeSingle();
  State.profile=ins||{id:user.id,name,streak:0,last_review_date:null};
}
async function afterLogin(user){
  State.user=user; overlay('Memuat data…'); await ensureProfile(user); await loadAll(); overlayOff();
  setNavVisible(true); goto('dashboard');
}

/* ============================ DATA ============================ */
async function loadCategories(){ const {data,error}=await sb.from('categories').select('*').order('created_at',{ascending:true}); if(!error)State.categories=data||[]; }
async function loadFlashcards(){ const {data,error}=await sb.from('flashcards').select('*').order('created_at',{ascending:false}); if(!error)State.flashcards=data||[]; }
async function loadNotes(){ const {data,error}=await sb.from('notes').select('*').order('updated_at',{ascending:false}); if(!error)State.notes=data||[]; }
async function loadDeckProgress(){
  const {data,error}=await sb.from('deck_progress').select('jlpt_level,kanji,status');
  State.deckProgress={};
  if(!error){ (data||[]).forEach(r=>{ State.deckProgress[r.jlpt_level+'|'+r.kanji]=r.status; }); }
}
async function loadAll(){ await Promise.all([loadCategories(),loadFlashcards(),loadNotes(),loadDeckProgress()]); }

async function createCategory(name){ const {data,error}=await sb.from('categories').insert({user_id:State.user.id,name}).select().single(); if(error){toast('Gagal menambah kategori','error');return null;} State.categories.push(data); return data; }
async function updateCategory(id,name){ const {error}=await sb.from('categories').update({name}).eq('id',id); if(error){toast('Gagal mengubah kategori','error');return;} const c=State.categories.find(x=>x.id===id); if(c)c.name=name; }
async function deleteCategory(id){ const {error}=await sb.from('categories').delete().eq('id',id); if(error){toast('Gagal menghapus kategori','error');return;} State.categories=State.categories.filter(c=>c.id!==id); State.flashcards=State.flashcards.filter(f=>f.category_id!==id); }

async function createFlashcard(o){ const {data,error}=await sb.from('flashcards').insert({user_id:State.user.id,category_id:o.category_id,kanji:o.kanji,reading:o.reading,meaning:o.meaning,status:'belum_hafal',favorite:false,review_level:0,next_review_date:todayStr(),review_count:0}).select().single(); if(error){toast('Gagal menyimpan flashcard','error');return null;} State.flashcards.unshift(data); return data; }
async function updateFlashcard(id,patch){ const {error}=await sb.from('flashcards').update(patch).eq('id',id); if(error){toast('Gagal memperbarui','error');return;} const f=State.flashcards.find(x=>x.id===id); if(f)Object.assign(f,patch); }
async function deleteFlashcard(id){ const {error}=await sb.from('flashcards').delete().eq('id',id); if(error){toast('Gagal menghapus','error');return;} State.flashcards=State.flashcards.filter(f=>f.id!==id); }

async function createNote(o){ const {data,error}=await sb.from('notes').insert({user_id:State.user.id,category_id:o.category_id||null,title:o.title,content:o.content}).select().single(); if(error){toast('Gagal menyimpan catatan','error');return null;} State.notes.unshift(data); return data; }
async function updateNote(id,patch){ const {error}=await sb.from('notes').update(patch).eq('id',id); if(error){toast('Gagal memperbarui catatan','error');return;} const n=State.notes.find(x=>x.id===id); if(n)Object.assign(n,patch); }
async function deleteNote(id){ const {error}=await sb.from('notes').delete().eq('id',id); if(error){toast('Gagal menghapus catatan','error');return;} State.notes=State.notes.filter(n=>n.id!==id); }

async function saveStreak(){ if(!State.profile)return; await sb.from('profiles').update({streak:State.profile.streak,last_review_date:State.profile.last_review_date}).eq('id',State.user.id); }

/* ============================ AI ============================ */
async function fetchJapanese(word){
  const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),20000);
  try{
    const res=await fetch(CONFIG.API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({word}),signal:ctrl.signal});
    clearTimeout(t); const data=await res.json().catch(()=>null);
    if(!res.ok||!data)throw new Error((data&&data.error)||'Gagal memanggil AI');
    if(!data.reading||!data.meaning)throw new Error('Respons AI tidak lengkap');
    return {reading:String(data.reading).trim(),meaning:String(data.meaning).trim()};
  }catch(err){ clearTimeout(t); if(err.name==='AbortError')throw new Error('Permintaan AI timeout'); throw err; }
}

/* ============================ STATS ============================ */
function stats(){ const total=State.flashcards.length; const hafal=State.flashcards.filter(f=>f.status==='hafal').length; const belum=total-hafal; const pct=total?Math.round(hafal/total*100):0; return {total,hafal,belum,pct}; }
function dueCards(){ const t=todayStr(); return State.flashcards.filter(f=>(f.next_review_date||t)<=t); }
function effectiveStreak(){ const p=State.profile; if(!p||!p.last_review_date)return 0; const d=daysBetween(p.last_review_date,todayStr()); return d<=1 ? (p.streak||0) : 0; }

/* ============================ DASHBOARD ============================ */
function renderDashboard(){
  const {total,hafal,belum,pct}=stats(); const due=dueCards().length;
  const name=State.profile?.name||'Pelajar';
  const h=new Date().getHours();
  $('#dash-greet').textContent = h<11?'おはよう！' : (h<18?'こんにちは！' : 'こんばんは！');
  // Avatar — show photo if available
  const avatarUrl = State.profile?.avatar_url;
  ['#dash-avatar','#set-avatar'].forEach(sel=>{
    const el=$(sel); if(!el) return;
    if(avatarUrl){ el.innerHTML=`<img src="${avatarUrl}" alt="avatar">`; }
    else { el.innerHTML=(sel==='#set-avatar'?'<span class="avatar-cam">📷</span>':'')+(name[0]||'P').toUpperCase(); }
  });
  // Ringkasan Hari Ini
  const baru=State.flashcards.filter(f=>(f.review_count||0)===0).length;
  $('#sum-baru').textContent=baru;
  $('#sum-review').textContent=due;
  $('#sum-akurasi').textContent=pct+'%';
  // Level/XP (kosmetik dari data hafal)
  let deckHafal=0; for(const k in State.deckProgress){ if(State.deckProgress[k]==='hafal') deckHafal++; }
  const xp=(hafal+deckHafal)*10; const level=Math.floor(xp/500)+1; const within=xp%500;
  if($('#lvl-badge')) $('#lvl-badge').textContent='L'+level;
  if($('#lvl-label-txt')) $('#lvl-label-txt').textContent='Level '+level;
  if($('#xp-fill')) $('#xp-fill').style.width=(within/500*100)+'%';
  if($('#xp-text')) $('#xp-text').textContent=within+' / 500 XP';
  // Review banner
  const banner=$('#review-banner');
  banner.innerHTML = due>0 ? `<div class="banner" style="margin-bottom:14px"><div class="grow"><div class="bt">📚 Ada ${due} kartu untuk direview.</div></div><button class="btn btn-sm btn-primary" id="banner-review">Review →</button></div>` : '';
  if(due>0) $('#banner-review').onclick=()=>goto('review');
  // Nav badge
  const navBadge=$('#nav-review-ic'); if(navBadge){ let b=navBadge.querySelector('.nav-badge'); if(due>0){ if(!b){b=document.createElement('span');b.className='nav-badge';navBadge.appendChild(b);} b.textContent=due>99?'99+':due; } else if(b){ b.remove(); } }
  drawWeekChart();
}
function drawWeekChart(){
  const cv=$('#week-chart'); if(!cv) return;
  const dpr=window.devicePixelRatio||1; const W=cv.clientWidth||320,H=150;
  cv.width=W*dpr;cv.height=H*dpr; const ctx=cv.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,H);
  const counts=[],labels=[]; const today=new Date(); const init=['M','S','S','R','K','J','S'];
  for(let i=6;i>=0;i--){
    const d=new Date(today); d.setDate(today.getDate()-i); d.setHours(0,0,0,0);
    const nx=new Date(d); nx.setDate(d.getDate()+1);
    let c=0; State.flashcards.forEach(f=>{ if(f.last_reviewed_at){ const t=new Date(f.last_reviewed_at); if(t>=d&&t<nx)c++; } });
    counts.push(c); labels.push(init[d.getDay()]);
  }
  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  const barActive=isDark?'#818CF8':'#6366F1';
  const barPassive=isDark?'#1E3A5F':'#E0E7FF';
  const txt=isDark?'#64748B':'#9CA3AF';
  const max=Math.max(1,...counts); const pad=16, bw=(W-pad*2)/7, base=H-22;
  function rr(x,y,w,hh,r){ r=Math.min(r,w/2,hh/2); ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+hh,r); ctx.arcTo(x+w,y+hh,x,y+hh,r); ctx.arcTo(x,y+hh,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
  counts.forEach((c,i)=>{ const bh=Math.max(Math.round((c/max)*(base-14)),4); const x=pad+i*bw+bw*0.22, y=base-bh, w=bw*0.56;
    ctx.fillStyle=c>0?barActive:barPassive; rr(x,y,w,bh,5); ctx.fill();
    ctx.fillStyle=txt;ctx.textAlign='center';ctx.font='600 11px Inter,sans-serif';ctx.fillText(labels[i],x+w/2,H-6); });
}
async function uploadAvatar(file){
  if(!file||!State.user) return;
  const ext=file.name.split('.').pop();
  const path=`avatars/${State.user.id}.${ext}`;
  overlay('Mengunggah foto…');
  try{
    const {error:upErr}=await sb.storage.from('avatars').upload(path,file,{upsert:true,contentType:file.type});
    if(upErr) throw upErr;
    const {data}=sb.storage.from('avatars').getPublicUrl(path);
    const avatarUrl=data.publicUrl+'?t='+Date.now();
    await sb.from('profiles').update({avatar_url:avatarUrl}).eq('id',State.user.id);
    if(!State.profile) State.profile={};
    State.profile.avatar_url=avatarUrl;
    renderDashboard(); renderSettings();
    toast('Foto profil diperbarui ✓','success');
  }catch(e){ toast('Gagal upload: '+e.message,'error'); }
  overlayOff();
}

/* ============================ CATEGORY ============================ */
function countFor(catId){ return State.flashcards.filter(f=>f.category_id===catId).length; }
function renderCategory(){
  const list=$('#cat-list');
  if(!State.categories.length){ list.innerHTML=`<div class="empty nb"><span class="em">📂</span>Belum ada kategori.</div>`; return; }
  list.innerHTML=State.categories.map(c=>`<div class="row-card nb"><div class="grow"><div class="title">${esc(c.name)}</div><div class="sub">${countFor(c.id)} flashcard</div></div>
    <button class="btn btn-mini btn-ghost" data-edit-cat="${c.id}">✎</button><button class="btn btn-mini btn-danger" data-del-cat="${c.id}">🗑</button></div>`).join('');
  $$('[data-edit-cat]',list).forEach(b=>b.onclick=()=>categoryForm(b.dataset.editCat));
  $$('[data-del-cat]',list).forEach(b=>b.onclick=()=>confirmDeleteCategory(b.dataset.delCat));
}
async function categoryForm(id){
  const editing=State.categories.find(c=>c.id===id);
  const ok=await modal({title:editing?'Edit Kategori':'Tambah Kategori',
    body:`<div class="field"><label>Nama Kategori</label><input class="input" id="m-cat-name" value="${esc(editing?editing.name:'')}" placeholder="Mis. N5, Kata Kerja…"/></div>`,
    confirmText:editing?'Simpan':'Tambah',
    onConfirm:async()=>{ const name=$('#m-cat-name').value.trim(); if(!name){toast('Nama tidak boleh kosong','warning');return false;} if(editing)await updateCategory(id,name); else await createCategory(name); }});
  if(ok){ toast(editing?'Kategori diperbarui':'Kategori ditambahkan','success'); renderCategory(); refreshFilters(); }
}
async function confirmDeleteCategory(id){
  const c=State.categories.find(x=>x.id===id); const n=countFor(id);
  const ok=await modal({title:'Hapus Kategori?',body:`<p>"${esc(c.name)}" beserta <b>${n} flashcard</b> akan dihapus permanen.</p>`,confirmText:'Hapus',danger:true});
  if(!ok)return; await deleteCategory(id); toast('Kategori dihapus','success'); renderCategory(); refreshFilters();
}

/* ============================ FLASHCARD MANAGER ============================ */
function catName(id){ const c=State.categories.find(x=>x.id===id); return c?c.name:'—'; }
function matchSearch(f,q){
  if(!q)return true;
  const hay=[ (f.kanji||''), (f.reading||''), (f.meaning||'').toLowerCase(), toRomaji(f.reading||''), toRomaji(f.kanji||'') ].join(' ').toLowerCase();
  return hay.includes(q) || toRomaji(q).length && hay.includes(toRomaji(q));
}
function visibleFlashcards(){
  const q=$('#fc-search').value.trim().toLowerCase();
  const filter=$('#fc-filter').value, status=$('#fc-status').value, sort=$('#fc-sort').value;
  let arr=State.flashcards.slice();
  if(filter)arr=arr.filter(f=>f.category_id===filter);
  if(status==='favorite')arr=arr.filter(f=>f.favorite);
  else if(status==='hafal')arr=arr.filter(f=>f.status==='hafal');
  else if(status==='belum_hafal')arr=arr.filter(f=>f.status!=='hafal');
  if(q)arr=arr.filter(f=>matchSearch(f,q));
  if(sort==='az')arr.sort((a,b)=>(a.kanji||'').localeCompare(b.kanji||'','ja'));
  else if(sort==='status')arr.sort((a,b)=>(a.status==='hafal'?1:0)-(b.status==='hafal'?1:0));
  else arr.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  return arr;
}
function renderFlashcards(){
  const list=$('#fc-list'); const all=visibleFlashcards(); const arr=all.slice(0,State.fcLimit);
  if(!all.length){ list.innerHTML=`<div class="empty nb"><span class="em">🃏</span>Tidak ada flashcard.</div>`; $('#fc-more').classList.add('hidden'); return; }
  list.innerHTML=arr.map(f=>`<div class="row-card nb jp"><div class="grow"><div class="title">${esc(f.kanji)}</div>
    <div class="sub">${esc(f.reading||'…')} · ${esc(f.meaning||'…')}</div>
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><span class="tag gray">${esc(catName(f.category_id))}</span><span class="tag ${f.status==='hafal'?'green':''}">${f.status==='hafal'?'✓ Hafal':'Belum'}</span></div></div>
    <div class="card-actions">
      <button class="btn btn-mini btn-ghost" data-spk="${f.id}">🔊</button>
      <button class="btn btn-mini btn-ghost" data-fav="${f.id}"><span class="star ${f.favorite?'on':''}">⭐</span></button>
      <button class="btn btn-mini btn-ghost" data-edit-fc="${f.id}">✎</button>
      <button class="btn btn-mini btn-danger" data-del-fc="${f.id}">🗑</button>
    </div></div>`).join('');
  $('#fc-more').classList.toggle('hidden', all.length<=State.fcLimit);
  $$('[data-spk]',list).forEach(b=>b.onclick=()=>{ const f=State.flashcards.find(x=>x.id===b.dataset.spk); if(f)Speech.speak(f.kanji); });
  $$('[data-fav]',list).forEach(b=>b.onclick=()=>toggleFav(b.dataset.fav));
  $$('[data-edit-fc]',list).forEach(b=>b.onclick=()=>editFlashcardForm(b.dataset.editFc));
  $$('[data-del-fc]',list).forEach(b=>b.onclick=()=>confirmDeleteFlashcard(b.dataset.delFc));
}
async function toggleFav(id){ const f=State.flashcards.find(x=>x.id===id); if(!f)return; const nv=!f.favorite; f.favorite=nv; await updateFlashcard(id,{favorite:nv}); renderFlashcards(); }

async function addFlashcardForm(presetCat){
  if(!State.categories.length){ toast('Buat kategori terlebih dahulu','warning'); goto('category'); return; }
  const opts=State.categories.map(c=>`<option value="${c.id}" ${c.id===presetCat?'selected':''}>${esc(c.name)}</option>`).join('');
  const root=$('#modal-root');
  root.innerHTML=`<div class="modal-back"><div class="modal nb"><h3>Tambah Flashcard</h3><p>AI mengisi cara baca & arti otomatis.</p>
    <div class="field"><label>Kategori</label><select class="select" id="m-fc-cat" style="width:100%">${opts}</select></div>
    <div class="field"><label>Kanji / Kosakata Jepang</label><input class="input jp" id="m-fc-word" placeholder="Mis. 食べる"/></div>
    <div class="actions"><button class="btn btn-ghost" id="m-fc-cancel">Batal</button><button class="btn btn-primary" id="m-fc-save">Simpan</button></div></div></div>`;
  const close=()=>root.innerHTML='';
  $('.modal-back',root).addEventListener('click',e=>{if(e.target.classList.contains('modal-back'))close();});
  $('#m-fc-cancel').onclick=close;
  $('#m-fc-save').onclick=async()=>{
    const category_id=$('#m-fc-cat').value, word=$('#m-fc-word').value.trim();
    if(!word){toast('Masukkan kata Jepang','warning');return;}
    close(); overlay('Sedang membuat flashcard…');
    try{
      let reading, meaning;
      const dict=await lookupDictionary(word);            // 1) cek dictionary dulu
      if(dict){ reading=dict.reading; meaning=dict.meaning; }
      else { const r=await fetchJapanese(word); reading=r.reading; meaning=r.meaning; } // 2) fallback AI (+auto simpan ke dict di backend)
      const card=await createFlashcard({category_id,kanji:word,reading,meaning}); overlayOff();
      if(card){toast(dict?'Dari kamus 📖':'Flashcard dibuat 🎉','success'); refreshAll();}
    }
    catch(err){ overlayOff(); toast(err.message||'Gagal','error',4000); manualFallback(category_id,word); }
  };
}
async function manualFallback(category_id,word){
  const ok=await modal({title:'AI tidak tersedia',body:`<p>Isi manual untuk "${esc(word)}".</p>
    <div class="field"><label>Cara Baca (hiragana)</label><input class="input jp" id="mf-read" placeholder="たべる"/></div>
    <div class="field"><label>Arti</label><input class="input" id="mf-mean" placeholder="Makan"/></div>`,confirmText:'Simpan',
    onConfirm:async()=>{ const reading=$('#mf-read').value.trim(),meaning=$('#mf-mean').value.trim(); if(!reading||!meaning){toast('Lengkapi cara baca & arti','warning');return false;} const c=await createFlashcard({category_id,kanji:word,reading,meaning}); if(!c)return false; }});
  if(ok){ toast('Flashcard disimpan','success'); refreshAll(); }
}
async function editFlashcardForm(id){
  const f=State.flashcards.find(x=>x.id===id); if(!f)return;
  const opts=State.categories.map(c=>`<option value="${c.id}" ${c.id===f.category_id?'selected':''}>${esc(c.name)}</option>`).join('');
  const ok=await modal({title:'Edit Flashcard',
    body:`<div class="field"><label>Kategori</label><select class="select" id="m-ef-cat" style="width:100%">${opts}</select></div>
      <div class="field"><label>Kanji / Kosakata</label><input class="input jp" id="m-ef-kanji" value="${esc(f.kanji)}"/></div>
      <div class="field"><label>Cara Baca</label><input class="input jp" id="m-ef-read" value="${esc(f.reading||'')}"/></div>
      <div class="field"><label>Arti</label><input class="input" id="m-ef-mean" value="${esc(f.meaning||'')}"/></div>`,confirmText:'Simpan',
    onConfirm:async()=>{ const kanji=$('#m-ef-kanji').value.trim(); if(!kanji){toast('Kanji tidak boleh kosong','warning');return false;}
      await updateFlashcard(id,{category_id:$('#m-ef-cat').value,kanji,reading:$('#m-ef-read').value.trim(),meaning:$('#m-ef-mean').value.trim()}); }});
  if(ok){ toast('Flashcard diperbarui','success'); refreshAll(); }
}
async function confirmDeleteFlashcard(id){
  const f=State.flashcards.find(x=>x.id===id);
  const ok=await modal({title:'Hapus Flashcard?',body:`<p>"${esc(f.kanji)}" akan dihapus permanen.</p>`,confirmText:'Hapus',danger:true});
  if(!ok)return; await deleteFlashcard(id); toast('Flashcard dihapus','success'); refreshAll();
}
function refreshFilters(){
  const opts=`<option value="">Semua Kategori</option>`+State.categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const sel=$('#fc-filter'),cur=sel.value; sel.innerHTML=opts; sel.value=State.categories.some(c=>c.id===cur)?cur:'';
  const ns=$('#note-filter'),nc=ns.value; ns.innerHTML=opts; ns.value=State.categories.some(c=>c.id===nc)?nc:'';
}

/* ============================ BATCH IMPORT ============================ */
function batchImportForm(){
  if(!State.categories.length){ toast('Buat kategori terlebih dahulu','warning'); goto('category'); return; }
  const opts=State.categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const root=$('#modal-root');
  root.innerHTML=`<div class="modal-back"><div class="modal nb"><h3>⚡ Batch Import</h3><p>Tempel banyak kata, satu per baris. AI akan memproses semuanya.</p>
    <div class="field"><label>Kategori</label><select class="select" id="b-cat" style="width:100%">${opts}</select></div>
    <div class="field"><label>Daftar Kata Jepang</label><textarea class="textarea jp" id="b-words" placeholder="食べる&#10;飲む&#10;行く&#10;見る&#10;買う"></textarea></div>
    <div class="set-item" style="padding:12px;border:1px solid var(--border);border-radius:12px;margin-bottom:14px"><div class="grow"><div class="t" style="font-size:14px">Lewati kata yang sudah ada</div></div>
      <label class="switch"><input type="checkbox" id="b-skip" checked/><span class="track"><span class="knob"></span></span></label></div>
    <div class="actions"><button class="btn btn-ghost" id="b-cancel">Batal</button><button class="btn btn-primary" id="b-go">Generate Flashcards</button></div></div></div>`;
  const close=()=>root.innerHTML='';
  $('.modal-back',root).addEventListener('click',e=>{if(e.target.classList.contains('modal-back'))close();});
  $('#b-cancel').onclick=close;
  $('#b-go').onclick=()=>runBatch($('#b-cat').value, $('#b-words').value, $('#b-skip').checked, root);
}
async function runBatch(category_id, raw, skipExisting, root){
  let words=raw.split('\n').map(w=>w.trim()).filter(Boolean);
  words=[...new Set(words)]; // hapus duplikat dalam paste
  if(skipExisting){
    const existing=new Set(State.flashcards.filter(f=>f.category_id===category_id).map(f=>f.kanji));
    var skipped=words.filter(w=>existing.has(w)).length;
    words=words.filter(w=>!existing.has(w));
  } else { var skipped=0; }
  if(!words.length){ toast('Tidak ada kata baru untuk diproses','warning'); return; }
  const total=words.length;
  $('.modal h3',root).textContent='⚡ Memproses…';
  $('.modal p',root).textContent='Mohon jangan tutup halaman ini.';
  const formArea=$('#b-cat',root).closest('.modal');
  formArea.querySelectorAll('.field,.set-item,.actions').forEach(e=>e.remove());
  const prog=document.createElement('div'); prog.className='batch-progress';
  prog.innerHTML=`<div class="batch-bar"><div class="batch-fill" id="b-fill"></div></div><div class="batch-count" id="b-count">0 / ${total}</div>`;
  formArea.appendChild(prog);
  let ok=0, fail=0; const rows=[];
  const dictMap=await lookupDictionaryMany(words);   // cek dictionary sekaligus
  for(let i=0;i<total;i++){
    $('#b-count').textContent=`${i+1} / ${total}`;
    $('#b-fill').style.width=Math.round((i+1)/total*100)+'%';
    const w=words[i]; const hit=dictMap[w];
    if(hit){ rows.push({user_id:State.user.id,category_id,kanji:w,reading:hit.reading,meaning:hit.meaning,status:'belum_hafal',favorite:false,review_level:0,next_review_date:todayStr(),review_count:0}); ok++; continue; }
    try{ const {reading,meaning}=await fetchJapanese(w); rows.push({user_id:State.user.id,category_id,kanji:w,reading,meaning,status:'belum_hafal',favorite:false,review_level:0,next_review_date:todayStr(),review_count:0}); ok++; }
    catch(e){ fail++; }
  }
  if(rows.length){ const {data,error}=await sb.from('flashcards').insert(rows).select(); if(!error&&data)State.flashcards=data.concat(State.flashcards); else if(error){ok=0;fail=total;toast('Gagal menyimpan ke database','error');} }
  const res=document.createElement('div');
  res.innerHTML=`<div class="batch-result"><div class="b ok">Berhasil<br>${ok}</div><div class="b fail">Gagal<br>${fail}</div><div class="b skip">Dilewati<br>${skipped}</div></div>
    <div class="actions" style="margin-top:14px"><button class="btn btn-primary" id="b-done">Selesai</button></div>`;
  formArea.appendChild(res);
  $('#b-done').onclick=()=>{ root.innerHTML=''; toast(`Selesai: ${ok} berhasil`,'success'); refreshAll(); };
}

/* ============================ STUDY (FLIP) ============================ */
function startStudy(){
  const filter=$('#fc-filter').value, status=$('#fc-status').value;
  let list=State.flashcards.slice();
  if(filter)list=list.filter(f=>f.category_id===filter);
  if(status==='favorite')list=list.filter(f=>f.favorite);
  else if(status==='hafal')list=list.filter(f=>f.status==='hafal');
  else if(status==='belum_hafal')list=list.filter(f=>f.status!=='hafal');
  list.sort((a,b)=>(a.status==='hafal'?1:0)-(b.status==='hafal'?1:0));
  State.study={list,idx:0,flipped:false};
  $('#study-cat').textContent=filter?catName(filter):'Semua';
  goto('study');
}
function renderStudy(){
  const {list,idx}=State.study; const empty=$('#study-empty'),wrap=$('#study-wrap');
  if(!list.length){empty.classList.remove('hidden');wrap.classList.add('hidden');return;}
  empty.classList.add('hidden');wrap.classList.remove('hidden');
  const f=list[idx]; $('#flip').classList.remove('flipped'); State.study.flipped=false;
  $('#study-kanji').textContent=f.kanji; $('#study-reading').textContent=f.reading||'—'; $('#study-meaning').textContent=f.meaning||'—';
  $('#study-count').textContent=`${idx+1} / ${list.length}`;
  $('#study-hafal').style.opacity=f.status==='hafal'?'1':'.65'; $('#study-belum').style.opacity=f.status==='hafal'?'.65':'1';
}
function flipStudy(){ State.study.flipped=!State.study.flipped; $('#flip').classList.toggle('flipped',State.study.flipped); if(State.study.flipped&&State.autoplay){const f=State.study.list[State.study.idx]; if(f)Speech.speak(f.kanji);} }
function studyMove(d){ const n=State.study.list.length; if(!n)return; State.study.idx=(State.study.idx+d+n)%n; renderStudy(); }
async function studySetStatus(status){
  const f=State.study.list[State.study.idx]; if(!f)return;
  if(f.status!==status){ f.status=status; await updateFlashcard(f.id,{status}); }
  toast(status==='hafal'?'Ditandai hafal ✓':'Ditandai belum hafal','success',1200);
  renderStudy(); setTimeout(()=>studyMove(1),300);
}

/* ============================ REVIEW (SRS) ============================ */
function startReview(){
  let list=dueCards();
  const t=todayStr();
  list.sort((a,b)=>{ const da=a.next_review_date||t, db=b.next_review_date||t; if(da!==db)return da<db?-1:1; return (a.review_count||0)-(b.review_count||0); });
  State.review={list,idx:0,shown:false};
}
function renderReview(){
  const {list,idx}=State.review; const empty=$('#review-empty'),wrap=$('#review-wrap');
  if(idx>=list.length||!list.length){ empty.classList.remove('hidden'); wrap.classList.add('hidden'); $('#review-left').textContent='0'; renderDashboard(); return; }
  empty.classList.add('hidden'); wrap.classList.remove('hidden');
  const f=list[idx]; $('#rflip').classList.remove('flipped'); State.review.shown=false;
  $('#review-kanji').textContent=f.kanji; $('#review-reading').textContent=f.reading||'—'; $('#review-meaning').textContent=f.meaning||'—';
  $('#review-count').textContent=`${list.length-idx} tersisa`; $('#review-left').textContent=list.length-idx;
  $('#review-show').classList.remove('hidden'); $('#review-grade').classList.add('hidden');
}
function reviewShowAnswer(){
  State.review.shown=true; $('#rflip').classList.add('flipped');
  $('#review-show').classList.add('hidden'); $('#review-grade').classList.remove('hidden');
  if(State.autoplay){ const f=State.review.list[State.review.idx]; if(f)Speech.speak(f.kanji); }
}
async function reviewGrade(grade){
  const f=State.review.list[State.review.idx]; if(!f)return;
  let level=f.review_level||0, next;
  if(grade==='sulit'){ level=Math.max(0,level-1); next=addDays(1); }
  else if(grade==='normal'){ level=Math.min(6,level+1); next=addDays(SRS_DAYS[level]||1); }
  else { level=Math.min(6,level+2); next=addDays(SRS_DAYS[level]||1); }
  const patch={review_level:level,next_review_date:next,last_reviewed_at:new Date().toISOString(),review_count:(f.review_count||0)+1};
  if(grade!=='sulit') patch.status='hafal';
  await updateFlashcard(f.id,patch);
  await bumpStreak();
  State.review.idx++; renderReview();
}
async function bumpStreak(){
  const p=State.profile; if(!p)return; const t=todayStr();
  if(p.last_review_date===t)return;
  if(p.last_review_date && daysBetween(p.last_review_date,t)===1) p.streak=(p.streak||0)+1;
  else p.streak=1;
  p.last_review_date=t; await saveStreak();
}

/* ============================ NOTES ============================ */
function visibleNotes(){
  const q=$('#note-search').value.trim().toLowerCase(), filter=$('#note-filter').value;
  let arr=State.notes.slice();
  if(filter)arr=arr.filter(n=>n.category_id===filter);
  if(q)arr=arr.filter(n=>(n.title||'').toLowerCase().includes(q)||(n.content||'').toLowerCase().includes(q));
  return arr;
}
function renderNotes(){
  const list=$('#note-list'), arr=visibleNotes();
  if(!arr.length){ list.innerHTML=`<div class="empty nb"><span class="em">📝</span>Belum ada catatan.</div>`; return; }
  list.innerHTML=arr.map(n=>`<div class="row-card nb"><div class="grow"><div class="title">${esc(n.title)}</div>
    <div class="sub">${esc((n.content||'').slice(0,80))}${(n.content||'').length>80?'…':''}</div>
    <div style="margin-top:8px"><span class="tag gray">${esc(n.category_id?catName(n.category_id):'Tanpa Kategori')}</span></div></div>
    <div class="card-actions"><button class="btn btn-mini btn-ghost" data-edit-note="${n.id}">✎</button><button class="btn btn-mini btn-danger" data-del-note="${n.id}">🗑</button></div></div>`).join('');
  $$('[data-edit-note]',list).forEach(b=>b.onclick=()=>noteForm(b.dataset.editNote));
  $$('[data-del-note]',list).forEach(b=>b.onclick=()=>confirmDeleteNote(b.dataset.delNote));
}
async function noteForm(id){
  const editing=State.notes.find(n=>n.id===id);
  const opts=`<option value="">Tanpa Kategori</option>`+State.categories.map(c=>`<option value="${c.id}" ${editing&&c.id===editing.category_id?'selected':''}>${esc(c.name)}</option>`).join('');
  const ok=await modal({title:editing?'Edit Catatan':'Tambah Catatan',
    body:`<div class="field"><label>Kategori</label><select class="select" id="m-note-cat" style="width:100%">${opts}</select></div>
      <div class="field"><label>Judul</label><input class="input" id="m-note-title" value="${esc(editing?editing.title:'')}" placeholder="Mis. Pola ～たい"/></div>
      <div class="field"><label>Isi</label><textarea class="textarea" id="m-note-content" placeholder="Tulis catatan…">${esc(editing?editing.content:'')}</textarea></div>`,
    confirmText:editing?'Simpan':'Tambah',
    onConfirm:async()=>{ const title=$('#m-note-title').value.trim(); if(!title){toast('Judul wajib diisi','warning');return false;}
      const o={category_id:$('#m-note-cat').value||null,title,content:$('#m-note-content').value.trim()};
      if(editing)await updateNote(id,o); else await createNote(o); }});
  if(ok){ toast(editing?'Catatan diperbarui':'Catatan ditambahkan','success'); renderNotes(); }
}
async function confirmDeleteNote(id){
  const n=State.notes.find(x=>x.id===id);
  const ok=await modal({title:'Hapus Catatan?',body:`<p>"${esc(n.title)}" akan dihapus permanen.</p>`,confirmText:'Hapus',danger:true});
  if(!ok)return; await deleteNote(id); toast('Catatan dihapus','success'); renderNotes();
}

/* ============================ DICTIONARY ============================ */
/* Cek dictionary untuk satu kata (kanji atau reading sama persis) */
async function lookupDictionary(word){
  try{
    const {data}=await sb.from('dictionary').select('kanji,reading,meaning,jlpt_level')
      .or(`kanji.eq.${word},reading.eq.${word}`).limit(1).maybeSingle();
    return data||null;
  }catch(e){ return null; }
}
/* Cek banyak kata sekaligus (untuk batch) → map kanji→entry */
async function lookupDictionaryMany(words){
  const map={};
  try{
    const {data}=await sb.from('dictionary').select('kanji,reading,meaning').in('kanji',words);
    (data||[]).forEach(d=>{ map[d.kanji]=d; });
  }catch(e){}
  return map;
}
/* Pencarian dictionary (kanji / hiragana / katakana / Indonesia) */
async function searchDictionary(q, level){
  let query=sb.from('dictionary').select('id,kanji,reading,meaning,jlpt_level');
  if(level) query=query.eq('jlpt_level',level);
  q=(q||'').trim();
  if(q){
    const hira=kataToHira(q);
    const terms=[`kanji.ilike.%${q}%`,`reading.ilike.%${q}%`,`meaning.ilike.%${q}%`];
    if(hira!==q) terms.push(`reading.ilike.%${hira}%`);
    query=query.or(terms.join(','));
  }
  query=query.order('jlpt_level',{ascending:true}).limit(2000);
  const {data,error}=await query;
  if(error){ toast('Gagal memuat kamus','error'); return []; }
  return data||[];
}
let dictTimer=null;
async function runDictionarySearch(){
  const q=$('#dict-search').value, level=$('#dict-level').value;
  const list=$('#dict-list'); list.innerHTML=`<div class="empty"><span class="em">⏳</span>Memuat…</div>`;
  const res=await searchDictionary(q,level);
  State.dictResults=res; State.dictLimit=50; renderDictionary();
}
function renderDictionary(){
  const list=$('#dict-list'); const all=State.dictResults; const arr=all.slice(0,State.dictLimit);
  $('#dict-count').textContent = `${all.length} kata`;
  if(!all.length){ list.innerHTML=`<div class="empty nb"><span class="em">📕</span>Tidak ada hasil di kamus.<br/>Coba kata lain, atau tambahkan via Flashcard (AI).</div>`; $('#dict-more').classList.add('hidden'); return; }
  list.innerHTML=arr.map(d=>{ const lv=(d.jlpt_level||'').toUpperCase(); const cls=lv==='N5'?'n5':lv==='N4'?'n4':'ai';
    return `<div class="row-card nb jp"><div class="grow"><div class="title">${esc(d.kanji)}</div>
      <div class="sub">${esc(d.reading||'')} · ${esc(d.meaning||'')}</div>
      <div style="margin-top:8px;display:flex;gap:6px"><span class="tag ${cls}">${esc(lv||'—')}</span></div></div>
      <div class="card-actions"><button class="btn btn-mini btn-ghost" data-dspk="${d.id}">🔊</button>
      <button class="btn btn-mini btn-accent" data-dadd="${d.id}">➕</button></div></div>`; }).join('');
  $('#dict-more').classList.toggle('hidden', all.length<=State.dictLimit);
  $$('[data-dspk]',list).forEach(b=>b.onclick=()=>{ const d=all.find(x=>x.id===b.dataset.dspk); if(d)Speech.speak(d.kanji); });
  $$('[data-dadd]',list).forEach(b=>b.onclick=()=>{ const d=all.find(x=>x.id===b.dataset.dadd); if(d)addDictToFlashcard(d); });
}
async function addDictToFlashcard(d){
  if(!State.categories.length){ toast('Buat kategori terlebih dahulu','warning'); goto('category'); return; }
  const opts=State.categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const ok=await modal({title:'Tambahkan ke Flashcard',
    body:`<p>"${esc(d.kanji)}" (${esc(d.reading)}) — ${esc(d.meaning)}</p>
      <div class="field"><label>Kategori</label><select class="select" id="m-da-cat" style="width:100%">${opts}</select></div>`,
    confirmText:'Tambah',
    onConfirm:async()=>{ const category_id=$('#m-da-cat').value; const card=await createFlashcard({category_id,kanji:d.kanji,reading:d.reading,meaning:d.meaning}); if(!card)return false; }});
  if(ok){ toast('Ditambahkan ke flashcard 🎉','success'); refreshAll(); }
}

/* ============================ BUILT-IN DECK (N5/N4/N3) ============================ */
function deckHafalCount(level){
  let n=0; const pre=level+'|';
  for(const k in State.deckProgress){ if(k.startsWith(pre)&&State.deckProgress[k]==='hafal') n++; }
  return n;
}
async function renderDeckCards(){
  const wrap=$('#deck-cards'); if(!wrap) return;
  wrap.innerHTML=`<div class="empty"><span class="em">⏳</span>Memuat…</div>`;
  async function levelCard(level){
    const {count}=await sb.from('dictionary').select('id',{count:'exact',head:true}).eq('jlpt_level',level);
    const total=count||0; const hafal=Math.min(deckHafalCount(level),total); const pct=total?Math.round(hafal/total*100):0;
    return `<div class="row-card nb"><div class="grow">
      <div class="title">📚 Belajar ${level}</div>
      <div class="sub">${total} kartu · ${hafal} hafal</div>
      <div class="mini-bar"><div class="mini-fill" style="width:${pct}%"></div></div>
      <div style="font-size:12px;font-weight:800;margin-top:5px">${pct}%</div></div>
      <button class="btn btn-sm btn-primary" data-deck="${level}">Mulai</button></div>`;
  }
  const cards=[]; for(const lv of ['N5','N4','N3']) cards.push(await levelCard(lv));
  wrap.innerHTML=cards.join('');
  $$('[data-deck]',wrap).forEach(b=>b.onclick=()=>openDeck(b.dataset.deck));
}
async function openDeck(level){
  overlay(`Memuat deck ${level}…`);
  const {data,error}=await sb.from('dictionary').select('id,kanji,reading,meaning').eq('jlpt_level',level).order('created_at',{ascending:true}).limit(3000);
  overlayOff();
  if(error){ toast('Gagal memuat deck','error'); return; }
  const all=data||[];
  // tampilkan hanya yang belum hafal
  const list=all.filter(c=>State.deckProgress[level+'|'+c.kanji]!=='hafal');
  State.deck={ level, all, list, idx:0, flipped:false, total:all.length };
  $('#deck-title').textContent=`Belajar ${level}`;
  goto('deck');
}
function renderDeck(){
  const d=State.deck; const empty=$('#deck-empty'),wrap=$('#deck-wrap');
  const hafal=d.total - d.list.length;
  const pct=d.total?Math.round(hafal/d.total*100):0;
  if(!d.list.length){ empty.classList.remove('hidden'); wrap.classList.add('hidden'); $('#deck-counter').textContent=`${pct}%`; return; }
  empty.classList.add('hidden'); wrap.classList.remove('hidden');
  if(d.idx>=d.list.length) d.idx=0;
  const c=d.list[d.idx]; $('#dflip').classList.remove('flipped'); d.flipped=false;
  $('#deck-kanji').textContent=c.kanji; $('#deck-reading').textContent=c.reading||'—'; $('#deck-meaning').textContent=c.meaning||'—';
  $('#deck-counter').textContent=`${d.idx+1} / ${d.list.length}`;
  $('#deck-fill').style.width=pct+'%';
  $('#deck-progress-txt').textContent=`${hafal} / ${d.total} hafal · ${pct}%`;
}
function deckFlip(){ const d=State.deck; d.flipped=!d.flipped; $('#dflip').classList.toggle('flipped',d.flipped); if(d.flipped&&State.autoplay){const c=d.list[d.idx]; if(c)Speech.speak(c.kanji);} }
function deckMove(dir){ const d=State.deck; const n=d.list.length; if(!n)return; d.idx=(d.idx+dir+n)%n; renderDeck(); }
function deckShuffle(){ const a=State.deck.list; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } State.deck.idx=0; renderDeck(); toast('Kartu diacak 🔀','success',1100); }
async function deckSetStatus(status){
  const d=State.deck; const c=d.list[d.idx]; if(!c)return;
  const key=d.level+'|'+c.kanji;
  if(status==='hafal'){
    State.deckProgress[key]='hafal';
    // simpan ke DB
    await sb.from('deck_progress').upsert(
      { user_id:State.user.id, jlpt_level:d.level, kanji:c.kanji, status:'hafal', last_reviewed_at:new Date().toISOString() },
      { onConflict:'user_id,jlpt_level,kanji' });
    // keluarkan dari antrian belajar
    d.list.splice(d.idx,1);
    if(d.idx>=d.list.length) d.idx=0;
    toast('Ditandai hafal ✓','success',1000);
    renderDeck();
  } else {
    // belum hafal → lanjut ke kartu berikutnya, tetap di antrian
    toast('Lanjut…','info',800);
    deckMove(1);
  }
}

/* ============================ PROGRESS + CHARTS ============================ */
function renderProgress(){
  const {total,hafal,belum,pct}=stats();
  $('#pg-total').textContent=total; $('#pg-hafal').textContent=hafal; $('#pg-belum').textContent=belum; $('#pg-pct').textContent=pct+'%';
  drawDonut(hafal,belum); drawSrs();
  const wrap=$('#pg-cats');
  if(!State.categories.length){ wrap.innerHTML=`<div class="empty nb"><span class="em">📊</span>Belum ada data kategori.</div>`; return; }
  wrap.innerHTML=State.categories.map(c=>{ const cards=State.flashcards.filter(f=>f.category_id===c.id); const h=cards.filter(f=>f.status==='hafal').length; const p=cards.length?Math.round(h/cards.length*100):0;
    return `<div class="cat-stat nb"><div class="grow"><div class="nm">${esc(c.name)}</div><div class="mini-bar"><div class="mini-fill" style="width:${p}%"></div></div>
      <div style="font-size:12px;font-weight:700;color:var(--text-2);margin-top:5px">${h}/${cards.length} hafal</div></div><div class="pct">${p}%</div></div>`; }).join('');
}
function drawDonut(hafal,belum){
  const cv=$('#donut'); const dpr=window.devicePixelRatio||1; const W=cv.clientWidth||320,H=220;
  cv.width=W*dpr;cv.height=H*dpr; const ctx=cv.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,H);
  const css=getComputedStyle(document.documentElement);
  const cHafal=(css.getPropertyValue('--accent').trim())||'#22C55E';
  const cBelum=(css.getPropertyValue('--amber').trim())||'#F59E0B';
  const cBorder=(css.getPropertyValue('--border').trim())||'#E5E7EB';
  const cSurf=(css.getPropertyValue('--surface').trim())||'#fff';
  const cText=(css.getPropertyValue('--text').trim())||'#111827';
  const cText2=(css.getPropertyValue('--text-2').trim())||'#6B7280';
  const cx=W/2,cy=H/2,R=78,r=48,total=hafal+belum;
  const segs=total?[{v:hafal,color:cHafal},{v:belum,color:cBelum}]:[{v:1,color:cBorder}];
  let start=-Math.PI/2;
  segs.forEach(s=>{ const ang=(s.v/(total||1))*Math.PI*2; ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,R,start,start+ang);ctx.closePath();ctx.fillStyle=s.color;ctx.fill();start+=ang; });
  ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=cSurf;ctx.fill();
  const pct=total?Math.round(hafal/total*100):0;
  ctx.fillStyle=cText;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='800 30px Inter,sans-serif';ctx.fillText(pct+'%',cx,cy-6);
  ctx.font='700 12px Inter,sans-serif';ctx.fillStyle=cText2;ctx.fillText('HAFAL',cx,cy+16);
  ctx.textAlign='left';ctx.font='700 13px Inter,sans-serif';
  ctx.fillStyle=cHafal;ctx.beginPath();ctx.arc(7,H-12,6,0,Math.PI*2);ctx.fill();ctx.fillStyle=cText;ctx.fillText('Hafal ('+hafal+')',20,H-11);
  ctx.fillStyle=cBelum;ctx.beginPath();ctx.arc(127,H-12,6,0,Math.PI*2);ctx.fill();ctx.fillStyle=cText;ctx.fillText('Belum ('+belum+')',140,H-11);
}
function drawSrs(){
  const cv=$('#srs-chart'); const dpr=window.devicePixelRatio||1; const W=cv.clientWidth||320,H=200;
  cv.width=W*dpr;cv.height=H*dpr; const ctx=cv.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,H);
  const css=getComputedStyle(document.documentElement);
  const bar=(css.getPropertyValue('--primary').trim())||'#6366F1';
  const cText=(css.getPropertyValue('--text').trim())||'#111827';
  const cText2=(css.getPropertyValue('--text-2').trim())||'#6B7280';
  const counts=[0,0,0,0,0,0,0]; State.flashcards.forEach(f=>{ const l=Math.min(6,Math.max(0,f.review_level||0)); counts[l]++; });
  const max=Math.max(1,...counts); const pad=24, bw=(W-pad*2)/7, base=H-26;
  function rr(x,y,w,hh,rad){ rad=Math.min(rad,w/2,hh/2); ctx.beginPath(); ctx.moveTo(x+rad,y); ctx.arcTo(x+w,y,x+w,y+hh,rad); ctx.arcTo(x+w,y+hh,x,y+hh,rad); ctx.arcTo(x,y+hh,x,y,rad); ctx.arcTo(x,y,x+w,y,rad); ctx.closePath(); }
  counts.forEach((c,i)=>{ const h=Math.round((c/max)*(base-18)); const x=pad+i*bw+bw*0.18, y=base-Math.max(h,3), w=bw*0.64;
    ctx.fillStyle=bar; ctx.globalAlpha=c>0?1:.25; rr(x,y,w,Math.max(h,3),5); ctx.fill(); ctx.globalAlpha=1;
    ctx.fillStyle=cText;ctx.textAlign='center';ctx.font='700 12px Inter,sans-serif'; if(c>0)ctx.fillText(c,x+w/2,y-6);
    ctx.font='600 11px Inter,sans-serif';ctx.fillStyle=cText2;ctx.fillText('L'+i,x+w/2,H-8); });
}

/* ============================ SETTINGS / EXPORT-IMPORT ============================ */
function renderSettings(){
  const name=State.profile?.name||'Pelajar';
  $('#set-name').textContent=name; $('#set-email').textContent=State.user?.email||''; $('#set-avatar').textContent=(name[0]||'P').toUpperCase();
  $('#set-autoplay').checked=State.autoplay;
  $('#set-speed').value = String(State.ttsSpeed);
  $('#set-theme').checked = (State.theme==='dark');
  populateVoicePicker();
}
function exportData(){
  const payload={app:'nihongo-flash',version:2,exported_at:new Date().toISOString(),profile:{name:State.profile?.name||''},
    categories:State.categories.map(({id,name,created_at})=>({id,name,created_at})),
    flashcards:State.flashcards.map(({id,category_id,kanji,reading,meaning,status,favorite,review_level,next_review_date,review_count,created_at})=>({id,category_id,kanji,reading,meaning,status,favorite,review_level,next_review_date,review_count,created_at})),
    notes:State.notes.map(({id,category_id,title,content,created_at})=>({id,category_id,title,content,created_at}))};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`nihongo-flash-backup-${todayStr()}.json`; a.click(); URL.revokeObjectURL(url);
  toast('Data diekspor','success');
}
function importData(file){
  const reader=new FileReader();
  reader.onload=async()=>{
    let data; try{data=JSON.parse(reader.result);}catch(e){return toast('File JSON tidak valid','error');}
    if(data.app!=='nihongo-flash'||!Array.isArray(data.categories)||!Array.isArray(data.flashcards))return toast('Format backup tidak dikenali','error');
    const notes=Array.isArray(data.notes)?data.notes:[];
    const ok=await modal({title:'Import Data?',body:`<p>Menambahkan <b>${data.categories.length} kategori</b>, <b>${data.flashcards.length} flashcard</b>, <b>${notes.length} catatan</b>.</p>`,confirmText:'Import'});
    if(!ok)return; overlay('Mengimpor data…');
    try{
      const map={};
      for(const c of data.categories){ if(!c.name)continue; const created=await createCategory(c.name); if(created&&c.id)map[c.id]=created.id; }
      const rows=data.flashcards.filter(f=>f.kanji).map(f=>({user_id:State.user.id,category_id:map[f.category_id]||(State.categories[0]&&State.categories[0].id)||null,kanji:f.kanji,reading:f.reading||'',meaning:f.meaning||'',status:f.status==='hafal'?'hafal':'belum_hafal',favorite:!!f.favorite,review_level:f.review_level||0,next_review_date:f.next_review_date||todayStr(),review_count:f.review_count||0})).filter(r=>r.category_id);
      if(rows.length){ const {data:ins,error}=await sb.from('flashcards').insert(rows).select(); if(error)throw error; State.flashcards=(ins||[]).concat(State.flashcards); }
      const nrows=notes.filter(n=>n.title).map(n=>({user_id:State.user.id,category_id:map[n.category_id]||null,title:n.title,content:n.content||''}));
      if(nrows.length){ const {data:nins,error:ne}=await sb.from('notes').insert(nrows).select(); if(ne)throw ne; State.notes=(nins||[]).concat(State.notes); }
      overlayOff(); toast('Import berhasil 🎉','success'); refreshAll();
    }catch(err){ overlayOff(); toast('Import gagal: '+(err.message||''),'error',4000); }
  };
  reader.readAsText(file);
}

/* ============================ NAV / REFRESH ============================ */
function refreshAll(){ renderDashboard(); renderCategory(); refreshFilters(); renderFlashcards(); renderNotes(); renderProgress(); renderSettings(); }
function goto(screen){
  show(screen); setActiveNav(screen==='deck'?'dictionary':(['dashboard','flashcard','review','dictionary','notes','settings'].includes(screen)?screen:''));
  if(screen==='dashboard')renderDashboard();
  if(screen==='category')renderCategory();
  if(screen==='flashcard'){State.fcLimit=60;refreshFilters();renderFlashcards();}
  if(screen==='study')renderStudy();
  if(screen==='review'){startReview();renderReview();}
  if(screen==='dictionary'){ renderDeckCards(); if(!State.dictResults.length) runDictionarySearch(); else renderDictionary(); }
  if(screen==='deck')renderDeck();
  if(screen==='notes'){refreshFilters();renderNotes();}
  if(screen==='progress')renderProgress();
  if(screen==='settings')renderSettings();
}

/* ============================ EVENTS ============================ */
let searchTimer=null;
function bindEvents(){
  $$('[data-go]').forEach(b=>b.onclick=()=>show(b.dataset.go));
  $('#reg-submit').onclick=doRegister; $('#log-submit').onclick=doLogin;
  $('#welcome-google').onclick=doGoogle; $('#login-google').onclick=doGoogle;
  $$('.nav-btn').forEach(b=>b.onclick=()=>goto(b.dataset.nav));
  $$('[data-nav]').forEach(b=>{ if(!b.classList.contains('nav-btn'))b.onclick=()=>goto(b.dataset.nav); });

  $('#cat-add-btn').onclick=()=>categoryForm(null);
  $('#fc-add-btn').onclick=()=>addFlashcardForm(null);
  if($('#fc-batch-btn')) $('#fc-batch-btn').onclick=batchImportForm;
  if($('#dash-batch')) $('#dash-batch').onclick=batchImportForm;
  if($('#dash-start')) $('#dash-start').onclick=()=>{ const due=dueCards().length; goto(due>0?'review':'flashcard'); };
  $('#fc-study-btn').onclick=startStudy;
  $('#fc-search').addEventListener('input',()=>{ clearTimeout(searchTimer); searchTimer=setTimeout(()=>{State.fcLimit=60;renderFlashcards();},120); });
  $('#fc-filter').addEventListener('change',()=>{State.fcLimit=60;renderFlashcards();});
  $('#fc-status').addEventListener('change',()=>{State.fcLimit=60;renderFlashcards();});
  $('#fc-sort').addEventListener('change',()=>{State.fcLimit=60;renderFlashcards();});
  $('#fc-more').onclick=()=>{State.fcLimit+=60;renderFlashcards();};

  $('#flip').onclick=flipStudy;
  $('#study-speak-f').onclick=e=>{e.stopPropagation();const f=State.study.list[State.study.idx];if(f)Speech.speak(f.kanji);};
  $('#study-speak-b').onclick=e=>{e.stopPropagation();const f=State.study.list[State.study.idx];if(f)Speech.speak(f.kanji);};
  $('#study-hafal').onclick=e=>{e.stopPropagation();studySetStatus('hafal');};
  $('#study-belum').onclick=e=>{e.stopPropagation();studySetStatus('belum_hafal');};
  $('#study-prev').onclick=()=>studyMove(-1); $('#study-next').onclick=()=>studyMove(1);

  $('#review-show').onclick=reviewShowAnswer;
  $('#review-speak-f').onclick=e=>{e.stopPropagation();const f=State.review.list[State.review.idx];if(f)Speech.speak(f.kanji);};
  $('#review-speak-b').onclick=e=>{e.stopPropagation();const f=State.review.list[State.review.idx];if(f)Speech.speak(f.kanji);};
  $$('#review-grade [data-grade]').forEach(b=>b.onclick=()=>reviewGrade(b.dataset.grade));

  $('#note-add-btn').onclick=()=>noteForm(null);
  $('#note-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(renderNotes,120);});
  $('#note-filter').addEventListener('change',renderNotes);

  $('#dict-search').addEventListener('input',()=>{clearTimeout(dictTimer);dictTimer=setTimeout(runDictionarySearch,250);});
  $('#dict-level').addEventListener('change',runDictionarySearch);
  $('#dict-more').onclick=()=>{State.dictLimit+=50;renderDictionary();};

  $('#dflip').onclick=deckFlip;
  $('#deck-speak-f').onclick=e=>{e.stopPropagation();const c=State.deck.list[State.deck.idx];if(c)Speech.speak(c.kanji);};
  $('#deck-speak-b').onclick=e=>{e.stopPropagation();const c=State.deck.list[State.deck.idx];if(c)Speech.speak(c.kanji);};
  $('#deck-hafal').onclick=e=>{e.stopPropagation();deckSetStatus('hafal');};
  $('#deck-belum').onclick=e=>{e.stopPropagation();deckSetStatus('belum_hafal');};
  $('#deck-prev').onclick=()=>deckMove(-1);
  $('#deck-shuffle').onclick=deckShuffle;

  $('#set-autoplay')?.addEventListener('change',e=>{ State.autoplay=e.target.checked; localStorage.setItem('nf_autoplay',State.autoplay?'1':'0'); });
  $('#set-speed')?.addEventListener('change',e=>{ State.ttsSpeed=parseFloat(e.target.value); localStorage.setItem('nf_tts_speed',e.target.value); toast(`Kecepatan: ${e.target.value}×`,'success',1200); });
  $('#set-voice')?.addEventListener('change',e=>{ Speech.setVoice(e.target.value); if(e.target.value) toast('Voice diubah','success',1200); });
  $('#set-theme')?.addEventListener('change',e=>{ applyTheme(e.target.checked?'dark':'light'); });
  // Avatar upload (Settings + Dashboard avatar tap)
  ['#set-avatar','#dash-avatar'].forEach(sel=>{
    $(sel)?.addEventListener('click',()=>$('#avatar-file')?.click());
  });
  $('#avatar-file')?.addEventListener('change',e=>{ const f=e.target.files?.[0]; if(f)uploadAvatar(f); e.target.value=''; });
  $('#btn-logout').onclick=doLogout; $('#btn-export').onclick=exportData;
  $('#btn-import').onclick=()=>$('#import-file').click();
  $('#import-file').onchange=e=>{ if(e.target.files[0])importData(e.target.files[0]); e.target.value=''; };

  $('#log-pass').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
  $('#reg-pass2').addEventListener('keydown',e=>{if(e.key==='Enter')doRegister();});
}

/* ============================ PWA ============================ */
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;showInstallPill();});
function showInstallPill(){
  if(!deferredPrompt)return;
  $('#install-root').innerHTML=`<div class="install-pill nb"><div class="grow"><div class="t">📲 Pasang Nihongo Flash</div></div><button class="btn btn-sm btn-primary" id="pwa-install">Pasang</button><button class="btn btn-icon btn-ghost" id="pwa-dismiss">✕</button></div>`;
  $('#pwa-install').onclick=async()=>{$('#install-root').innerHTML='';deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;};
  $('#pwa-dismiss').onclick=()=>$('#install-root').innerHTML='';
}
if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('service-worker.js').catch(()=>{})); }

/* ============================ INIT ============================ */
async function init(){
  // Boot timeout — kalau 8 detik masih loading, paksa tampilkan welcome
  const bootTimer = setTimeout(()=>{
    $('#boot')?.classList.add('hidden');
    setNavVisible(false); show('welcome');
  }, 8000);

  try {
    applyTheme(State.theme);
    bindEvents(); Speech.init();
    const {data:{session}} = await sb.auth.getSession();
    clearTimeout(bootTimer);
    $('#boot').classList.add('hidden');
    if(session?.user){ await afterLogin(session.user); }
    else { setNavVisible(false); show('welcome'); }
  } catch(err){
    clearTimeout(bootTimer);
    console.error('Init error:', err);
    $('#boot')?.classList.add('hidden');
    setNavVisible(false); show('welcome');
  }

  sb.auth.onAuthStateChange(async(event,sess)=>{
    if(event==='SIGNED_IN'&&sess?.user&&!State.user){ await afterLogin(sess.user); }
    if(event==='SIGNED_OUT'){ State.user=null; setNavVisible(false); show('welcome'); }
  });
}
init();
