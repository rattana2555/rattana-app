/* ============================================================
   Rattana Stock — Redesign prototype  (engine + shared screens)
   Clickable mock. No real backend. Reads ?dir=A|B|C.
   ============================================================ */

const DIR = (new URLSearchParams(location.search).get('dir') || 'A').toUpperCase();

/* ---------- line icons (no emoji) ---------- */
const ICONS = {
  scan:'<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M7 9v6M10.5 9v6M14 9v6M17 9v6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  minus:'<path d="M5 12h14"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  camera:'<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="3.5"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  chart:'<path d="M3 3v18h18"/><path d="M7 15v-4M12 15V8M17 15v-6"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  trash:'<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
  back:'<path d="M15 18l-6-6 6-6"/>',
  next:'<path d="M9 18l6-6-6-6"/>',
  box:'<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  x:'<path d="M6 6l12 12M18 6 6 18"/>',
  edit:'<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  alert:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  bs:'<path d="M21 4H8L2 12l6 8h13a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z"/><path d="M18 9l-6 6M12 9l6 6"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  cloud:'<path d="M18 16.5a4 4 0 0 0-1.3-7.8A6 6 0 0 0 5 10a4.5 4.5 0 0 0 1 8.9"/><path d="M12 12v8M9 17l3 3 3-3"/>',
  pin:'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="2.5"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  dot:'<circle cx="12" cy="12" r="3"/>',
};
function ic(name, cls){ return `<svg class="ic ${cls||''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]||''}</svg>`; }

/* ---------- warehouses ---------- */
const WH_NAMES = { W1:'สมุทรสงคราม', W2:'สุพรรณบุรี', W3:'ราชบุรี', W4:'นครปฐม' };
const WH_LIST  = ['W1','W2','W3','W4'];
const UNIT_FULL = { EA:'ชิ้น', PA:'แพ็ก', BP:'แพ็กใหญ่', CS:'ลัง' };

/* ---------- mock catalogue ----------
   stock per warehouse is the CS.EA string, exactly like the real sheet. */
const PRODUCTS = [
  { key:'8851959031234', name:'เบียร์ช้าง คลาสสิก 320 มล.', short:'ช้าง 320',  cat:'beer',
    units:['CS','PA','EA'], factors:{EA:1,PA:6,CS:24}, codes:{EA:'8851959030011',PA:'8851959030028',CS:'8851959031234'},
    stock:{W1:'8.00',W2:'3.05',W3:'1.12',W4:'0.00'} },
  { key:'8850999320014', name:'น้ำดื่มสิงห์ 600 มล.', short:'สิงห์ 600', cat:'water',
    units:['CS','PA','EA'], factors:{EA:1,PA:12,CS:24}, codes:{EA:'8850999320014',PA:'8850999320021',CS:'8850999320038'},
    stock:{W1:'12.00',W2:'0.20',W3:'4.06',W4:'2.00'} },
  { key:'8851234567002', name:'โค้ก กระป๋อง 325 มล.', short:'โค้ก 325', cat:'soft',
    units:['CS','PA','EA'], factors:{EA:1,PA:6,CS:30}, codes:{EA:'8851234567002',PA:'8851234567019',CS:'8851234567026'},
    stock:{W1:'5.00',W2:'5.00',W3:'0.18',W4:'3.10'} },
  { key:'8852057010038', name:'นมตราหมี UHT รสจืด 180 มล.', short:'หมี 180', cat:'milk',
    units:['CS','PA','EA'], factors:{EA:1,PA:4,CS:48}, codes:{EA:'8852057010038',PA:'8852057010045',CS:'8852057010052'},
    stock:{W1:'2.00',W2:'2.00',W3:'6.12',W4:'1.24'} },
  { key:'8850987654003', name:'มาม่า ต้มยำกุ้ง 55 ก.', short:'มาม่า ต้มยำ', cat:'noodle',
    units:['CS','PA','EA'], factors:{EA:1,PA:6,CS:30}, codes:{EA:'8850987654003',PA:'8850987654010',CS:'8850987654027'},
    stock:{W1:'10.00',W2:'4.18',W3:'2.00',W4:'0.06'} },
  { key:'8850123450019', name:'เนสกาแฟ เบลนด์ 3in1 (ซอง)', short:'เนสกาแฟ 3in1', cat:'coffee',
    units:['CS','BP','EA'], factors:{EA:1,BP:27,CS:108}, codes:{EA:'8850123450019',BP:'8850123450026',CS:'8850123450033'},
    stock:{W1:'1.50',W2:'1.40',W3:'0.90',W4:'2.00'} },
  { key:'8851019200017', name:'น้ำมันพืชองุ่น 1 ลิตร', short:'น้ำมันองุ่น 1L', cat:'oil',
    units:['CS','EA'], factors:{EA:1,CS:12}, codes:{EA:'8851019200017',CS:'8851019200024'},
    stock:{W1:'3.00',W2:'2.08',W3:'1.00',W4:'0.10'} },
  { key:'8850777001025', name:'ทิชชู่เซลล็อกซ์ 2 ชั้น (ม้วน)', short:'เซลล็อกซ์', cat:'paper',
    units:['CS','PA','EA'], factors:{EA:1,PA:4,CS:24}, codes:{EA:'8850777001025',PA:'8850777001032',CS:'8850777001049'},
    stock:{W1:'6.00',W2:'1.10',W3:'3.00',W4:'2.04'} },
];
const PROD_BY_KEY = Object.fromEntries(PRODUCTS.map(p => [p.key, p]));

