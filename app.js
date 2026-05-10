// Generate app icon at runtime (no external PNG required)
(function(){
  try{
    const sz=192,c=document.createElement('canvas');c.width=sz;c.height=sz;
    const ctx=c.getContext('2d');
    ctx.fillStyle='#115ea3';
    if(ctx.roundRect)ctx.roundRect(0,0,sz,sz,sz*0.2);else ctx.rect(0,0,sz,sz);
    ctx.fill();
    ctx.fillStyle='#fff';ctx.font=`bold ${sz*0.62}px Arial,sans-serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('N',sz/2,sz*0.53);
    const url=c.toDataURL('image/png');
    const atl=document.querySelector('link[rel="apple-touch-icon"]');
    if(atl)atl.href=url;
  }catch(e){}
})();

const SK="nous_v4";
let currentUser=null;

// ── SUPABASE CONFIG ──
// SUPABASE_KEY is the anon/publishable key — intentionally client-visible (Supabase design).
// Security model: authentication via Supabase Auth (JWT); data access gated by the session token.
// RLS is ACTIVE on nous_events. Only authenticated sessions (valid JWT) can read/write.
// Unauthenticated requests with the anon key alone are rejected by Supabase.
const SUPABASE_URL = 'https://uojnjhpvwmgslerallxj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_sTY9Fhw42eOQ-jSAD_pKNg_a8QhW6Vs';
const TABLE = 'nous_events';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'nous_auth'
  }
});
const MONTHS=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const DAYS=['Mo','Di','Mi','Do','Fr','Sa','So'];
const SL={blocker:'Blocker',save:'Save the Date',zugesagt:'Zugesagt',teilweise:'Teilweise gebucht',final:'Final'};
const SC={blocker:'sb-blocker',save:'sb-save',zugesagt:'sb-zugesagt',teilweise:'sb-teilweise',final:'sb-final'};
const SCB={blocker:'s-blocker',save:'s-save',zugesagt:'s-zugesagt',teilweise:'s-teilweise',final:'s-final'};
const OL={gemeinsam:'Gemeinsam',toja:'Toja',johann:'Johann'};
const OC={gemeinsam:'ob-gemeinsam',toja:'ob-toja',johann:'ob-johann'};
const PERSONS=['toja','johann'], DIRS=['an','ab'];
let events=[],editId=null,pendingAtt=[],pvId=null,selIds=new Set(),bulkMode=false,calY,calM,subCnt=0,todoCnt=0;
let notesQuill=null;

// Airport IATA → address mapping
const AIRPORTS={
  FRA:'Flughafen Frankfurt, 60549 Frankfurt am Main',
  MUC:'Flughafen München, Nordallee 25, 85356 München',
  HAM:'Flughafen Hamburg, Flughafenstraße 1-3, 22335 Hamburg',
  BER:'Flughafen Berlin Brandenburg, 12521 Berlin',
  DUS:'Flughafen Düsseldorf, Flughafenstraße, 40474 Düsseldorf',
  STR:'Flughafen Stuttgart, Flughafenstraße, 70629 Stuttgart',
  CGN:'Flughafen Köln/Bonn, Kennedystraße, 51147 Köln',
  NUE:'Flughafen Nürnberg, 90411 Nürnberg',
  VIE:'Flughafen Wien, 1300 Wien-Schwechat',
  ZRH:'Flughafen Zürich, 8058 Zürich',
  GVA:'Flughafen Genf, 1215 Genf',
  LHR:'London Heathrow Airport, Hounslow TW6',
  LGW:'London Gatwick Airport, Horley Surrey RH6',
  STN:'London Stansted Airport, Essex CM24',
  CDG:'Paris Charles de Gaulle, 95700 Roissy-en-France',
  ORY:'Paris Orly Airport, Orly',
  AMS:'Amsterdam Schiphol, Evert van de Beekstraat, Schiphol',
  BCN:'Barcelona El Prat Airport, El Prat de Llobregat',
  MAD:'Madrid Barajas Airport, Madrid',
  PMI:'Flughafen Palma de Mallorca',
  IBZ:'Flughafen Ibiza',
  AGP:'Málaga Costa del Sol Airport',
  ALC:'Alicante-Elche Airport',
  TFS:'Tenerife Sur Airport',
  LPA:'Gran Canaria Airport',
  FCO:'Rome Fiumicino Airport, Via dell\'Aeroporto, Fiumicino',
  MXP:'Milano Malpensa Airport, Ferno',
  ATH:'Athens International Airport, Spata',
  IST:'Istanbul Airport, Arnavutköy',
  DXB:'Dubai International Airport',
  DOH:'Hamad International Airport, Doha',
  JFK:'John F. Kennedy International Airport, New York',
  LGA:'LaGuardia Airport, Queens, New York',
  EWR:'Newark Liberty International Airport, Newark',
  LAX:'Los Angeles International Airport',
  ORD:'O\'Hare International Airport, Chicago',
  MIA:'Miami International Airport',
  SFO:'San Francisco International Airport',
  SIN:'Singapore Changi Airport',
  NRT:'Tokyo Narita International Airport',
  HND:'Tokyo Haneda Airport',
  ICN:'Seoul Incheon International Airport',
  CPH:'Copenhagen Airport Kastrup',
  OSL:'Oslo Gardermoen Airport',
  ARN:'Stockholm Arlanda Airport',
  HEL:'Helsinki Vantaa Airport',
  DUB:'Dublin Airport',
  LIS:'Lissabon Humberto Delgado Airport',
  OPO:'Porto Francisco Sá Carneiro Airport',
  PRG:'Prag Václav Havel Airport',
  WAW:'Warschau Chopin Airport',
  BUD:'Budapest Ferenc Liszt Airport',
  GRZ:'Flughafen Graz, 8073 Feldkirchen',
  SZG:'Flughafen Salzburg, Innsbrucker Bundesstraße 95, 5020 Salzburg',
  INN:'Flughafen Innsbruck, Fürstenweg 180, 6020 Innsbruck',
};

// German public holidays (national + Bayern/Hessen distinctions)
function _easterDate(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),dy=((h+l-7*m+114)%31)+1;return new Date(y,mo-1,dy);}
function _shiftDate(d,n){const r=new Date(d);r.setDate(r.getDate()+n);return r;}
function _ds(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
const _holCache={};
function getHolidays(year){
  if(_holCache[year]) return _holCache[year];
  const h={}, e=_easterDate(year);
  // states: null=bundesweit, 'BY'=nur Bayern, 'HE'=nur Hessen, 'BYHE'=Bayern+Hessen (nicht bundesweit)
  const add=(d,name,states)=>{h[_ds(d)]={name,states};};
  add(new Date(year,0,1),'Neujahr',null);
  add(new Date(year,0,6),'Hl. Drei Könige','BY');
  add(_shiftDate(e,-2),'Karfreitag',null);
  add(_shiftDate(e,1),'Ostermontag',null);
  add(new Date(year,4,1),'Tag der Arbeit',null);
  add(_shiftDate(e,39),'Christi Himmelfahrt',null);
  add(_shiftDate(e,50),'Pfingstmontag',null);
  add(_shiftDate(e,60),'Fronleichnam','BYHE');
  add(new Date(year,7,15),'Mariä Himmelfahrt','BY');
  add(new Date(year,9,3),'Tag der Einheit',null);
  add(new Date(year,10,1),'Allerheiligen','BY');
  add(new Date(year,11,25),'1. Weihnachtstag',null);
  add(new Date(year,11,26),'2. Weihnachtstag',null);
  return _holCache[year]=h;
}

function formatNominatimAddress(a, cc){
  if(!a) return '';
  const road=a.road||a.pedestrian||a.footway||a.path||a.cycleway||'';
  const hnum=a.house_number||'';
  const city=a.city||a.town||a.village||a.municipality||a.county||'';
  const post=a.postcode||'';
  const state=a.state||a.province||'';
  const suburb=a.suburb||a.neighbourhood||a.quarter||'';
  const c=cc?cc.toLowerCase():'';

  let street='', cityPart='';
  // HouseNr before street: FR, MC only (e.g. "10 Rue de la Paix")
  const numFirst=new Set(['fr','mc']);
  // HouseNr after street (Straße/Calle/Via Nr): DE, AT, CH, NL, BE, LU, PL, CZ,
  //   SK, HU, RO, HR, SI, BG, GR, TR, SE, NO, DK, FI, UA, RS, LT, LV, EE, IS,
  //   ES, IT, PT (e.g. "Calle Mayor 10", "Via Roma 10", "Rua Augusta 23")
  const numAfter=new Set(['de','at','ch','nl','be','lu','pl','cz','sk','hu','ro',
    'hr','si','bg','gr','tr','se','no','dk','fi','ua','rs','lt','lv','ee','is',
    'es','it','pt']);
  // HouseNr before, City then Postcode: GB, IE, AU, NZ
  const gbStyle=new Set(['gb','ie','au','nz']);
  // HouseNr before, City, State ZIP: US, CA
  const usStyle=new Set(['us','ca']);

  if(numFirst.has(c)){
    street=road&&hnum?`${hnum} ${road}`:road||hnum;
    cityPart=post&&city?`${post} ${city}`:city||post;
    return [street,cityPart].filter(Boolean).join(', ');
  }
  if(numAfter.has(c)){
    street=road&&hnum?`${road} ${hnum}`:road||hnum;
    cityPart=post&&city?`${post} ${city}`:city||post;
    return [street,cityPart].filter(Boolean).join(', ');
  }
  if(gbStyle.has(c)){
    street=road&&hnum?`${hnum} ${road}`:road||hnum;
    const sub=suburb&&suburb!==city?suburb:'';
    cityPart=city&&post?`${city} ${post}`:city||post;
    return [street,sub,cityPart].filter(Boolean).join(', ');
  }
  if(usStyle.has(c)){
    street=road&&hnum?`${hnum} ${road}`:road||hnum;
    const stateZip=state&&post?`${state} ${post}`:state||post;
    return [street,city,stateZip].filter(Boolean).join(', ');
  }
  // Default: same as numAfter (most common globally)
  street=road&&hnum?`${road} ${hnum}`:road||hnum;
  cityPart=post&&city?`${post} ${city}`:city||post;
  return [street,cityPart].filter(Boolean).join(', ');
}

function resolveAddr(addr){
  if(!addr)return addr;
  const code=addr.trim().toUpperCase();
  return AIRPORTS[code]||(code.length===3&&/^[A-Z]{3}$/.test(code)?code+' Airport':addr);
}

// Navigation helper
let _navPickerAddr='';
function openNav(addr,e){
  if(e){e.stopPropagation();}
  if(!addr) return;
  addr=resolveAddr(addr);
  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(isIOS){
    _navPickerAddr=addr;
    document.getElementById('navPickerAddr').textContent=addr;
    document.getElementById('navPickerBackdrop').classList.add('open');
  } else {
    window.open('https://www.google.com/maps/search/?q='+encodeURIComponent(addr),'_blank','noopener,noreferrer');
  }
}
function closeNavPicker(){document.getElementById('navPickerBackdrop').classList.remove('open');}
function navPickerOpen(app){
  const q=encodeURIComponent(_navPickerAddr);
  closeNavPicker();
  if(app==='apple') window.location.href='https://maps.apple.com/?q='+q;
  else if(app==='google') window.location.href='comgooglemaps://?q='+q+'&views=&zoom=14';
  else if(app==='waze') window.location.href='waze://?q='+q+'&navigate=yes';
}
function navLink(addr,label,extraClass=''){
  if(!addr) return '';
  const safeAttr=addr.replace(/"/g,'&quot;');
  return `<span class="nav-btn-loc${extraClass?' '+extraClass:''}" data-action="openNav" data-addr="${safeAttr}">${esc(label||addr)}</span>`;
}
function initQuill(){
  if(notesQuill) return;
  notesQuill=new Quill('#f_notes_editor',{
    theme:'snow',
    placeholder:'Weitere Infos…',
    modules:{toolbar:[[{header:[1,2,false]}],['bold','italic','underline'],[{list:'ordered'},{list:'bullet'}],['clean']]}
  });
}

// Strict allowlist: only tags/attributes Quill's snow theme produces.
// No href, src, style, or event handlers — prevents stored XSS via notes.
const NOTES_PURIFY_CFG={
  ALLOWED_TAGS:['p','br','strong','em','u','h1','h2','ul','ol','li','span'],
  ALLOWED_ATTR:['class'],   // ql-* classes for indent/align
  ALLOW_DATA_ATTR:false,
  FORCE_BODY:true,
};
function sanitizeNotes(html){
  if(!html||!html.trim()) return '';
  // Fail-closed: if DOMPurify failed to load, refuse to render/store the HTML
  if(typeof DOMPurify==='undefined') return '';
  return DOMPurify.sanitize(html, NOTES_PURIFY_CFG);
}

// Safe Quill loader — never calls dangerouslyPasteHTML.
// Path: raw HTML → DOMPurify → Quill clipboard.convert (HTML→Delta) → setContents (Delta).
// Delta has no HTML injection surface; setContents is the safe Quill v2 load API.
// Handles both new sanitized HTML and legacy unsanitized HTML from older saves.
function loadNotesIntoQuill(html){
  initQuill();
  if(!notesQuill) return;
  if(!html||!html.trim()){notesQuill.setContents([]);return;}
  const clean=sanitizeNotes(html);
  if(!clean){notesQuill.setContents([]);return;}
  // clipboard.convert({html}) returns a Delta — no raw HTML touches the DOM
  const delta=notesQuill.clipboard.convert({html:clean});
  notesQuill.setContents(delta);
}

// Safe Quill exporter.
// Prefers getSemanticHTML() (official v2 API, clean output) over root.innerHTML.
// Result is sanitized again before storage as a second safety layer.
function exportNotesFromQuill(){
  if(!notesQuill||!notesQuill.getText().trim()) return '';
  const raw=typeof notesQuill.getSemanticHTML==='function'
    ? notesQuill.getSemanticHTML()
    : notesQuill.root.innerHTML;
  return sanitizeNotes(raw);
}
const ACT_KEY='nous_activity_v1';
let activityLog=[];
function loadActivity(){try{const l=localStorage.getItem(ACT_KEY);if(l)activityLog=JSON.parse(l);}catch(e){console.warn('[nous] Aktivitätslog konnte nicht gelesen werden',e);}}
function saveActivity(){try{localStorage.setItem(ACT_KEY,JSON.stringify(activityLog.slice(0,200)));}catch(e){console.warn('[nous] Aktivitätslog konnte nicht gespeichert werden (Storage voll?)',e);}}
function mergeActivity(remote){
  if(!Array.isArray(remote)) return;
  const seen=new Set();
  activityLog=[...activityLog,...remote].filter(a=>{
    const k=a.ts+'|'+a.type+'|'+a.evTitle;
    if(seen.has(k)) return false;
    seen.add(k); return true;
  }).sort((a,b)=>b.ts.localeCompare(a.ts)).slice(0,200);
  saveActivity();
}
async function supabaseSaveActivity(){
  if(!SUPABASE_URL||!SUPABASE_KEY) return;
  await sb.from(TABLE).upsert({id:2,data:JSON.stringify(activityLog.slice(0,200)),updated_at:new Date().toISOString()});
}
function applyRemoteActivity(raw){
  try{mergeActivity(typeof raw==='string'?JSON.parse(raw):raw);}catch(e){}
  try{if(document.getElementById('view-aktuell').classList.contains('active'))renderAktuell();}catch(e){}
}
async function reloadActivityFromSupabase(){
  if(!SUPABASE_URL||!SUPABASE_KEY) return;
  const{data:rows,error}=await sb.from(TABLE).select('data').eq('id',2).limit(1);
  if(!error&&rows&&rows.length&&rows[0].data) applyRemoteActivity(rows[0].data);
}
function logActivity(type,evTitle,detail){
  activityLog.unshift({type,evTitle,detail,ts:new Date().toISOString(),user:currentUser||null});
  saveActivity();
  supabaseSaveActivity();
}
function clearActivity(){if(!confirm('Aktivitätsprotokoll löschen?'))return;activityLog=[];saveActivity();renderActivity();showToast('Protokoll gelöscht');}
function fmtAbsTime(iso){
  if(!iso)return '';
  const d=new Date(iso);
  const pad=n=>String(n).padStart(2,'0');
  return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtRelTime(iso){
  if(!iso)return '';
  const diff=Date.now()-new Date(iso).getTime();
  const m=Math.floor(diff/60000),h=Math.floor(diff/3600000),d=Math.floor(diff/86400000);
  if(d>0)return `vor ${d} Tag${d>1?'en':''}`;
  if(h>0)return `vor ${h} Std.`;
  if(m>0)return `vor ${m} Min.`;
  return 'gerade eben';
}
function renderActivity(){
  const c=document.getElementById('activityFeed');if(!c)return;
  if(!activityLog.length){
    c.innerHTML=`<div class="activity-empty"><div class="activity-empty-text">Noch keine Aktivität aufgezeichnet</div></div>`;
    return;
  }
  const icons={create:'+',edit:'~',delete:'×',todo:'✓',export:'↓'};
  const iconCls={create:'ai-create',edit:'ai-edit',delete:'ai-delete',todo:'ai-todo',export:'ai-edit'};
  c.innerHTML=activityLog.map(a=>{
    const who=a.user==='toja'?'Toja':a.user==='johann'?'Johann':null;
    const personBadge=who?`<span style="font-weight:700;color:${a.user==='toja'?'var(--toja-color)':'var(--johann-color)'}">${who}</span> · `:'';
    return `<div class="activity-item">
      <div class="activity-icon ${iconCls[a.type]||'ai-edit'}">${icons[a.type]||'•'}</div>
      <div class="activity-body">
        <div class="activity-title">${esc(a.evTitle)||'—'}</div>
        <div class="activity-detail">${esc(a.detail)||''}</div>
        <div class="activity-time">${personBadge}${fmtRelTime(a.ts)} · ${fmtAbsTime(a.ts)}</div>
      </div>
    </div>`;
  }).join('');
}
let activeStatusFilters=new Set(),activeOwnerFilters=new Set();

// AUTH
function detectPerson(user){
  return user.user_metadata?.person||null;
}

function bindStaticHandlers(){
  // Form element listeners (can't use delegation for onchange/oninput on specific IDs)
  const q=(id,ev,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener(ev,fn);};
  q('f_owner','change',syncOwnerRestrictions);
  q('f_dateTo','change',autoDetectMultiday);
  q('f_allday','change',toggleAllday);
  q('f_dateFrom','change',syncSubDates);
  q('f_location','input',function(){addrSearch(this,'f_location_dd','f_lat','f_lon');});
  // Drag-drop on file drop area
  const fd=document.getElementById('fileDropArea');
  if(fd){
    fd.addEventListener('dragover',handleDragOver);
    fd.addEventListener('dragleave',handleDragLeave);
    fd.addEventListener('drop',handleDrop);
  }
  // File input onchange
  const fi=document.getElementById('fileInput');
  if(fi) fi.addEventListener('change',function(){handleFiles(this);});
}
function initApp(user){
  currentUser=detectPerson(user);
  bindStaticHandlers();
  document.getElementById('lockScreen').style.display='none';
  document.getElementById('lockForm').style.display='none';
  document.getElementById('lockLoading').style.display='block';
  document.getElementById('app').classList.add('visible');
  const n=new Date();calY=n.getFullYear();calM=n.getMonth();
  // Chip im Header
  const chip=document.getElementById('userChip');
  if(chip) chip.textContent=currentUser==='toja'?'Toja':currentUser==='johann'?'Johann':(user.email||'');
  activeOwnerFilters=new Set();
  activeStatusFilters=new Set();
  loadActivity();
  loadData();
}

async function signIn(){
  const email=document.getElementById('pwEmail').value.trim();
  const pw=document.getElementById('pwInput').value;
  const errEl=document.getElementById('pwError');
  errEl.textContent='';
  if(!email||!pw){errEl.textContent='Bitte E-Mail und Passwort eingeben';return;}
  const btn=document.querySelector('.lock-btn');
  btn.textContent='…';btn.disabled=true;
  const {data,error}=await sb.auth.signInWithPassword({email,password:pw});
  btn.textContent='Anmelden';btn.disabled=false;
  if(error){errEl.textContent='Falsches Passwort oder unbekannte E-Mail';return;}
  initApp(data.user);
}

async function signOut(){
  appInitialized=false;
  await sb.auth.signOut();
  currentUser=null;
  events=[];activityLog=[];
  try{localStorage.removeItem(SK);}catch(e){}
  try{localStorage.removeItem(ACT_KEY);}catch(e){}
  document.getElementById('pwInput').value='';
  document.getElementById('pwEmail').value='';
  // showLockScreen() wird durch onAuthStateChange(SIGNED_OUT) getriggert
}

function toggleHamburger(e){e.stopPropagation();const m=document.getElementById('hamburgerMenu');m.style.display=m.style.display==='none'?'block':'none';}
function closeHamburger(){document.getElementById('hamburgerMenu').style.display='none';}
function toggleCardMenu(evId,e){
  e.stopPropagation();
  document.querySelectorAll('.card-menu.open').forEach(m=>{if(m.id!=='cm_'+evId)m.classList.remove('open');});
  document.getElementById('cm_'+evId)?.classList.toggle('open');
}
document.addEventListener('click',()=>{
  closeHamburger();
  document.querySelectorAll('.card-menu.open').forEach(m=>m.classList.remove('open'));
});

async function changePassword(){
  const pw=document.getElementById('pwNew').value;
  const pw2=document.getElementById('pwConfirm').value;
  const err=document.getElementById('pwModalError');
  err.textContent='';
  if(pw.length<6){err.textContent='Mindestens 6 Zeichen';return;}
  if(pw!==pw2){err.textContent='Passwörter stimmen nicht überein';return;}
  const btn=document.querySelector('#pwModal .btn-primary');
  btn.textContent='…';btn.disabled=true;
  const {error}=await sb.auth.updateUser({password:pw});
  btn.textContent='Speichern';btn.disabled=false;
  if(error){err.textContent='Fehler: '+error.message;return;}
  closeModal('pwModal');
  document.getElementById('pwNew').value='';
  document.getElementById('pwConfirm').value='';
  showToast('Passwort erfolgreich geändert');
}

// Auth-State-Handler — feuert bei Seitenload, Token-Refresh und Logout automatisch
let appInitialized=false;
sb.auth.onAuthStateChange((event,session)=>{
  if(event==='SIGNED_IN'||event==='INITIAL_SESSION'||event==='TOKEN_REFRESHED'){
    if(session?.user){
      if(!appInitialized){appInitialized=true;initApp(session.user);}
      else currentUser=detectPerson(session.user); // stille Token-Aktualisierung
    } else {
      showLockScreen();
    }
  } else if(event==='SIGNED_OUT'){
    showLockScreen();
  }
});

function showLockScreen(){
  appInitialized=false;
  document.getElementById('lockScreen').style.display='flex';
  document.getElementById('lockLoading').style.display='none';
  document.getElementById('lockForm').style.display='block';
  document.getElementById('app').classList.remove('visible');
}

document.getElementById('pwInput').addEventListener('keydown',e=>{if(e.key==='Enter')signIn();});
document.getElementById('pwEmail').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('pwInput').focus();});

// ── FLIGHT LOOKUP ──
async function lookupFlight(person, dir){
  const numEl=document.getElementById(`t_${person}_${dir}_flugnum`);
  const dateEl=document.getElementById(`t_${person}_${dir}_flugdate`);
  if(!numEl||!numEl.value.trim()){showToast('Bitte Flugnummer eingeben');return;}

  // Show loading state
  numEl.disabled=true;
  showToast('Flugdaten werden gesucht…');

  try{
    const flightNum=numEl.value.trim().replace(/\s/g,'').toUpperCase();
    const flightDate=dateEl&&dateEl.value?dateEl.value:'';
    let url=`/.netlify/functions/aviationstack?flight_iata=${encodeURIComponent(flightNum)}&limit=1`;
    if(flightDate) url+=`&flight_date=${flightDate}`;

    const resp=await fetch(url);
    const data=await resp.json();

    if(!data.data||data.data.length===0){
      showToast('Flug nicht gefunden — bitte manuell eingeben');
      numEl.disabled=false;
      return;
    }

    const f=data.data[0];
    const dep=f.departure||{};
    const arr=f.arrival||{};

    // Fill in fields
    const fromEl=document.getElementById(`t_${person}_${dir}_flugfrom`);
    const toEl=document.getElementById(`t_${person}_${dir}_flugto`);
    const depEl=document.getElementById(`t_${person}_${dir}_flugdep`);
    const arrEl=document.getElementById(`t_${person}_${dir}_flugarr`);

    if(fromEl) fromEl.value=dep.iata||'';
    if(toEl) toEl.value=arr.iata||'';

    // Parse scheduled times (format: "2026-05-29T08:30:00+00:00")
    if(dep.scheduled){
      const t=new Date(dep.scheduled);
      if(depEl) depEl.value=`${String(t.getUTCHours()).padStart(2,'0')}:${String(t.getUTCMinutes()).padStart(2,'0')}`;
      if(dateEl&&!dateEl.value) dateEl.value=t.toISOString().slice(0,10);
    }
    if(arr.scheduled){
      const t=new Date(arr.scheduled);
      if(arrEl) arrEl.value=`${String(t.getUTCHours()).padStart(2,'0')}:${String(t.getUTCMinutes()).padStart(2,'0')}`;
    }

    showToast(`${flightNum}: ${dep.iata||'?'}→${arr.iata||'?'} gefunden`);
  } catch(e){
    showToast('Fehler beim Abrufen — bitte manuell eingeben');
  }
  numEl.disabled=false;
}

// ── STORAGE ──
function saveData(){
  // Strip base64 attachment data from the localStorage cache.
  // Full attachment content (images/PDFs) is only in Supabase; localStorage is metadata-only.
  try{
    const slim=events.map(ev=>ev.attachments&&ev.attachments.length
      ?Object.assign({},ev,{attachments:ev.attachments.map(a=>({name:a.name,type:a.type}))})
      :ev);
    localStorage.setItem(SK,JSON.stringify(slim));
  }catch(e){console.warn('[nous] Events konnten nicht lokal gespeichert werden',e);}
  if(SUPABASE_URL&&SUPABASE_KEY) supabaseSave();
  renderAll();
  try{if(document.getElementById('view-calendar').classList.contains('active'))renderCal();}catch(e){console.warn('[nous] renderCal fehlgeschlagen',e);}
  try{if(document.getElementById('view-aktuell').classList.contains('active'))renderAktuell();}catch(e){console.warn('[nous] renderAktuell fehlgeschlagen',e);}
  try{if(document.getElementById('view-todos').classList.contains('active'))renderTodos();}catch(e){console.warn('[nous] renderTodos fehlgeschlagen',e);}
  try{if(document.getElementById('view-invites').classList.contains('active'))renderInvites();}catch(e){console.warn('[nous] renderInvites fehlgeschlagen',e);}
  updateInviteBadge();
}

async function supabaseSave(){
  const {error}=await sb.from(TABLE).upsert({id:1,data:JSON.stringify(events),updated_at:new Date().toISOString()});
  if(error) console.error('[Supabase] Save-Fehler:',error);
  else console.log('[Supabase] OK');
}

function applyRemoteData(raw){
  try{
    const remote=typeof raw==='string'?JSON.parse(raw):raw;
    if(!Array.isArray(remote))return false;
    events=remote;
    try{localStorage.setItem(SK,JSON.stringify(remote));}catch(e){}
    renderAll();renderCal();renderAktuell();
    try{if(document.getElementById('view-todos').classList.contains('active'))renderTodos();}catch(e){}
    try{if(document.getElementById('view-invites').classList.contains('active'))renderInvites();}catch(e){}
    updateInviteBadge();
    return true;
  }catch(e){console.error('[nous] Remote-Daten ungültig',e);return false;}
}

async function reloadFromSupabase(){
  const{data:rows,error}=await sb.from(TABLE).select('data').eq('id',1).limit(1);
  if(!error&&rows&&rows.length&&rows[0].data) applyRemoteData(rows[0].data);
}

async function loadData(){
  try{const l=localStorage.getItem(SK);if(l)events=JSON.parse(l);}catch(e){console.warn('[nous] localStorage Fehler',e);}
  renderAll();renderCal();renderAktuell();updateInviteBadge();
  await Promise.all([reloadFromSupabase(),reloadActivityFromSupabase()]);
  // Echtzeit-Sync für Events (id=1) und Aktivitätslog (id=2)
  sb.channel('nous-sync')
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:TABLE},payload=>{
      if(!payload.new) return;
      if(payload.new.id===1&&payload.new.data) applyRemoteData(payload.new.data);
      else if(payload.new.id===2&&payload.new.data) applyRemoteActivity(payload.new.data);
    })
    .subscribe(status=>console.log('[Supabase] Realtime:',status));
}

// Beim Zurückkehren in den Tab neu laden (z.B. nach Gerätewechsel)
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&appInitialized){reloadFromSupabase();reloadActivityFromSupabase();}
});

// TABS
function renderTodos(){
  const feed=document.getElementById('todosFeed');
  if(!feed) return;

  let evList=events;
  if(activeStatusFilters.size>0) evList=evList.filter(e=>activeStatusFilters.has(e.status));
  const ownerFilter=activeOwnerFilters;

  function filterTodos(list){
    if(ownerFilter.size===0) return list||[];
    return (list||[]).filter(t=>{const o=t.owner||'beide';return o==='beide'||ownerFilter.has(o);});
  }

  function todoItems(list,evId){
    return filterTodos(list).map(t=>`
      <div class="todos-feed-item ${t.done?'done':''}">
        <div class="todos-feed-cb ${t.done?'checked':''}" data-action="toggleTodoFeed" data-ev-id="${evId}" data-todo-id="${t.id}">${t.done?'✓':''}</div>
        <div style="flex:1;min-width:0">
          <span class="todos-feed-text ${t.done?'done-text':''}">${esc(t.text)||'—'}</span>
          ${t.dueDate?`<div style="font-size:0.7rem;color:var(--text3);margin-top:2px">${fmtD(t.dueDate)}${t.dueTime?' · '+t.dueTime:''}</div>`:''}
        </div>
        ${t.owner&&t.owner!=='beide'?`<span class="todos-feed-owner tfo-${t.owner}">${t.owner==='toja'?'Toja':'Johann'}</span>`:''}
      </div>`).join('');
  }

  const evWithTodos=evList.filter(e=>{
    const hasDirect=filterTodos(e.todos).length>0;
    const hasSub=(e.subevents||[]).some(s=>filterTodos(s.todos).length>0);
    return hasDirect||hasSub;
  }).sort((a,b)=>(a.date||a.dateFrom||'').localeCompare(b.date||b.dateFrom||''));

  const sections=evWithTodos.map(ev=>{
    const ds=ev.multiday?`${fmtD(ev.dateFrom)} – ${fmtD(ev.dateTo)}`:fmtD(ev.date);
    const directItems=todoItems(ev.todos,ev.id);
    const subSections=(ev.subevents||[]).map(sub=>{
      const subItems=todoItems(sub.todos,ev.id);
      if(!subItems) return '';
      return `<div class="todos-sub-section">
        <div class="todos-sub-label">${esc(sub.title||'Subevent')}</div>
        ${subItems}
      </div>`;
    }).filter(Boolean).join('');
    if(!directItems&&!subSections) return '';
    return `<div class="todos-feed-event">
      <div class="todos-feed-title">
        <span>${esc(ev.title)}</span>
        <span class="todos-feed-date">${ds}</span>
      </div>
      ${directItems}
      ${subSections}
    </div>`;
  }).filter(Boolean).join('');

  feed.innerHTML=sections||'<div class="aktuell-today-empty" style="margin:20px 0">Keine To-dos vorhanden</div>';
}

const FILTER_TABS=new Set(['overview','todos']);
const TABS_ORDER=['aktuell','calendar','todos','overview'];
let timeFilter='all';
let currentTab='aktuell';

function switchTab(n,el){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  if(el) el.classList.add('active');
  else{const te=document.querySelector(`[data-tab="${n}"]`);if(te)te.classList.add('active');}
  document.getElementById('view-'+n).classList.add('active');
  currentTab=n;
  const toolbar=document.getElementById('filterToolbar');
  if(toolbar) toolbar.style.display=FILTER_TABS.has(n)?'block':'none';
  const timeRow=document.getElementById('timeFilterRow');
  if(timeRow) timeRow.style.display=n==='overview'?'flex':'none';
  if(n==='calendar') renderCal();
  else if(n==='aktuell') renderAktuell();
  else if(n==='todos') renderTodos();
  else renderAll();
}

// Swipe-Navigation zwischen Tabs (iOS)
(function(){
  let sx=0,sy=0;
  document.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;sy=e.touches[0].clientY;},{passive:true});
  document.addEventListener('touchend',e=>{
    const dx=e.changedTouches[0].clientX-sx;
    const dy=e.changedTouches[0].clientY-sy;
    if(Math.abs(dx)<52||Math.abs(dy)>Math.abs(dx)*0.65)return;
    // Nicht im Map-Modal oder innerhalb scrollbarer Elemente
    const target=e.target;
    if(target.closest('#mapModal,.modal-overlay.open,.cal-grid,.modal-body'))return;
    const idx=TABS_ORDER.indexOf(currentTab);
    if(dx<0&&idx<TABS_ORDER.length-1) switchTab(TABS_ORDER[idx+1],null);
    else if(dx>0&&idx>0) switchTab(TABS_ORDER[idx-1],null);
  },{passive:true});
})();

/// Kalender: Zurück zu Heute
function calToday(){
  const n=new Date();calY=n.getFullYear();calM=n.getMonth();
  renderCal();showCalDay(n.toISOString().slice(0,10));
}

// ── ADDRESS AUTOCOMPLETE ──
const addrTimers={};
function addrSearch(input,dropdownId,latId,lonId){
  const q=input.value.trim();
  const dd=document.getElementById(dropdownId);
  if(!dd) return;
  if(q.length<3){dd.classList.remove('open');dd.innerHTML='';return;}
  clearTimeout(addrTimers[dropdownId]);
  // Store input reference on dropdown for later
  dd._inputEl=input;
  dd._latId=latId;
  dd._lonId=lonId;
  addrTimers[dropdownId]=setTimeout(async()=>{
    try{
      const url=`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`;
      const r=await fetch(url);
      const data=await r.json();
      if(!data.length){dd.classList.remove('open');return;}
      dd.innerHTML=data.map(item=>{
        const formatted=formatNominatimAddress(item.address,item.address?.country_code);
        const stored=formatted||(item.display_name.split(', ').slice(0,5).join(', '));
        const country=item.address?.country||'';
        return `<div class="addr-option"
          data-name="${stored.replace(/"/g,'&quot;').replace(/'/g,'&#39;')}"
          data-lat="${item.lat}"
          data-lon="${item.lon}">
          <strong>${esc(formatted||stored)}</strong>${country?'<br><span style="color:var(--text3);font-size:0.74rem">'+esc(country)+'</span>':''}
        </div>`;
      }).join('');
      // Attach click handlers directly (no inline onclick — avoids escaping issues)
      dd.querySelectorAll('.addr-option').forEach(opt=>{
        opt.addEventListener('mousedown',e=>{e.preventDefault();selectAddrEl(opt,dd);});
        opt.addEventListener('touchend',e=>{e.preventDefault();selectAddrEl(opt,dd);});
      });
      dd.classList.add('open');
    }catch(e){console.warn('[nous] Adressvorschlag fehlgeschlagen',e);}
  },300);
}

function selectAddrEl(option,dd){
  const name=option.dataset.name;
  const lat=option.dataset.lat;
  const lon=option.dataset.lon;
  // Set the input value
  if(dd._inputEl) dd._inputEl.value=name;
  // Set hidden lat/lon
  if(dd._latId){const el=document.getElementById(dd._latId);if(el)el.value=lat;}
  if(dd._lonId){const el=document.getElementById(dd._lonId);if(el)el.value=lon;}
  // Also handle class-based lat/lon (subevents, accoms)
  if(dd._inputEl){
    const wrap=dd._inputEl.closest('.addr-wrap');
    if(wrap){
      const latHid=wrap.querySelector('input[type=hidden].sub-lat,input[type=hidden].ac-lat');
      const lonHid=wrap.querySelector('input[type=hidden].sub-lon,input[type=hidden].ac-lon');
      if(latHid) latHid.value=lat;
      if(lonHid) lonHid.value=lon;
    }
  }
  dd.classList.remove('open');
  dd.innerHTML='';
}

// Keep old selectAddr as alias for any remaining inline calls
function selectAddr(option,dropdownId,latId,lonId){
  const dd=document.getElementById(dropdownId);
  if(dd){dd._latId=latId;dd._lonId=lonId;selectAddrEl(option,dd);}
}

// Close dropdowns on outside click
document.addEventListener('click',e=>{
  if(!e.target.closest('.addr-wrap')) document.querySelectorAll('.addr-dropdown.open').forEach(d=>d.classList.remove('open'));
});

// ── UNTERKUNFT ──
let accomCnt=0;
function addAccom(data){
  accomCnt++;
  const id='accom_'+accomCnt;
  const container=document.getElementById('accomContainer');
  if(!container) return;
  const n=container.children.length+1;
  const div=document.createElement('div');
  div.className='accom-item'; div.id=id;
  div.innerHTML=`
    <div class="accom-item-head">
      <span class="accom-num">Unterkunft ${n}</span>
      <button type="button" class="remove-btn" data-action="removeSelf" data-target="${id}">✕</button>
    </div>
    <div class="form-row" style="margin-bottom:8px">
      <div class="form-group"><label>Name</label><input type="text" class="ac-name" placeholder="z.B. Hotel Miramar" value="${esc(data?.name||'')}"></div>
      <div class="form-group"><label>Buchungsreferenz</label><input type="text" class="ac-ref" placeholder="z.B. BK123456" value="${esc(data?.ref||'')}"></div>
    </div>
    <div class="form-group" style="margin-bottom:8px"><label>Adresse</label>
      <div class="addr-wrap">
        <input type="text" class="ac-addr" placeholder="Adresse suchen…" autocomplete="off" value="${esc(data?.addr||'')}"
          data-action="addrSearchInput" data-dd="acdd_${id}" data-lat="aclat_${id}" data-lon="aclon_${id}">
        <input type="hidden" class="ac-lat" value="${data?.lat||''}">
        <input type="hidden" class="ac-lon" value="${data?.lon||''}">
        <div class="addr-dropdown" id="acdd_${id}"></div>
      </div>
    </div>
    <div class="form-row" style="margin-bottom:8px">
      <div class="form-group"><label>Check-in Datum</label><input type="date" class="ac-cin-date" value="${data?.cinDate||''}"></div>
      <div class="form-group"><label>Check-in Zeit</label><input type="time" class="ac-cin-time" value="${data?.cinTime||''}"></div>
    </div>
    <div class="form-row" style="margin-bottom:8px">
      <div class="form-group"><label>Check-out Datum</label><input type="date" class="ac-cout-date" value="${data?.coutDate||''}"></div>
      <div class="form-group"><label>Check-out Zeit</label><input type="time" class="ac-cout-time" value="${data?.coutTime||''}"></div>
    </div>
    <div class="form-group" style="margin-bottom:8px"><label>Buchungslink</label><input type="text" class="ac-link" placeholder="https://…" value="${data?.link||''}"></div>
    <div class="form-group"><label>Notizen</label><textarea class="ac-notes" style="min-height:52px" placeholder="Notizen zur Unterkunft…">${data?.notes||''}</textarea></div>`;
  container.appendChild(div);
}

function collectAccoms(){
  return Array.from(document.querySelectorAll('#accomContainer .accom-item')).map(item=>({
    name:item.querySelector('.ac-name')?.value||'',
    ref:item.querySelector('.ac-ref')?.value||'',
    addr:item.querySelector('.ac-addr')?.value||'',
    lat:item.querySelector('.ac-lat')?.value||'',
    lon:item.querySelector('.ac-lon')?.value||'',
    cinDate:item.querySelector('.ac-cin-date')?.value||'',
    cinTime:item.querySelector('.ac-cin-time')?.value||'',
    coutDate:item.querySelector('.ac-cout-date')?.value||'',
    coutTime:item.querySelector('.ac-cout-time')?.value||'',
    link:item.querySelector('.ac-link')?.value||'',
    notes:item.querySelector('.ac-notes')?.value||''
  })).filter(a=>a.name||a.addr);
}

// ── MAP ──
let mapInstance=null;
const STATUS_COLORS={save:'#c9a600',zugesagt:'#0f6cbd',teilweise:'#d07000',alles:'#107c10',final:'#107c10'};

function openEventMap(evId){
  const ev=events.find(e=>e.id===evId); if(!ev) return;
  document.getElementById('mapModalTitle').textContent=ev.title;
  document.getElementById('mapModal').classList.add('open');

  setTimeout(async()=>{
    const container=document.getElementById('mapContainer');
    if(!container) return;
    if(mapInstance){mapInstance.remove();mapInstance=null;}

    mapInstance=L.map('mapContainer',{zoomControl:true});
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{
      attribution:'© OpenStreetMap © CartoDB',subdomains:'abcd',maxZoom:19
    }).addTo(mapInstance);

    const markers=[];

    function mkIcon(html,size=16){
      return L.divIcon({html,className:'',iconSize:[size,size],iconAnchor:[size/2,size/2]});
    }
    function fitMap(){
      if(!mapInstance) return;
      if(!markers.length){mapInstance.setView([48.1,11.6],5);return;}
      if(markers.length===1){mapInstance.setView(markers[0].getLatLng(),13);return;}
      mapInstance.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
    }

    // Main event location
    if(ev.lat&&ev.lon){
      const color=STATUS_COLORS[ev.status]||'#0f6cbd';
      const m=L.marker([parseFloat(ev.lat),parseFloat(ev.lon)],{
        icon:mkIcon(`<div style="width:16px;height:16px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35)"></div>`)
      }).addTo(mapInstance);
      const ds=ev.multiday?`${fmtD(ev.dateFrom)} – ${fmtD(ev.dateTo)}`:fmtD(ev.date);
      m.bindPopup(`<strong>${esc(ev.title)}</strong><br>${ds}`).openPopup();
      markers.push(m);
    }

    // Subevents
    (ev.subevents||[]).forEach(s=>{
      if(!s.lat||!s.lon) return;
      const m=L.marker([parseFloat(s.lat),parseFloat(s.lon)],{
        icon:mkIcon(`<div style="width:12px;height:12px;border-radius:50%;background:#5c2e91;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>`)
      }).addTo(mapInstance);
      m.bindPopup(`<strong>${esc(s.title)||'Subevent'}</strong><br>${fmtD(s.date)}${s.time?' · '+esc(s.time):''}`);
      markers.push(m);
    });

    // Accommodations
    (ev.accommodations||[]).forEach(ac=>{
      if(!ac.lat||!ac.lon) return;
      const m=L.marker([parseFloat(ac.lat),parseFloat(ac.lon)],{
        icon:mkIcon(`<div style="font-size:20px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3))">H</div>`,24)
      }).addTo(mapInstance);
      m.bindPopup(`<strong>${esc(ac.name)||'Unterkunft'}</strong>${ac.addr?'<br>'+esc(ac.addr):''}${ac.cinDate?'<br>Check-in: '+fmtD(ac.cinDate):''}`);
      markers.push(m);
    });

    // Show known markers immediately; transport geocoding happens below
    fitMap();

    // Collect relevant transport locations:
    // Anreise → arrival airport/station of the LAST leg (final destination near the event)
    // Abreise → departure airport/station of the FIRST leg (nearest to the event)
    // Connections/layovers in between are excluded.
    const seen=new Set();
    const transLocs=[];
    const sortByDep=legs=>[...legs].sort((a,b)=>(a.data?.dep||a.data?.time||'').localeCompare(b.data?.dep||b.data?.time||''));
    PERSONS.forEach(p=>{
      DIRS.forEach(d=>{
        const raw=(ev.transport&&ev.transport[p]&&ev.transport[p][d])||[];
        const legs=sortByDep(Array.isArray(raw)?raw:(raw&&raw.type?[raw]:[])).filter(l=>l&&l.type);
        if(!legs.length) return;
        // For Anreise: event-side airport = `to` of the last leg
        // For Abreise: event-side airport = `from` of the first leg
        const leg=d==='an'?legs[legs.length-1]:legs[0];
        if(leg.type==='flug'&&leg.data){
          const q=d==='an'?leg.data.to:leg.data.from;
          if(!q||seen.has(q)) return;
          seen.add(q);
          transLocs.push({q,icon:'',label:'Flughafen',searchQ:resolveAddr(q)||q});
        } else if(leg.type==='zug'&&leg.data){
          const q=d==='an'?leg.data.to:leg.data.from;
          if(!q||seen.has(q)) return;
          seen.add(q);
          transLocs.push({q,icon:'',label:'Bahnhof',searchQ:q+' Bahnhof'});
        }
      });
    });

    if(!transLocs.length) return;

    // Geocode in parallel via Nominatim, then refit
    await Promise.all(transLocs.map(async loc=>{
      try{
        const url=`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(loc.searchQ)}&format=json&limit=1&accept-language=de`;
        const resp=await fetch(url);
        const data=await resp.json();
        if(!data||!data[0]||!mapInstance) return;
        const lat=parseFloat(data[0].lat),lon=parseFloat(data[0].lon);
        if(isNaN(lat)||isNaN(lon)) return;
        const m=L.marker([lat,lon],{
          icon:mkIcon(`<div style="font-size:20px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3))">${loc.icon}</div>`,24)
        }).addTo(mapInstance);
        m.bindPopup(`<strong>${loc.icon} ${esc(loc.q)}</strong><br>${esc(loc.label)}`);
        markers.push(m);
      }catch(e){console.warn('[nous] Kartenmarkierung konnte nicht gesetzt werden',e);}
    }));

    if(mapInstance) fitMap();
  },150);
}

