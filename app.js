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
// RLS is ACTIVE on nous_event/nous_activity and on the attachments bucket.
// Unauthenticated requests with the anon key alone are rejected by Supabase.
const SUPABASE_URL = 'https://uojnjhpvwmgslerallxj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_sTY9Fhw42eOQ-jSAD_pKNg_a8QhW6Vs';
// Eine Zeile pro Termin bzw. pro Protokolleintrag statt eines gemeinsamen JSON-Blobs.
const T_EVENT = 'nous_event';
const T_ACT   = 'nous_activity';
const T_ATTMIG = 'nous_attachment_migration';
// Anhänge liegen im Storage, nicht im Termin-JSON: Base64-Fotos hatten die
// Termin-Zeile auf 17 MB aufgebläht und damit jeden Sync-Vorgang lahmgelegt.
const BUCKET = 'attachments';
// Zahlungen gehören zu keinem Termin. Sie liegen deshalb in einer
// reservierten Zeile derselben Tabelle statt in einer eigenen — eine neue
// Tabelle hätte eine Migration samt RLS-Regeln auf der laufenden Datenbank
// verlangt. Die Zeile wird beim Laden herausgefiltert und erreicht die
// Terminlisten nie.
const LEDGER_ID = '__ledger__';
// ── FEATURE-SCHALTER: KOSTEN ───────────────────────────────────────────
// Die Kostenfunktion ist vollständig implementiert, aber vorerst stillgelegt:
// Sie soll erst live gehen, wenn geklärt ist, wie sie sich sauber in den
// übrigen Ablauf einfügt. Der Schalter blendet ausschließlich Bedienung und
// Anzeige aus. Bereits erfasste Kostenpositionen und Zahlungen bleiben
// gespeichert, werden weiter synchronisiert und beim Bearbeiten eines Termins
// unverändert übernommen — ein `true` hier genügt, um alles wieder sichtbar
// zu machen.
const FEATURE_KOSTEN = false;
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
let events=[],payments=[],editId=null,pendingAtt=[],pvId=null,selIds=new Set(),bulkMode=false,calY,calM,subCnt=0,todoCnt=0;
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
// Das Protokoll liegt als eine Zeile pro Eintrag in nous_activity.
// Anhängen kollidiert nie, deshalb entfällt das frühere Zusammenführen ganzer Listen.
function actRowToEntry(r){return{id:r.id,type:r.type,evTitle:r.ev_title,detail:r.detail,ts:r.ts,user:r.actor};}
function insertActivityEntry(entry){
  if(!entry||!entry.id||activityLog.some(a=>a.id===entry.id)) return false;
  activityLog.unshift(entry);
  activityLog.sort((a,b)=>String(b.ts||'').localeCompare(String(a.ts||'')));
  activityLog=activityLog.slice(0,200);
  saveActivity();
  return true;
}
async function loadActivityFromSupabase(){
  const{data,error}=await sb.from(T_ACT).select('id,type,ev_title,detail,ts,actor').order('ts',{ascending:false}).limit(200);
  if(error){reportSyncError('Aktivitäten konnten nicht geladen werden',error,true);return false;}
  activityLog=(data||[]).map(actRowToEntry);
  saveActivity();
  return true;
}
async function logActivity(type,evTitle,detail){
  const entry={id:'act_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),type,evTitle,detail,ts:new Date().toISOString(),user:currentUser||null};
  insertActivityEntry(entry);
  renderActivity();renderAktuellIfActive();
  const{error}=await sb.from(T_ACT).insert({id:entry.id,type,ev_title:evTitle,detail,ts:entry.ts,actor:currentUser||null});
  if(error) reportSyncError('Aktivität konnte nicht übertragen werden',error);
}
async function clearActivity(){
  if(!confirm('Aktivitätsprotokoll löschen?'))return;
  const{error}=await sb.from(T_ACT).delete().neq('id','');
  if(error){reportSyncError('Protokoll konnte nicht gelöscht werden',error);return;}
  activityLog=[];saveActivity();renderActivity();renderAktuellIfActive();showToast('Protokoll gelöscht');
}
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
// Solange die Kostenfunktion abgeschaltet ist, sollen auch die bereits
// protokollierten Kosten- und Zahlungsvorgänge nicht mehr im Update-Feed
// erscheinen. Gefiltert wird ausschließlich die Anzeige — das Protokoll
// selbst bleibt vollständig erhalten.
function isKostenActivity(a){
  return ((a&&a.evTitle)||'')==='Zahlung'||/^Ausgabe: /.test((a&&a.detail)||'');
}
function visibleActivity(){
  if(FEATURE_KOSTEN) return activityLog;
  return activityLog.filter(a=>!isKostenActivity(a)).map(a=>{
    const detail=String(a.detail||'').split(' · ').filter(part=>part!=='Kosten geändert').join(' · ');
    if(detail===a.detail) return a;
    return Object.assign({},a,{detail:detail||'Details aktualisiert'});
  });
}

function renderActivity(){
  const c=document.getElementById('activityFeed');if(!c)return;
  const acts=visibleActivity();
  if(!acts.length){
    c.innerHTML=`<div class="activity-empty"><div class="activity-empty-text">Noch keine Aktivität aufgezeichnet</div></div>`;
    return;
  }
  const icons={create:'+',edit:'~',delete:'×',todo:'✓',export:'↓'};
  const iconCls={create:'ai-create',edit:'ai-edit',delete:'ai-delete',todo:'ai-todo',export:'ai-edit'};
  c.innerHTML=acts.map(a=>{
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
  // Ersatzdarstellung für das Google-Maps-Symbol. Stand als onerror-Attribut im
  // HTML und wurde von der CSP blockiert, die Ersatzdarstellung kam nie.
  const gi=document.getElementById('gmapsIcon');
  if(gi){
    const fallback=()=>{if(gi.parentNode)gi.replaceWith(document.createTextNode('G'));};
    gi.addEventListener('error',fallback);
    if(gi.complete&&gi.naturalWidth===0) fallback();
  }
}
// Blendet die im Markup mit data-feature markierten Bereiche aus, solange
// der zugehörige Schalter aus ist.
function applyFeatureFlags(){
  if(FEATURE_KOSTEN) return;
  document.querySelectorAll('[data-feature="kosten"]').forEach(el=>{el.style.display='none';});
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
  // Sync-Zustand vollständig zurücksetzen, sonst schreibt eine neue Anmeldung
  // gegen einen Kanal und einen Cache der vorherigen Sitzung.
  remoteReady=false;
  if(syncRetryTimer){clearInterval(syncRetryTimer);syncRetryTimer=null;}
  if(syncChannel){try{sb.removeChannel(syncChannel);}catch(e){}syncChannel=null;}
  attUrlCache.clear();
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

// ── STORAGE ──
// Termine liegen als eine Zeile pro Termin in nous_event. Früher lag der gesamte
// Bestand in einem einzigen JSON-Blob: wer zuletzt speicherte, schrieb seine
// komplette Liste zurück und löschte damit die zwischenzeitlich vom anderen
// angelegten Termine. Zeilenweise Speicherung macht paralleles Arbeiten an
// verschiedenen Terminen konfliktfrei.

// Vor dem ersten erfolgreichen Laden darf nichts geschrieben werden: der lokale
// Cache kann veraltet sein und würde neuere Serverstände überschreiben.
let remoteReady=false;
let syncRetryTimer=null;

function setSyncState(ok){
  const el=document.getElementById('syncWarning');
  if(el) el.classList.toggle('vis',!ok);
}
// Sync-Fehler wurden bisher stillschweigend verschluckt — die App meldete
// „Gespeichert“, obwohl nichts beim anderen ankam. Jetzt werden sie sichtbar.
// Fehlgeschlagene Hintergrund-Abgleiche zeigen nur das Banner: sie laufen
// wiederholt, eine Meldung pro Versuch wäre reine Belästigung. Eine vom
// Nutzer ausgelöste Aktion meldet sich dagegen immer.
function reportSyncError(msg,err,quiet){
  console.error('[nous] '+msg,err);
  if(!quiet) showToast(msg);
  setSyncState(false);
}
function syncGuard(){
  if(remoteReady) return true;
  showToast('Synchronisierung läuft noch — bitte einen Moment');
  return false;
}
function renderAktuellIfActive(){
  try{if(document.getElementById('view-aktuell').classList.contains('active'))renderAktuell();}catch(e){}
}

// localStorage ist nur ein Anzeige-Cache für den Kaltstart. Anhänge gehören
// nicht hinein — sie sprengen das Quota, und der Fehler bliebe unbemerkt.
function slimAttachments(list){
  return (list||[]).map(a=>{
    const o={name:a.name,type:a.type};
    if(a.path)o.path=a.path;
    if(a.size)o.size=a.size;
    return o;
  });
}
const PAY_SK='nous_payments_v1';
function cacheEvents(){
  try{
    localStorage.setItem(SK,JSON.stringify(events.map(ev=>Object.assign({},ev,{attachments:slimAttachments(ev.attachments)}))));
    localStorage.setItem(PAY_SK,JSON.stringify(payments));
  }catch(e){console.warn('[nous] Events konnten nicht lokal zwischengespeichert werden',e);}
}
function readPaymentsRow(r){
  const list=r&&r.data&&r.data.payments;
  return Array.isArray(list)?list:[];
}
async function persistPayments(){
  if(!remoteReady) return false;
  const{error}=await sb.from(T_EVENT).upsert({id:LEDGER_ID,data:{ledger:true,payments},updated_by:currentUser||null});
  if(error){reportSyncError('Zahlung konnte nicht gespeichert werden',error);return false;}
  setSyncState(true);
  return true;
}

function rowToEvent(r){return Object.assign({},r.data,{id:r.id,updatedAt:r.updated_at});}
function eventToRow(ev){
  const data=Object.assign({},ev,{attachments:slimAttachments(ev.attachments)});
  delete data.updatedAt; // steht als Spalte in der Zeile, gesetzt von der Datenbank
  return {id:ev.id,data,updated_by:currentUser||null};
}

function renderEverything(){
  renderAll();
  try{if(document.getElementById('view-calendar').classList.contains('active'))renderCal();}catch(e){console.warn('[nous] renderCal fehlgeschlagen',e);}
  renderAktuellIfActive();
  try{if(document.getElementById('view-todos').classList.contains('active'))renderTodos();}catch(e){console.warn('[nous] renderTodos fehlgeschlagen',e);}
  try{if(document.getElementById('view-invites').classList.contains('active'))renderInvites();}catch(e){console.warn('[nous] renderInvites fehlgeschlagen',e);}
  if(FEATURE_KOSTEN){try{if(document.getElementById('view-kosten').classList.contains('active'))renderKosten();}catch(e){console.warn('[nous] renderKosten fehlgeschlagen',e);}}
  updateInviteBadge();
  hydrateAttachmentImages();
}
// Lokal zwischenspeichern und neu zeichnen. Das Schreiben zum Server erfolgt
// bewusst getrennt über persistEvent(), damit Fehler dort auffallen.
function saveData(){cacheEvents();renderEverything();}

async function persistEvent(ev){
  if(!remoteReady) return false;
  const{error}=await sb.from(T_EVENT).upsert(eventToRow(ev));
  if(error){reportSyncError('Termin konnte nicht gespeichert werden',error);return false;}
  setSyncState(true);
  return true;
}
// Weiches Löschen: die Zeile bleibt mit deleted=true stehen, damit das Löschen
// auch Geräte erreicht, die zwischenzeitlich offline waren.
async function persistEventDeleted(id){
  if(!remoteReady) return false;
  const{error}=await sb.from(T_EVENT).update({deleted:true,updated_by:currentUser||null}).eq('id',id);
  if(error){reportSyncError('Termin konnte nicht gelöscht werden',error);return false;}
  setSyncState(true);
  return true;
}

async function loadEventsFromSupabase(){
  const{data,error}=await sb.from(T_EVENT).select('id,data,updated_at,deleted');
  if(error){reportSyncError('Termine konnten nicht geladen werden',error,true);return false;}
  const rows=(data||[]).filter(r=>!r.deleted);
  payments=readPaymentsRow(rows.find(r=>r.id===LEDGER_ID));
  events=rows.filter(r=>r.id!==LEDGER_ID).map(rowToEvent);
  cacheEvents();
  return true;
}

// Der Server ist die Wahrheit: eingehende Zeilen werden unverändert übernommen.
function applyEventRow(r){
  if(r.id===LEDGER_ID){payments=r.deleted?[]:readPaymentsRow(r);return true;}
  const i=events.findIndex(e=>e.id===r.id);
  if(r.deleted){if(i<0)return false;events.splice(i,1);return true;}
  const ev=rowToEvent(r);
  if(i<0)events.push(ev);else events[i]=ev;
  return true;
}
function removeEventRow(id){
  const i=id?events.findIndex(e=>e.id===id):-1;
  if(i<0) return false;
  events.splice(i,1);
  return true;
}

async function reloadFromSupabase(){
  const ok=await loadEventsFromSupabase();
  if(ok){setSyncState(true);renderEverything();}
  return ok;
}
async function reloadActivityFromSupabase(){
  const ok=await loadActivityFromSupabase();
  if(ok){renderActivity();renderAktuellIfActive();}
  return ok;
}

// Solange der erste Ladeversuch scheitert, bleibt die App schreibgesperrt.
// Ohne Wiederholung bliebe sie das bis zum nächsten Neustart.
function scheduleSyncRetry(){
  if(syncRetryTimer) return;
  syncRetryTimer=setInterval(async()=>{
    if(!await loadEventsFromSupabase()) return;
    clearInterval(syncRetryTimer);syncRetryTimer=null;
    remoteReady=true;setSyncState(true);renderEverything();
    await reloadActivityFromSupabase();
    migrateLegacyAttachments();
  },15000);
}

let syncChannel=null;
function subscribeRealtime(){
  if(syncChannel){try{sb.removeChannel(syncChannel);}catch(e){}syncChannel=null;}
  // Realtime muss das Zugriffstoken der Sitzung kennen, sonst filtert RLS alles weg.
  try{Promise.resolve(sb.realtime.setAuth()).catch(e=>console.warn('[nous] Realtime-Auth',e));}
  catch(e){console.warn('[nous] Realtime-Auth',e);}
  syncChannel=sb.channel('nous-sync')
    .on('postgres_changes',{event:'*',schema:'public',table:T_EVENT},payload=>{
      let changed=false;
      if(payload.eventType==='DELETE') changed=removeEventRow(payload.old&&payload.old.id);
      else if(payload.new&&payload.new.id) changed=applyEventRow(payload.new);
      if(changed){cacheEvents();renderEverything();}
    })
    .on('postgres_changes',{event:'INSERT',schema:'public',table:T_ACT},payload=>{
      if(payload.new&&insertActivityEntry(actRowToEntry(payload.new))){renderActivity();renderAktuellIfActive();}
    })
    .subscribe(status=>{
      console.log('[Supabase] Realtime:',status);
      // Nach (Wieder-)Verbinden vollständig nachladen: während der Unterbrechung
      // gesendete Änderungen werden nicht nachgeliefert.
      if(status==='SUBSCRIBED'&&remoteReady){reloadFromSupabase();reloadActivityFromSupabase();}
      if(status==='CHANNEL_ERROR'||status==='TIMED_OUT') setSyncState(false);
    });
}

async function loadData(){
  try{const l=localStorage.getItem(SK);if(l)events=JSON.parse(l);}catch(e){console.warn('[nous] localStorage Fehler',e);}
  try{const l=localStorage.getItem(PAY_SK);if(l)payments=JSON.parse(l);}catch(e){console.warn('[nous] localStorage Fehler',e);}
  renderAll();renderCal();renderAktuell();updateInviteBadge();
  const[evOk]=await Promise.all([loadEventsFromSupabase(),loadActivityFromSupabase()]);
  remoteReady=evOk;
  setSyncState(evOk);
  renderEverything();renderActivity();
  subscribeRealtime();
  if(evOk) migrateLegacyAttachments();
  else scheduleSyncRetry();
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
const TABS_ORDER=['aktuell','calendar','todos','overview','kosten'].filter(t=>t!=='kosten'||FEATURE_KOSTEN);
let timeFilter='all';
let currentTab='aktuell';

function switchTab(n,el){
  if(n==='kosten'&&!FEATURE_KOSTEN){n='aktuell';el=null;}
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  if(el&&el.classList.contains('tab')) el.classList.add('active');
  else{const te=document.querySelector(`.tab[data-tab="${n}"]`);if(te)te.classList.add('active');}
  document.getElementById('view-'+n).classList.add('active');
  currentTab=n;
  const toolbar=document.getElementById('filterToolbar');
  if(toolbar) toolbar.style.display=FILTER_TABS.has(n)?'block':'none';
  const timeRow=document.getElementById('timeFilterRow');
  if(timeRow) timeRow.style.display=n==='overview'?'flex':'none';
  if(n==='calendar') renderCal();
  else if(n==='aktuell') renderAktuell();
  else if(n==='todos') renderTodos();
  else if(n==='kosten') renderKosten();
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

// Karte lohnt sich, sobald irgendein Ort hinterlegt ist – auch ohne gespeicherte
// Koordinaten, denn diese werden beim Öffnen der Karte nachgeschlagen.
function eventHasMapData(ev){
  if(!ev) return false;
  if((ev.lat&&ev.lon)||ev.location) return true;
  if((ev.accommodations||[]).some(a=>(a.lat&&a.lon)||a.addr)) return true;
  if((ev.subevents||[]).some(s=>(s.lat&&s.lon)||s.location)) return true;
  return PERSONS.some(p=>DIRS.some(d=>{
    const raw=(ev.transport&&ev.transport[p]&&ev.transport[p][d])||[];
    const legs=Array.isArray(raw)?raw:(raw&&raw.type?[raw]:[]);
    return legs.some(l=>l&&(l.type==='flug'||l.type==='zug')&&l.data&&(l.data.from||l.data.to));
  }));
}

// Geocoding mit lokalem Cache – hält die Nominatim-Last klein und macht
// wiederholtes Öffnen der Karte schnell.
const GEOCACHE_KEY='nous_geocache_v1';
let _geoCache=null,_geoLastCall=0;
function geoCache(){
  if(_geoCache) return _geoCache;
  try{_geoCache=JSON.parse(localStorage.getItem(GEOCACHE_KEY)||'{}');}catch(e){_geoCache={};}
  if(!_geoCache||typeof _geoCache!=='object') _geoCache={};
  return _geoCache;
}
async function geocodeCached(q){
  if(!q) return null;
  const key=String(q).trim().toLowerCase();
  if(!key) return null;
  const cache=geoCache();
  if(cache[key]) return cache[key];
  // Nominatim-Nutzungsrichtlinie: maximal eine Anfrage pro Sekunde
  const wait=1000-(Date.now()-_geoLastCall);
  if(wait>0) await new Promise(r=>setTimeout(r,wait));
  _geoLastCall=Date.now();
  const url=`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&accept-language=de`;
  const resp=await fetch(url);
  if(!resp.ok) return null;
  const data=await resp.json();
  if(!data||!data[0]) return null;
  const lat=parseFloat(data[0].lat),lon=parseFloat(data[0].lon);
  if(isNaN(lat)||isNaN(lon)) return null;
  cache[key]={lat,lon};
  const keys=Object.keys(cache);
  if(keys.length>300) delete cache[keys[0]];
  try{localStorage.setItem(GEOCACHE_KEY,JSON.stringify(cache));}catch(e){}
  return cache[key];
}

function openEventMap(evId){
  const ev=events.find(e=>e.id===evId); if(!ev) return;
  document.getElementById('mapModalTitle').textContent=ev.title;
  document.getElementById('mapModal').classList.add('open');

  setTimeout(async()=>{
    const container=document.getElementById('mapContainer');
    if(!container) return;
    if(mapInstance){mapInstance.remove();mapInstance=null;}

    mapInstance=L.map('mapContainer',{zoomControl:true});
    // Kachel-Quelle ohne API-Key (CartoDB-Basemaps verlangen inzwischen einen Schlüssel
    // und liefern sonst nur noch ein "API KEY REQUIRED"-Wasserzeichen zurück).
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende',
      maxZoom:19
    }).addTo(mapInstance);
    let tileErrLogged=false;
    tiles.on('tileerror',()=>{ if(!tileErrLogged){tileErrLogged=true;console.warn('[nous] Kartenkacheln konnten nicht geladen werden');} });

    const markers=[];

    function mkIcon(html,size=16){
      return L.divIcon({html,className:'',iconSize:[size,size],iconAnchor:[size/2,size/2]});
    }
    // Tropfenförmiger Pin mit Symbol – ersetzt die früheren, im Code leeren Icons,
    // die zu unsichtbaren Markern geführt haben.
    function mkPin(color,glyph){
      return L.divIcon({
        className:'',
        html:`<div style="position:relative;width:28px;height:36px">`+
             `<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">`+
             `<path d="M14 1C7.4 1 2 6.3 2 12.9 2 21.4 14 35 14 35s12-13.6 12-22.1C26 6.3 20.6 1 14 1z" fill="${color}" stroke="#fff" stroke-width="2"/></svg>`+
             `<div style="position:absolute;left:0;top:5px;width:28px;display:flex;align-items:center;justify-content:center">${glyph}</div>`+
             `</div>`,
        iconSize:[28,36],iconAnchor:[14,36],popupAnchor:[0,-32]
      });
    }
    const GLYPH_PLANE='<svg width="15" height="15" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>';
    const GLYPH_TRAIN='<svg width="15" height="15" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 2c-4 0-8 .5-8 4v9.5A3.5 3.5 0 0 0 7.5 19L6 20.5v.5h12v-.5L16.5 19a3.5 3.5 0 0 0 3.5-3.5V6c0-3.5-3.6-4-8-4zM7.5 17A1.5 1.5 0 1 1 9 15.5 1.5 1.5 0 0 1 7.5 17zM11 10H6V6h5zm2 0V6h5v4zm3.5 7a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5z"/></svg>';
    const GLYPH_BED='<svg width="15" height="15" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M7 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9a4 4 0 0 0-4-4z"/></svg>';
    function fitMap(){
      if(!mapInstance) return;
      if(!markers.length){mapInstance.setView([48.1,11.6],5);return;}
      if(markers.length===1){mapInstance.setView(markers[0].getLatLng(),13);return;}
      mapInstance.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
    }
    // Das Modal wird eingeblendet, während die Karte entsteht: Leaflet misst dann eine
    // falsche Containergröße, wodurch Kacheln fehlen und Marker verschoben wirken.
    function refit(){
      if(!mapInstance) return;
      mapInstance.invalidateSize({animate:false});
      fitMap();
    }
    mapInstance.whenReady(()=>requestAnimationFrame(refit));
    setTimeout(refit,350);
    if(window.ResizeObserver){
      const ro=new ResizeObserver(()=>{ if(mapInstance) mapInstance.invalidateSize({animate:false}); });
      ro.observe(container);
      mapInstance.on('unload',()=>ro.disconnect());
    }

    // Hauptort
    const evIcon=mkIcon(`<div style="width:16px;height:16px;border-radius:50%;background:${STATUS_COLORS[ev.status]||'#0f6cbd'};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35)"></div>`);
    const evDates=ev.multiday?`${fmtD(ev.dateFrom)} – ${fmtD(ev.dateTo)}`:fmtD(ev.date);
    const evPopup=`<strong>${esc(ev.title)}</strong><br>${evDates}`;
    // Orte ohne gespeicherte Koordinaten (z.B. frei eingetippte Adressen) werden
    // unten nachgeschlagen, statt einfach von der Karte zu verschwinden.
    const pending=[];
    if(ev.lat&&ev.lon){
      const m=L.marker([parseFloat(ev.lat),parseFloat(ev.lon)],{icon:evIcon}).addTo(mapInstance);
      m.bindPopup(evPopup).openPopup();
      markers.push(m);
    } else if(ev.location){
      pending.push({searchQ:resolveAddr(ev.location)||ev.location,icon:evIcon,popup:evPopup,open:true});
    }

    // Subevents
    (ev.subevents||[]).forEach(s=>{
      const icon=mkIcon(`<div style="width:12px;height:12px;border-radius:50%;background:#5c2e91;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>`,12);
      const popup=`<strong>${esc(s.title)||'Subevent'}</strong><br>${fmtD(s.date)}${s.time?' · '+esc(s.time):''}`;
      if(s.lat&&s.lon){
        const m=L.marker([parseFloat(s.lat),parseFloat(s.lon)],{icon}).addTo(mapInstance);
        m.bindPopup(popup);
        markers.push(m);
      } else if(s.location){
        pending.push({searchQ:s.location,icon,popup});
      }
    });

    // Unterkünfte
    (ev.accommodations||[]).forEach(ac=>{
      const icon=mkPin('#a4262c',GLYPH_BED);
      const popup=`<strong>${esc(ac.name)||'Unterkunft'}</strong>${ac.addr?'<br>'+esc(ac.addr):''}${ac.cinDate?'<br>Check-in: '+fmtD(ac.cinDate):''}`;
      if(ac.lat&&ac.lon){
        const m=L.marker([parseFloat(ac.lat),parseFloat(ac.lon)],{icon}).addTo(mapInstance);
        m.bindPopup(popup);
        markers.push(m);
      } else if(ac.addr){
        pending.push({searchQ:ac.addr,icon,popup});
      }
    });

    // Bekannte Marker sofort zeigen; alles Weitere wird unten geokodiert
    fitMap();

    // Collect relevant transport locations:
    // Anreise → arrival airport/station of the LAST leg (final destination near the event)
    // Abreise → departure airport/station of the FIRST leg (nearest to the event)
    // Connections/layovers in between are excluded.
    const seen=new Set();
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
          pending.push({searchQ:resolveAddr(q)||q,icon:mkPin('#0f6cbd',GLYPH_PLANE),popup:`<strong>${esc(q)}</strong><br>Flughafen`});
        } else if(leg.type==='zug'&&leg.data){
          const q=d==='an'?leg.data.to:leg.data.from;
          if(!q||seen.has(q)) return;
          seen.add(q);
          pending.push({searchQ:q+' Bahnhof',icon:mkPin('#038387',GLYPH_TRAIN),popup:`<strong>${esc(q)}</strong><br>Bahnhof`});
        }
      });
    });

    if(!pending.length) return;

    // Nacheinander geokodieren – Nominatim erlaubt nur eine Anfrage pro Sekunde.
    const thisMap=mapInstance;
    for(const loc of pending){
      if(mapInstance!==thisMap) return;
      try{
        const pos=await geocodeCached(loc.searchQ);
        if(!pos||mapInstance!==thisMap) continue;
        const m=L.marker([pos.lat,pos.lon],{icon:loc.icon}).addTo(mapInstance);
        m.bindPopup(loc.popup);
        if(loc.open) m.openPopup();
        markers.push(m);
        fitMap();
      }catch(e){console.warn('[nous] Kartenmarkierung konnte nicht gesetzt werden',e);}
    }

    if(mapInstance===thisMap) refit();
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
  const recentActs=visibleActivity().slice(0,10);

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

  // Section: Kosten — nur der Saldo, Details im eigenen Tab
  const aktOpen=FEATURE_KOSTEN?openPositions():[];
  if(FEATURE_KOSTEN&&(aktOpen.length||payments.length)){
    const aktBal=totalBalanceCents();
    html+=`<div class="aktuell-section"><div class="aktuell-section-title">Kosten</div>
      <div class="bal-card" style="margin-bottom:0">
        <div>
          <div class="bal-amount ${balanceClass(aktBal)}">${balanceText(aktBal)}</div>
          <div style="font-size:0.72rem;color:var(--text3);margin-top:3px">${aktOpen.length} ${aktOpen.length===1?'Position':'Positionen'} · ${fmtEur(sumTotal(aktOpen.map(x=>x.exp)))} Kosten</div>
        </div>
        <button class="btn-secondary" data-action="switchTab" data-tab="kosten" style="font-size:0.78rem;padding:0 14px;min-height:38px;border-radius:8px;white-space:nowrap">Details</button>
      </div></div>`;
  }

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

// ── KOSTEN / AUSLAGEN ──────────────────────────────────────────────────
// Je Position wird festgehalten, wer verauslagt hat (paidBy) und wer die
// Kosten trägt (bearer: beide je zur Hälfte, oder eine Person allein).
// Erst daraus ergibt sich der Saldo — wer wem wie viel schuldet.
// Beträge stehen in Euro; gerechnet wird durchgehend in Cent, damit sich
// keine Rundungsfehler aufsummieren.
function parseAmount(str){
  if(str==null) return NaN;
  const t=String(str).replace(/[€\s]/g,'').replace(/\.(?=\d{3}(\D|$))/g,'').replace(',','.');
  if(!t) return NaN;
  return /^-?\d+(\.\d+)?$/.test(t)?parseFloat(t):NaN;
}
function expCents(e){
  const n=Number(e&&e.amount);
  return Number.isFinite(n)?Math.round(n*100):0;
}
function fmtEur(cents){
  return (cents/100).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
}
// Anteil, den `person` an dieser Position zu tragen hat (in Cent)
function expShareCents(e,person){
  const c=expCents(e);
  const bearer=e.bearer||'beide';
  if(bearer==='beide'){
    const half=Math.round(c/2);
    return person==='johann'?half:c-half;
  }
  return bearer===person?c:0;
}
// Saldo dieser Position: positiv = Johann schuldet Toja, negativ = umgekehrt
function expBalanceCents(e){
  const c=expCents(e);
  if(!c) return 0;
  if(e.paidBy==='toja') return expShareCents(e,'johann');
  if(e.paidBy==='johann') return -expShareCents(e,'toja');
  return 0;
}
function eventExpenses(ev){return Array.isArray(ev.expenses)?ev.expenses:[];}
// Alle Positionen über alle Termine, jeweils mit ihrem Termin
function allExpenses(){
  const out=[];
  events.forEach(ev=>eventExpenses(ev).forEach(exp=>out.push({ev,exp})));
  return out;
}
function sumBalance(list){return list.reduce((s,e)=>s+expBalanceCents(e),0);}
function sumTotal(list){return list.reduce((s,e)=>s+expCents(e),0);}
// Eine Zahlung von Johann an Toja verringert Johanns Schuld und umgekehrt
function paymentCents(p){
  const n=Number(p&&p.amount);
  return Number.isFinite(n)?Math.round(n*100):0;
}
function paymentBalanceCents(p){
  const c=paymentCents(p);
  return p.from==='johann'?-c:c;
}
function paymentsBalance(list){return (list||[]).reduce((s,p)=>s+paymentBalanceCents(p),0);}
// Positionen, die in den Saldo eingehen. settledAt stammt aus der früheren
// Alles-oder-nichts-Abrechnung; solche Posten gelten als erledigt.
function openPositions(){return allExpenses().filter(x=>expCents(x.exp)&&!x.exp.settledAt);}
function totalBalanceCents(){
  return sumBalance(openPositions().map(x=>x.exp))+paymentsBalance(payments);
}
function paymentDirText(p){
  return p.from==='johann'?'Johann → Toja':'Toja → Johann';
}
// Datum, unter dem eine Position zeitlich einsortiert wird
function expenseDate(ev,exp){return (exp&&exp.date)||evPrimaryDate(ev)||'';}
function lastPaymentDate(){
  return payments.reduce((m,p)=>(p.date&&p.date>m)?p.date:m,'');
}
function balanceText(cents){
  if(cents===0) return 'Ausgeglichen';
  return cents>0?`Johann schuldet Toja ${fmtEur(cents)}`:`Toja schuldet Johann ${fmtEur(-cents)}`;
}
function balanceClass(cents){return cents===0?'bal-even':cents>0?'bal-toja':'bal-johann';}
const BEARER_LABEL={beide:'beide je zur Hälfte',toja:'Toja allein',johann:'Johann allein'};

// ── ANWESENHEIT JE PERSON ──────────────────────────────────────────────
// Ein gemeinsamer Termin kann für Toja und Johann an unterschiedlichen Tagen
// beginnen und enden (ev.personDates). dateFrom/dateTo bleiben dabei die
// Klammer über beide Anwesenheiten, damit Listen, Filter und Kalender
// unverändert mit einem Zeitraum je Termin rechnen können.
function evRange(ev){
  const from=ev.dateFrom||ev.date||'';
  if(!from) return null;
  return {from,to:ev.dateTo||ev.date||from};
}
// true, sobald mindestens eine Person vom Gesamtzeitraum abweicht
function hasPersonDates(ev){
  if((ev.owner||'gemeinsam')!=='gemeinsam'||!ev.personDates) return false;
  const full=evRange(ev);
  if(!full) return false;
  return PERSONS.some(p=>{
    const d=ev.personDates[p];
    return d&&d.from&&d.to&&(d.from!==full.from||d.to!==full.to);
  });
}
// Zeitraum, in dem `person` bei diesem Termin anwesend ist; null = nicht beteiligt
function personRange(ev,person){
  const full=evRange(ev);
  if(!full) return null;
  const owner=ev.owner||'gemeinsam';
  if(owner!=='gemeinsam') return owner===person?full:null;
  const d=ev.personDates&&ev.personDates[person];
  return (d&&d.from&&d.to)?{from:d.from,to:d.to}:full;
}
function personPresentOn(ev,person,ds){
  const r=personRange(ev,person);
  return !!r&&ds>=r.from&&ds<=r.to;
}
function presentPersons(ev,ds){return PERSONS.filter(p=>personPresentOn(ev,p,ds));}
// Überschneidung zweier Termine aus Sicht einer Person; null = keine
function personOverlap(a,b,person,aRange){
  const ra=aRange||personRange(a,person), rb=personRange(b,person);
  if(!ra||!rb) return null;
  const from=ra.from>rb.from?ra.from:rb.from;
  const to=ra.to<rb.to?ra.to:rb.to;
  return from<=to?{from,to}:null;
}
function personLabel(p){return p==='toja'?'Toja':'Johann';}
// Farbige Zeitraumzeile je Person — nur wenn es tatsächlich Abweichungen gibt
function personDatesHtml(ev){
  if(!hasPersonDates(ev)) return '';
  const col={toja:'var(--toja-color)',johann:'var(--johann-color)'};
  return PERSONS.map(p=>{
    const r=personRange(ev,p);
    return `<span style="color:${col[p]};font-weight:700">${personLabel(p)}</span> ${fmtD(r.from)} – ${fmtD(r.to)}`;
  }).join(' &nbsp;·&nbsp; ');
}

const CONFLICT_SK='nous_dismissed_conflicts_v1';
let dismissedConflictKeys=new Set(JSON.parse(localStorage.getItem(CONFLICT_SK)||'[]'));
let conflictingEventIds=new Set();

function saveDismissedConflicts(){
  try{localStorage.setItem(CONFLICT_SK,JSON.stringify([...dismissedConflictKeys]));}catch(e){}
}
function todayStr(){return _ds(new Date());}
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

  const today=todayStr();

  // Only true multi-day events (at least 2 distinct days) that are not fully in the past
  const multiEvs=events.filter(ev=>ev.multiday&&ev.dateFrom&&ev.dateTo&&ev.dateTo>ev.dateFrom&&ev.dateTo>=today);

  const dateMap={};
  multiEvs.forEach(ev=>{
    let d=new Date(ev.dateFrom+'T00:00:00');
    const end=new Date(ev.dateTo+'T00:00:00');
    while(d<=end){
      const ds=_ds(d);
      // Conflicts on past days are irrelevant
      if(ds>=today){
        if(!dateMap[ds]) dateMap[ds]=[];
        dateMap[ds].push(ev);
      }
      d.setDate(d.getDate()+1);
    }
  });

  const conflicts=[];
  conflictingEventIds=new Set();
  Object.entries(dateMap).forEach(([date,evs])=>{
    if(evs.length<2) return;
    const conflicting=new Set();
    // Anwesenheit einmal je Termin bestimmen, nicht in jedem Paarvergleich
    const present=new Map(evs.map(ev=>[ev,presentPersons(ev,date)]));
    for(let i=0;i<evs.length;i++){
      for(let j=i+1;j<evs.length;j++){
        const pA=present.get(evs[i]), pB=present.get(evs[j]);
        // Kollision nur, wenn dieselbe Person an diesem Tag bei beiden da ist
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

// ── TRANSPORT: BEIDE PERSONEN ZU EINER LISTE ───────────────────────────
// Fahren beide dieselbe Strecke, soll sie einmal als „Beide" erscheinen und
// nicht zweimal je Person. Zusammengeführt wird über den Haken „gemeinsam"
// und, wo der fehlt, über Flug-/Zugnummer bzw. Notiz.
function legMatchKey(leg){
  if(!leg||!leg.type) return null;
  if(leg.type==='flug'){const n=(leg.data?.num||'').trim();return n?`flug_${n.toLowerCase()}`:null;}
  if(leg.type==='zug'){const n=(leg.data?.num||'').trim();return n?`zug_${n.toLowerCase()}`:null;}
  if(leg.type==='auto') return `auto_${(leg.note||'').trim().toLowerCase()}`;
  if(leg.type==='sonstiges'){const n=(leg.note||'').trim();return n?`son_${n.toLowerCase()}`:null;}
  return null;
}
function legTime(leg){return leg?.data?.dep||leg?.data?.time||'';}
function sortLegsByTime(legs){return [...legs].sort((a,b)=>legTime(a).localeCompare(legTime(b)));}
function mergeLegs(tRaw,jRaw){
  const tLegs=sortLegsByTime(Array.isArray(tRaw)?tRaw:(tRaw&&tRaw.type?[tRaw]:[]));
  const jLegs=sortLegsByTime(Array.isArray(jRaw)?jRaw:(jRaw&&jRaw.type?[jRaw]:[]));
  const usedT=new Set(),usedJ=new Set(),out=[];
  tLegs.forEach((l,i)=>{if(l?.sharedWithBoth){out.push({leg:l,who:'beide'});usedT.add(i);}});
  jLegs.forEach((l,i)=>{if(l?.sharedWithBoth&&!usedJ.has(i)){out.push({leg:l,who:'beide'});usedJ.add(i);}});
  const tMap=new Map();
  tLegs.forEach((l,i)=>{if(!usedT.has(i)&&l){const k=legMatchKey(l);if(k)tMap.set(k,i);}});
  jLegs.forEach((l,i)=>{if(!usedJ.has(i)&&l){const k=legMatchKey(l);if(k&&tMap.has(k)){const ti=tMap.get(k);out.push({leg:tLegs[ti],who:'beide'});usedT.add(ti);usedJ.add(i);}}});
  tLegs.forEach((l,i)=>{if(!usedT.has(i)&&l?.type)out.push({leg:l,who:'toja'});});
  jLegs.forEach((l,i)=>{if(!usedJ.has(i)&&l?.type)out.push({leg:l,who:'johann'});});
  return out.sort((a,b)=>legTime(a.leg).localeCompare(legTime(b.leg)));
}

// ── ZEITLEISTE EINES TERMINS ───────────────────────────────────────────
// Anreise, Unterkunft, Sub-Events und Abreise standen bisher nach Kategorie
// sortiert untereinander — die Abreise also vor den Sub-Events, die sie
// zeitlich abschließt. Hier werden sie stattdessen in die Reihenfolge
// gebracht, in der sie tatsächlich stattfinden, und nach Tagen gruppiert.
//
// Nicht jeder Eintrag trägt ein Datum: Auto- und Sonstiges-Etappen haben
// keines, und Zeiten dürfen fehlen. Fehlt das Datum, wird es aus der
// Richtung erschlossen (Anreise → erster Tag, Abreise → letzter Tag);
// fehlt die Uhrzeit, ordnet die Art den Eintrag innerhalb des Tages ein.
const TL_PRIO={an:0,checkin:1,accom:1,sub:2,checkout:3,ab:4};
const TL_FALLBACK_TIME={an:'00:00',checkin:'00:01',accom:'00:01',sub:'00:02',checkout:'23:58',ab:'23:59'};
function evFirstDate(ev){return ev.multiday?(ev.dateFrom||ev.date||''):(ev.date||ev.dateFrom||'');}
function evLastDate(ev){return ev.multiday?(ev.dateTo||ev.dateFrom||ev.date||''):(ev.date||ev.dateFrom||'');}
function buildEventTimeline(ev){
  const items=[];
  const push=(kind,date,time,payload)=>{
    items.push(Object.assign({kind,date:date||'',time:time||'',
      sortTime:time||TL_FALLBACK_TIME[kind]||'12:00',prio:TL_PRIO[kind]??2},payload));
  };
  const tr=ev.transport||{};
  DIRS.forEach(d=>{
    const fallback=d==='an'?evFirstDate(ev):evLastDate(ev);
    mergeLegs(tr.toja?.[d]||[],tr.johann?.[d]||[]).forEach(({leg,who})=>{
      push(d,leg.data?.date||fallback,legTime(leg)||leg.eta||'',{leg,who,dir:d});
    });
  });
  (ev.accommodations||[]).forEach(a=>{
    if(a.cinDate||a.coutDate){
      if(a.cinDate||a.cinTime) push('checkin',a.cinDate||evFirstDate(ev),a.cinTime,{accom:a});
      if(a.coutDate||a.coutTime) push('checkout',a.coutDate||evLastDate(ev),a.coutTime,{accom:a});
    } else {
      // Ohne Datumsangabe lässt sich kein Check-in erfinden: die Unterkunft
      // erscheint dann als ein Eintrag zu Beginn des Termins.
      push('accom',evFirstDate(ev),'',{accom:a});
    }
  });
  (ev.subevents||[]).forEach(sub=>{ push('sub',sub.date,sub.time,{sub}); });

  const dated=items.filter(i=>i.date).sort((a,b)=>
    a.date.localeCompare(b.date)||a.sortTime.localeCompare(b.sortTime)||a.prio-b.prio);
  const undated=items.filter(i=>!i.date);
  const days=[];
  dated.forEach(i=>{
    const last=days[days.length-1];
    if(last&&last.date===i.date) last.items.push(i);
    else days.push({date:i.date,items:[i]});
  });
  return {days,undated,count:items.length};
}

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
  const ppHtml=personDatesHtml(e);
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
  const trWhoColor={beide:'var(--purple)',toja:'var(--toja-color)',johann:'var(--johann-color)'};
  const trWhoLabel={beide:'Beide',toja:'Toja',johann:'Johann'};
  const trRows={an:mergeLegs(tr.toja?.an||[],tr.johann?.an||[]),ab:mergeLegs(tr.toja?.ab||[],tr.johann?.ab||[])};
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

  const cardExps=FEATURE_KOSTEN?eventExpenses(e).filter(x=>expCents(x)):[];
  if(cardExps.length){
    const openExps=cardExps.filter(x=>!x.settledAt);
    const bal=sumBalance(openExps);
    sections+=`<div class="card-section">
      <div class="card-section-toggle" data-action="toggleSection">
        <span class="card-section-title">Kosten (${cardExps.length}) — ${fmtEur(sumTotal(cardExps))}</span>
        <span class="card-section-arrow">▾</span>
      </div>
      <div class="card-section-body">
        ${cardExps.slice(0,4).map(x=>`<div class="sub-row"><div class="sub-dot" style="background:var(--blue);opacity:0.5"></div><span>${esc(x.desc)||'—'} · ${fmtEur(expCents(x))} · <span style="color:var(--${x.paidBy}-color);font-weight:700">${personLabel(x.paidBy)}</span>${x.settledAt?' · abgerechnet':''}</span></div>`).join('')}
        ${cardExps.length>4?`<div style="font-size:0.72rem;color:var(--text3);margin-top:2px">+${cardExps.length-4} weitere</div>`:''}
        <div style="font-size:0.74rem;margin-top:4px" class="${balanceClass(bal)}"><strong>${openExps.length?balanceText(bal):'Alles abgerechnet'}</strong></div>
      </div>
    </div>`;
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
        <div class="att-row">${e.attachments.map(a=>a.type&&a.type.startsWith('image/')?`<div class="att-thumb">${attImgTag(a,'')}</div>`:`<div class="att-thumb">📄</div>`).join('')}</div>
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
        ${ppHtml?`<div class="card-meta" style="margin-top:2px;font-size:0.72rem">${ppHtml}</div>`:''}
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
              ${FEATURE_KOSTEN?`<div class="card-menu-item" data-action="openExpenseModal" data-ev-id="${e.id}">Ausgabe hinzufügen</div>`:''}
              ${eventHasMapData(e)?`<div class="card-menu-item" data-action="openEventMap" data-ev-id="${e.id}">Karte</div>`:''}
            </div>
          </div>
        </div>
      </div>
    </div>
    ${sections}
  </div>`;
}

// TOGGLE TODO IN CARD
async function toggleTodo(evId,todoId){
  if(!syncGuard()) return;
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
  saveData();
  // Erst übertragen, dann protokollieren: sonst meldet das Protokoll eine
  // Änderung, die beim anderen nie angekommen ist.
  if(!await persistEvent(ev)){await reloadFromSupabase();return;}
  logActivity('todo',ev.title,`To-do ${todo.done?'erledigt':'wieder geöffnet'}: „${todo.text}"`);
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
      // Tagesgenaue Einfärbung: gemeinsame Tage grün, Alleintage in Personenfarbe
      const present=presentPersons(b.ev,ds);
      const owner=b.ev.owner||'gemeinsam';
      const segCls=owner!=='gemeinsam'?`bar-ow-${owner}`
        :present.length===1?`bar-ow-${present[0]}`
        :present.length===0?'bar-absent':'bar-ow-gemeinsam';
      const cls=`cal-bar-segment ${segCls}${isSolo?' bar-solo':isStart?' bar-start':isEnd?' bar-end':isRowStart?' bar-row-start':''}`;
      const top=26+b.row*16;
      const label=(isStart||isRowStart)?`<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;display:block">${esc(b.ev.title)||SL[b.ev.status]||''}</span>`:`<span></span>`;
      barsHtml+=`<div class="${cls}" style="position:absolute;top:${top}px;left:${isStart||isRowStart?'2px':'0'};right:${isEnd?'2px':'0'};pointer-events:auto;overflow:hidden" data-action="showCalDay" data-day="${ds}" title="${esc(b.ev.title)}${hasPersonDates(b.ev)?' · '+esc(present.length?present.map(personLabel).join(' + '):'niemand anwesend'):''}">${label}</div>`;
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
  hydrateAttachmentImages();
}

// ── KOSTEN-ANSICHT ─────────────────────────────────────────────────────
// 'alle' = sämtliche Positionen, 'seit' = nur die nach der letzten Zahlung
let kostenScope='alle';
function setKostenScope(v){kostenScope=v;renderKosten();}

function renderKosten(){
  if(!FEATURE_KOSTEN) return;
  const feed=document.getElementById('kostenFeed');
  if(!feed) return;
  const positions=openPositions();
  const bal=totalBalanceCents();
  const paidSum=payments.reduce((s,p)=>s+paymentCents(p),0);

  let html=`<div class="bal-card">
    <div>
      <div class="bal-label">Saldo</div>
      <div class="bal-amount ${balanceClass(bal)}">${balanceText(bal)}</div>
      <div style="font-size:0.72rem;color:var(--text3);margin-top:3px">${fmtEur(sumTotal(positions.map(x=>x.exp)))} Kosten · ${fmtEur(paidSum)} gezahlt</div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn-primary" data-action="openExpenseModal" style="font-size:0.78rem;padding:0 14px;min-height:38px;border-radius:8px;white-space:nowrap">+ Ausgabe</button>
      <button class="btn-secondary" data-action="openPaymentModal" style="font-size:0.78rem;padding:0 14px;min-height:38px;border-radius:8px;white-space:nowrap">Zahlung erfassen</button>
    </div>
  </div>`;

  // Positionen je Termin — vollständige Historie, jüngster Termin zuerst
  const cutoff=lastPaymentDate();
  const useScope=kostenScope==='seit'&&cutoff;
  const shown=useScope?positions.filter(x=>expenseDate(x.ev,x.exp)>cutoff):positions;
  html+=`<div class="aktuell-section"><div class="aktuell-section-title">Positionen</div>`;
  if(cutoff){
    html+=`<div class="exp-filter">
      <div class="filter-chip${kostenScope==='alle'?' active':''}" data-action="setKostenScope" data-scope="alle">Alle</div>
      <div class="filter-chip${kostenScope==='seit'?' active':''}" data-action="setKostenScope" data-scope="seit">Seit letzter Zahlung</div>
    </div>`;
  }
  if(!shown.length){
    html+=`<div class="aktuell-today-empty">${useScope?'Seit der letzten Zahlung nichts angefallen':'Keine Kostenpositionen erfasst'}</div>`;
  } else {
    const byEvent=new Map();
    shown.forEach(({ev,exp})=>{
      if(!byEvent.has(ev.id)) byEvent.set(ev.id,{ev,list:[]});
      byEvent.get(ev.id).list.push(exp);
    });
    html+=[...byEvent.values()]
      .sort((a,b)=>(evPrimaryDate(b.ev)||'').localeCompare(evPrimaryDate(a.ev)||''))
      .map(({ev,list})=>{
        const gb=sumBalance(list);
        return `<div class="exp-group">
          <div class="exp-group-title" data-action="openPreview" data-ev-id="${ev.id}">${esc(ev.title)}</div>
          <div class="exp-group-sub">${ev.multiday?fmtD(ev.dateFrom)+' – '+fmtD(ev.dateTo):fmtD(ev.date)}</div>
          ${list.map(x=>`<div class="exp-row">
            <div class="exp-row-main">
              <div>${esc(x.desc)||'—'}${x.date?` <span class="exp-row-meta" style="display:inline">· ${fmtD(x.date)}</span>`:''}</div>
              <div class="exp-row-meta">verauslagt: <span style="color:var(--${x.paidBy}-color);font-weight:700">${personLabel(x.paidBy)}</span> · getragen: ${BEARER_LABEL[x.bearer||'beide']}</div>
            </div>
            <span class="exp-row-amount">${fmtEur(expCents(x))}</span>
          </div>`).join('')}
          <div class="exp-row" style="border-top:1px solid var(--border);margin-top:5px;padding-top:5px">
            <span class="${balanceClass(gb)}" style="font-weight:700">${balanceText(gb)}</span>
            <span class="exp-row-amount">${fmtEur(sumTotal(list))}</span>
          </div>
        </div>`;
      }).join('');
  }
  html+=`</div>`;

  // Geleistete Zahlungen
  html+=`<div class="aktuell-section"><div class="aktuell-section-title">Zahlungen</div>`;
  if(!payments.length){
    html+=`<div class="aktuell-today-empty">Noch keine Zahlungen erfasst</div>`;
  } else {
    html+=`<div class="exp-group">`+[...payments]
      .sort((a,b)=>(b.date||'').localeCompare(a.date||''))
      .map(p=>`<div class="pay-row">
        <div class="exp-row-main">
          <div class="pay-dir" style="color:var(--${p.from}-color)">${paymentDirText(p)}</div>
          <div class="exp-row-meta">${p.date?fmtD(p.date):'ohne Datum'}${p.note?' · '+esc(p.note):''}</div>
        </div>
        <span class="exp-row-amount">${fmtEur(paymentCents(p))}</span>
        <button class="remove-todo" data-action="askDeletePayment" data-pay-id="${esc(p.id)}" title="Zahlung löschen">✕</button>
      </div>`).join('')+`</div>`;
  }
  html+=`</div>`;

  // Positionen aus der früheren Alles-oder-nichts-Abrechnung
  const legacy=allExpenses().filter(x=>expCents(x.exp)&&x.exp.settledAt);
  if(legacy.length){
    html+=`<div class="aktuell-section"><div class="aktuell-section-title">Früher abgerechnet</div>
      <div class="exp-group">
        <div class="exp-row"><div class="exp-row-main">
          <div>${legacy.length} ${legacy.length===1?'Position':'Positionen'} aus einer früheren Abrechnung</div>
          <div class="exp-row-meta">Gehen nicht in den Saldo ein. Sie stehen weiterhin beim jeweiligen Termin.</div>
        </div><span class="exp-row-amount">${fmtEur(sumTotal(legacy.map(x=>x.exp)))}</span></div>
      </div></div>`;
  }
  feed.innerHTML=html;
}

// ── AUSGABE SCHNELL ERFASSEN ───────────────────────────────────────────
// Ausgaben fallen unterwegs an. Sie sollen sich erfassen lassen, ohne den
// ganzen Termin zu öffnen: Betrag, Zweck, fertig — der Rest ist vorbelegt.
// Reihenfolge der Terminauswahl: laufende zuerst, dann kommende, dann
// vergangene. Der wahrscheinlichste Termin steht damit oben.
function expensePickerEvents(){
  const today=todayStr();
  const withRange=events.map(ev=>{
    const from=ev.multiday?(ev.dateFrom||''):(ev.date||'');
    const to=(ev.multiday?(ev.dateTo||ev.dateFrom):(ev.date||''))||from;
    return {ev,from,to};
  });
  const byFrom=(a,b)=>a.from.localeCompare(b.from);
  const running=withRange.filter(x=>x.from&&x.from<=today&&x.to>=today).sort(byFrom);
  const upcoming=withRange.filter(x=>x.from>today).sort(byFrom);
  const past=withRange.filter(x=>x.from&&x.to<today).sort((a,b)=>b.to.localeCompare(a.to));
  const undated=withRange.filter(x=>!x.from);
  return [...running,...upcoming,...past,...undated].map(x=>x.ev);
}
function openExpenseModal(evId){
  if(!FEATURE_KOSTEN) return;
  const list=expensePickerEvents();
  if(!list.length){showToast('Bitte zuerst einen Termin anlegen');return;}
  const sel=document.getElementById('q_event');
  if(!sel) return;
  sel.innerHTML=list.map(ev=>{
    const ds=ev.multiday?`${fmtD(ev.dateFrom)} – ${fmtD(ev.dateTo)}`:fmtD(ev.date);
    return `<option value="${esc(ev.id)}">${esc(ev.title)||'—'}${ds?' · '+ds:''}</option>`;
  }).join('');
  sel.value=(evId&&list.some(ev=>ev.id===evId))?evId:list[0].id;
  document.getElementById('q_amount').value='';
  document.getElementById('q_desc').value='';
  document.getElementById('q_date').value=todayStr();
  document.getElementById('q_paid').value=currentUser||'toja';
  _quickBearerTouched=false;
  syncQuickBearer();
  document.getElementById('expenseModal').classList.add('open');
  // Direkt in den Betrag springen — auf dem iPhone öffnet das die Tastatur
  setTimeout(()=>document.getElementById('q_amount').focus(),50);
}
// Bei Terminen für eine Person trägt im Zweifel diese Person die Kosten.
// Sobald der Nutzer die Kostentragung selbst gesetzt hat, bleibt seine Wahl
// stehen — ein Terminwechsel darf eine bewusste Angabe nicht überschreiben.
let _quickBearerTouched=false;
function markQuickBearerTouched(){_quickBearerTouched=true;}
function syncQuickBearer(){
  if(_quickBearerTouched) return;
  const ev=events.find(e=>e.id===document.getElementById('q_event')?.value);
  const owner=(ev&&ev.owner)||'gemeinsam';
  const b=document.getElementById('q_bearer');
  if(b) b.value=owner==='gemeinsam'?'beide':owner;
}
async function saveQuickExpense(){
  if(!syncGuard()) return;
  const ev=events.find(e=>e.id===document.getElementById('q_event').value);
  if(!ev){showToast('Bitte einen Termin wählen');return;}
  const amount=parseAmount(document.getElementById('q_amount').value);
  if(!Number.isFinite(amount)||amount<=0){showToast('Bitte einen gültigen Betrag eingeben');return;}
  const desc=document.getElementById('q_desc').value.trim();
  if(!desc){showToast('Bitte angeben, wofür');return;}
  const exp={
    id:'x_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    desc,amount,
    paidBy:document.getElementById('q_paid').value,
    bearer:document.getElementById('q_bearer').value,
    date:document.getElementById('q_date').value||'',
    settledAt:''
  };
  const before=eventExpenses(ev);
  ev.expenses=[...before,exp];
  saveData();
  if(!await persistEvent(ev)){ev.expenses=before;saveData();return;}
  closeModal('expenseModal');
  logActivity('edit',ev.title,`Ausgabe: ${desc} · ${fmtEur(expCents(exp))} · verauslagt ${personLabel(exp.paidBy)}`);
  showToast(`${fmtEur(expCents(exp))} erfasst`);
  renderEverything();
}

// ── ZAHLUNG ERFASSEN ───────────────────────────────────────────────────
function openPaymentModal(){
  if(!FEATURE_KOSTEN) return;
  const bal=totalBalanceCents();
  const fromEl=document.getElementById('p_from');
  const amtEl=document.getElementById('p_amount');
  const dateEl=document.getElementById('p_date');
  const noteEl=document.getElementById('p_note');
  const hint=document.getElementById('p_hint');
  if(!fromEl) return;
  // Vorbelegung: der Schuldner zahlt den offenen Saldo an den anderen
  fromEl.value=bal<0?'toja':'johann';
  amtEl.value=bal?(Math.abs(bal)/100).toFixed(2).replace('.',','):'';
  dateEl.value=todayStr();
  noteEl.value='';
  hint.textContent=bal?`Offener Saldo: ${balanceText(bal)}`:'Der Saldo ist ausgeglichen.';
  document.getElementById('paymentModal').classList.add('open');
}
async function savePayment(){
  if(!syncGuard()) return;
  const amount=parseAmount(document.getElementById('p_amount').value);
  if(!Number.isFinite(amount)||amount<=0){showToast('Bitte einen gültigen Betrag eingeben');return;}
  const p={
    id:'p_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    from:document.getElementById('p_from').value,
    amount,
    date:document.getElementById('p_date').value||todayStr(),
    note:document.getElementById('p_note').value.trim()
  };
  payments.push(p);
  cacheEvents();
  if(!await persistPayments()){payments=payments.filter(x=>x.id!==p.id);cacheEvents();return;}
  closeModal('paymentModal');
  logActivity('edit','Zahlung',`${paymentDirText(p)} · ${fmtEur(paymentCents(p))}${p.note?' · '+p.note:''}`);
  showToast('Zahlung erfasst');
  renderEverything();
}
function askDeletePayment(id){
  const p=payments.find(x=>x.id===id);
  if(!p) return;
  askConfirm('Zahlung löschen?',`${paymentDirText(p)} · ${fmtEur(paymentCents(p))} — der Saldo ändert sich entsprechend.`,'Löschen',()=>deletePayment(id));
}
async function deletePayment(id){
  if(!syncGuard()) return;
  const before=payments;
  const p=payments.find(x=>x.id===id);
  if(!p) return;
  payments=payments.filter(x=>x.id!==id);
  cacheEvents();
  if(!await persistPayments()){payments=before;cacheEvents();return;}
  logActivity('delete','Zahlung',`${paymentDirText(p)} · ${fmtEur(paymentCents(p))} gelöscht`);
  showToast('Zahlung gelöscht');
  renderEverything();
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
    // Konfliktprüfung aus Sicht der eingeladenen Person: es zählen nur Tage, an
    // denen sie bei beiden Terminen anwesend wäre — und nur solche in der Zukunft.
    const today=todayStr();
    const inviteeRange=personRange(ev,currentUser)||evRange(ev);
    const conflicts=events.map(e=>{
      if(e.id===ev.id) return null;
      const ov=personOverlap(ev,e,currentUser,inviteeRange);
      return (ov&&ov.to>=today)?{ev:e,ov}:null;
    }).filter(Boolean);
    const conflictHtml=conflicts.length?`<div class="invite-conflict">
      <div class="invite-conflict-title">Terminierungskonflikt (${conflicts.length})</div>
      ${conflicts.map(({ev:c,ov})=>`<div class="invite-conflict-item">· ${esc(c.title)} – ${ov.from===ov.to?fmtD(ov.from):fmtD(ov.from)+' – '+fmtD(ov.to)}</div>`).join('')}
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

async function acceptInvite(id){
  if(!syncGuard()) return;
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
  saveData();
  if(!await persistEvent(ev)){await reloadFromSupabase();return;}
  logActivity('edit',ev.title,`Einladung angenommen – Termin jetzt Gemeinsam`);
  showToast('Einladung angenommen');
  renderInvites();
  updateInviteBadge();
}

async function declineInvite(id){
  if(!syncGuard()) return;
  const ev=events.find(e=>e.id===id);
  if(!ev||!ev.invite) return;
  ev.invite.status='declined';
  saveData();
  if(!await persistEvent(ev)){await reloadFromSupabase();return;}
  logActivity('edit',ev.title,'Einladung abgelehnt');
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
  document.getElementById('expensesContainer').innerHTML='';
  updateExpensesSummary();
  const fInvite=document.getElementById('f_invite');if(fInvite){fInvite.checked=false;fInvite.disabled=false;}
  const fSplit=document.getElementById('f_splitDates');if(fSplit)fSplit.checked=false;
  PERSONS.forEach(p=>['f_from_','f_to_'].forEach(pre=>{const el=document.getElementById(pre+p);if(el)el.value='';}));
  togglePerPersonDates();
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
  // Populate per-person arrival/departure
  const fSplit=document.getElementById('f_splitDates');
  if(fSplit){
    const pd=ev.personDates;
    const on=!!(pd&&PERSONS.every(p=>pd[p]&&pd[p].from&&pd[p].to));
    fSplit.checked=on;
    PERSONS.forEach(p=>{
      const f=document.getElementById(`f_from_${p}`), t=document.getElementById(`f_to_${p}`);
      if(f) f.value=on?pd[p].from:'';
      if(t) t.value=on?pd[p].to:'';
    });
    togglePerPersonDates();
  }
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
  document.getElementById('expensesContainer').innerHTML='';
  if(FEATURE_KOSTEN) eventExpenses(ev).forEach(x=>addExpense(x));
  updateExpensesSummary();
}

function autoDetectMultiday(){
  const from=document.getElementById('f_dateFrom').value;
  const to=document.getElementById('f_dateTo').value;
  const isM=!!(to&&to>from);
  document.getElementById('singleDate').style.display=isM?'none':'block';
  updatePerPersonVisibility();
}
function toggleAllday(){document.getElementById('timeGroup').style.display=document.getElementById('f_allday').checked?'none':'block';}

// ── ABWEICHENDE AN-/ABREISE JE PERSON (Formular) ────────────────────────
// Nur sinnvoll bei mehrtägigen, gemeinsamen Terminen: bei einem Einzeltag oder
// einem Termin für nur eine Person gibt es nichts zu unterscheiden.
function updatePerPersonVisibility(){
  const sec=document.getElementById('perPersonDatesSection');
  if(!sec) return;
  const owner=document.getElementById('f_owner')?.value||'gemeinsam';
  const from=document.getElementById('f_dateFrom')?.value||'';
  const to=document.getElementById('f_dateTo')?.value||'';
  // Nicht abwählen, nur ausblenden — beim Wiederherstellen des Zeitraums
  // stehen die Eingaben dann noch. Gespeichert wird nur, was sichtbar gilt.
  sec.style.display=(owner==='gemeinsam'&&to&&to>from)?'':'none';
}
function togglePerPersonDates(){
  const on=!!document.getElementById('f_splitDates')?.checked;
  const box=document.getElementById('perPersonDatesFields');
  if(box) box.style.display=on?'':'none';
  if(!on) return;
  const from=document.getElementById('f_dateFrom')?.value||'';
  const to=document.getElementById('f_dateTo')?.value||from;
  PERSONS.forEach(p=>{
    const f=document.getElementById(`f_from_${p}`), t=document.getElementById(`f_to_${p}`);
    if(f&&!f.value) f.value=from;
    if(t&&!t.value) t.value=to;
  });
}
// Der Gesamtzeitraum ist die Klammer über beide Anwesenheiten und wird
// mitgezogen, sobald jemand früher anreist oder später abreist.
function syncSplitDates(){
  if(!document.getElementById('f_splitDates')?.checked) return;
  const fromEl=document.getElementById('f_dateFrom'), toEl=document.getElementById('f_dateTo');
  if(!fromEl||!toEl) return;
  let min=fromEl.value, max=toEl.value||fromEl.value;
  PERSONS.forEach(p=>{
    const f=document.getElementById(`f_from_${p}`)?.value||'';
    const t=document.getElementById(`f_to_${p}`)?.value||'';
    if(f&&(!min||f<min)) min=f;
    if(t&&(!max||t>max)) max=t;
  });
  if(min&&min!==fromEl.value) fromEl.value=min;
  if(max&&min&&max>min&&max!==toEl.value) toEl.value=max;
  autoDetectMultiday();syncSubDates();
}
// Übernimmt Ankunfts-/Abreisetag aus den erfassten Transport-Teilstrecken:
// Ankunft = letzte Teilstrecke der Anreise, Abreise = erste der Abreise.
function datesFromTransport(person){
  const legDate=l=>(l&&l.data&&l.data.date)||'';
  const sorted=dir=>collectLegs(person,dir).filter(legDate)
    .sort((a,b)=>(legDate(a)+(a.data.dep||'')).localeCompare(legDate(b)+(b.data.dep||'')));
  const an=sorted('an'), ab=sorted('ab');
  const from=an.length?legDate(an[an.length-1]):'';
  const to=ab.length?legDate(ab[0]):'';
  if(!from&&!to){showToast(`Kein Transport mit Datum für ${personLabel(person)} hinterlegt`);return;}
  if(from){const el=document.getElementById(`f_from_${person}`);if(el)el.value=from;}
  if(to){const el=document.getElementById(`f_to_${person}`);if(el)el.value=to;}
  syncSplitDates();
  showToast(`An-/Abreise ${personLabel(person)} aus Transport übernommen`);
}
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
  updatePerPersonVisibility();
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

// KOSTENPOSITIONEN IM FORMULAR
let expCnt=0;
function addExpense(data){
  expCnt++;
  const rowId='exp_'+expCnt;
  const c=document.getElementById('expensesContainer');
  if(!c) return;
  const paid=(data&&data.paidBy)||currentUser||'toja';
  const owner=document.getElementById('f_owner')?.value||'gemeinsam';
  // Bei Terminen für eine Person trägt im Zweifel diese Person die Kosten
  const bearer=(data&&data.bearer)||(owner==='gemeinsam'?'beide':owner);
  const amount=data&&Number.isFinite(Number(data.amount))?Number(data.amount).toFixed(2).replace('.',','):'';
  const settled=(data&&data.settledAt)||'';
  const div=document.createElement('div');
  div.className='exp-item'+(settled?' settled':'');
  div.id=rowId;
  div.dataset.expId=(data&&data.id)||'x_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  div.dataset.settledAt=settled;
  const dis=settled?' disabled':'';
  div.innerHTML=`
    <input type="text" class="exp-desc" placeholder="Wofür?" value="${esc(data?.desc||'')}"${dis}>
    <input type="text" class="exp-amount" inputmode="decimal" placeholder="0,00" value="${esc(amount)}"${dis}>
    <span class="exp-tag">bezahlt</span>
    <select class="exp-paid ow-${paid}" data-action="updateExpStyle"${dis}>
      <option value="toja" ${paid==='toja'?'selected':''}>Toja</option>
      <option value="johann" ${paid==='johann'?'selected':''}>Johann</option>
    </select>
    <span class="exp-tag">getragen</span>
    <select class="exp-bearer ow-${bearer}" data-action="updateExpStyle"${dis}>
      <option value="beide" ${bearer==='beide'?'selected':''}>Beide</option>
      <option value="toja" ${bearer==='toja'?'selected':''}>Toja</option>
      <option value="johann" ${bearer==='johann'?'selected':''}>Johann</option>
    </select>
    <input type="date" class="exp-date" value="${esc(data?.date||'')}"${dis}>
    ${settled
      ?`<span class="exp-settled-tag" title="Am ${esc(fmtAbsTime(settled))} abgerechnet">✓ abgerechnet</span>`
      :`<button type="button" class="remove-todo" data-action="removeExpense" data-target="${rowId}">✕</button>`}`;
  c.appendChild(div);
  updateExpensesSummary();
}
function updateExpStyle(sel){
  const base=sel.classList.contains('exp-paid')?'exp-paid':'exp-bearer';
  sel.className=base+' ow-'+sel.value;
  updateExpensesSummary();
}
function removeExpense(id){
  document.getElementById(id)?.remove();
  updateExpensesSummary();
}
function collectExpenses(){
  return Array.from(document.querySelectorAll('#expensesContainer .exp-item')).map(item=>{
    const raw=item.querySelector('.exp-amount').value.trim();
    return {
      id:item.dataset.expId,
      desc:item.querySelector('.exp-desc').value.trim(),
      amount:raw?parseAmount(raw):0,
      paidBy:item.querySelector('.exp-paid').value,
      bearer:item.querySelector('.exp-bearer').value,
      date:item.querySelector('.exp-date')?.value||'',
      settledAt:item.dataset.settledAt||''
    };
  }).filter(e=>e.desc||e.amount);
}
// Laufende Zusammenfassung unter den Zeilen — der Saldo soll schon beim
// Eintragen sichtbar sein, nicht erst nach dem Speichern.
function updateExpensesSummary(){
  const el=document.getElementById('expensesSummary');
  if(!el) return;
  const list=collectExpenses().filter(e=>Number.isFinite(e.amount)&&e.amount);
  if(!list.length){el.textContent='';return;}
  const open=list.filter(e=>!e.settledAt);
  const bal=sumBalance(open);
  const settledCount=list.length-open.length;
  el.innerHTML=`Gesamt ${fmtEur(sumTotal(list))} · <span class="${balanceClass(bal)}" style="font-weight:700">${balanceText(bal)}</span>`
    +(settledCount?` · ${settledCount} bereits abgerechnet`:'');
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
// safeDataPdf: validate base64 PDF data URI before embedding.
function safeDataPdf(data){
  return typeof data==='string'&&/^data:application\/pdf;base64,/.test(data)?data:'';
}

// ── ANHÄNGE IM STORAGE ──
// Anhänge werden als Datei im privaten Bucket abgelegt; im Termin steht nur
// noch {name, type, path, size}. Der Bucket ist privat, Bilder werden deshalb
// über kurzlebige signierte URLs geladen und diese im Speicher zwischengehalten.
const ATT_PIXEL='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const attUrlCache=new Map();

function dataUriToBytes(dataUri){
  const b64=String(dataUri||'').split(',')[1];
  if(!b64) return null;
  const raw=atob(b64);
  const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
  return bytes;
}

async function attSignedUrls(paths){
  const wanted=[...new Set((paths||[]).filter(Boolean))];
  const now=Date.now();
  const missing=wanted.filter(p=>{const c=attUrlCache.get(p);return !c||c.exp<now;});
  if(missing.length){
    const{data,error}=await sb.storage.from(BUCKET).createSignedUrls(missing,3600);
    if(error) console.warn('[nous] Signierte URLs fehlgeschlagen',error);
    else (data||[]).forEach(d=>{
      if(d&&d.signedUrl&&!d.error) attUrlCache.set(d.path,{url:d.signedUrl,exp:now+50*60*1000});
    });
  }
  const out={};
  wanted.forEach(p=>{const c=attUrlCache.get(p);if(c)out[p]=c.url;});
  return out;
}

// Bild-Tags werden zunächst mit einem Platzhalter gerendert und die signierte
// URL danach nachgereicht — signieren ist asynchron, Rendern ist es nicht.
function attImgTag(a,attrs){
  if(a&&a.data) return `<img src="${safeDataImg(a.data)}" ${attrs}>`;
  if(a&&a.path) return `<img src="${ATT_PIXEL}" data-att-path="${esc(a.path)}" ${attrs}>`;
  return `<img src="${ATT_PIXEL}" ${attrs}>`;
}
async function hydrateAttachmentImages(){
  const els=[...document.querySelectorAll('img[data-att-path]')];
  if(!els.length) return;
  const map=await attSignedUrls(els.map(el=>el.dataset.attPath));
  els.forEach(el=>{
    const url=map[el.dataset.attPath];
    if(url){el.src=url;el.removeAttribute('data-att-path');}
  });
}

// Fotos aus dem Telefon sind mehrere Megabyte groß. Ohne Verkleinerung wächst
// der Bestand wieder so weit, dass jeder Abgleich unbrauchbar langsam wird.
const ATT_MAX_EDGE=2000, ATT_QUALITY=0.82, ATT_COMPRESS_ABOVE=900*1024;
async function compressImage(file){
  if(!file.type.startsWith('image/')||file.type==='image/gif') return file;
  try{
    const bmp=await createImageBitmap(file);
    const scale=Math.min(1,ATT_MAX_EDGE/Math.max(bmp.width,bmp.height));
    if(scale===1&&file.size<=ATT_COMPRESS_ABOVE){bmp.close&&bmp.close();return file;}
    const w=Math.round(bmp.width*scale),h=Math.round(bmp.height*scale);
    const c=document.createElement('canvas');c.width=w;c.height=h;
    c.getContext('2d').drawImage(bmp,0,0,w,h);
    bmp.close&&bmp.close();
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',ATT_QUALITY));
    if(!blob||blob.size>=file.size) return file;
    return new File([blob],String(file.name||'bild').replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'});
  }catch(e){console.warn('[nous] Bildkomprimierung übersprungen',e);return file;}
}

async function uploadAttachment(evId,a){
  const bytes=dataUriToBytes(a.data);
  if(!bytes) throw new Error('Anhang ohne Inhalt: '+(a.name||''));
  const ext=(String(a.type||'').split('/')[1]||'bin').replace('jpeg','jpg');
  const path=`${evId}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
  const{error}=await sb.storage.from(BUCKET).upload(path,new Blob([bytes],{type:a.type}),{contentType:a.type,upsert:false});
  if(error) throw error;
  return {name:a.name,type:a.type,path,size:bytes.length};
}
async function uploadPendingAttachments(evId,list){
  const out=[];
  for(const a of (list||[])){
    if(a.path||!a.data){
      const kept={name:a.name,type:a.type};
      if(a.path)kept.path=a.path;
      if(a.size)kept.size=a.size;
      out.push(kept);
    } else out.push(await uploadAttachment(evId,a));
  }
  return out;
}
// Beim Entfernen eines Anhangs auch die Datei löschen, sonst bleiben Dateileichen zurück.
async function deleteRemovedAttachments(existing,next){
  const before=((existing&&existing.attachments)||[]).map(a=>a.path).filter(Boolean);
  if(!before.length) return;
  const after=new Set((next||[]).map(a=>a.path).filter(Boolean));
  const gone=before.filter(p=>!after.has(p));
  if(!gone.length) return;
  const{error}=await sb.storage.from(BUCKET).remove(gone);
  if(error) console.warn('[nous] Verwaiste Anhänge nicht entfernt',error);
}

// Einmalige Übernahme der Altbestände: die Base64-Anhänge liegen in einer
// Staging-Tabelle und wandern von dort in den Storage. claimed_at verhindert,
// dass beide Geräte dieselbe Datei gleichzeitig hochladen.
async function migrateLegacyAttachments(){
  try{
    const{data:rows,error}=await sb.from(T_ATTMIG).select('event_id,claimed_at');
    if(error||!rows||!rows.length) return;
    const cutoff=new Date(Date.now()-10*60*1000).toISOString();
    for(const row of rows){
      if(row.claimed_at&&row.claimed_at>cutoff) continue;
      const{data:claim}=await sb.from(T_ATTMIG).update({claimed_at:new Date().toISOString()})
        .eq('event_id',row.event_id).or(`claimed_at.is.null,claimed_at.lt."${cutoff}"`).select('event_id');
      if(!claim||!claim.length) continue;
      try{
        const{data:full,error:loadErr}=await sb.from(T_ATTMIG).select('attachments').eq('event_id',row.event_id).single();
        if(loadErr) throw loadErr;
        const uploaded=await uploadPendingAttachments(row.event_id,(full&&full.attachments)||[]);
        const ev=events.find(e=>e.id===row.event_id);
        if(ev){
          ev.attachments=uploaded;
          if(!await persistEvent(ev)) throw new Error('Termin konnte nach Anhang-Übernahme nicht gespeichert werden');
        }
        await sb.from(T_ATTMIG).delete().eq('event_id',row.event_id);
        saveData();
        showToast('Anhänge übernommen');
      }catch(e){
        console.error('[nous] Anhang-Übernahme fehlgeschlagen',e);
        await sb.from(T_ATTMIG).update({claimed_at:null}).eq('event_id',row.event_id);
      }
    }
  }catch(e){console.error('[nous] Anhang-Übernahme fehlgeschlagen',e);}
}

// ATTACHMENT LIGHTBOX
// Open a full-size preview when an attachment in the preview modal is tapped.
// Images are shown inline; PDFs open in a new tab via a blob URL (the strict
// CSP forbids framing data:/blob: URLs, so we can't embed them in-page).
let attBlobUrl=null;
function dataUriToBlobUrl(dataUri,mime){
  const bytes=dataUriToBytes(dataUri);
  return bytes?URL.createObjectURL(new Blob([bytes],{type:mime})):null;
}
function revokeAttBlob(){if(attBlobUrl){URL.revokeObjectURL(attBlobUrl);attBlobUrl=null;}}
async function openAttPreview(evId,idx){
  const ev=events.find(e=>e.id===evId);if(!ev||!ev.attachments)return;
  const a=ev.attachments[parseInt(idx,10)];if(!a)return;
  const content=document.getElementById('attLightboxContent');
  const nameEl=document.getElementById('attLightboxName');
  if(!content)return;
  revokeAttBlob();
  nameEl.textContent=a.name||'';
  const isImg=!!(a.type&&a.type.startsWith('image/'));
  // Anhänge aus dem Storage: signierte URL. Noch nicht hochgeladene Anhänge im
  // offenen Formular liegen weiterhin als Data-URI vor.
  let url='';
  if(a.path){
    const m=await attSignedUrls([a.path]);
    url=m[a.path]||'';
  }else if(a.data){
    if(isImg) url=safeDataImg(a.data);
    else{
      const src=safeDataPdf(a.data);
      if(src){attBlobUrl=dataUriToBlobUrl(src,'application/pdf');url=attBlobUrl||'';}
    }
  }
  if(!url){showToast('Vorschau nicht verfügbar');return;}
  if(isImg){
    content.innerHTML=`<img src="${esc(url)}" alt="${esc(a.name||'')}">`;
  }else if(a.type==='application/pdf'){
    content.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;gap:14px;color:#fff">
      <div style="font-size:3.5rem">📄</div>
      <a class="att-lightbox-dl" href="${esc(url)}" target="_blank" rel="noopener noreferrer">PDF in neuem Tab öffnen</a>
    </div>`;
  }else{
    showToast('Vorschau nicht verfügbar');return;
  }
  document.getElementById('attLightbox').classList.add('open');
}
function closeAttPreview(){
  const lb=document.getElementById('attLightbox');
  if(lb)lb.classList.remove('open');
  const content=document.getElementById('attLightboxContent');
  if(content)content.innerHTML='';
  revokeAttBlob();
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
const MAX_UPLOAD_IMAGE=25*1024*1024, MAX_UPLOAD_FILE=5*1024*1024;
function validateFile(file){
  if(!ALLOWED_UPLOAD_MIME.has(file.type)){showToast(`Dateityp nicht erlaubt: ${file.type||'unbekannt'}`);return false;}
  // Bilder werden vor dem Upload verkleinert, das Rohmaterial darf grösser sein.
  const max=file.type.startsWith('image/')?MAX_UPLOAD_IMAGE:MAX_UPLOAD_FILE;
  if(file.size>max){showToast(`Max. ${Math.round(max/1048576)} MB pro Datei`);return false;}
  return true;
}
// Bilder werden vor der Aufnahme verkleinert. Die Magic-Byte-Prüfung läuft
// gegen die komprimierte Fassung, die dann auch hochgeladen wird.
async function addAttachmentFiles(files){
  let added=0;
  for(const original of Array.from(files||[])){
    if(!validateFile(original)) continue;
    const file=await compressImage(original);
    const data=await toB64(file);
    if(!checkMagicB64(data,file.type)){showToast(`Dateiformat ungültig: ${file.type}`);continue;}
    pendingAtt.push({name:file.name||('bild_'+Date.now()+'.png'),type:file.type,data});
    added++;
  }
  if(added>0) renderAttList();
  return added;
}
async function handleFiles(input){await addAttachmentFiles(input.files);}
async function addFileObjects(files){
  const added=await addAttachmentFiles(files);
  if(added>0) showToast(`${added} Datei${added>1?'en':''} hinzugefügt`);
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
  const list=document.getElementById('attList');
  if(!list) return;
  list.innerHTML=pendingAtt.map((a,i)=>{
    const isImg=a.type&&a.type.startsWith('image/');
    return `<div class="att-item" style="${isImg?'flex-direction:column;align-items:flex-start;padding:6px 8px;gap:4px':''}">
      ${isImg?attImgTag(a,'style="width:100%;max-width:160px;max-height:100px;object-fit:cover;border-radius:3px;border:1px solid var(--border)"'):'📄'}
      <div style="display:flex;align-items:center;gap:5px;width:100%">
        <span style="flex:1;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.72rem">${esc(a.name)}</span>
        <span class="att-rm" data-action="removeAtt" data-idx="${i}">✕</span>
      </div>
    </div>`;
  }).join('');
  hydrateAttachmentImages();
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
  const flightNum=numEl.value.trim().replace(/\s/g,'').toUpperCase();
  const flightDate=dateEl&&dateEl.value?dateEl.value:'';
  const ask=async date=>{
    let url=`/.netlify/functions/aviationstack?flight_iata=${encodeURIComponent(flightNum)}&limit=1`;
    if(date) url+=`&flight_date=${encodeURIComponent(date)}`;
    const resp=await fetch(url);
    try{return await resp.json();}catch(e){return {error:{code:'',message:'Unlesbare Antwort'}};}
  };
  try{
    let data=await ask(flightDate);
    let ohneDatum=false;
    // Der Gratistarif deckt nur aktuelle Flüge ab. Wird das Datum abgelehnt,
    // liefert die Abfrage ohne Datum wenigstens Strecke und Planzeiten.
    if(flightDate&&data.error&&/restricted|not_supported|historical/i.test(data.error.code||'')){
      data=await ask('');
      ohneDatum=true;
    }
    if(data.error){
      showToast(flightErrorText(data.error));
      numEl.disabled=false;
      return;
    }
    if(!data.data||!data.data.length){
      showToast('Flug nicht gefunden — bitte manuell eingeben');
      numEl.disabled=false;
      return;
    }
    const f=data.data[0];
    const dep=f.departure||{},arr=f.arrival||{};
    const fromEl=document.getElementById(`leg_${lid}_flugfrom`);
    const toEl=document.getElementById(`leg_${lid}_flugto`);
    const depEl=document.getElementById(`leg_${lid}_flugdep`);
    const arrEl=document.getElementById(`leg_${lid}_flugarr`);
    if(fromEl) fromEl.value=dep.iata||'';
    if(toEl) toEl.value=arr.iata||'';
    if(dep.scheduled){
      const t=new Date(dep.scheduled);
      if(depEl) depEl.value=`${String(t.getUTCHours()).padStart(2,'0')}:${String(t.getUTCMinutes()).padStart(2,'0')}`;
      if(dateEl&&!dateEl.value&&!ohneDatum) dateEl.value=t.toISOString().slice(0,10);
    }
    if(arr.scheduled){
      const t=new Date(arr.scheduled);
      if(arrEl) arrEl.value=`${String(t.getUTCHours()).padStart(2,'0')}:${String(t.getUTCMinutes()).padStart(2,'0')}`;
    }
    showToast(`${flightNum}: ${dep.iata||'?'}→${arr.iata||'?'}${ohneDatum?' (aktueller Flugplan)':''}`);
  }catch(e){
    showToast('Flugabfrage nicht erreichbar');
  }
  numEl.disabled=false;
}
// Aus dem Fehlercode von AviationStack eine Meldung machen, mit der man etwas
// anfangen kann. Bisher hieß jeder Fehlschlag „Flug nicht gefunden".
function flightErrorText(err){
  const code=(err&&err.code)||'';
  const map={
    not_configured:'Flugabfrage nicht eingerichtet (Schlüssel fehlt in Netlify)',
    invalid_access_key:'AviationStack-Schlüssel ist ungültig',
    missing_access_key:'AviationStack-Schlüssel fehlt',
    inactive_user:'AviationStack-Konto ist inaktiv',
    usage_limit_reached:'AviationStack-Kontingent aufgebraucht',
    rate_limit_reached:'Zu viele Abfragen — später erneut versuchen',
    https_access_restricted:'AviationStack-Tarif erlaubt kein HTTPS',
    function_access_restricted:'Diese Abfrage ist im AviationStack-Tarif nicht enthalten',
    historical_data_restricted:'Flüge zu anderen Tagen sind im AviationStack-Tarif nicht enthalten'
  };
  return map[code]||(err&&err.message)||'Flugabfrage fehlgeschlagen';
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
function releaseSaveBtn(btn){if(btn){btn.disabled=false;btn.textContent='Speichern';}}
async function saveEvent(){
  const title=document.getElementById('f_title').value.trim();
  if(!title){showToast('Bitte Titel eingeben');return;}
  if(!syncGuard()) return;
  let dateFrom=document.getElementById('f_dateFrom').value;
  let dateTo=document.getElementById('f_dateTo').value;
  const isM=!!(dateTo&&dateTo>dateFrom);
  // Abweichende An-/Abreise: nur bei mehrtägigen, gemeinsamen Terminen
  const splitOn=isM&&document.getElementById('f_owner').value==='gemeinsam'&&!!document.getElementById('f_splitDates')?.checked;
  let personDates=null;
  if(splitOn){
    personDates={};
    for(const p of PERSONS){
      const f=document.getElementById(`f_from_${p}`)?.value||'';
      const t=document.getElementById(`f_to_${p}`)?.value||'';
      if(!f||!t){showToast(`Bitte An- und Abreise für ${personLabel(p)} angeben`);return;}
      if(t<f){showToast(`${personLabel(p)}: Abreise liegt vor der Anreise`);return;}
      personDates[p]={from:f,to:t};
      // Der Gesamtzeitraum muss beide Anwesenheiten umschließen
      if(f<dateFrom) dateFrom=f;
      if(t>dateTo) dateTo=t;
    }
  }
  if(FEATURE_KOSTEN){
    const badExp=collectExpenses().find(e=>!Number.isFinite(e.amount));
    if(badExp){showToast(`Betrag bei „${badExp.desc||'Kostenposition'}" ist keine gültige Zahl`);return;}
  }
  const existing=editId?events.find(e=>e.id===editId):null;
  const wasEdit=!!editId;
  const evId=editId||genId();
  const saveBtn=document.querySelector('#eventModal [data-action="saveEvent"]');
  if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='Speichern …';}
  // Anhänge zuerst in den Storage laden; im Termin steht nur noch die Referenz.
  let attachments;
  try{
    attachments=await uploadPendingAttachments(evId,pendingAtt);
  }catch(err){
    releaseSaveBtn(saveBtn);
    reportSyncError('Anhänge konnten nicht hochgeladen werden',err);
    return;
  }
  const ev={
    id:evId,uid:(existing&&existing.uid)||genUid(),
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
    expenses:FEATURE_KOSTEN?collectExpenses():eventExpenses(existing||{}),
    attachments,
    subevents:collectSubs(),
    updatedAt:new Date().toISOString()
  };
  if(isM){ev.dateFrom=dateFrom;ev.dateTo=dateTo;ev.personDates=personDates;}
  else{ev.date=dateFrom;ev.time=document.getElementById('f_time').value;ev.personDates=null;}
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
  // Erst zum Server schreiben. Scheitert das, bleibt das Formular offen und die
  // Eingabe erhalten — bisher meldete die App Erfolg, auch wenn nichts ankam.
  const ok=await persistEvent(ev);
  releaseSaveBtn(saveBtn);
  if(!ok) return;
  await deleteRemovedAttachments(existing,attachments);

  let detail;
  if(wasEdit){
    // Build changelog entry: what changed?
    const changes=[];
    if(existing){
      if(existing.status!==ev.status) changes.push(`Status: ${SL[existing.status]||existing.status} → ${SL[ev.status]||ev.status}`);
      if((existing.date||existing.dateFrom)!==(ev.date||ev.dateFrom)) changes.push('Datum geändert');
      if(existing.location!==ev.location) changes.push('Ort geändert');
      if(existing.title!==ev.title) changes.push(`Titel: „${existing.title}" → „${ev.title}"`);
      if(JSON.stringify(existing.personDates||null)!==JSON.stringify(ev.personDates||null)) changes.push('An-/Abreise je Person geändert');
      if(JSON.stringify(existing.transport)!==JSON.stringify(ev.transport)) changes.push('Transport geändert');
      if(JSON.stringify(existing.todos)!==JSON.stringify(ev.todos)) changes.push('To-dos geändert');
      if(JSON.stringify(existing.expenses||[])!==JSON.stringify(ev.expenses||[])) changes.push('Kosten geändert');
      if(JSON.stringify(existing.subevents)!==JSON.stringify(ev.subevents)) changes.push('Subevents geändert');
    }
    detail=changes.length?changes.join(' · '):'Details aktualisiert';
  } else {
    const dateStr=ev.multiday?`${fmtD(ev.dateFrom)} – ${fmtD(ev.dateTo)}`:fmtD(ev.date);
    detail=`Neuer Termin · ${dateStr} · ${SL[ev.status]||ev.status}`;
  }
  // Der Realtime-Rücklauf des eigenen Schreibvorgangs kann schneller sein als
  // dieser Code. Deshalb ersetzen statt anhängen, sonst entsteht ein Duplikat.
  const idx=events.findIndex(e=>e.id===evId);
  if(idx<0) events.push(ev); else events[idx]=ev;
  saveData();closeModal('eventModal');
  showToast(wasEdit?'Termin aktualisiert':'Termin gespeichert');
  logActivity(wasEdit?'edit':'create',ev.title,detail);
}

// DELETE
let _pendingDeleteId=null,_pendingConfirm=null;
// Derselbe Dialog auch für andere Bestätigungen als das Löschen
function askConfirm(title,sub,okLabel,fn){
  _pendingDeleteId=null;
  _pendingConfirm=fn;
  document.getElementById('confirmDialogTitle').textContent=title;
  document.getElementById('confirmDialogSub').textContent=sub;
  const ok=document.getElementById('confirmDialogOk');
  if(ok){ok.textContent=okLabel||'OK';ok.className='btn-primary';}
  document.getElementById('confirmOverlay').classList.add('open');
}
function delEvent(id){
  const ev=events.find(e=>e.id===id);if(!ev)return;
  _pendingDeleteId=id;
  _pendingConfirm=null;
  document.getElementById('confirmDialogTitle').textContent=`„${ev.title}" löschen?`;
  document.getElementById('confirmDialogSub').textContent='Diese Aktion kann nicht rückgängig gemacht werden.';
  const ok=document.getElementById('confirmDialogOk');
  if(ok){ok.textContent='Löschen';ok.className='btn-danger';}
  document.getElementById('confirmOverlay').classList.add('open');
}
async function confirmDialogOk(){
  const id=_pendingDeleteId, fn=_pendingConfirm;  // save before closing clears it
  closeConfirmDialog();
  if(fn){fn();return;}
  if(!id)return;
  if(!syncGuard()) return;
  const ev=events.find(e=>e.id===id);
  const delTitle=ev?ev.title:'';
  const delDate=ev?(ev.multiday?fmtD(ev.dateFrom):fmtD(ev.date)):'';
  events=events.filter(e=>e.id!==id);
  closeModal('eventModal');closeModal('previewModal');
  saveData();
  if(!await persistEventDeleted(id)){await reloadFromSupabase();return;}
  logActivity('delete',delTitle,`Termin gelöscht · ${delDate}`);
  showToast('Termin gelöscht');
}
function closeConfirmDialog(){
  document.getElementById('confirmOverlay').classList.remove('open');
  _pendingDeleteId=null;
  _pendingConfirm=null;
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
      ${hasPersonDates(ev)?`<div class="pv-row full"><div class="pv-label">Anwesenheit</div><div class="pv-val">${personDatesHtml(ev)}</div></div>`:''}
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

  const pvExps=FEATURE_KOSTEN?eventExpenses(ev).filter(x=>expCents(x)):[];
  if(pvExps.length){
    const openExps=pvExps.filter(x=>!x.settledAt);
    const bal=sumBalance(openExps);
    html+=`<div class="pv-block" style="margin-bottom:8px"><div class="pv-block-title">Kosten</div>`+
      pvExps.map(x=>`<div class="exp-row">
        <div class="exp-row-main">
          <div>${esc(x.desc)||'—'}</div>
          <div class="exp-row-meta">verauslagt: <span style="color:var(--${x.paidBy}-color);font-weight:700">${personLabel(x.paidBy)}</span> · getragen: ${BEARER_LABEL[x.bearer||'beide']}${x.settledAt?' · abgerechnet':''}</div>
        </div>
        <span class="exp-row-amount">${fmtEur(expCents(x))}</span>
      </div>`).join('')+
      `<div class="exp-row" style="border-top:1px solid var(--border);margin-top:5px;padding-top:5px">
        <span style="font-weight:700">Gesamt</span><span class="exp-row-amount">${fmtEur(sumTotal(pvExps))}</span>
      </div>
      <div class="exp-row"><span class="${balanceClass(bal)}" style="font-weight:700">${openExps.length?balanceText(bal):'Alles abgerechnet'}</span></div>
    </div>`;
  }

  // ── ABLAUF ───────────────────────────────────────────────────────────
  // Eine Zeitleiste statt getrennter Blöcke für Transport, Unterkunft und
  // Sub-Events: Die Einträge stehen in der Reihenfolge, in der sie
  // stattfinden, bei mehrtägigen Terminen nach Tagen gruppiert.
  const tl=buildEventTimeline(ev);
  if(tl.count){
    const tlWhoColor={beide:'var(--purple)',toja:'var(--toja-color)',johann:'var(--johann-color)'};
    const tlWhoLabel={beide:'Beide',toja:'Toja',johann:'Johann'};
    const legTypeLabel={flug:'Flug',zug:'Zug',auto:'Auto',sonstiges:'Sonstiges'};

    // Zeitleisten-Zeile: links die Uhrzeit, rechts der Eintrag.
    const tlRow=(kindCls,timeText,title,meta,extra)=>
      `<div class="pv-tl-row ${kindCls}">
        <div class="pv-tl-time">${timeText?esc(timeText):''}</div>
        <div class="pv-tl-body">
          <div class="pv-tl-title">${title}</div>
          ${meta?`<div class="pv-tl-meta">${meta}</div>`:''}
          ${extra||''}
        </div>
      </div>`;

    const legTitle=leg=>{
      const d=leg.data||{};
      if(leg.type==='flug'||leg.type==='zug'){
        const route=d.from&&d.to?`${navLink(d.from,d.from)} → ${navLink(d.to,d.to)}`:'';
        return [esc(d.num)||legTypeLabel[leg.type],route].filter(Boolean).join(' · ');
      }
      return esc(leg.note)||legTypeLabel[leg.type]||'Transport';
    };
    const legMeta=(leg,who,dir,i_time)=>{
      const d=leg.data||{};
      const parts=[`<span style="font-weight:700;color:${tlWhoColor[who]}">${tlWhoLabel[who]}</span>`,
                   dir==='an'?'Anreise':'Abreise'];
      if(d.arr) parts.push('an '+esc(d.arr));
      if(leg.type==='auto'&&leg.eta&&!i_time) parts.push('ETA '+esc(leg.eta));
      if(leg.type!=='auto'&&leg.type!=='sonstiges'&&leg.note) parts.push(esc(leg.note));
      return parts.join(' · ');
    };
    const accomExtra=a=>{
      const sl=safeUrl(a.link);
      return [a.addr?`<div class="pv-tl-line">${navLink(a.addr)}</div>`:'',
        a.ref?`<div class="pv-tl-line">Buchungsreferenz: <span style="font-family:monospace;color:var(--text)">${esc(a.ref)}</span></div>`:'',
        sl?`<div class="pv-tl-line"><a href="${sl}" target="_blank" rel="noopener noreferrer" style="color:var(--blue)">🔗 Buchungslink</a></div>`:'',
        a.notes?`<div class="pv-tl-line">${esc(a.notes)}</div>`:''].filter(Boolean).join('');
    };
    const subExtra=sub=>!(sub.todos&&sub.todos.length)?'':
      `<div class="pv-tl-line">`+sub.todos.map(t=>`<div class="pv-tl-todo${t.done?' done':''}">
        <span>${t.done?'✓':'○'}</span><span>${esc(t.text)}</span>
        <span style="color:${ownerColors[t.owner||'beide']};font-weight:700">${ownerLabels[t.owner||'beide']}</span>
      </div>`).join('')+`</div>`;

    const itemHtml=i=>{
      if(i.kind==='an'||i.kind==='ab')
        return tlRow('tl-'+i.kind,i.time,legTitle(i.leg),legMeta(i.leg,i.who,i.dir,i.time),'');
      if(i.kind==='checkin'||i.kind==='accom')
        return tlRow('tl-accom',i.time,
          `${i.kind==='checkin'?'Check-in':'Unterkunft'} · ${esc(i.accom.name)||'—'}`,
          i.accom.coutDate?'bis '+fmtD(i.accom.coutDate)+(i.accom.coutTime?', '+esc(i.accom.coutTime):''):'',
          accomExtra(i.accom));
      if(i.kind==='checkout')
        return tlRow('tl-accom',i.time,`Check-out · ${esc(i.accom.name)||'—'}`,'','');
      const sub=i.sub;
      const meta=[sub.timeEnd?'bis '+esc(sub.timeEnd):'',sub.location?navLink(sub.location):''].filter(Boolean).join(' · ');
      return tlRow('tl-sub',i.time,esc(sub.title)||'—',meta,subExtra(sub));
    };

    // Tagesüberschriften nur, wenn der Termin mehrere Tage berührt.
    const multiDay=tl.days.length>1;
    html+=`<div class="pv-block" style="margin-bottom:8px"><div class="pv-block-title">Ablauf</div><div class="pv-tl">`;
    tl.days.forEach(day=>{
      if(multiDay) html+=`<div class="pv-tl-day">${fmtD(day.date)}</div>`;
      html+=day.items.map(itemHtml).join('');
    });
    if(tl.undated.length){
      html+=`<div class="pv-tl-day">Ohne Datum</div>`+tl.undated.map(itemHtml).join('');
    }
    html+=`</div></div>`;
  }

  if(ev.attachments&&ev.attachments.length){
    html+=`<div class="pv-block"><div class="pv-block-title">Anhänge</div><div style="display:flex;flex-wrap:wrap;gap:6px">`+
      ev.attachments.map((a,i)=>a.type&&a.type.startsWith('image/')?
        attImgTag(a,`class="pv-att" data-action="openAttPreview" data-ev-id="${id}" data-att-idx="${i}" style="width:60px;height:60px;object-fit:cover;border-radius:4px;border:1px solid var(--border)" title="${esc(a.name||'')}"`)
        :`<div class="pv-att" data-action="openAttPreview" data-ev-id="${id}" data-att-idx="${i}" style="width:60px;height:60px;background:var(--surface3);border:1px solid var(--border);border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:1.3rem" title="${esc(a.name||'')}">📄<span style="font-size:0.5rem;color:var(--text2);max-width:54px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 3px">${esc(a.name||'')}</span></div>`
      ).join('')+`</div></div>`;
  }

  document.getElementById('pvBody').innerHTML=html;
  hydrateAttachmentImages();
  const hasMap=eventHasMapData(ev);
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
    case 'datesFromTransport': datesFromTransport(t.dataset.person); break;
    case 'addExpense': addExpense(); break;
    case 'removeExpense': removeExpense(t.dataset.target); break;
    case 'openExpenseModal': e.stopPropagation(); openExpenseModal(t.dataset.evId); closeHamburger(); break;
    case 'saveQuickExpense': saveQuickExpense(); break;
    case 'openPaymentModal': openPaymentModal(); break;
    case 'savePayment': savePayment(); break;
    case 'askDeletePayment': askDeletePayment(t.dataset.payId); break;
    case 'setKostenScope': setKostenScope(t.dataset.scope); break;
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
    // Attachment preview (lightbox)
    case 'openAttPreview': openAttPreview(t.dataset.evId,t.dataset.attIdx); break;
    case 'closeAttPreview': closeAttPreview(); break;
  }
});

document.addEventListener('change', e=>{
  const t=e.target.closest('[data-action]');
  if(!t) return;
  const a=t.dataset.action;
  if(a==='toggleLegType') toggleLegType(t.dataset.lid);
  else if(a==='updateTodoOwnerStyle') updateTodoOwnerStyle(t);
  else if(a==='updateExpStyle') updateExpStyle(t);
  else if(a==='syncQuickBearer') syncQuickBearer();
  else if(a==='markQuickBearerTouched') markQuickBearerTouched();
  else if(a==='togglePerPersonDates') togglePerPersonDates();
  else if(a==='syncSplitDates') syncSplitDates();
});

document.addEventListener('input', e=>{
  if(e.target.closest('#expensesContainer')) updateExpensesSummary();
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

// Ausgeblendete Funktionen abschalten, sobald das Markup steht.
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',applyFeatureFlags);
else applyFeatureFlags();

// ── SERVICE WORKER ──
// Stand bisher als Inline-Skript in index.html und wurde dort von der CSP
// blockiert — die automatische Aktualisierung lief deshalb nie an.
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('/sw.js').then(reg=>{
      document.addEventListener('visibilitychange',()=>{
        if(!document.hidden) reg.update();
      });
      reg.addEventListener('updatefound',()=>{
        const sw=reg.installing;
        if(!sw) return;
        sw.addEventListener('statechange',()=>{
          // Neue Version aktiv: neu laden, damit beide Geräte denselben Code fahren.
          if(sw.state==='installed'&&navigator.serviceWorker.controller) window.location.reload();
        });
      });
    }).catch(e=>console.warn('[nous] Service Worker nicht registriert',e));
  });
}