/* barcode -> {key, unit}  (for typed input + hardware scanner guns) */
const BARCODE_INDEX = {};
PRODUCTS.forEach(p => p.units.forEach(u => { const c = p.codes[u]; if(c) BARCODE_INDEX[c] = { key:p.key, unit:u }; }));

/* category accent for the thumbnail tile (subtle, not emoji) */
const CAT_TINT = {
  beer:'#c98a2a', water:'#2f8fd6', soft:'#d0483a', milk:'#7a8aa8',
  noodle:'#d98b1f', coffee:'#8a5a36', oil:'#caa23a', paper:'#5aa17a',
};

/* ---------- CS.EA stock parsing (identical rule to production) ---------- */
function parseStock(val){
  const s = String(val==null?'0':val).trim();
  if(!s || s==='-') return { cs:0, ea:0, raw:'0' };
  const clean = s.replace(/,/g,'').replace(/[^\d.]/g,'');
  if(!clean || clean==='.') return { cs:0, ea:0, raw:s };
  const dot = clean.indexOf('.');
  const csStr = dot===-1 ? clean : clean.slice(0,dot);
  const eaStr = dot===-1 ? ''    : clean.slice(dot+1);
  const cs = parseInt(csStr,10)||0;
  const ea = eaStr==='' ? 0 : (parseInt(eaStr,10)||0);
  return { cs, ea, raw:s };
}
function systemPieces(item){
  const p = PROD_BY_KEY[item.key];
  const { cs, ea } = parseStock(p ? p.stock[S.wh] : '0');
  return cs * (item.factors.CS || 1) + ea;
}
function systemRaw(item){
  const p = PROD_BY_KEY[item.key];
  return p ? p.stock[S.wh] : '0';
}
function countedPieces(item){
  return ['EA','PA','BP','CS'].reduce((s,u)=> s + (item.counts[u]||0)*(item.factors[u]||1), 0);
}
function piecesToCSEA(pieces, factorCS){
  const sign = pieces<0?'-':''; const a=Math.abs(pieces);
  const f = factorCS>0?factorCS:1;
  const cs = Math.floor(a/f), ea = a-cs*f;
  return `${sign}${cs} ลัง ${ea} ชิ้น`;
}
function breakdownText(item){
  const parts = ['CS','BP','PA','EA'].filter(u => item.counts[u]>0)
    .map(u => `${item.counts[u]} ${u}`);
  return parts.length ? parts.join(' + ') : '0';
}
function itemDiff(item){
  const counted = countedPieces(item);
  const system  = systemPieces(item);
  const diff = counted - system;
  return { counted, system, diff, status: diff===0?'ok':(diff<0?'short':'over'), factorCS:item.factors.CS||1, raw:systemRaw(item) };
}
function fmtNum(n){ return n.toLocaleString('en-US'); }