function renderAktuell(){
  const feed=document.getElementById('aktuellFeed');
  if(!feed) return;
  const today=new Date().toISOString().slice(0,10);

  // HEUTE — collect all activity types for today
  const heuteItems=[];
  const userMatch=ev=>{
    const o=ev.owner||'gemeinsam';
    return !currentUser||o==='gemeinsam'||o===currentUser;
  };

  events.forEach(ev=>{
    // Transport legs
    PERSONS.forEach(person=>{
      DIRS.forEach(dir=>{
        const legs=(ev.transport&&ev.transport[person]&&ev.transport[person][dir])||[];
        legs.forEach(leg=>{
          if(currentUser&&person!==currentUser&&!leg.sharedWithBoth) return;
          const date=(leg.data&&leg.data.date)||'';
          if(date!==today) return;
          const time=(leg.data&&leg.data.dep)||'';
          const arrTime=(leg.data&&leg.data.arr)||'';
          let icon='',detail='';
          if(leg.type==='flug'){
            icon='';
            const f=leg.data||{};
            detail=`${f.num||''}${f.from&&f.to?' · '+f.from+'→'+f.to:''}${f.dep?' · '+f.dep:''}${f.arr?'–'+f.arr:''}`.trim();
          } else if(leg.type==='zug'){
            icon='';
            const t=leg.data||{};
            detail=`${t.num||''}${t.from&&t.to?' · '+t.from+'→'+t.to:''}${t.dep?' · '+t.dep:''}${t.arr?'–'+t.arr:''}`.trim();
          } else {
            detail=[leg.eta?'ETA '+leg.eta:'',leg.note||''].filter(Boolean).join(' · ');
          }
          heuteItems.push({
            cat:dir==='an'?'anreise':'abreise',
            sortGroup:dir==='an'?0:4,
            sortTime:time,
            icon,
            label:dir==='an'?'Anreise':'Abreise',
            title:detail||ev.title,
            detail:'',
            parent:ev.title,
            time,
            ev
          });
        });
      });
    });

    // Accommodations
    if(userMatch(ev)){
      (ev.accommodations||[]).forEach(ac=>{
        if(ac.cinDate===today){
          heuteItems.push({
            cat:'cin',sortGroup:1,sortTime:'',icon:'',
            label:'Check-in',title:ac.name||'Unterkunft',
            detail:ac.addr?navLink(ac.addr):'',parent:ev.title,time:'',ev
          });
        }
        if(ac.coutDate===today){
          heuteItems.push({
            cat:'cout',sortGroup:2,sortTime:'',icon:'',
            label:'Check-out',title:ac.name||'Unterkunft',
            detail:ac.addr?navLink(ac.addr):'',parent:ev.title,time:'',ev
          });
        }
      });
    }

    // Subevents
    if(userMatch(ev)){
      (ev.subevents||[]).forEach(sub=>{
        if(sub.date!==today) return;
        // Hide subevents more than 30 min past their end time
        if(sub.timeEnd){
          const now=new Date();
          const[eh,em]=sub.timeEnd.split(':').map(Number);
          const nowMin=now.getHours()*60+now.getMinutes();
          if(nowMin>eh*60+em+30) return;
        }
        const t=sub.time||'';
        const te=sub.timeEnd?'–'+sub.timeEnd:'';
        heuteItems.push({
          cat:'sub',sortGroup:3,sortTime:t,icon:'',
          label:'Subevent',title:sub.title||'—',
          detail:`${t?t+te+' ':''}${sub.location?navLink(sub.location):''}`.trim(),
          parent:ev.title,time:t,ev
        });
      });
    }
  });

  // Sort: group order, then by time within group
  heuteItems.sort((a,b)=>{
    if(a.sortGroup!==b.sortGroup) return a.sortGroup-b.sortGroup;
    return (a.sortTime||'').localeCompare(b.sortTime||'');
  });

  // BEVORSTEHEND — next 3 events after today
  const upcoming=filtered()
    .filter(e=>(e.date||e.dateFrom||'')>today)
    .sort((a,b)=>(a.date||a.dateFrom||'').localeCompare(b.date||b.dateFrom||''))
    .slice(0,3);

  // UPDATES — last 10 activity entries
  const recentActs=activityLog.slice(0,10);

  // Other person's events today (for the notice banner)
  const otherUser=currentUser==='toja'?'johann':currentUser==='johann'?'toja':null;
  const otherName=otherUser==='toja'?'Toja':'Johann';
  const otherColor=otherUser==='toja'?'var(--toja-color)':'var(--johann-color)';
  const otherSoft=otherUser==='toja'?'var(--toja-soft)':'var(--johann-soft)';
  const isActiveToday=ev=>ev.multiday?(ev.dateFrom<=today&&ev.dateTo>=today):ev.date===today;
  const otherEventsToday=otherUser?events.filter(ev=>(ev.owner||'gemeinsam')===otherUser&&isActiveToday(ev)):[];

  let html='';

  // Section: Heute
  html+=`<div class="aktuell-section"><div class="aktuell-section-title">Heute</div>`;

  // Banner: other person busy today
  if(otherEventsToday.length){
    html+=`<div style="background:${otherSoft};border:1px solid ${otherColor};border-radius:8px;padding:8px 10px;margin-bottom:8px">
      <div style="font-size:0.68rem;font-weight:700;color:${otherColor};text-transform:uppercase;letter-spacing:0.07em;margin-bottom:5px">👤 ${otherName} heute</div>
      ${otherEventsToday.map(ev=>`<div style="display:flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer;border-radius:5px" data-action="openPreview" data-ev-id="${ev.id}">
        <span style="font-size:0.78rem;font-weight:600;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ev.title)}</span>
        <span style="font-size:0.72rem;color:var(--text3);flex-shrink:0">${ev.multiday?fmtD(ev.dateFrom)+' – '+fmtD(ev.dateTo):ev.time?ev.time+' Uhr':'Ganztägig'}</span>
      </div>`).join('')}
    </div>`;
  }

  if(!heuteItems.length){
    html+=`<div class="aktuell-today-empty">Heute stehen keine Aktivitäten an.</div>`;
  } else {
    html+=`<div class="heute-list">`;
    heuteItems.forEach(item=>{
      html+=`<div class="heute-item hi-${item.cat}" data-action="openPreview" data-ev-id="${item.ev.id}">
        <div class="heute-icon">${item.icon}</div>
        <div class="heute-body">
          <div class="heute-label">${esc(item.label)}</div>
          <div class="heute-title">${esc(item.title)}</div>
          ${item.detail?`<div class="heute-detail">${item.detail}</div>`:''}
          <div class="heute-parent">${esc(item.parent)}</div>
        </div>
        ${item.time?`<div class="heute-time">${item.time}</div>`:''}
      </div>`;
    });
    html+=`</div>`;
  }
  html+=`</div>`;

  // Section: Bevorstehend
  html+=`<div class="aktuell-section"><div class="aktuell-section-title">Bevorstehend</div>`;
  if(!upcoming.length){
    html+=`<div class="aktuell-today-empty">Keine bevorstehenden Termine</div>`;
  } else {
    html+=`<div class="event-list">${upcoming.map(e=>renderCard(e)).join('')}</div>`;
  }
  html+=`</div>`;

  // Section: Updates
  html+=`<div class="aktuell-section"><div class="aktuell-section-title">Updates</div>`;
  if(!recentActs.length){
    html+=`<div class="aktuell-today-empty">Noch keine Aktivität aufgezeichnet</div>`;
  } else {
    const icons={create:'+',edit:'~',delete:'×',todo:'✓',export:'↓'};
    const iconCls={create:'ai-create',edit:'ai-edit',delete:'ai-delete',todo:'ai-todo',export:'ai-edit'};
    html+=recentActs.map(a=>{
      const who=a.user==='toja'?'Toja':a.user==='johann'?'Johann':null;
      const personBadge=who?`<span style="font-weight:700;color:${a.user==='toja'?'var(--toja-color)':'var(--johann-color)'}">${who}</span> · `:'';
      return `<div class="activity-item">
        <div class="activity-icon ${iconCls[a.type]||'ai-edit'}">${icons[a.type]||'•'}</div>
        <div class="activity-body">
          <div class="activity-title">${esc(a.evTitle)||'—'}</div>
          <div class="activity-detail">${esc(a.detail)||''}</div>
          <div class="activity-time">${personBadge}${fmtRelTime(a.ts)} · ${fmtAbsTime(a.ts)}</div>
        </div>
      </div>`;
    }).join('');
  }
  html+=`</div>`;

  feed.innerHTML=html;
}

// FILTER — multi-select, two groups: status + owner
function toggleFilter(key,el){
  const [group,val]=key.split(':');
  if(group==='status'){
    if(val==='all'){
      activeStatusFilters.clear();
      // deactivate all status chips, activate "Alle"
      document.querySelectorAll('[data-filter^="status:"]').forEach(c=>c.classList.remove('active'));
      el.classList.add('active');
    } else {
      // deactivate "Alle"
      document.querySelector('[data-filter="status:all"]').classList.remove('active');
      if(activeStatusFilters.has(val)){
        activeStatusFilters.delete(val);el.classList.remove('active');
        if(activeStatusFilters.size===0){
          document.querySelector('[data-filter="status:all"]').classList.add('active');
        }
      } else {
        activeStatusFilters.add(val);el.classList.add('active');
      }
    }
  } else if(group==='owner'){
    if(activeOwnerFilters.has(val)){
      activeOwnerFilters.delete(val);el.classList.remove('active');
    } else {
      activeOwnerFilters.add(val);el.classList.add('active');
    }
  }
  renderAll();
  try{if(document.getElementById('view-calendar').classList.contains('active'))renderCal();}catch(e){console.warn('[nous] renderCal fehlgeschlagen',e);}
  try{if(document.getElementById('view-aktuell').classList.contains('active'))renderAktuell();}catch(e){console.warn('[nous] renderAktuell fehlgeschlagen',e);}
  try{if(document.getElementById('view-todos').classList.contains('active'))renderTodos();}catch(e){console.warn('[nous] renderTodos fehlgeschlagen',e);}
}