/* ---------- state ---------- */
const S = {
  screen:'login',
  wh:null,
  items:{},        // key -> {key,name,short,cat,units,factors,counts}
  pending:null,    // {key, unit, qty}  (qty entry for A / C)
  editKey:null,
  scanReturn:'count',
  scanQueue:0,     // deterministic scan order
};

function newItem(p){
  return { key:p.key, name:p.name, short:p.short, cat:p.cat, units:p.units.slice(),
           factors:{...p.factors}, counts:{EA:0,PA:0,BP:0,CS:0} };
}
function ensureItem(key){
  if(!S.items[key]) S.items[key] = newItem(PROD_BY_KEY[key]);
  return S.items[key];
}
function addCount(key, unit, qty){
  if(qty<=0) return;
  ensureItem(key).counts[unit] = (S.items[key].counts[unit]||0) + qty;
}
/* set an exact count (manual typing) */
function setCount(key, unit, val){
  const it = S.items[key]; if(!it) return;
  it.counts[unit] = Math.max(0, parseInt(val,10)||0);
  if(!it.units.some(u=>it.counts[u]>0)){ delete S.items[key]; if(S.expand===key) S.expand=null; }
}
/* move a counted item to the top of the list (newest scan visible first) */
function moveFront(key){
  if(!S.items[key]) return;
  const v = S.items[key]; const rest = {...S.items}; delete rest[key];
  S.items = { [key]:v, ...rest };
}
/* re-render but keep the list scroll positions (B / list sheet / desktop) */
function renderKeepScroll(){
  const a = document.getElementById('scrollArea'); const ya = a?a.scrollTop:0;
  const b = document.getElementById('sumScroll'); const yb = b?b.scrollTop:0;
  render();
  const a2 = document.getElementById('scrollArea'); if(a2) a2.scrollTop = ya;
  const b2 = document.getElementById('sumScroll'); if(b2) b2.scrollTop = yb;
}

/* pre-seed a few counted items so Summary is meaningful on first view */
function seed(){
  S.wh = 'W2';
  // ตรง : เบียร์ช้าง system 3.05 = 77 ชิ้น  → นับ 3CS 5EA
  addCount('8851959031234','CS',3); addCount('8851959031234','EA',5);
  // ขาด : สิงห์ system 0.20 = 20 ชิ้น → นับ 15 EA  (-5)
  addCount('8850999320014','EA',15);
  // เกิน : โค้ก system 5.00 = 150 ชิ้น → นับ 5CS 4EA (+4)
  addCount('8851234567002','CS',5); addCount('8851234567002','EA',4);
  // ตรง : นมหมี system 2.00 = 96 ชิ้น → นับ 2CS
  addCount('8852057010038','CS',2);
}

/* ---------- scan simulation ---------- */
function simulateScan(){
  // cycle through catalogue deterministically; default to its biggest unit
  const p = PRODUCTS[S.scanQueue % PRODUCTS.length];
  S.scanQueue++;
  const unit = p.units[0]; // biggest (CS first)
  return { key:p.key, unit };
}