function toggleTimeFilter(key){
  const val=key.split(':')[1];
  timeFilter=val;
  document.querySelectorAll('[data-filter^="time:"]').forEach(c=>c.classList.toggle('active',c.dataset.filter===key));
  renderAll();
}

function filtered(){
  let list=events;
  if(activeStatusFilters.size>0) list=list.filter(e=>activeStatusFilters.has(e.status));
  if(activeOwnerFilters.size>0) list=list.filter(e=>activeOwnerFilters.has(e.owner||'gemeinsam'));
  return list;
}

const CONFLICT_SK='nous_dismissed_conflicts_v1';
let dismissedConflictKeys=new Set(JSON.parse(localStorage.getItem(CONFLICT_SK)||'[]'));
let conflictingEventIds=new Set();

function saveDismissedConflicts(){
  try{localStorage.setItem(CONFLICT_SK,JSON.stringify([...dismissedConflictKeys]));}catch(e){}
}
function conflictKey(date,evs){return date+'::'+evs.map(e=>e.id).sort().join(',');}
function dismissConflict(key){
  dismissedConflictKeys.add(key);
  saveDismissedConflicts();
  document.getElementById('conflict-item-'+CSS.escape(key))?.remove();
  const listEl=document.getElementById('conflictList');
  if(listEl&&!listEl.children.length) document.getElementById('conflictBanner')?.classList.remove('vis');
}
function dismissConflictBanner(){
  document.querySelectorAll('#conflictList .conflict-item').forEach(el=>{
    if(el.dataset.key) dismissedConflictKeys.add(el.dataset.key);
  });
  saveDismissedConflicts();
  document.getElementById('conflictBanner').classList.remove('vis');
}

function detectConflicts(){
  const banner=document.getElementById('conflictBanner');
  const listEl=document.getElementById('conflictList');
  if(!banner||!listEl) return;

  function affectedPersons(ev){
    const o=ev.owner||'gemeinsam';
    if(o==='gemeinsam') return ['toja','johann'];
    return [o];
  }

  // Only true multi-day events (at least 2 distinct days) participate in conflict detection
  const multiEvs=events.filter(ev=>ev.multiday&&ev.dateFrom&&ev.dateTo&&ev.dateTo>ev.dateFrom);

  const dateMap={};
  multiEvs.forEach(ev=>{
    let d=new Date(ev.dateFrom+'T00:00:00');
    const end=new Date(ev.dateTo+'T00:00:00');
    while(d<=end){
      const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if(!dateMap[ds]) dateMap[ds]=[];
      dateMap[ds].push(ev);
      d.setDate(d.getDate()+1);
    }
  });

  const conflicts=[];
  conflictingEventIds=new Set();
  Object.entries(dateMap).forEach(([date,evs])=>{
    if(evs.length<2) return;
    const conflicting=new Set();
    for(let i=0;i<evs.length;i++){
      for(let j=i+1;j<evs.length;j++){
        const pA=affectedPersons(evs[i]);
        const pB=affectedPersons(evs[j]);
        if(pA.some(p=>pB.includes(p))){ conflicting.add(evs[i]); conflicting.add(evs[j]); }
      }
    }
    if(conflicting.size>1){
      const key=conflictKey(date,[...conflicting]);
      if(!dismissedConflictKeys.has(key)){
        conflicts.push({date,evs:[...conflicting],key});
        conflicting.forEach(ev=>conflictingEventIds.add(ev.id));
      }
    }
  });

  conflicts.sort((a,b)=>a.date.localeCompare(b.date));

  if(conflicts.length===0){
    banner.classList.remove('vis');
    return;
  }

  banner.classList.add('vis');
  listEl.innerHTML=conflicts.map(({date,evs,key})=>`
    <div class="conflict-item" id="conflict-item-${esc(key)}" data-key="${esc(key)}">
      <div class="conflict-dot"></div>
      <span><strong>${fmtD(date)}:</strong>&nbsp;${evs.map(e=>esc(e.title)).join(' · ')}</span>
      <button class="conflict-item-dismiss" data-action="dismissConflict" data-key="${esc(key)}" title="Ausblenden">✕</button>
    </div>`).join('');
}


// COLLAPSIBLE MODAL SECTIONS
function toggleModalSection(btn){
  const arrow=btn.querySelector('.form-section-toggle-arrow');
  const body=btn.nextElementSibling;
  if(!body) return;
  const isOpen=body.classList.contains('open');
  body.classList.toggle('open',!isOpen);
  if(arrow) arrow.classList.toggle('open',!isOpen);
}

// COLLAPSIBLE CARD SECTIONS
function toggleSection(btn){
  const arrow=btn.querySelector('.card-section-arrow');
  const body=btn.nextElementSibling;
  if(!body) return;
  const isOpen=body.classList.contains('open');
  body.classList.toggle('open',!isOpen);
  if(arrow) arrow.classList.toggle('open',!isOpen);
}

// BULK
function toggleBulk(){bulkMode=!bulkMode;selIds.clear();document.getElementById('bulkBtn').classList.toggle('active',bulkMode);document.getElementById('bulkBar').classList.toggle('vis',bulkMode);renderAll();}
function toggleSel(id){selIds.has(id)?selIds.delete(id):selIds.add(id);document.getElementById('bulkInfo').textContent=selIds.size+' ausgewählt';renderAll();}
function selectAll(){filtered().forEach(e=>selIds.add(e.id));document.getElementById('bulkInfo').textContent=selIds.size+' ausgewählt';renderAll();}
function bulkExport(){showToast('Export wurde deaktiviert');}

// HELPERS
function esc(s){if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function safeUrl(url){if(!url)return '';const u=url.trim();return /^https?:\/\//i.test(u)?u:'';}
function fmtD(d){if(!d)return '';const dt=new Date(d+'T00:00:00');const wd=dt.toLocaleDateString('de-DE',{weekday:'short'});return wd+', '+dt.toLocaleDateString('de-DE',{day:'2-digit',month:'short',year:'numeric'});}
function nowTs(){return new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'Z';}
function genId(){return 'ev_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);}
function genUid(){return 'nous-'+Date.now()+'-'+Math.random().toString(36).slice(2,9)+'@nous.app';}
function safe(s){return(s||'event').replace(/[^a-zA-Z0-9äöüÄÖÜß\-_\s]/g,'').replace(/\s+/g,'_').slice(0,40);}
function icsTs(date,time,allday){if(!date)return '';const d=date.replace(/-/g,'');if(allday)return d;if(time){const t=time.replace(':','')+'00';return d+'T'+t;}return d+'T000000';}

// SMART DATE SYNC
function syncSubDates(){
  const from=document.getElementById('f_dateFrom').value;
  if(!from)return;
  const year=from.slice(0,4);
  document.querySelectorAll('.sub-date').forEach(el=>{
    el.min=from;
    if(!el.value) el.setAttribute('placeholder',year);
  });
  const toEl=document.getElementById('f_dateTo');
  if(toEl){toEl.min=from;}
  ['t_toja_an_flugdate','t_toja_ab_flugdate','t_johann_an_flugdate','t_johann_ab_flugdate',
   't_toja_an_zugdate','t_toja_ab_zugdate','t_johann_an_zugdate','t_johann_ab_zugdate'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.min=year+'-01-01';
  });
  autoDetectMultiday();
}

// RENDER
function evPrimaryDate(e){return e.multiday?(e.dateFrom||''):(e.date||e.dateFrom||'');}
function timeToMin(t){if(!t)return -1;const[h,m]=t.split(':').map(Number);return h*60+m;}

function renderAll(){
  const now=new Date().toISOString().slice(0,10);
  let list=filtered();
  if(timeFilter==='upcoming'){
    list=list.filter(e=>(e.date||e.dateTo||e.dateFrom||'')>=now);
    list.sort((a,b)=>(a.date||a.dateFrom||'').localeCompare(b.date||b.dateFrom||''));
  } else if(timeFilter==='past'){
    list=list.filter(e=>{const d=e.multiday?(e.dateTo||e.dateFrom||''):(e.date||'');return d&&d<now;});
    list.sort((a,b)=>(b.date||b.dateFrom||'').localeCompare(a.date||a.dateFrom||''));
  } else {
    list.sort((a,b)=>(a.date||a.dateFrom||'').localeCompare(b.date||b.dateFrom||''));
  }
  renderTimeline('eventList',list);
  detectConflicts();
}

function renderTimeline(cid,list){
  const c=document.getElementById(cid);
  if(!c)return;
  if(!list.length){c.innerHTML=`<div class="empty-state"><div class="empty-title">Keine Termine</div><div class="empty-sub">Erstelle deinen ersten gemeinsamen Termin</div></div>`;return;}

  const groups={};
  list.forEach(ev=>{const d=evPrimaryDate(ev)||'';if(!groups[d])groups[d]=[];groups[d].push(ev);});
  const sortedDates=Object.keys(groups).sort();

  let html='';
  sortedDates.forEach(d=>{
    const dayEvs=[...groups[d]].sort((a,b)=>{
      const at=timeToMin(a.time),bt=timeToMin(b.time);
      if(at===-1&&bt===-1)return 0;if(at===-1)return 1;if(bt===-1)return -1;return at-bt;
    });
    if(d) html+=`<div class="tl-date-head"><span>${fmtD(d)}</span></div>`;

    // Pair overlapping timed events (within 60 min) into 2-col rows
    const rows=[];
    dayEvs.forEach(ev=>{
      const t=timeToMin(ev.time);
      if(t>-1&&rows.length){
        const last=rows[rows.length-1];
        if(last.length<2&&timeToMin(last[last.length-1].time)>-1&&Math.abs(t-timeToMin(last[last.length-1].time))<60){
          last.push(ev);return;
        }
      }
      rows.push([ev]);
    });
    rows.forEach(row=>{
      if(row.length===2){
        html+=`<div class="tl-row-2">${row.map(e=>`<div class="tl-col">${renderCard(e)}</div>`).join('')}</div>`;
      } else {
        html+=renderCard(row[0]);
      }
    });
  });
  c.innerHTML=html;
}

function renderList(cid,list){
  const c=document.getElementById(cid);
  if(!list.length){c.innerHTML=`<div class="empty-state"><div class="empty-title">Keine Termine</div><div class="empty-sub">Erstelle deinen ersten gemeinsamen Termin</div></div>`;return;}
  c.innerHTML=list.map(e=>renderCard(e)).join('');
}

function ownerDot(o){if(o==='toja')return 'dot-toja';if(o==='johann')return 'dot-johann';return 'dot-beide';}

function effectiveStatus(e){
  if(e.owner==='gemeinsam'){
    if(currentUser==='toja') return e.statusToja||e.status||'save';
    if(currentUser==='johann') return e.statusJohann||e.status||'save';
    if(e.statusToja&&e.statusJohann&&e.statusToja===e.statusJohann) return e.statusToja;
  }
  return e.status||'save';
}
function renderCard(e){
  const isM=e.multiday;
  const ds=isM?`${fmtD(e.dateFrom)} – ${fmtD(e.dateTo)}`:fmtD(e.date);
  const ts=(!e.allday&&e.time)?e.time+' Uhr':'Ganztägig';
  const sel=selIds.has(e.id);
  const effStatus=effectiveStatus(e);
  const dualStatus=e.owner==='gemeinsam'&&e.statusToja&&e.statusJohann&&e.statusToja!==e.statusJohann;
  const statusBadgesHtml=dualStatus
    ?`<span class="status-badge ${SC[e.statusToja]||''}" style="font-size:0.6rem">T: ${SL[e.statusToja]||''}</span><span class="status-badge ${SC[e.statusJohann]||''}" style="font-size:0.6rem">J: ${SL[e.statusJohann]||''}</span>`
    :`<span class="status-badge ${SC[effStatus]||''}">${SL[effStatus]||''}</span>`;

  let sections='';

  if(e.subevents&&e.subevents.length){
    const sortedSubs=[...e.subevents].sort((a,b)=>((a.date||'')+(a.time||'')).localeCompare((b.date||'')+(b.time||'')));
    sections+=`<div class="card-section">
      <div class="card-section-toggle" data-action="toggleSection">
        <span class="card-section-title">Subevents (${e.subevents.length})</span>
        <span class="card-section-arrow">▾</span>
      </div>
      <div class="card-section-body">
        ${sortedSubs.slice(0,3).map(s=>`<div class="sub-row"><div class="sub-dot"></div><span>${esc(s.title)||'—'}${s.date?' · '+fmtD(s.date):''}${s.time?' · '+esc(s.time):''}</span></div>`).join('')}
        ${e.subevents.length>3?`<div style="font-size:0.72rem;color:var(--text3);margin-top:2px">+${e.subevents.length-3} weitere</div>`:''}
      </div>
    </div>`;
  }

  const openTodos=(e.todos||[]).filter(t=>!t.done);
  const doneTodos=(e.todos||[]).filter(t=>t.done);
  if(openTodos.length){
    sections+=`<div class="card-section">
      <div class="card-section-toggle" data-action="toggleSection">
        <span class="card-section-title">To-dos — ${openTodos.length} offen${doneTodos.length?' · '+doneTodos.length+' erledigt':''}</span>
        <span class="card-section-arrow">▾</span>
      </div>
      <div class="card-section-body">
        ${openTodos.slice(0,4).map(t=>`<div class="todo-row">
          <div class="todo-check" data-action="toggleTodoCard" data-ev-id="${e.id}" data-todo-id="${t.id}">✓</div>
          <span style="flex:1">${esc(t.text)||'—'}</span>
          <div class="todo-owner-dot ${ownerDot(t.owner||'beide')}"></div>
        </div>`).join('')}
        ${openTodos.length>4?`<div style="font-size:0.72rem;color:var(--text3);margin-top:2px">+${openTodos.length-4} weitere</div>`:''}
      </div>
    </div>`;
  }

  // Transport summary — chronological across all persons
  const tr=e.transport||{};
  const cardLegStr=leg=>{
    if(leg.type==='flug'&&leg.data){const f=leg.data;return `${esc(f.num)} ${esc(f.from)}→${esc(f.to)}${f.dep?' · '+esc(f.dep):''}${f.arr?'–'+esc(f.arr):''}`.trim();}
    if(leg.type==='zug'&&leg.data){const t=leg.data;return `${esc(t.num)} ${esc(t.from)}→${esc(t.to)}${t.dep?' · '+esc(t.dep):''}${t.arr?'–'+esc(t.arr):''}`.trim();}
    if(leg.type==='auto') return [leg.eta?'ETA '+esc(leg.eta):'',leg.note?esc(leg.note):''].filter(Boolean).join(' · ')||'Auto';
    if(leg.type==='sonstiges') return `⋯ ${esc(leg.note)||''}`;
    return '';
  };
  const cardMatchKey=leg=>{
    if(!leg||!leg.type) return null;
    if(leg.type==='flug'){const n=(leg.data?.num||'').trim();return n?`flug_${n.toLowerCase()}`:null;}
    if(leg.type==='zug'){const n=(leg.data?.num||'').trim();return n?`zug_${n.toLowerCase()}`:null;}
    if(leg.type==='auto') return `auto_${(leg.note||'').trim().toLowerCase()}`;
    if(leg.type==='sonstiges'){const n=(leg.note||'').trim();return n?`son_${n.toLowerCase()}`:null;}
    return null;
  };
  const sortLegs=legs=>[...legs].sort((a,b)=>((a.data?.dep||a.data?.time||'')).localeCompare(b.data?.dep||b.data?.time||''));
  const buildChronoLegs=(tRaw,jRaw)=>{
    const tLegs=sortLegs(Array.isArray(tRaw)?tRaw:(tRaw&&tRaw.type?[tRaw]:[]));
    const jLegs=sortLegs(Array.isArray(jRaw)?jRaw:(jRaw&&jRaw.type?[jRaw]:[]));
    const usedT=new Set(),usedJ=new Set(),out=[];
    tLegs.forEach((l,i)=>{if(l?.sharedWithBoth){out.push({leg:l,who:'beide'});usedT.add(i);}});
    jLegs.forEach((l,i)=>{if(l?.sharedWithBoth&&!usedJ.has(i)){out.push({leg:l,who:'beide'});usedJ.add(i);}});
    const tMap=new Map();
    tLegs.forEach((l,i)=>{if(!usedT.has(i)&&l){const k=cardMatchKey(l);if(k)tMap.set(k,i);}});
    jLegs.forEach((l,i)=>{if(!usedJ.has(i)&&l){const k=cardMatchKey(l);if(k&&tMap.has(k)){const ti=tMap.get(k);out.push({leg:tLegs[ti],who:'beide'});usedT.add(ti);usedJ.add(i);}}});
    tLegs.forEach((l,i)=>{if(!usedT.has(i)&&l?.type)out.push({leg:l,who:'toja'});});
    jLegs.forEach((l,i)=>{if(!usedJ.has(i)&&l?.type)out.push({leg:l,who:'johann'});});
    return out.sort((a,b)=>(a.leg.data?.dep||a.leg.data?.time||'').localeCompare(b.leg.data?.dep||b.leg.data?.time||''));
  };
  const trWhoColor={beide:'var(--purple)',toja:'var(--toja-color)',johann:'var(--johann-color)'};
  const trWhoLabel={beide:'Beide',toja:'Toja',johann:'Johann'};
  const trRows={an:buildChronoLegs((tr.toja?.an||[]),(tr.johann?.an||[])),ab:buildChronoLegs((tr.toja?.ab||[]),(tr.johann?.ab||[]))};
  const hasAn=trRows.an.length>0,hasAb=trRows.ab.length>0;
  if(hasAn||hasAb){
    const trCount=trRows.an.length+trRows.ab.length;
    let trHtml=`<div class="card-section">
      <div class="card-section-toggle" data-action="toggleSection">
        <span class="card-section-title">Transport (${trCount})</span>
        <span class="card-section-arrow">▾</span>
      </div>
      <div class="card-section-body">`;
    if(hasAn){
      trHtml+=`<div style="font-size:0.68rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin:4px 0 3px">Anreise</div>`;
      trHtml+=trRows.an.map(({leg,who})=>{const s=cardLegStr(leg);return s?`<div class="sub-row" style="margin-left:6px"><div class="sub-dot" style="background:var(--blue);opacity:0.5"></div><span style="font-size:0.76rem"><span style="color:${trWhoColor[who]};font-weight:700">${trWhoLabel[who]}</span> ${s}</span></div>`:''}).join('');
    }
    if(hasAb){
      trHtml+=`<div style="font-size:0.68rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin:${hasAn?'7px':'4px'} 0 3px">Abreise</div>`;
      trHtml+=trRows.ab.map(({leg,who})=>{const s=cardLegStr(leg);return s?`<div class="sub-row" style="margin-left:6px"><div class="sub-dot" style="background:var(--red);opacity:0.4"></div><span style="font-size:0.76rem"><span style="color:${trWhoColor[who]};font-weight:700">${trWhoLabel[who]}</span> ${s}</span></div>`:''}).join('');
    }
    trHtml+='</div></div>';
    sections+=trHtml;
  }

  // Accommodations in card
  if(e.accommodations&&e.accommodations.length){
    sections+=`<div class="card-section">
      <div class="card-section-toggle" data-action="toggleSection">
        <span class="card-section-title">Unterkunft (${e.accommodations.length})</span>
        <span class="card-section-arrow">▾</span>
      </div>
      <div class="card-section-body">
        ${e.accommodations.slice(0,2).map(a=>{const sl=safeUrl(a.link);return `<div class="sub-row" style="flex-direction:column;align-items:flex-start;gap:2px"><div style="display:flex;align-items:center;gap:6px"><div class="sub-dot" style="background:#9b7ec8;opacity:0.7;flex-shrink:0"></div><span>${esc(a.name)||'—'}${a.cinDate?' · '+fmtD(a.cinDate):''}${a.coutDate?' – '+fmtD(a.coutDate):''}</span></div>${a.ref?`<div style="font-size:0.72rem;color:var(--text2);padding-left:14px">Ref: <span style="font-family:monospace">${esc(a.ref)}</span></div>`:''}${sl?`<div style="padding-left:14px"><a href="${sl}" target="_blank" rel="noopener noreferrer" style="font-size:0.72rem;color:var(--blue)">🔗 Buchungslink</a></div>`:''}</div>`;}).join('')}
      </div>
    </div>`;
  }

  if(e.attachments&&e.attachments.length){
    sections+=`<div class="card-section">
      <div class="card-section-toggle" data-action="toggleSection">
        <span class="card-section-title">Anhänge (${e.attachments.length})</span>
        <span class="card-section-arrow">▾</span>
      </div>
      <div class="card-section-body">
        <div class="att-row">${e.attachments.map(a=>a.type&&a.type.startsWith('image/')?`<div class="att-thumb"><img src="${safeDataImg(a.data)}"></div>`:`<div class="att-thumb">📄</div>`).join('')}</div>
      </div>
    </div>`;
  }

  return `<div class="event-card ${SCB[effStatus]||''} ${sel?'selected':''}" data-action="openPreview" data-ev-id="${e.id}" style="cursor:pointer">
    <div class="card-select ${bulkMode?'vis':''} ${sel?'chk':''}" data-action="toggleSel" data-ev-id="${e.id}">${sel?'✓':''}</div>
    <div class="card-header" style="${bulkMode?'padding-left:38px':''}">
      <div class="card-left">
        <div class="card-title-row">
          <div class="card-title">${esc(e.title)}</div>
          <span class="badge ${OC[e.owner||'gemeinsam']}">${OL[e.owner||'gemeinsam']}</span>
        </div>
        <div class="card-meta">
          <span>${ds}</span>
          ${!isM?`<span>${ts}</span>`:''}
        </div>
        ${e.location?`<div class="card-meta" style="margin-top:2px">${navLink(e.location)}</div>`:''}
      </div>
      <div class="card-right">
        ${statusBadgesHtml}
        <div class="card-actions">
          <div class="card-menu-wrap">
            <div class="card-btn card-menu-btn" data-action="toggleCardMenu" data-ev-id="${e.id}" title="Optionen">⋮</div>
            <div class="card-menu" id="cm_${e.id}">
              <div class="card-menu-item" data-action="openPreview" data-ev-id="${e.id}">Vorschau</div>
              <div class="card-menu-item" data-action="openModal" data-ev-id="${e.id}">Bearbeiten</div>
              ${(e.lat&&e.lon)||(e.accommodations&&e.accommodations.some(a=>a.lat))||(e.subevents&&e.subevents.some(s=>s.lat))?`<div class="card-menu-item" data-action="openEventMap" data-ev-id="${e.id}">Karte</div>`:''}
            </div>
          </div>
        </div>
      </div>
    </div>
    ${sections}
  </div>`;
}

// TOGGLE TODO IN CARD
function toggleTodo(evId,todoId){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  let todo=(ev.todos||[]).find(t=>t.id===todoId);
  if(!todo){
    for(const sub of (ev.subevents||[])){
      todo=(sub.todos||[]).find(t=>t.id===todoId);
      if(todo) break;
    }
  }
  if(!todo) return;
  todo.done=!todo.done;
  logActivity('todo',ev.title,`To-do ${todo.done?'erledigt':'wieder geöffnet'}: „${todo.text}"`);
  saveData();
}

// CALENDAR
function calPrev(){calM--;if(calM<0){calM=11;calY--;}renderCal();}
function calNext(){calM++;if(calM>11){calM=0;calY++;}renderCal();}
let selCalDay=null;

function renderCal(){
  document.getElementById('calLabel').textContent=MONTHS[calM]+' '+calY;
  const today=new Date().toISOString().slice(0,10);
  const fd=new Date(calY,calM,1).getDay(), off=(fd===0)?6:fd-1;
  const dim=new Date(calY,calM+1,0).getDate();
  const prevY=calM===0?calY-1:calY, prevM=calM===0?11:calM-1;
  const prevDim=new Date(calY,calM,0).getDate();
  const nextY=calM===11?calY+1:calY, nextM=calM===11?0:calM+1;

  // Day labels
  document.getElementById('calDayLabels').innerHTML=DAYS.map(d=>`<div class="cal-day-label">${d}</div>`).join('');

  // Build cells: prev-month tail + current month + next-month head to fill complete weeks
  const cells=[];
  for(let i=off-1;i>=0;i--){
    const d=prevDim-i;
    cells.push({date:`${prevY}-${String(prevM+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`,other:true});
  }
  for(let d=1;d<=dim;d++){
    cells.push({date:`${calY}-${String(calM+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`,other:false});
  }
  const trailing=cells.length%7===0?0:7-(cells.length%7);
  for(let d=1;d<=trailing;d++){
    cells.push({date:`${nextY}-${String(nextM+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`,other:true});
  }

  const cellDates=cells.map(c=>c.date);
  const firstDate=cellDates[0], lastDate=cellDates[cellDates.length-1];

  const multiEvs=filtered().filter(e=>e.multiday&&e.dateFrom&&e.dateTo&&e.dateTo>=firstDate&&e.dateFrom<=lastDate);
  const singleEvs=filtered().filter(e=>!e.multiday&&e.date);

  // Assign bar rows (max 3)
  const barRows=[];
  const rowOccupied={};
  for(let r=0;r<3;r++) rowOccupied[r]={};

  multiEvs.forEach(ev=>{
    let sc=-1,ec=-1;
    cellDates.forEach((d,i)=>{if(d>=ev.dateFrom&&d<=ev.dateTo){if(sc===-1)sc=i;ec=i;}});
    if(sc===-1) return;
    let row=-1;
    for(let r=0;r<3;r++){
      let free=true;
      for(let ci=sc;ci<=ec;ci++){if(rowOccupied[r][ci]){free=false;break;}}
      if(free){row=r;break;}
    }
    if(row===-1) return;
    for(let ci=sc;ci<=ec;ci++) rowOccupied[row][ci]=true;
    barRows.push({ev,sc,ec,row});
  });

  const years=[...new Set(cells.map(c=>parseInt(c.date.slice(0,4))))];
  const holidays=Object.assign({},...years.map(y=>getHolidays(y)));

  let gridHtml='';
  cells.forEach(({date:ds,other},ci)=>{
    const singleOnDay=singleEvs.filter(e=>e.date===ds);
    const dots=singleOnDay.slice(0,4).map(e=>`<div class="cal-dot ow-${e.owner||'gemeinsam'}"></div>`).join('');
    const hol=holidays[ds];
    const barsOnCell=barRows.filter(b=>ci>=b.sc&&ci<=b.ec);
    // Highest bar row used on this cell (0-indexed; -1 = no bars)
    const maxRow=barsOnCell.length>0?Math.max(...barsOnCell.map(b=>b.row)):-1;
    // Hide holiday label when all 3 bar rows are occupied (no space below)
    const showHoliday=hol&&maxRow<2;
    let holHtml='';
    if(showHoliday){
      const badge=hol.states==='BY'?'<span class="cal-hol-badge badge-by">BY</span>':hol.states==='HE'?'<span class="cal-hol-badge badge-he">HE</span>':hol.states==='BYHE'?'<span class="cal-hol-badge badge-byhe">BY·HE</span>':'';
      holHtml=`<div class="cal-holiday hol-${hol.states||'nat'}" title="${esc(hol.name)}${hol.states==='BY'?' (nur Bayern)':hol.states==='HE'?' (nur Hessen)':hol.states==='BYHE'?' (Bayern + Hessen)':''}">${esc(hol.name)}${badge}</div>`;
    }
    let barsHtml='';
    barsOnCell.forEach(b=>{
      const isStart=ci===b.sc,isEnd=ci===b.ec,isSolo=isStart&&isEnd;
      const isRowStart=ci%7===0&&ci>b.sc;
      const cls=`cal-bar-segment bar-ow-${b.ev.owner||'gemeinsam'}${isSolo?' bar-solo':isStart?' bar-start':isEnd?' bar-end':isRowStart?' bar-row-start':''}`;
      const top=26+b.row*16;
      const label=(isStart||isRowStart)?`<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;display:block">${esc(b.ev.title)||SL[b.ev.status]||''}</span>`:`<span></span>`;
      barsHtml+=`<div class="${cls}" style="position:absolute;top:${top}px;left:${isStart||isRowStart?'2px':'0'};right:${isEnd?'2px':'0'};pointer-events:auto;overflow:hidden" data-action="showCalDay" data-day="${ds}" title="${esc(b.ev.title)}">${label}</div>`;
    });
    const hasBar=barsHtml.length>0;
    // Cell height: bars + holiday row below (14px) when shown, otherwise normal padding
    const barsH=hasBar?26+(maxRow+1)*16:0;
    const minH=showHoliday?Math.max(52,barsH+16):hasBar?barsH+4:0;
    const extraHeight=minH>52?`min-height:${minH}px`:'';
    gridHtml+=`<div class="cal-cell${other?' other-month':''}${ds===today?' today':''}${selCalDay===ds?' sel-day':''}${hol?' has-holiday':''}" data-action="showCalDay" data-day="${ds}" style="${extraHeight}">
      <span class="day-num">${parseInt(ds.slice(8))}</span>
      ${singleOnDay.length?`<div class="cal-dots">${dots}</div>`:''}
      ${barsHtml}
      ${holHtml}
    </div>`;
  });

  document.getElementById('calGrid').innerHTML=gridHtml;
}
function showCalDay(ds){
  selCalDay=ds;renderCal();
  const de=filtered().filter(e=>e.multiday?ds>=e.dateFrom&&ds<=e.dateTo:e.date===ds);
  const c=document.getElementById('calDayEvents');
  const hol=getHolidays(parseInt(ds.slice(0,4)))[ds];
  const holNote=hol?`<div class="cal-day-holiday hol-${hol.states||'nat'}">${esc(hol.name)}${hol.states==='BY'?' <small>(nur Bayern)</small>':hol.states==='HE'?' <small>(nur Hessen)</small>':hol.states==='BYHE'?' <small>(Bayern · Hessen)</small>':''}</div>`:'';
  if(!de.length){c.innerHTML=hol?`<div class="cal-day-title">${fmtD(ds)}</div>${holNote}`:'';return;}
  c.innerHTML=`<div class="cal-day-title">${fmtD(ds)}</div>${holNote}`+de.map(e=>renderCard(e)).join('');
}

// INVITATIONS
function updateInviteBadge(){
  if(!currentUser) return;
  const count=events.filter(e=>e.invite&&e.invite.to===currentUser&&e.invite.status==='pending').length;
  const btn=document.getElementById('inviteBadgeBtn');
  const menu=document.getElementById('inviteBadgeMenu');
  [btn,menu].forEach(el=>{
    if(!el) return;
    el.textContent=count;
    el.style.display=count>0?'':'none';
  });
}

function eventsOverlap(a, b){
  const aFrom=a.dateFrom||a.date, aTo=a.dateTo||a.date;
  const bFrom=b.dateFrom||b.date, bTo=b.dateTo||b.date;
  if(!aFrom||!bFrom) return false;
  return aFrom<=bTo&&aTo>=bFrom;
}

function renderInvites(){
  const feed=document.getElementById('invitesFeed');
  if(!feed) return;
  if(!currentUser){feed.innerHTML='<div class="aktuell-today-empty" style="margin:20px 0">Nicht angemeldet</div>';return;}
  const mine=events.filter(e=>e.invite&&e.invite.to===currentUser);
  if(!mine.length){feed.innerHTML='<div class="aktuell-today-empty" style="margin:20px 0">Keine Einladungen vorhanden</div>';return;}
  // Split pending / answered
  const pending=mine.filter(e=>e.invite.status==='pending');
  const answered=mine.filter(e=>e.invite.status!=='pending');
  function inviteCard(ev){
    const inv=ev.invite;
    const fromName=inv.from==='toja'?'Toja':'Johann';
    const ds=ev.multiday?`${fmtD(ev.dateFrom)} – ${fmtD(ev.dateTo)}`:fmtD(ev.date);
    // Conflict detection: other events of the invited person on the same dates
    const conflicts=events.filter(e=>e.id!==ev.id&&(e.owner===currentUser||e.owner==='gemeinsam')&&eventsOverlap(e,ev));
    const conflictHtml=conflicts.length?`<div class="invite-conflict">
      <div class="invite-conflict-title">Terminierungskonflikt (${conflicts.length})</div>
      ${conflicts.map(c=>`<div class="invite-conflict-item">· ${esc(c.title)} – ${c.multiday?fmtD(c.dateFrom):fmtD(c.date)}</div>`).join('')}
    </div>`:'';
    if(inv.status==='accepted'){
      return `<div class="invite-card">
        <div class="invite-card-from from-${inv.from}">${fromName} hat eingeladen</div>
        <div class="invite-card-title">${esc(ev.title)}</div>
        <div class="invite-card-meta">${ds}${ev.location?' · '+esc(ev.location):''}</div>
        <div class="invite-status-accepted">✓ Angenommen</div>
      </div>`;
    }
    if(inv.status==='declined'){
      return `<div class="invite-card" style="opacity:0.6">
        <div class="invite-card-from from-${inv.from}">${fromName} hat eingeladen</div>
        <div class="invite-card-title">${esc(ev.title)}</div>
        <div class="invite-card-meta">${ds}</div>
        <div class="invite-status-declined">Abgelehnt</div>
      </div>`;
    }
    return `<div class="invite-card">
      <div class="invite-card-from from-${inv.from}">${fromName} hat eingeladen</div>
      <div class="invite-card-title">${esc(ev.title)}</div>
      <div class="invite-card-meta">${ds}${ev.location?' · '+esc(ev.location):''}</div>
      ${conflictHtml}
      <div class="invite-btns">
        <button class="invite-btn-accept" data-action="acceptInvite" data-ev-id="${ev.id}">Teilnehmen</button>
        <button class="invite-btn-decline" data-action="declineInvite" data-ev-id="${ev.id}">Ablehnen</button>
      </div>
    </div>`;
  }
  let html='';
  if(pending.length) html+=pending.map(inviteCard).join('');
  if(answered.length) html+=`<div style="font-size:0.7rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin:14px 0 6px">Beantwortet</div>`+answered.map(inviteCard).join('');
  feed.innerHTML=html;
}

function openInvites(){
  closeHamburger();
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-invites').classList.add('active');
  currentTab='invites';
  const toolbar=document.getElementById('filterToolbar');
  if(toolbar) toolbar.style.display='none';
  renderInvites();
}

function acceptInvite(id){
  const ev=events.find(e=>e.id===id);
  if(!ev||!ev.invite) return;
  ev.invite.status='accepted';
  // Upgrade to gemeinsam
  if(ev.owner==='toja'||ev.owner==='johann'){
    const prevStatus=ev.status||'save';
    ev.statusToja=prevStatus;
    ev.statusJohann=prevStatus;
    ev.owner='gemeinsam';
    ev.status=prevStatus;
  }
  logActivity('edit',ev.title,`Einladung angenommen – Termin jetzt Gemeinsam`);
  saveData();
  showToast('Einladung angenommen');
  renderInvites();
  updateInviteBadge();
}

function declineInvite(id){
  const ev=events.find(e=>e.id===id);
  if(!ev||!ev.invite) return;
  ev.invite.status='declined';
  logActivity('edit',ev.title,'Einladung abgelehnt');
  saveData();
  showToast('Einladung abgelehnt');
  renderInvites();
  updateInviteBadge();
}

// MODAL
function openModal(id){
  editId=id||null;pendingAtt=[];subCnt=0;todoCnt=0;
  resetForm();
  const delBtn=document.getElementById('btnDeleteEvent');
  if(delBtn){delBtn.style.display=id?'inline-flex':'none';if(id)delBtn.dataset.evId=id;}
  if(id){const ev=events.find(e=>e.id===id);if(ev)populateForm(ev);document.getElementById('modalTitle').textContent='Termin bearbeiten';}
  else document.getElementById('modalTitle').textContent='Neuer Termin';
  document.getElementById('eventModal').classList.add('open');
}
function closeModal(id){document.getElementById(id).classList.remove('open');}

let legCnt=0; // counter for unique leg IDs

function resetForm(){
  ['f_title','f_date','f_time','f_dateFrom','f_dateTo','f_location','f_lat','f_lon'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  initQuill();if(notesQuill)notesQuill.setContents([]);
  document.getElementById('f_status').value='save';
  document.getElementById('f_owner').value='gemeinsam';
  document.getElementById('f_allday').checked=false;
  PERSONS.forEach(p=>DIRS.forEach(d=>{
    const c=document.getElementById(`legs_${p}_${d}`);
    if(c) c.innerHTML='';
  }));
  document.getElementById('subContainer').innerHTML='';
  document.getElementById('todosContainer').innerHTML='';
  document.getElementById('attList').innerHTML='';
  document.getElementById('accomContainer').innerHTML='';
  const fInvite=document.getElementById('f_invite');if(fInvite){fInvite.checked=false;fInvite.disabled=false;}
  autoDetectMultiday();toggleAllday();
  syncOwnerRestrictions();
}

function populateForm(ev){
  document.getElementById('f_title').value=ev.title||'';
  document.getElementById('f_status').value=ev.status||'save';
  if(document.getElementById('f_statusToja'))document.getElementById('f_statusToja').value=ev.statusToja||ev.status||'save';
  if(document.getElementById('f_statusJohann'))document.getElementById('f_statusJohann').value=ev.statusJohann||ev.status||'save';
  document.getElementById('f_owner').value=ev.owner||'gemeinsam';
  document.getElementById('f_location').value=ev.location||'';
  const fLat=document.getElementById('f_lat');const fLon=document.getElementById('f_lon');
  if(fLat) fLat.value=ev.lat||''; if(fLon) fLon.value=ev.lon||'';
  loadNotesIntoQuill(ev.notes||'');
  if(ev.multiday){
    document.getElementById('f_dateFrom').value=ev.dateFrom||'';
    document.getElementById('f_dateTo').value=ev.dateTo||'';
  } else {
    document.getElementById('f_dateFrom').value=ev.date||'';
    document.getElementById('f_dateTo').value='';
    document.getElementById('f_time').value=ev.time||'';
    document.getElementById('f_allday').checked=!!ev.allday;
  }
  // Populate transport legs
  PERSONS.forEach(p=>DIRS.forEach(d=>{
    document.getElementById(`legs_${p}_${d}`).innerHTML='';
    const legs=(ev.transport&&ev.transport[p]&&ev.transport[p][d])||[];
    // Support old format (single object) and new format (array)
    const legsArr=Array.isArray(legs)?legs:(legs&&legs.type?[legs]:[]);
    legsArr.forEach(leg=>addLeg(p,d,leg));
  }));
  autoDetectMultiday();toggleAllday();
  syncOwnerRestrictions();
  // Populate invite state
  const fInvite=document.getElementById('f_invite');
  if(fInvite){
    fInvite.checked=!!(ev.invite&&(ev.invite.status==='pending'||ev.invite.status==='accepted'));
    fInvite.disabled=!!(ev.invite&&ev.invite.status==='accepted');
  }
  if(ev.subevents&&ev.subevents.length)ev.subevents.forEach(s=>addSub(s));
  if(ev.todos&&ev.todos.length)ev.todos.forEach(t=>addTodo('todosContainer',t));
  if(ev.attachments){pendingAtt=[...ev.attachments];renderAttList();}
  document.getElementById('accomContainer').innerHTML='';
  if(ev.accommodations&&ev.accommodations.length) ev.accommodations.forEach(a=>addAccom(a));
}

function autoDetectMultiday(){
  const from=document.getElementById('f_dateFrom').value;
  const to=document.getElementById('f_dateTo').value;
  const isM=!!(to&&to>from);
  document.getElementById('singleDate').style.display=isM?'none':'block';
}
function toggleAllday(){document.getElementById('timeGroup').style.display=document.getElementById('f_allday').checked?'none':'block';}
function toggleLegType(legId){
  const val=document.getElementById(`leg_${legId}_type`).value;
  const fl=document.getElementById(`leg_${legId}_flug`);
  const zg=document.getElementById(`leg_${legId}_zug`);
  const ot=document.getElementById(`leg_${legId}_other`);
  if(fl) fl.style.display=val==='flug'?'flex':'none';
  if(zg) zg.style.display=val==='zug'?'flex':'none';
  if(ot) ot.style.display=(val==='auto'||val==='sonstiges')?'block':'none';
  const etaRow=document.getElementById(`leg_${legId}_auto_eta_row`);
  if(etaRow) etaRow.style.display=val==='auto'?'flex':'none';
}

function copyTransport(to,from){
  DIRS.forEach(d=>copyDirLegs(to,d,from,d));
  showToast(`Gesamter Transport von ${from==='toja'?'Toja':'Johann'} übernommen`);
}

function syncOwnerRestrictions(){
  const owner=document.getElementById('f_owner')?.value||'gemeinsam';
  const tojaSec=document.getElementById('transport-person-toja');
  const johannSec=document.getElementById('transport-person-johann');
  if(tojaSec&&johannSec){
    if(owner==='toja'){
      tojaSec.style.opacity='';tojaSec.style.pointerEvents='';
      johannSec.style.opacity='0.35';johannSec.style.pointerEvents='none';
      if(!johannSec.querySelector('.owner-restricted-note')){
        const note=document.createElement('div');
        note.className='owner-restricted-note';
        note.style.cssText='font-size:0.72rem;color:var(--text3);text-align:center;padding:6px 0;font-style:italic';
        note.textContent='Nur Toja — kein Transport für Johann';
        johannSec.appendChild(note);
      }
    } else if(owner==='johann'){
      johannSec.style.opacity='';johannSec.style.pointerEvents='';
      tojaSec.style.opacity='0.35';tojaSec.style.pointerEvents='none';
      if(!tojaSec.querySelector('.owner-restricted-note')){
        const note=document.createElement('div');
        note.className='owner-restricted-note';
        note.style.cssText='font-size:0.72rem;color:var(--text3);text-align:center;padding:6px 0;font-style:italic';
        note.textContent='Nur Johann — kein Transport für Toja';
        tojaSec.appendChild(note);
      }
    } else {
      tojaSec.style.opacity='';tojaSec.style.pointerEvents='';
      johannSec.style.opacity='';johannSec.style.pointerEvents='';
      tojaSec.querySelectorAll('.owner-restricted-note').forEach(n=>n.remove());
      johannSec.querySelectorAll('.owner-restricted-note').forEach(n=>n.remove());
    }
  }
  // Show/hide per-person status fields for gemeinsam events
  const ppSec=document.getElementById('perPersonStatusSection');
  const singleSec=document.getElementById('singleStatusGroup');
  if(ppSec) ppSec.style.display=owner==='gemeinsam'?'':'none';
  if(singleSec) singleSec.style.display=owner==='gemeinsam'?'none':'';

  // Update existing todo selects in the main form
  document.querySelectorAll('#todosContainer .todo-owner-select').forEach(sel=>restrictTodoSelect(sel,owner));
  // Show/hide invite section (only for single-owner events)
  const inviteSec=document.getElementById('inviteSection');
  const inviteLabel=document.getElementById('inviteLabel');
  if(inviteSec){
    inviteSec.style.display=owner==='gemeinsam'?'none':'';
    if(inviteLabel){
      const other=owner==='toja'?'Johann':'Toja';
      inviteLabel.textContent=`${other} einladen`;
    }
  }
}

function restrictTodoSelect(sel,owner){
  if(!owner) owner=document.getElementById('f_owner')?.value||'gemeinsam';
  if(owner==='toja'||owner==='johann'){
    sel.value=owner;
    updateTodoOwnerStyle(sel);
    sel.disabled=true;
    sel.style.opacity='0.6';
  } else {
    sel.disabled=false;
    sel.style.opacity='';
  }
}

// TODOS
function addTodo(containerId,data){
  todoCnt++;
  const id='todo_'+todoCnt;
  const c=document.getElementById(containerId);
  if(!c){console.warn('addTodo: container not found:',containerId);return;}
  const div=document.createElement('div');
  div.className='todo-item';div.id=id;
  const isDone=data&&data.done;
  // Respect event owner for main todos (not subevent todos)
  const isMainTodo=containerId==='todosContainer';
  const eventOwner=isMainTodo?(document.getElementById('f_owner')?.value||'gemeinsam'):'gemeinsam';
  let ownerVal=(data&&data.owner)||'beide';
  if(isMainTodo&&!data&&(eventOwner==='toja'||eventOwner==='johann')) ownerVal=eventOwner;
  const isLocked=isMainTodo&&(eventOwner==='toja'||eventOwner==='johann');
  div.innerHTML=`
    <div class="todo-cb ${isDone?'checked':''}" data-action="toggleTodoCb" data-id="${id}">${isDone?'✓':''}</div>
    <div class="todo-main">
      <input type="text" class="todo-text-input ${isDone?'done-text':''}" placeholder="To-do beschreiben…" value="${esc(data?.text||'')}">
      <div class="todo-datetime">
        <input type="date" class="todo-due-date" value="${data?.dueDate||''}" style="font-size:0.75rem;padding:3px 6px;min-height:0;border-radius:6px">
        <input type="time" class="todo-due-time" value="${data?.dueTime||''}" style="font-size:0.75rem;padding:3px 6px;min-height:0;border-radius:6px">
      </div>
    </div>
    <select class="todo-owner-select ow-${ownerVal}" data-action="updateTodoOwnerStyle" ${isLocked?'disabled style="opacity:0.6"':''}>
      ${eventOwner==='gemeinsam'?`<option value="beide" ${ownerVal==='beide'?'selected':''}>Beide</option>`:''}
      <option value="toja" ${ownerVal==='toja'?'selected':''} ${eventOwner==='johann'?'style="display:none"':''}>Toja</option>
      <option value="johann" ${ownerVal==='johann'?'selected':''} ${eventOwner==='toja'?'style="display:none"':''}>Johann</option>
    </select>
    <button class="remove-todo" data-action="removeSelf" data-target="${id}">✕</button>`;
  c.appendChild(div);
}
function toggleTodoCb(id){
  const div=document.getElementById(id);if(!div)return;
  const cb=div.querySelector('.todo-cb');
  const inp=div.querySelector('.todo-text-input');
  const isDone=cb.classList.contains('checked');
  cb.classList.toggle('checked',!isDone);cb.textContent=isDone?'':'✓';
  inp.classList.toggle('done-text',!isDone);
}
function updateTodoOwnerStyle(sel){
  sel.className='todo-owner-select ow-'+sel.value;
}
function collectTodos(containerId){
  if(!containerId) return [];
  const container=document.getElementById(containerId);
  if(!container) return [];
  return Array.from(container.querySelectorAll('.todo-item')).map(item=>({
    id:'t_'+Math.random().toString(36).slice(2,8),
    text:item.querySelector('.todo-text-input').value,
    done:item.querySelector('.todo-cb').classList.contains('checked'),
    owner:item.querySelector('.todo-owner-select').value,
    dueDate:item.querySelector('.todo-due-date')?.value||'',
    dueTime:item.querySelector('.todo-due-time')?.value||''
  })).filter(t=>t.text.trim());
}

// SUBEVENTS
function addSub(data){
  subCnt++;const id='sub_'+subCnt;
  const c=document.getElementById('subContainer');
  const mainDate=document.getElementById('f_dateFrom').value||document.getElementById('f_date').value||'';
  const div=document.createElement('div');div.className='subevent-item';div.id=id;
  div.innerHTML=`<div class="sub-item-head"><span class="sub-num">Subevent ${c.children.length+1}</span><button class="remove-btn" data-action="removeSelf" data-target="${id}">✕</button></div>
    <div class="form-row" style="margin-bottom:7px">
      <div class="form-group"><label>Titel</label><input type="text" class="sub-title" placeholder="z.B. Abendessen" value="${esc(data?.title||'')}"></div>
      <div class="form-group"><label>Datum</label><input type="date" class="sub-date" value="${data?.date||''}" min="${mainDate}"></div>
    </div>
    <div class="form-row-3" style="margin-bottom:7px">
      <div class="form-group"><label>Beginn</label><input type="time" class="sub-time" value="${data?.time||''}"></div>
      <div class="form-group"><label>Ende</label><input type="time" class="sub-timeend" value="${data?.timeEnd||''}"></div>
      <div class="form-group"><label>Ort</label>
        <div class="addr-wrap">
          <input type="text" class="sub-loc" placeholder="Ort" value="${esc(data?.location||'')}" autocomplete="off" data-action="addrSearchInput" data-dd="sub-dd-${subCnt}" data-lat="sub-lat-${subCnt}" data-lon="sub-lon-${subCnt}">
          <input type="hidden" class="sub-lat" value="${data?.lat||''}"><input type="hidden" class="sub-lon" value="${data?.lon||''}">
          <div class="addr-dropdown" id="sub-dd-${subCnt}"></div>
        </div>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:8px"><label>Notizen</label><input type="text" class="sub-note" placeholder="Kurze Notiz" value="${esc(data?.note||'')}"></div>
    <div style="font-size:0.7rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:5px">To-dos</div>
    <div class="todos-container" id="sub-todos-${id}"></div>
    <button class="add-todo-btn" data-action="addTodo" data-target="sub-todos-${id}" style="margin-top:5px">+ To-do</button>`;
  c.appendChild(div);
  if(data&&data.todos&&data.todos.length)data.todos.forEach(t=>addTodo('sub-todos-'+id,t));
}
function collectSubs(){
  return Array.from(document.querySelectorAll('.subevent-item')).map(item=>({
    title:item.querySelector('.sub-title').value,
    date:item.querySelector('.sub-date').value,
    time:item.querySelector('.sub-time').value,
    timeEnd:item.querySelector('.sub-timeend').value,
    location:item.querySelector('.sub-loc')?.value||'',
    lat:item.querySelector('.sub-lat')?.value||'',
    lon:item.querySelector('.sub-lon')?.value||'',
    note:item.querySelector('.sub-note').value,
    todos:collectTodos(item.querySelector('.todos-container[id^="sub-todos-"]')?.id||'')
  }));
}

// ATTACHMENTS
// safeDataImg: validate base64 data URI before using as img src to prevent injection.
function safeDataImg(data){
  return typeof data==='string'&&/^data:image\/(jpeg|png|gif|webp);base64,/.test(data)?data:'';
}

// checkMagicB64: verify file magic bytes match the declared MIME type.
// Defends against renamed files (e.g. .exe renamed to .jpg) and MIME-type spoofing.
function checkMagicB64(dataURI,type){
  try{
    const b64=dataURI.split(',')[1];if(!b64)return false;
    const raw=atob(b64.slice(0,20));
    const b=Array.from(raw).map(ch=>ch.charCodeAt(0));
    if(type==='image/jpeg') return b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF;
    if(type==='image/png')  return b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47;
    if(type==='image/gif')  return b[0]===0x47&&b[1]===0x49&&b[2]===0x46&&b[3]===0x38;
    if(type==='image/webp') return b[0]===0x52&&b[1]===0x49&&b[2]===0x46&&b[3]===0x46&&b[8]===0x57&&b[9]===0x45&&b[10]===0x42&&b[11]===0x50;
    if(type==='application/pdf') return b[0]===0x25&&b[1]===0x50&&b[2]===0x44&&b[3]===0x46;
    return false;
  }catch(e){return false;}
}

// SVG excluded: SVG data-URIs can carry inline scripts and execute in some img contexts
const ALLOWED_UPLOAD_MIME=new Set(['image/jpeg','image/png','image/gif','image/webp','application/pdf']);
function validateFile(file){
  if(file.size>5*1024*1024){showToast('Max. 5 MB pro Datei');return false;}
  if(!ALLOWED_UPLOAD_MIME.has(file.type)){showToast(`Dateityp nicht erlaubt: ${file.type||'unbekannt'}`);return false;}
  return true;
}
async function handleFiles(input){
  for(const file of Array.from(input.files)){
    if(!validateFile(file)) continue;
    const data=await toB64(file);
    if(!checkMagicB64(data,file.type)){showToast(`Dateiformat ungültig: ${file.type}`);continue;}
    pendingAtt.push({name:file.name,type:file.type,data});
  }renderAttList();
}
async function addFileObjects(files){
  let added=0;
  for(const file of Array.from(files)){
    if(!validateFile(file)) continue;
    const data=await toB64(file);
    if(!checkMagicB64(data,file.type)){showToast(`Dateiformat ungültig: ${file.type}`);continue;}
    pendingAtt.push({name:file.name||('bild_'+Date.now()+'.png'),type:file.type,data});
    added++;
  }
  if(added>0){renderAttList();showToast(`${added} Datei${added>1?'en':''} hinzugefügt`);}
}
function handleDragOver(e){e.preventDefault();e.stopPropagation();document.getElementById('fileDropArea').classList.add('drag-over');}
function handleDragLeave(e){e.preventDefault();document.getElementById('fileDropArea').classList.remove('drag-over');}
function handleDrop(e){
  e.preventDefault();e.stopPropagation();
  document.getElementById('fileDropArea').classList.remove('drag-over');
  if(e.dataTransfer.files.length)addFileObjects(e.dataTransfer.files);
}
document.addEventListener('paste',function(e){
  const modal=document.getElementById('eventModal');
  if(!modal||!modal.classList.contains('open'))return;
  const active=document.activeElement;
  if(active&&(active.tagName==='INPUT'||active.tagName==='TEXTAREA'))return;
  const files=e.clipboardData&&e.clipboardData.files;
  if(files&&files.length){e.preventDefault();addFileObjects(files);return;}
  // image from clipboard (e.g. screenshot)
  const items=e.clipboardData&&e.clipboardData.items;
  if(!items)return;
  const imageItems=Array.from(items).filter(it=>it.kind==='file'&&it.type.startsWith('image/'));
  if(imageItems.length){
    e.preventDefault();
    addFileObjects(imageItems.map(it=>it.getAsFile()).filter(Boolean));
  }
});
function toB64(f){return new Promise(r=>{const fr=new FileReader();fr.onload=e=>r(e.target.result);fr.readAsDataURL(f);});}
function renderAttList(){
  document.getElementById('attList').innerHTML=pendingAtt.map((a,i)=>{
    const isImg=a.type&&a.type.startsWith('image/');
    return `<div class="att-item" style="${isImg?'flex-direction:column;align-items:flex-start;padding:6px 8px;gap:4px':''}">
      ${isImg?`<img src="${safeDataImg(a.data)}" style="width:100%;max-width:160px;max-height:100px;object-fit:cover;border-radius:3px;border:1px solid var(--border)">`:'📄'}
      <div style="display:flex;align-items:center;gap:5px;width:100%">
        <span style="flex:1;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.72rem">${esc(a.name)}</span>
        <span class="att-rm" data-action="removeAtt" data-idx="${i}">✕</span>
      </div>
    </div>`;
  }).join('');
}

// TRANSPORT LEGS
// Copy all legs from one direction to another
function copyDirLegs(toPerson, toDir, fromPerson, fromDir){
  const fromLegs=collectLegs(fromPerson,fromDir);
  if(!fromLegs.length){showToast('Keine Teilstrecken zum Kopieren');return;}
  document.getElementById(`legs_${toPerson}_${toDir}`).innerHTML='';
  fromLegs.forEach(leg=>addLeg(toPerson,toDir,leg));
  showToast(`${fromLegs.length} Teilstrecke${fromLegs.length>1?'n':''} übernommen`);
}

// Auto-fill return destination from last arrival of outbound
function autoFillReturn(person){
  const anLegs=collectLegs(person,'an');
  const abContainer=document.getElementById(`legs_${person}_ab`);
  if(!anLegs.length||!abContainer) return;
  // Get last leg's destination
  const lastLeg=anLegs[anLegs.length-1];
  if(!lastLeg||!lastLeg.data) return;
  const lastTo=lastLeg.data.to||lastLeg.data.to||'';
  if(!lastTo) return;
  // Find first leg in ab and set its 'from' field if empty
  const firstAbLeg=abContainer.querySelector('.leg-item');
  if(!firstAbLeg) return;
  const lid=firstAbLeg.id.replace('leg_block_','');
  const fromFlug=document.getElementById(`leg_${lid}_flugfrom`);
  const fromZug=document.getElementById(`leg_${lid}_zugfrom`);
  if(fromFlug&&!fromFlug.value) fromFlug.value=lastTo;
  if(fromZug&&!fromZug.value) fromZug.value=lastTo;
}

function makeLegDraggable(div, container){
  div.draggable=true;
  div.addEventListener('dragstart',e=>{
    e.dataTransfer.setData('text/plain',div.id);
    div.classList.add('dragging');
  });
  div.addEventListener('dragend',()=>{
    div.classList.remove('dragging');
    container.querySelectorAll('.leg-item').forEach(l=>l.classList.remove('drag-over'));
    renumberLegs(container);
  });
  div.addEventListener('dragover',e=>{
    e.preventDefault();
    container.querySelectorAll('.leg-item').forEach(l=>l.classList.remove('drag-over'));
    div.classList.add('drag-over');
  });
  div.addEventListener('drop',e=>{
    e.preventDefault();
    const dragId=e.dataTransfer.getData('text/plain');
    const dragEl=document.getElementById(dragId);
    if(dragEl&&dragEl!==div) container.insertBefore(dragEl,div);
    container.querySelectorAll('.leg-item').forEach(l=>l.classList.remove('drag-over'));
  });
}

function renumberLegs(container){
  Array.from(container.querySelectorAll('.leg-num')).forEach((el,i)=>{
    el.textContent=`Teilstrecke ${i+1}`;
  });
}

function addLeg(person, dir, data){
  legCnt++;
  const lid=`${person}_${dir}_${legCnt}`;
  const container=document.getElementById(`legs_${person}_${dir}`);
  if(!container) return;
  const legNum=container.children.length+1;
  const type=(data&&data.type)||'';
  const div=document.createElement('div');
  div.className='leg-item'; div.id=`leg_block_${lid}`;
  div.innerHTML=`
    <div class="leg-header">
      <span class="leg-drag-handle" title="Ziehen zum Sortieren">⠿</span>
      <span class="leg-num">Teilstrecke ${legNum}</span>
      <button type="button" class="remove-btn" data-action="removeLeg" data-lid="${lid}" data-person="${person}" data-dir="${dir}">✕</button>
    </div>
    <div class="form-group" style="margin-bottom:8px">
      <label>Transportmittel</label>
      <select id="leg_${lid}_type" data-action="toggleLegType" data-lid="${lid}">
        <option value="">— wählen —</option>
        <option value="flug" ${type==='flug'?'selected':''}>✈ Flug</option>
        <option value="zug" ${type==='zug'?'selected':''}>🚄 Zug</option>
        <option value="auto" ${type==='auto'?'selected':''}>🚗 Auto</option>
        <option value="sonstiges" ${type==='sonstiges'?'selected':''}>⋯ Sonstiges</option>
      </select>
    </div>
    <div id="leg_${lid}_flug" style="display:${type==='flug'?'flex':'none'};flex-direction:column;gap:7px">
      <div class="form-group"><label>Flugnummer</label>
        <div style="display:flex;gap:7px">
          <input type="text" id="leg_${lid}_flugnum" placeholder="LH1234" style="flex:1" value="${esc((data&&data.type==='flug'&&data.data&&data.data.num)||'')}" data-action="flightKeydown" data-lid="${lid}">
          <button type="button" data-action="lookupFlightLeg" data-lid="${lid}" style="padding:8px 10px;background:var(--blue);color:#fff;border:none;border-radius:4px;font-size:0.75rem;font-weight:700;font-family:'Nunito',sans-serif;cursor:pointer;white-space:nowrap">Suchen</button>
        </div>
      </div>
      <div class="form-group"><label>Datum</label><input type="date" id="leg_${lid}_flugdate" value="${esc((data&&data.type==='flug'&&data.data&&data.data.date)||'')}"></div>
      <div class="form-row">
        <div class="form-group"><label>Von (IATA)</label><input type="text" id="leg_${lid}_flugfrom" placeholder="FRA" value="${esc((data&&data.type==='flug'&&data.data&&data.data.from)||'')}"></div>
        <div class="form-group"><label>Nach (IATA)</label><input type="text" id="leg_${lid}_flugto" placeholder="BCN" value="${esc((data&&data.type==='flug'&&data.data&&data.data.to)||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Abflug</label><input type="time" id="leg_${lid}_flugdep" value="${esc((data&&data.type==='flug'&&data.data&&data.data.dep)||'')}"></div>
        <div class="form-group"><label>Ankunft</label><input type="time" id="leg_${lid}_flugarr" value="${esc((data&&data.type==='flug'&&data.data&&data.data.arr)||'')}"></div>
      </div>
    </div>
    <div id="leg_${lid}_zug" style="display:${type==='zug'?'flex':'none'};flex-direction:column;gap:7px">
      <div class="form-row">
        <div class="form-group"><label>Zugnummer</label><input type="text" id="leg_${lid}_zugnum" placeholder="ICE 1234" value="${esc((data&&data.type==='zug'&&data.data&&data.data.num)||'')}"></div>
        <div class="form-group"><label>Datum</label><input type="date" id="leg_${lid}_zugdate" value="${esc((data&&data.type==='zug'&&data.data&&data.data.date)||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Von</label><input type="text" id="leg_${lid}_zugfrom" placeholder="Frankfurt Hbf" value="${esc((data&&data.type==='zug'&&data.data&&data.data.from)||'')}"></div>
        <div class="form-group"><label>Nach</label><input type="text" id="leg_${lid}_zugto" placeholder="Paris Est" value="${esc((data&&data.type==='zug'&&data.data&&data.data.to)||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Abfahrt</label><input type="time" id="leg_${lid}_zugdep" value="${esc((data&&data.type==='zug'&&data.data&&data.data.dep)||'')}"></div>
        <div class="form-group"><label>Ankunft</label><input type="time" id="leg_${lid}_zugarr" value="${esc((data&&data.type==='zug'&&data.data&&data.data.arr)||'')}"></div>
      </div>
    </div>
    <div id="leg_${lid}_other" style="display:${(type==='auto'||type==='sonstiges')?'block':'none'}">
      <div id="leg_${lid}_auto_eta_row" style="display:${type==='auto'?'flex':'none'}">
        <div class="form-group"><label>Ankunft (ETA)</label><input type="time" id="leg_${lid}_auto_eta" value="${esc((data&&data.type==='auto'&&data.eta)||'')}"></div>
      </div>
      <div class="form-group"><label>Details</label><textarea id="leg_${lid}_note" style="min-height:44px" placeholder="Details…">${esc((data&&(data.type==='auto'||data.type==='sonstiges')&&data.note)||'')}</textarea></div>
    </div>
    <div class="toggle-row" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
      <label class="toggle"><input type="checkbox" id="leg_${lid}_shared" ${data&&data.sharedWithBoth?'checked':''}><span class="toggle-slider"></span></label>
      <span class="toggle-label" style="font-size:0.8rem">Für beide gelten</span>
    </div>`;
  container.appendChild(div);
  makeLegDraggable(div, container);
  // Auto-fill return 'from' when adding first abreise leg
  if(dir==='ab'&&container.children.length===1&&!data){
    setTimeout(()=>autoFillReturn(person),50);
  }
}

async function lookupFlightLeg(lid){
  const numEl=document.getElementById(`leg_${lid}_flugnum`);
  const dateEl=document.getElementById(`leg_${lid}_flugdate`);
  if(!numEl||!numEl.value.trim()){showToast('Bitte Flugnummer eingeben');return;}
  numEl.disabled=true; showToast('Flugdaten werden gesucht…');
  try{
    const flightNum=numEl.value.trim().replace(/\s/g,'').toUpperCase();
    const flightDate=dateEl&&dateEl.value?dateEl.value:'';
    let url=`/.netlify/functions/aviationstack?flight_iata=${encodeURIComponent(flightNum)}&limit=1`;
    if(flightDate) url+=`&flight_date=${flightDate}`;
    const resp=await fetch(url);
    const data=await resp.json();
    if(!data.data||!data.data.length){showToast('Flug nicht gefunden');numEl.disabled=false;return;}
    const f=data.data[0],dep=f.departure||{},arr=f.arrival||{};
    const fromEl=document.getElementById(`leg_${lid}_flugfrom`);
    const toEl=document.getElementById(`leg_${lid}_flugto`);
    const depEl=document.getElementById(`leg_${lid}_flugdep`);
    const arrEl=document.getElementById(`leg_${lid}_flugarr`);
    if(fromEl) fromEl.value=dep.iata||'';
    if(toEl) toEl.value=arr.iata||'';
    if(dep.scheduled){const t=new Date(dep.scheduled);if(depEl)depEl.value=`${String(t.getUTCHours()).padStart(2,'0')}:${String(t.getUTCMinutes()).padStart(2,'0')}`;if(dateEl&&!dateEl.value)dateEl.value=t.toISOString().slice(0,10);}
    if(arr.scheduled){const t=new Date(arr.scheduled);if(arrEl)arrEl.value=`${String(t.getUTCHours()).padStart(2,'0')}:${String(t.getUTCMinutes()).padStart(2,'0')}`;}
    showToast(`${flightNum}: ${dep.iata||'?'}→${arr.iata||'?'} gefunden`);
  }catch(e){showToast('Fehler beim Abrufen');}
  numEl.disabled=false;
}

function collectLegs(person, dir){
  const container=document.getElementById(`legs_${person}_${dir}`);
  if(!container) return [];
  return Array.from(container.querySelectorAll('.leg-item')).map(item=>{
    const lid=item.id.replace('leg_block_','');
    const type=document.getElementById(`leg_${lid}_type`)?.value||'';
    if(!type) return null;
    const obj={type};
    if(type==='flug'){
      obj.data={
        num:document.getElementById(`leg_${lid}_flugnum`)?.value||'',
        date:document.getElementById(`leg_${lid}_flugdate`)?.value||'',
        from:document.getElementById(`leg_${lid}_flugfrom`)?.value||'',
        to:document.getElementById(`leg_${lid}_flugto`)?.value||'',
        dep:document.getElementById(`leg_${lid}_flugdep`)?.value||'',
        arr:document.getElementById(`leg_${lid}_flugarr`)?.value||''
      };
    } else if(type==='zug'){
      obj.data={
        num:document.getElementById(`leg_${lid}_zugnum`)?.value||'',
        date:document.getElementById(`leg_${lid}_zugdate`)?.value||'',
        from:document.getElementById(`leg_${lid}_zugfrom`)?.value||'',
        to:document.getElementById(`leg_${lid}_zugto`)?.value||'',
        dep:document.getElementById(`leg_${lid}_zugdep`)?.value||'',
        arr:document.getElementById(`leg_${lid}_zugarr`)?.value||''
      };
    } else {
      obj.note=document.getElementById(`leg_${lid}_note`)?.value||'';
      if(type==='auto') obj.eta=document.getElementById(`leg_${lid}_auto_eta`)?.value||'';
    }
    obj.sharedWithBoth=document.getElementById(`leg_${lid}_shared`)?.checked||false;
    return obj;
  }).filter(Boolean);
}

function collectTransport(){
  const out={};
  PERSONS.forEach(p=>{
    out[p]={};
    DIRS.forEach(d=>{ out[p][d]=collectLegs(p,d); });
  });
  return out;
}

// SAVE
function saveEvent(){
  const title=document.getElementById('f_title').value.trim();
  if(!title){showToast('Bitte Titel eingeben');return;}
  const dateFrom=document.getElementById('f_dateFrom').value;
  const dateTo=document.getElementById('f_dateTo').value;
  const isM=!!(dateTo&&dateTo>dateFrom);
  const existing=editId?events.find(e=>e.id===editId):null;
  const ev={
    id:editId||genId(),uid:(existing&&existing.uid)||genUid(),
    sequence:existing?((existing.sequence||0)+1):0,
    title,
    ...((()=>{
      const own=document.getElementById('f_owner').value;
      const stT=document.getElementById('f_statusToja')?.value||'save';
      const stJ=document.getElementById('f_statusJohann')?.value||'save';
      if(own==='gemeinsam'){
        return {status:stT,statusToja:stT,statusJohann:stJ};
      }
      return {status:document.getElementById('f_status').value,statusToja:'',statusJohann:''};
    })()),
    owner:document.getElementById('f_owner').value,
    location:document.getElementById('f_location').value,
    lat:document.getElementById('f_lat')?.value||'',
    lon:document.getElementById('f_lon')?.value||'',
    notes:exportNotesFromQuill(),
    multiday:isM,allday:document.getElementById('f_allday').checked,
    transport:collectTransport(),
    todos:collectTodos('todosContainer'),
    accommodations:collectAccoms(),
    attachments:pendingAtt,
    subevents:collectSubs(),
    updatedAt:new Date().toISOString()
  };
  if(isM){ev.dateFrom=dateFrom;ev.dateTo=dateTo;}
  else{ev.date=dateFrom;ev.time=document.getElementById('f_time').value;}
  // Invite handling
  const fInvite=document.getElementById('f_invite');
  const inviteChecked=fInvite&&fInvite.checked&&ev.owner!=='gemeinsam';
  if(inviteChecked){
    const other=ev.owner==='toja'?'johann':'toja';
    const existingInvite=existing&&existing.invite;
    // Don't reset an already accepted invite when editing
    if(existingInvite&&existingInvite.status==='accepted'){
      ev.invite=existingInvite;
    } else {
      ev.invite={from:ev.owner,to:other,status:'pending'};
    }
  } else if(existing&&existing.invite&&existing.invite.status==='accepted'){
    ev.invite=existing.invite; // preserve accepted invites even if checkbox unchecked
  } else {
    ev.invite=null;
  }
  if(editId){
    // Build changelog entry: what changed?
    const changes=[];
    if(existing){
      if(existing.status!==ev.status) changes.push(`Status: ${SL[existing.status]||existing.status} → ${SL[ev.status]||ev.status}`);
      if((existing.date||existing.dateFrom)!==(ev.date||ev.dateFrom)) changes.push('Datum geändert');
      if(existing.location!==ev.location) changes.push('Ort geändert');
      if(existing.title!==ev.title) changes.push(`Titel: „${existing.title}" → „${ev.title}"`);
      if(JSON.stringify(existing.transport)!==JSON.stringify(ev.transport)) changes.push('Transport geändert');
      if(JSON.stringify(existing.todos)!==JSON.stringify(ev.todos)) changes.push('To-dos geändert');
      if(JSON.stringify(existing.subevents)!==JSON.stringify(ev.subevents)) changes.push('Subevents geändert');
    }
    events=events.map(e=>e.id===editId?ev:e);
    logActivity('edit',ev.title,changes.length?changes.join(' · '):'Details aktualisiert');
  } else {
    events.push(ev);
    const dateStr=ev.multiday?`${fmtD(ev.dateFrom)} – ${fmtD(ev.dateTo)}`:fmtD(ev.date);
    logActivity('create',ev.title,`Neuer Termin · ${dateStr} · ${SL[ev.status]||ev.status}`);
  }
  saveData();closeModal('eventModal');
  showToast(editId?'Termin aktualisiert':'Termin gespeichert');

}

// DELETE
let _pendingDeleteId=null;
function delEvent(id){
  const ev=events.find(e=>e.id===id);if(!ev)return;
  _pendingDeleteId=id;
  document.getElementById('confirmDialogTitle').textContent=`„${ev.title}" löschen?`;
  document.getElementById('confirmDialogSub').textContent='Diese Aktion kann nicht rückgängig gemacht werden.';
  document.getElementById('confirmOverlay').classList.add('open');
}
function confirmDialogOk(){
  const id=_pendingDeleteId;  // save before closing clears it
  closeConfirmDialog();
  if(!id)return;
  const ev=events.find(e=>e.id===id);
  if(ev) logActivity('delete',ev.title,`Termin gelöscht · ${ev.multiday?fmtD(ev.dateFrom):fmtD(ev.date)}`);
  events=events.filter(e=>e.id!==id);
  closeModal('eventModal');closeModal('previewModal');
  saveData();showToast('Termin gelöscht');
}
function closeConfirmDialog(){
  document.getElementById('confirmOverlay').classList.remove('open');
  _pendingDeleteId=null;
}

// PREVIEW
function openPreview(id){
  pvId=id;const ev=events.find(e=>e.id===id);if(!ev)return;
  document.getElementById('pvTitle').textContent=ev.title;
  const ds=ev.multiday?`${fmtD(ev.dateFrom)} – ${fmtD(ev.dateTo)}`:fmtD(ev.date);
  const ts=(!ev.allday&&ev.time)?ev.time+' Uhr':'Ganztägig';
  const ownerColors={'toja':'var(--toja-color)','johann':'var(--johann-color)','beide':'var(--purple)'};
  const ownerLabels={'toja':'Toja','johann':'Johann','beide':'Beide'};

  const pvEffStatus=effectiveStatus(ev);
  const pvDual=ev.owner==='gemeinsam'&&ev.statusToja&&ev.statusJohann&&ev.statusToja!==ev.statusJohann;
  const pvStatusBadge=pvDual
    ?`<span class="status-badge ${SC[ev.statusToja]||''}">T: ${SL[ev.statusToja]||''}</span><span class="status-badge ${SC[ev.statusJohann]||''}">J: ${SL[ev.statusJohann]||''}</span>`
    :`<span class="status-badge ${SC[pvEffStatus]||''}">${SL[pvEffStatus]||''}</span>`;
  let html=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
    ${pvStatusBadge}
    <span class="badge ${OC[ev.owner||'gemeinsam']}">${OL[ev.owner||'gemeinsam']}</span>
  </div>
  <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:10px">
    <div class="pv-grid">
      <div class="pv-row${ev.multiday?' full':''}"><div class="pv-label">Datum</div><div class="pv-val">${ds}</div></div>
      ${!ev.multiday?`<div class="pv-row"><div class="pv-label">Uhrzeit</div><div class="pv-val">${ts}</div></div>`:''}
      ${ev.location?`<div class="pv-row full"><div class="pv-label">Ort</div><div class="pv-val">${navLink(ev.location,'','wrap')}</div></div>`:''}
    </div>
    ${ev.notes?`<div class="pv-divider"></div><div class="pv-row"><div class="pv-label">Notizen</div><div class="pv-val pv-notes-html ql-editor" style="font-size:0.84rem;padding:0;min-height:0">${sanitizeNotes(ev.notes)}</div></div>`:''}
  </div>`;

  if(ev.todos&&ev.todos.length){
    html+=`<div class="pv-block" style="margin-bottom:8px"><div class="pv-block-title">To-dos</div>`+
      ev.todos.map(t=>`<div class="pv-todo-row ${t.done?'done':''}">
        <div style="width:14px;height:14px;border-radius:2px;border:1.5px solid ${t.done?'var(--blue)':'var(--border2)'};background:${t.done?'var(--blue)':'#fff'};display:flex;align-items:center;justify-content:center;font-size:0.6rem;color:#fff;flex-shrink:0">${t.done?'✓':''}</div>
        <span style="flex:1">${esc(t.text)}</span>
        <span style="font-size:0.68rem;color:${ownerColors[t.owner||'beide']};font-weight:700">${ownerLabels[t.owner||'beide']}</span>
      </div>`).join('')+`</div>`;
  }

  const tr=ev.transport||{};
  const pvLegRow=leg=>{
    if(leg.type==='flug'&&leg.data){const f=leg.data;return (`${esc(f.num)}${f.from&&f.to?' · '+navLink(f.from,f.from)+'→'+navLink(f.to,f.to):''}${f.dep?' · '+esc(f.dep):''}${f.arr?'–'+esc(f.arr):''}`).trim();}
    if(leg.type==='zug'&&leg.data){const t=leg.data;return (`${esc(t.num)}${t.from&&t.to?' · '+navLink(t.from,t.from)+'→'+navLink(t.to,t.to):''}${t.dep?' · '+esc(t.dep):''}${t.arr?'–'+esc(t.arr):''}`).trim();}
    return [leg.eta?'ETA '+esc(leg.eta):'',leg.note?esc(leg.note):''].filter(Boolean).join(' · ')||'Auto';
  };
  const pvMatchKey=leg=>{
    if(!leg||!leg.type) return null;
    if(leg.type==='flug'){const n=(leg.data?.num||'').trim();return n?`flug_${n.toLowerCase()}`:null;}
    if(leg.type==='zug'){const n=(leg.data?.num||'').trim();return n?`zug_${n.toLowerCase()}`:null;}
    if(leg.type==='auto') return `auto_${(leg.note||'').trim().toLowerCase()}`;
    if(leg.type==='sonstiges'){const n=(leg.note||'').trim();return n?`son_${n.toLowerCase()}`:null;}
    return null;
  };
  const pvSortLegs=legs=>[...legs].sort((a,b)=>(a.data?.dep||a.data?.time||'').localeCompare(b.data?.dep||b.data?.time||''));
  const pvBuildChronoLegs=(tRaw,jRaw)=>{
    const tLegs=pvSortLegs(Array.isArray(tRaw)?tRaw:(tRaw&&tRaw.type?[tRaw]:[]));
    const jLegs=pvSortLegs(Array.isArray(jRaw)?jRaw:(jRaw&&jRaw.type?[jRaw]:[]));
    const usedT=new Set(),usedJ=new Set(),out=[];
    tLegs.forEach((l,i)=>{if(l?.sharedWithBoth){out.push({leg:l,who:'beide'});usedT.add(i);}});
    jLegs.forEach((l,i)=>{if(l?.sharedWithBoth&&!usedJ.has(i)){out.push({leg:l,who:'beide'});usedJ.add(i);}});
    const tMap=new Map();
    tLegs.forEach((l,i)=>{if(!usedT.has(i)&&l){const k=pvMatchKey(l);if(k)tMap.set(k,i);}});
    jLegs.forEach((l,i)=>{if(!usedJ.has(i)&&l){const k=pvMatchKey(l);if(k&&tMap.has(k)){const ti=tMap.get(k);out.push({leg:tLegs[ti],who:'beide'});usedT.add(ti);usedJ.add(i);}}});
    tLegs.forEach((l,i)=>{if(!usedT.has(i)&&l?.type)out.push({leg:l,who:'toja'});});
    jLegs.forEach((l,i)=>{if(!usedJ.has(i)&&l?.type)out.push({leg:l,who:'johann'});});
    return out.sort((a,b)=>(a.leg.data?.dep||a.leg.data?.time||'').localeCompare(b.leg.data?.dep||b.leg.data?.time||''));
  };
  const pvWhoColor={beide:'var(--purple)',toja:'var(--toja-color)',johann:'var(--johann-color)'};
  const pvWhoLabel={beide:'Beide',toja:'Toja',johann:'Johann'};
  const pvTrRows={an:pvBuildChronoLegs(tr.toja?.an||[],tr.johann?.an||[]),ab:pvBuildChronoLegs(tr.toja?.ab||[],tr.johann?.ab||[])};
  const hasTr=pvTrRows.an.length>0||pvTrRows.ab.length>0;
  if(hasTr){
    html+=`<div class="pv-block" style="margin-bottom:8px"><div class="pv-block-title">Transport</div>`;
    DIRS.forEach(d=>{
      const rows=pvTrRows[d];
      if(!rows.length)return;
      const label=d==='an'?'Anreise':'Abreise';
      html+=`<div style="font-size:0.68rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin:6px 0 3px">${label}</div>`;
      rows.forEach(({leg,who})=>{
        const s=pvLegRow(leg);
        if(!s)return;
        html+=`<div style="font-size:0.78rem;margin-bottom:3px"><span style="font-weight:700;color:${pvWhoColor[who]}">${pvWhoLabel[who]}</span> <span style="color:var(--text2)">${s}</span></div>`;
      });
    });
    html+=`</div>`;
  }

  if(ev.subevents&&ev.subevents.length){
    const sortedSubs=[...ev.subevents].sort((a,b)=>((a.date||'')+(a.time||'')).localeCompare((b.date||'')+(b.time||'')));
    html+=`<div class="pv-block" style="margin-bottom:8px"><div class="pv-block-title">Subevents (${ev.subevents.length})</div>`+
      sortedSubs.map(s=>`<div style="border-bottom:1px solid var(--border);padding:7px 0;last-child{border:none}">
        <div style="font-size:0.85rem;font-weight:700;color:var(--text)">${esc(s.title)||'—'}</div>
        <div style="font-size:0.78rem;color:var(--text2)">${fmtD(s.date)}${s.time?' · '+esc(s.time):''} ${s.timeEnd?'– '+esc(s.timeEnd):''} ${s.location?'· '+navLink(s.location):''}</div>
        ${s.todos&&s.todos.length?`<div style="margin-top:4px">`+s.todos.map(t=>`<div style="font-size:0.75rem;color:${t.done?'var(--text3)':'var(--text2)'};text-decoration:${t.done?'line-through':'none'};display:flex;gap:5px;align-items:center;padding:1px 0">
          <span>${t.done?'✓':'○'}</span><span>${esc(t.text)}</span><span style="color:${ownerColors[t.owner||'beide']};font-weight:700;font-size:0.68rem">${ownerLabels[t.owner||'beide']}</span></div>`).join('')+'</div>':''}
      </div>`).join('')+`</div>`;
  }

  if(ev.accommodations&&ev.accommodations.length){
    html+=`<div class="pv-block" style="margin-bottom:8px"><div class="pv-block-title">Unterkunft</div>`+
      ev.accommodations.map(a=>`<div style="font-size:0.78rem;padding:4px 0;border-bottom:1px solid var(--border)">
        <strong style="color:var(--text)">${esc(a.name)||'—'}</strong>
        ${a.cinDate||a.coutDate?`<span style="color:var(--text2)"> · ${a.cinDate?fmtD(a.cinDate):''}${a.coutDate?' – '+fmtD(a.coutDate):''}</span>`:''}
        ${a.cinTime||a.coutTime?`<div style="color:var(--text2);margin-top:1px">${a.cinTime?'Check-in: '+esc(a.cinTime):''}${a.cinTime&&a.coutTime?' · ':''}${a.coutTime?'Check-out: '+esc(a.coutTime):''}</div>`:''}
        ${a.addr?`<div style="margin-top:3px">${navLink(a.addr)}</div>`:''}
        ${a.ref?`<div style="margin-top:2px;color:var(--text2)">Buchungsreferenz: <span style="font-family:monospace;color:var(--text)">${esc(a.ref)}</span></div>`:''}
        ${(sl=>sl?`<div style="margin-top:2px"><a href="${sl}" target="_blank" rel="noopener noreferrer" style="color:var(--blue);font-size:0.75rem;word-break:break-all">🔗 Buchungslink</a></div>`:'')(safeUrl(a.link))}
        ${a.notes?`<div style="color:var(--text2);margin-top:2px">${esc(a.notes)}</div>`:''}
      </div>`).join('')+`</div>`;
  }

  if(ev.attachments&&ev.attachments.length){
    html+=`<div class="pv-block"><div class="pv-block-title">Anhänge</div><div style="display:flex;flex-wrap:wrap;gap:6px">`+
      ev.attachments.map(a=>a.type&&a.type.startsWith('image/')?
        `<img src="${safeDataImg(a.data)}" style="width:60px;height:60px;object-fit:cover;border-radius:4px;border:1px solid var(--border)">`
        :`<div style="width:60px;height:60px;background:var(--surface3);border:1px solid var(--border);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:1.3rem">📄</div>`
      ).join('')+`</div></div>`;
  }

  document.getElementById('pvBody').innerHTML=html;
  const hasMap=(ev.lat&&ev.lon)||(ev.accommodations&&ev.accommodations.some(a=>a.lat))||(ev.subevents&&ev.subevents.some(s=>s.lat));
  const pvMapBtn=document.getElementById('pvMapBtn');
  if(pvMapBtn){pvMapBtn.style.display=hasMap?'':'none';if(hasMap)pvMapBtn.dataset.evId=id;}
  document.getElementById('previewModal').classList.add('open');
}
function editFromPv(){closeModal('previewModal');openModal(pvId);}
function openEventMapFromPv(id){closeModal('previewModal');openEventMap(id||pvId);}
function exportFromPv(){}  // export removed

// EXPORT



function buildSubIcs(parent,s){
  const stamp=nowTs();
  const uid=`sub-${parent.uid}-${(s.title||'').replace(/\s/g,'')}-${s.date||''}`;
  let ics=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Nous//Nous//DE\r\nCALSCALE:GREGORIAN\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:${stamp}\r\nSEQUENCE:0\r\n`;
  if(!s.time){ics+=`DTSTART;VALUE=DATE:${(s.date||'').replace(/-/g,'')}\r\nDTEND;VALUE=DATE:${(s.date||'').replace(/-/g,'')}\r\n`;}
  else{ics+=`DTSTART:${icsTs(s.date,s.time,false)}\r\n`;ics+=`DTEND:${icsTs(s.date,s.timeEnd||s.time,false)}\r\n`;}
  let desc=s.note||'';
  if(s.todos&&s.todos.length){const open=s.todos.filter(t=>!t.done);if(open.length)desc+=(desc?'\\n\\n':'')+'To-dos: '+open.map(t=>t.text).join(', ');}
  ics+=`SUMMARY:${s.title||'Subevent'} (${parent.title})\r\n`;
  if(s.location)ics+=`LOCATION:${s.location}\r\n`;
  if(desc)ics+=`DESCRIPTION:${desc}\r\n`;
  ics+=`END:VEVENT\r\nEND:VCALENDAR`;return ics;
}


function showToast(msg){
  const ex=document.querySelector('.toast');if(ex)ex.remove();
  const t=document.createElement('div');t.className='toast';t.textContent=msg;
  document.body.appendChild(t);setTimeout(()=>t.remove(),2800);
}

// ── UNIFIED EVENT DELEGATION ──────────────────────────────────────────────
// Replaces all inline onclick/onchange/oninput/onkeydown attributes.
// For static elements: data-action on the element itself.
// For dynamic elements (renderCard, addLeg, etc.): data-action on generated markup.
document.addEventListener('click', e=>{
  const t=e.target.closest('[data-action]');
  if(!t) return;
  const a=t.dataset.action;
  switch(a){
    // Auth / header
    case 'signIn': signIn(); break;
    case 'toggleHamburger': toggleHamburger(e); break;
    case 'openNewModal': openModal();closeHamburger(); break;
    case 'openInvites': openInvites(); break;
    case 'openPwModal': document.getElementById('pwModal').classList.add('open');closeHamburger(); break;
    case 'signOut': signOut(); break;
    // Tabs
    case 'switchTab': switchTab(t.dataset.tab,t); break;
    // Filters
    case 'toggleFilter': toggleFilter(t.dataset.filter,t); break;
    case 'toggleTimeFilter': toggleTimeFilter(t.dataset.filter); break;
    // Banners / nav
    case 'dismissConflictBanner': dismissConflictBanner(); break;
    case 'dismissConflict': e.stopPropagation(); dismissConflict(t.dataset.key); break;
    case 'calPrev': calPrev(); break;
    case 'calNext': calNext(); break;
    case 'calToday': calToday(); break;
    case 'copyStatusToOther':{
      const src=t.dataset.source;
      if(src==='toja'){const v=document.getElementById('f_statusToja')?.value;if(v){const j=document.getElementById('f_statusJohann');if(j)j.value=v;}}
      else{const v=document.getElementById('f_statusJohann')?.value;if(v){const tj=document.getElementById('f_statusToja');if(tj)tj.value=v;}}
      break;
    }
    // Modals
    case 'closeModal': closeModal(t.dataset.modal); break;
    case 'closeMapModal': closeModal('mapModal');if(mapInstance){mapInstance.remove();mapInstance=null;} break;
    case 'saveEvent': saveEvent(); break;
    case 'editFromPv': editFromPv(); break;
    case 'openEventMapFromPv': openEventMapFromPv(t.dataset.evId); break;
    case 'changePassword': changePassword(); break;
    // Confirm dialog
    case 'closeConfirmDialog': closeConfirmDialog(); break;
    case 'confirmDialogOk': confirmDialogOk(); break;
    // Nav picker
    case 'closeNavPicker': closeNavPicker(); break;
    case 'stopProp': e.stopPropagation(); break;
    case 'navPickerOpen': navPickerOpen(t.dataset.app); break;
    case 'openNav': openNav(t.dataset.addr,e); break;
    // Form sections
    case 'toggleModalSection': toggleModalSection(t); break;
    case 'toggleSection': e.stopPropagation(); toggleSection(t); break;
    // Form dynamic buttons
    case 'addTodo': addTodo(t.dataset.target); break;
    case 'addSub': addSub(); break;
    case 'addAccom': addAccom(); break;
    case 'addLeg': addLeg(t.dataset.person,t.dataset.dir); break;
    case 'copyDirLegs': copyDirLegs(t.dataset.toPerson,t.dataset.toDir,t.dataset.fromPerson,t.dataset.fromDir); break;
    // Todo interactions
    case 'toggleTodoFeed':
      e.stopPropagation();
      toggleTodo(t.dataset.evId,t.dataset.todoId);
      break;
    case 'toggleTodoCard':
      e.stopPropagation();
      toggleTodo(t.dataset.evId,t.dataset.todoId);
      break;
    case 'toggleTodoCb': toggleTodoCb(t.dataset.id); break;
    // Card interactions
    case 'toggleSel': e.stopPropagation(); toggleSel(t.dataset.evId); break;
    case 'toggleCardMenu': toggleCardMenu(t.dataset.evId,e); break;
    case 'openPreview': openPreview(t.dataset.evId); break;
    case 'openModal': e.stopPropagation(); openModal(t.dataset.evId); break;
    case 'openEventMap': openEventMap(t.dataset.evId); break;
    case 'delEvent': delEvent(t.dataset.evId); break;
    // Calendar
    case 'showCalDay': showCalDay(t.dataset.day); break;
    // Invites
    case 'acceptInvite': acceptInvite(t.dataset.evId); break;
    case 'declineInvite': declineInvite(t.dataset.evId); break;
    // Remove-self
    case 'removeSelf': document.getElementById(t.dataset.target)?.remove(); break;
    // Leg remove
    case 'removeLeg':
      document.getElementById('leg_block_'+t.dataset.lid)?.remove();
      renumberLegs(document.getElementById('legs_'+t.dataset.person+'_'+t.dataset.dir));
      break;
    // Flight lookup
    case 'lookupFlightLeg': lookupFlightLeg(t.dataset.lid); break;
    // Attachment remove
    case 'removeAtt':
      pendingAtt.splice(parseInt(t.dataset.idx),1);
      renderAttList();
      break;
  }
});

document.addEventListener('change', e=>{
  const t=e.target.closest('[data-action]');
  if(!t) return;
  const a=t.dataset.action;
  if(a==='toggleLegType') toggleLegType(t.dataset.lid);
  else if(a==='updateTodoOwnerStyle') updateTodoOwnerStyle(t);
});

document.addEventListener('input', e=>{
  const t=e.target.closest('[data-action]');
  if(!t) return;
  if(t.dataset.action==='addrSearchInput')
    addrSearch(t,t.dataset.dd,t.dataset.lat,t.dataset.lon);
});

document.addEventListener('keydown', e=>{
  const t=e.target.closest('[data-action]');
  if(!t) return;
  if(t.dataset.action==='flightKeydown'&&e.key==='Enter')
    lookupFlightLeg(t.dataset.lid);
});