/* ---------- toast ---------- */
let toastTimer=null;
function toast(msg, type='ok'){
  const wrap = document.getElementById('toast-wrap');
  wrap.innerHTML = `<div class="toast toast-${type}">${type==='ok'?ic('check'):type==='warn'?ic('alert'):ic('alert')}<span>${msg}</span></div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ wrap.innerHTML=''; }, 2200);
}

/* ---------- thumbnail tile (category tint + initial, no emoji) ---------- */
function thumb(p, size){
  const tint = CAT_TINT[p.cat] || '#5b6b86';
  const s = size||46;
  const label = (p.short||p.name||'?').trim().charAt(0);
  return `<div class="thumb" style="width:${s}px;height:${s}px;background:${tint}1a;color:${tint};border-color:${tint}33">${ic('box')}</div>`;
}

/* ---------- router ---------- */
function go(screen){ S.screen = screen; render(); }

function isDesktop(){
  if(window.__forceDesk===true) return true;
  if(window.__forceDesk===false) return false;
  return window.innerWidth >= 980;
}

function render(){
  const app = document.getElementById('app');
  const phone = document.getElementById('phone');
  const desk = isDesktop() && DIR==='B';
  if(phone) phone.setAttribute('data-mode', desk ? 'desktop' : 'mobile');
  let html='';
  if(desk){
    if(S.screen==='login')          html = renderLogin();
    else if(S.screen==='scan')      html = renderScan();
    else if(!S.wh)                   html = renderWarehouse();
    else                            html = renderDesktop();   // in screens.js
  } else {
    switch(S.screen){
      case 'login':     html = renderLogin(); break;
      case 'warehouse': html = renderWarehouse(); break;
      case 'count':     html = renderCount(); break;     // in screens.js (A/B/C)
      case 'qty':       html = renderQtyA(); break;      // in screens.js (A)
      case 'scan':      html = renderScan(); break;      // in screens.js
      case 'list':      html = renderListSheet(); break; // in screens.js
      case 'summary':   html = renderSummary(); break;
      default:          html = renderLogin();
    }
  }
  app.innerHTML = html;
  if(typeof afterRender==='function') afterRender();
}

/* ---------- shared chrome ---------- */
function appBar(title, opts){
  opts = opts||{};
  const left = opts.back
    ? `<button class="ab-btn" onclick="${opts.back}">${ic('back')}</button>`
    : `<div class="ab-logo">R</div>`;
  const wh = S.wh ? `<button class="wh-chip" onclick="go('warehouse')">${ic('pin')}<span>${S.wh}</span></button>` : '';
  const right = opts.right!=null ? opts.right
    : `${wh}<button class="ab-btn" onclick="logout()" title="ออกจากระบบ">${ic('logout')}</button>`;
  return `<header class="appbar">
    ${left}
    <div class="ab-title">${title}</div>
    <div class="ab-right">${right}</div>
  </header>`;
}

/* bottom tab bar (Count / Summary) */
function tabBar(active){
  const n = Object.keys(S.items).length;
  return `<nav class="tabbar">
    <button class="tab ${active==='count'?'on':''}" onclick="go('count')">${ic('scan')}<span>นับสต็อก</span></button>
    <button class="tab ${active==='summary'?'on':''}" onclick="go('summary')">${ic('chart')}<span>สรุปผล${n?` · ${n}`:''}</span></button>
  </nav>`;
}

function logout(){ if(confirm('ออกจากระบบ?')){ S.screen='login'; render(); } }

/* ============================================================
   LOGIN
   ============================================================ */
function renderLogin(){
  return `<div class="screen login">
    <div class="login-top">
      <div class="brand-badge">R</div>
      <div class="brand-name">RATTANA <b>STOCK</b></div>
      <div class="brand-sub">ระบบนับสต็อกสินค้า</div>
    </div>
    <div class="login-card">
      <div class="login-h">เข้าสู่ระบบ</div>
      <p class="login-p">เข้าสู่ระบบด้วยบัญชีบริษัทเพื่อเริ่มนับสต็อก</p>
      <button class="btn btn-google" onclick="mockLogin()">
        <span class="g">G</span> เข้าสู่ระบบด้วย Google
      </button>
      <div class="login-note">${ic('user')} ใช้ได้เฉพาะอีเมลที่ลงทะเบียนไว้กับผู้ดูแล</div>
    </div>
    <div class="dir-tag">แนวออกแบบ ${DIR}</div>
  </div>`;
}
function mockLogin(){
  if(!Object.keys(S.items).length) seed();
  go('warehouse');
}

/* ============================================================
   WAREHOUSE PICKER
   ============================================================ */
function renderWarehouse(){
  const cards = WH_LIST.map(w => {
    const on = S.wh===w;
    return `<button class="wh-card ${on?'on':''}" onclick="pickWh('${w}')">
      <div class="wh-ic">${ic('box')}</div>
      <div class="wh-meta"><div class="wh-code">${w}</div><div class="wh-loc">${WH_NAMES[w]}</div></div>
      ${on?`<div class="wh-on">${ic('check')}</div>`:`<div class="wh-go">${ic('next')}</div>`}
    </button>`;
  }).join('');
  return `<div class="screen">
    ${appBar('เลือกคลังสินค้า',{right:`<button class="ab-btn" onclick="logout()">${ic('logout')}</button>`})}
    <div class="scroll pad">
      <div class="lead">เลือกคลังที่จะเริ่มนับ</div>
      <div class="wh-grid">${cards}</div>
    </div>
  </div>`;
}
function pickWh(w){
  S.wh = w;
  if(isDesktop()) S._refocusBC = true;
  go('count');
}

/* ============================================================
   SUMMARY  (shared — readable card list, not a dense table)
   ============================================================ */
function summaryRows(){
  return Object.values(S.items).map(it => ({ it, ...itemDiff(it) }))
    .sort((a,b)=> Math.abs(b.diff)-Math.abs(a.diff));
}
function statTilesHtml(rows){
  const nOk = rows.filter(r=>r.status==='ok').length;
  const nShort = rows.filter(r=>r.status==='short').length;
  const nOver = rows.filter(r=>r.status==='over').length;
  return `<div class="stat3">
    <div class="stat stat-ok"><div class="st-v">${nOk}</div><div class="st-l">ตรง</div></div>
    <div class="stat stat-short"><div class="st-v">${nShort}</div><div class="st-l">ขาด</div></div>
    <div class="stat stat-over"><div class="st-v">${nOver}</div><div class="st-l">เกิน</div></div>
  </div>`;
}
function summaryListHtml(rows){
  if(!rows.length) return `<div class="empty"><div>ยังไม่มีรายการนับ</div><p>สแกนสินค้าเพื่อเริ่ม</p></div>`;
  return `<div class="sum-rows">` + rows.map(r => {
    const diffWord = r.status==='ok' ? 'ตรง' : (r.status==='short' ? 'ขาด' : 'เกิน');
    const a = Math.abs(r.diff), f = r.factorCS>0 ? r.factorCS : 1;
    const cs = Math.floor(a/f), ea = a - cs*f;
    const csea = cs>0 ? `${cs} CS ${ea} EA` : `${ea} EA`;
    const pill = r.status==='ok'
      ? `<span class="srp srp-ok">${ic('check')} ตรง</span>`
      : `<span class="srp srp-${r.status}">${diffWord} ${csea}</span>`;
    return `<div class="sum-row sr-${r.status}">
      <div class="sr-main">
        <div class="sr-name">${r.it.name}</div>
        <div class="sr-sub">นับ <b>${fmtNum(r.counted)}</b> · ระบบ ${fmtNum(r.system)} ชิ้น</div>
      </div>
      ${pill}
    </div>`;
  }).join('') + `</div>`;
}
function renderSummary(){
  const rows = summaryRows();
  const body = rows.length ? summaryListHtml(rows)
    : `<div class="empty">${ic('chart')}<div>ยังไม่มีรายการนับ</div><p>ไปที่แท็บ “นับสต็อก” เพื่อเริ่ม</p></div>`;
  return `<div class="screen">
    ${appBar('สรุปผลการนับ')}
    <div class="scroll pad-b">
      <div class="sum-head">
        <div class="sum-wh">${ic('pin')} คลัง ${S.wh} · ${WH_NAMES[S.wh]||''}</div>
        <div class="sum-count">${rows.length} รายการ</div>
      </div>
      ${statTilesHtml(rows)}
      <div class="sum-list">${body}</div>
    </div>
    ${rows.length?`<div class="dock">
      <button class="btn btn-ghost" onclick="toast('ดาวน์โหลดไฟล์ Excel แล้ว (ตัวอย่าง)','ok')">${ic('download')} Excel</button>
      <button class="btn btn-primary grow" onclick="toast('บันทึกลง Google Sheet แล้ว','ok')">${ic('cloud')} บันทึกผล</button>
    </div>`:''}
    ${tabBar('summary')}
  </div>`;
}

/* ---------- boot ---------- */
function boot(){
  document.getElementById('phone').setAttribute('data-dir', DIR);
  let rt=null;
  window.addEventListener('resize', ()=>{ clearTimeout(rt); rt=setTimeout(()=>{ S._wasDesk=null; render(); }, 150); });
  render();
}
