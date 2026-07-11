/* ============================================================
   Rattana Stock — Redesign prototype  (count screens A/B/C,
   scan overlay, list sheet, qty entry).  Branches on DIR.
   ============================================================ */

/* dispatch */
function renderCount(){
  if(DIR==='B') return renderCountB();
  if(DIR==='C') return renderCountC();
  return renderCountA();
}

function statusChips(){
  const rows = Object.values(S.items).map(itemDiff);
  const nOk = rows.filter(r=>r.status==='ok').length;
  const nS  = rows.filter(r=>r.status==='short').length;
  const nO  = rows.filter(r=>r.status==='over').length;
  return `<div class="chips">
    <span class="chip chip-ok">${nOk} ตรง</span>
    <span class="chip chip-short">${nS} ขาด</span>
    <span class="chip chip-over">${nO} เกิน</span>
  </div>`;
}
function mainUnit(it){
  let best=null,max=-1;
  it.units.forEach(u=>{ if((it.counts[u]||0)>max){max=it.counts[u]||0;best=u;} });
  return best || it.units[0];
}

/* ============================================================
   DIRECTION A — Guided (one clear action, big bottom buttons)
   ============================================================ */
function renderCountA(){
  const n = Object.keys(S.items).length;
  return `<div class="screen">
    ${appBar('นับสต็อก')}
    <div class="scroll center-col">
      <div class="guide-progress">
        <div class="gp-num">${n}</div>
        <div class="gp-l">รายการที่นับแล้ว · คลัง ${S.wh}</div>
      </div>
      <div class="guide-hero">
        <div class="hero-ring">${ic('scan')}</div>
        <div class="hero-h">พร้อมนับสินค้า</div>
        <div class="hero-p">แตะปุ่มด้านล่างเพื่อสแกนบาร์โค้ด<br>แล้วใส่จำนวนที่นับได้</div>
      </div>
    </div>
    <div class="dock dock-col">
      <button class="btn btn-primary btn-xl" onclick="openScan()">${ic('camera')} สแกนสินค้า</button>
      <button class="btn btn-soft" onclick="go('list')">${ic('list')} ดูรายการที่นับ${n?` (${n})`:''}</button>
    </div>
    ${tabBar('count')}
  </div>`;
}

/* qty entry screen (A) — focused stepper */
function renderQtyA(){
  const p = PROD_BY_KEY[S.pending.key];
  const u = S.pending.unit, qty = S.pending.qty;
  const pieces = qty * (p.factors[u]||1);
  const unitSel = p.units.map(uu =>
    `<button class="seg ${uu===u?'on':''}" onclick="qtySetUnit('${uu}')">${uu}<i>${UNIT_FULL[uu]}</i></button>`).join('');
  const chips = [1,6,12].map(v=>`<button class="qchip" onclick="qtySet(${v})">${v}</button>`).join('');
  return `<div class="screen">
    ${appBar('ใส่จำนวน',{back:"cancelQty()"})}
    <div class="scroll pad">
      <div class="prod-head">
        ${thumb(p,64)}
        <div class="ph-main">
          <div class="ph-name">${p.name}</div>
          <div class="ph-code">${S.pending.key}</div>
        </div>
      </div>
      <div class="field-l">หน่วยที่นับ</div>
      <div class="seg-row seg-3">${unitSel}</div>
      <div class="field-l">จำนวน</div>
      <div class="stepper-xl">
        <button class="step-btn" onclick="qtyBump(-1)">${ic('minus')}</button>
        <div class="step-val">${qty}<i>${u}</i></div>
        <button class="step-btn" onclick="qtyBump(1)">${ic('plus')}</button>
      </div>
      <div class="qchips">${chips}<span class="qeq">= ${fmtNum(pieces)} ชิ้น</span></div>
    </div>
    <div class="dock dock-col">
      <button class="btn btn-primary btn-xl" onclick="confirmQty()">${ic('check')} เพิ่มเข้ารายการ</button>
      <button class="btn btn-ghost" onclick="cancelQty()">ยกเลิก</button>
    </div>
  </div>`;
}
function qtyBump(d){ S.pending.qty = Math.max(0, S.pending.qty + d); render(); }
function qtySet(v){ S.pending.qty = v; render(); }
function qtySetUnit(u){ S.pending.unit = u; render(); }
function confirmQty(){
  if(S.pending.qty<=0){ cancelQty(); return; }
  const {key,unit,qty} = S.pending;
  addCount(key,unit,qty);
  const name = PROD_BY_KEY[key].short;
  S.pending=null;
  S.screen='count'; render();
  toast(`เพิ่ม ${qty} ${unit} · ${name}`,'ok');
}
function cancelQty(){ S.pending=null; go('count'); }

/* ============================================================
   DIRECTION B — Live list (inline steppers, sticky scan dock)
   ============================================================ */
function renderCountB(){
  const items = Object.values(S.items);
  const list = items.length ? items.map(rowB).join('')
    : `<div class="empty sm">${ic('list')}<div>ยังไม่มีรายการ</div><p>สแกนหรือพิมพ์บาร์โค้ดด้านล่างเพื่อเริ่มนับ</p></div>`;
  const egCodes = ['8851959030011','8850999320014','8850987654003'];
  const egChips = egCodes.map(c=>`<button class="eg-chip" onclick="bcFill('${c}')">${c}</button>`).join('');
  return `<div class="screen">
    ${appBar('นับสต็อก')}
    <div class="livebar">
      ${statusChips()}
      <div class="live-n">${items.length} รายการ</div>
    </div>
    <div class="scroll pad-list" id="scrollArea">
      ${pendingCardB()}
      ${list}
    </div>
    <div class="bc-eg">
      <span class="bc-eg-l">เครื่องยิงบาร์โค้ดจะกรอกให้อัตโนมัติ · ลองพิมพ์:</span>
      <div class="bc-eg-row">${egChips}</div>
    </div>
    <div class="dock dock-bc">
      <div class="bc-input">
        ${ic('search')}
        <input id="bcInput" type="text" inputmode="numeric" autocomplete="off"
               placeholder="สแกน / พิมพ์บาร์โค้ด แล้วกด Enter"
               oninput="bcLive(this)" onkeydown="bcKey(event)">
        <button class="bc-go" onclick="bcSubmit()" title="เพิ่ม">${ic('next')}</button>
      </div>
      <button class="cam-btn" onclick="openScan()" title="เปิดกล้อง">${ic('camera')}</button>
    </div>
    ${tabBar('count')}
  </div>`;
}
function rowB(it){
  const d = itemDiff(it);
  const p = PROD_BY_KEY[it.key];
  const open = S.expand===it.key;
  const mu = mainUnit(it);
  const pill = d.status==='ok' ? `<span class="pill pill-ok">${ic('check')} ตรง</span>`
    : `<span class="pill pill-${d.status}">${d.status==='short'?'ขาด':'เกิน'} ${fmtNum(Math.abs(d.diff))}</span>`;
  const allSteppers = it.units.map(u=>`
    <div class="ustep">
      <span class="ustep-l"><b>${u}</b> ${UNIT_FULL[u]} · ×${it.factors[u]}</span>
      <div class="stepper-sm">
        <button class="step-s" onclick="bumpInline('${it.key}','${u}',-1)">${ic('minus')}</button>
        <input class="step-in" type="text" inputmode="numeric" value="${it.counts[u]||0}"
               onfocus="this.select()" onkeydown="qtyKey(event,this)" onchange="setCountInput('${it.key}','${u}',this)">
        <button class="step-s" onclick="bumpInline('${it.key}','${u}',1)">${ic('plus')}</button>
      </div>
    </div>`).join('');
  return `<div class="lrow ${open?'open':''}">
    <div class="lrow-main" onclick="toggleExpand('${it.key}')">
      ${thumb(p,44)}
      <div class="lrow-info">
        <div class="lrow-name">${it.name}</div>
        <div class="lrow-sub">${breakdownText(it)} = <b>${fmtNum(d.counted)}</b> ชิ้น · ระบบ ${fmtNum(d.system)}</div>
      </div>
      ${pill}
      <span class="lrow-chev">${ic('next')}</span>
    </div>
    ${open?`<div class="lrow-expand">
      <div class="lrow-edit-l">แก้ไขจำนวนที่นับ</div>
      ${allSteppers}
      <button class="lrow-del" onclick="removeItem('${it.key}')">${ic('trash')} ลบรายการนี้</button>
    </div>`:''}
  </div>`;
}
function qtyKey(e, el){ if(e.key==='Enter'){ e.preventDefault(); el.blur(); } }
function setCountInput(key, unit, el){ setCount(key, unit, el.value); renderKeepScroll(); }
function toggleExpand(key){ S.expand = S.expand===key?null:key; render(); }
function bumpInline(key,unit,d){
  const it = S.items[key]; if(!it) return;
  it.counts[unit] = Math.max(0,(it.counts[unit]||0)+d);
  if(!it.units.some(u=>it.counts[u]>0)){ delete S.items[key]; if(S.expand===key) S.expand=null; }
  const sc = document.getElementById('scrollArea'); const y = sc?sc.scrollTop:0;
  render();
  const sc2 = document.getElementById('scrollArea'); if(sc2) sc2.scrollTop=y;
}

/* ============================================================
   DIRECTION C — Keypad POS (big numeric pad, thumb zone)
   ============================================================ */
function renderCountC(){
  const n = Object.keys(S.items).length;
  let panel;
  if(S.pending){
    const p = PROD_BY_KEY[S.pending.key];
    const u = S.pending.unit, qty = S.pending.qty;
    const pieces = qty * (p.factors[u]||1);
    const unitSel = p.units.map(uu =>
      `<button class="seg ${uu===u?'on':''}" onclick="kSetUnit('${uu}')">${uu}</button>`).join('');
    panel = `<div class="kp-prod">
      ${thumb(p,48)}
      <div class="kp-info"><div class="kp-name">${p.short}</div><div class="kp-code">${S.pending.key}</div></div>
      <button class="kp-clear" onclick="kClearProd()">${ic('x')}</button>
    </div>
    <div class="kp-seg">${unitSel}</div>
    <div class="kp-display">
      <span class="kp-qty">${qty}</span>
      <span class="kp-unit">${u}</span>
      <span class="kp-eq">= ${fmtNum(pieces)} ชิ้น</span>
    </div>`;
  } else {
    panel = `<div class="kp-empty">
      <div class="hero-ring sm">${ic('scan')}</div>
      <div class="kp-empty-h">สแกนสินค้าเพื่อเริ่ม</div>
      <div class="kp-empty-p">แตะ “สแกน” ที่แป้นด้านล่าง</div>
    </div>`;
  }
  const keys = ['1','2','3','4','5','6','7','8','9'].map(k=>`<button class="key" onclick="kNum('${k}')">${k}</button>`).join('');
  return `<div class="screen">
    ${appBar('นับสต็อก',{right:`<button class="ab-btn" onclick="go('list')" title="รายการ">${ic('list')}${n?`<span class="ab-badge">${n}</span>`:''}</button>`})}
    <div class="kp-top">${panel}</div>
    <div class="kp-listbar" onclick="go('list')">${ic('list')} รายการที่นับ <b>${n}</b><span class="kp-go">${ic('next')}</span></div>
    <div class="keypad">
      ${keys}
      <button class="key key-fn" onclick="kScan()">${ic('camera')}</button>
      <button class="key" onclick="kNum('0')">0</button>
      <button class="key key-fn" onclick="kBack()">${ic('bs')}</button>
      <button class="key key-save ${S.pending && S.pending.qty>0?'':'off'}" onclick="kSave()">${ic('check')} บันทึก</button>
    </div>
  </div>`;
}
function kNum(d){
  if(!S.pending){ toast('สแกนสินค้าก่อน','warn'); return; }
  const cur = String(S.pending.qty||0);
  const next = (cur==='0'?'':cur) + d;
  S.pending.qty = Math.min(9999, parseInt(next,10)||0);
  render();
}
function kBack(){ if(!S.pending) return; S.pending.qty = Math.floor((S.pending.qty||0)/10); render(); }
function kSetUnit(u){ if(S.pending){ S.pending.unit=u; render(); } }
function kClearProd(){ S.pending=null; render(); }
function kScan(){ S.scanReturn='count'; go('scan'); }
function kSave(){
  if(!S.pending || S.pending.qty<=0){ toast('ใส่จำนวนก่อน','warn'); return; }
  const {key,unit,qty} = S.pending;
  addCount(key,unit,qty);
  const name = PROD_BY_KEY[key].short;
  S.pending=null; render();
  toast(`บันทึก ${qty} ${unit} · ${name}`,'ok');
}

/* ============================================================
   SCAN overlay (shared) — faux viewfinder + simulate button
   ============================================================ */
function renderScan(){
  const picker = PRODUCTS.map(p=>`<button class="pick" onclick="pickProduct('${p.key}')">
    ${thumb(p,34)}<span class="pick-n">${p.short}</span><span class="pick-c">${p.units[0]}</span></button>`).join('');
  return `<div class="screen scan-screen">
    <header class="appbar scan-bar">
      <button class="ab-btn light" onclick="closeScan()">${ic('x')}</button>
      <div class="ab-title">สแกนบาร์โค้ด</div>
      <div class="ab-right"></div>
    </header>
    <div class="viewfinder">
      <div class="vf-frame"><span></span><span></span><span></span><span></span><div class="vf-laser"></div></div>
      <div class="vf-hint">วางบาร์โค้ดให้อยู่ในกรอบ</div>
    </div>
    <div class="scan-actions">
      <button class="btn btn-primary btn-xl" onclick="doScan()">${ic('scan')} จำลองสแกน</button>
      <div class="scan-or">หรือเลือกจากรายการ</div>
      <div class="pick-list">${picker}</div>
    </div>
  </div>`;
}
function openScan(){ S.scanReturn='count'; go('scan'); }
function closeScan(){ go('count'); }
function doScan(){ const {key,unit}=simulateScan(); handleScanned(key,unit); }
function pickProduct(key){ handleScanned(key, PROD_BY_KEY[key].units[0]); }
function handleScanned(key, unit){
  if(navigator.vibrate) try{navigator.vibrate(40);}catch(e){}
  if(DIR==='B'){
    S.pendingB = { key, unit, qty:1 };
    S._scrollTop = true;
    go('count');
  } else if(DIR==='C'){
    S.pending = { key, unit, qty:0 };
    go('count');
  } else { // A
    S.pending = { key, unit, qty:1 };
    S.screen='qty'; render();
  }
}

/* ----- barcode field (typed input + hardware scanner gun) — Direction B ----- */
function bcLive(el){ /* guns type fast & send Enter; no live handling needed */ }
function bcFill(code){ const inp=document.getElementById('bcInput'); if(inp){ inp.value=code; bcSubmit(); } }
function bcKey(e){ if(e.key==='Enter'){ e.preventDefault(); bcSubmit(); } }
function bcSubmit(){
  const inp=document.getElementById('bcInput'); if(!inp) return;
  const code=String(inp.value||'').trim(); if(!code) return;
  const hit=BARCODE_INDEX[code];
  if(!hit){ toast('ไม่พบบาร์โค้ด: '+code,'warn'); inp.select(); return; }
  S.pendingB = { key:hit.key, unit:hit.unit, qty:1 };
  S._scrollTop = true;
  inp.value='';
  render();
}

/* ----- quantity prompt after a scan (Direction B) ----- */
function pendingCardB(){
  if(!S.pendingB) return '';
  const p = PROD_BY_KEY[S.pendingB.key], u = S.pendingB.unit, qty = S.pendingB.qty;
  const pieces = qty * (p.factors[u]||1);
  const unitSel = p.units.map(uu =>
    `<button class="seg ${uu===u?'on':''}" onclick="pbUnit('${uu}')">${uu}<i>${UNIT_FULL[uu]}</i></button>`).join('');
  const chips = [1,6,12].map(v=>`<button class="qchip" onclick="pbSet(${v})">${v}</button>`).join('');
  return `<div class="pb-card">
    <div class="pb-flag">${ic('scan')} สแกนแล้ว · ใส่จำนวนที่นับได้</div>
    <div class="pb-top">
      ${thumb(p,44)}
      <div class="pb-info">
        <div class="pb-name">${p.name}</div>
        <div class="pb-sub">${S.pendingB.key} · 1 ${u} = ${p.factors[u]||1} ชิ้น</div>
      </div>
      <button class="pb-x" onclick="pbCancel()" title="ยกเลิก">${ic('x')}</button>
    </div>
    <div class="seg-row seg-3 pb-seg">${unitSel}</div>
    <div class="pb-row">
      <button class="step-btn" onclick="pbBump(-1)">${ic('minus')}</button>
      <input id="pbInput" class="pb-qty" type="text" inputmode="numeric" value="${qty}"
             onfocus="this.select()" oninput="pbLive(this)" onkeydown="pbKey(event)">
      <button class="step-btn" onclick="pbBump(1)">${ic('plus')}</button>
    </div>
    <div class="qchips">${chips}<span class="qeq">= ${fmtNum(pieces)} ชิ้น</span></div>
    <button class="btn btn-primary btn-block pb-add" onclick="pbConfirm()">${ic('check')} เพิ่มเข้ารายการ</button>
  </div>`;
}
function pbLive(el){ if(S.pendingB) S.pendingB.qty = Math.max(0, parseInt(el.value,10)||0); }
function pbKey(e){ if(e.key==='Enter'){ e.preventDefault(); pbConfirm(); } }
function pbBump(d){ if(!S.pendingB) return; S.pendingB.qty = Math.max(0, S.pendingB.qty + d); renderKeepScroll(); }
function pbSet(v){ if(!S.pendingB) return; S.pendingB.qty = v; renderKeepScroll(); }
function pbUnit(u){ if(!S.pendingB) return; S.pendingB.unit = u; renderKeepScroll(); }
function pbConfirm(){
  if(!S.pendingB) return;
  const { key, unit, qty } = S.pendingB;
  if(qty<=0){ pbCancel(); return; }
  addCount(key, unit, qty); moveFront(key);
  S.pendingB = null; S._refocusBC = true; S._scrollTop = true;
  render();
  toast(`เพิ่ม ${qty} ${unit} · ${PROD_BY_KEY[key].short}`,'ok');
}
function pbCancel(){ S.pendingB = null; S._refocusBC = true; render(); }

/* ============================================================
   LIST sheet (A & C) — full counted list with inline edit
   ============================================================ */
function renderListSheet(){
  const items = Object.values(S.items);
  const list = items.length ? items.map(rowB).join('')
    : `<div class="empty sm">${ic('list')}<div>ยังไม่มีรายการนับ</div></div>`;
  return `<div class="screen">
    ${appBar('รายการที่นับ',{back:"go('count')"})}
    <div class="livebar">
      ${statusChips()}
      <div class="live-n">${items.length} รายการ</div>
    </div>
    <div class="scroll pad-list" id="scrollArea">${list}</div>
    <div class="dock">
      <button class="btn btn-soft grow" onclick="go('count')">${ic('scan')} นับต่อ</button>
      <button class="btn btn-primary grow" onclick="go('summary')">${ic('chart')} ดูสรุปผล</button>
    </div>
  </div>`;
}

function removeItem(key){
  const it = S.items[key]; if(!it) return;
  if(!confirm(`ลบ “${it.short}” ออกจากการนับ?`)) return;
  delete S.items[key];
  if(S.expand===key) S.expand=null;
  render();
}
function clearAll(){
  if(!Object.keys(S.items).length) return;
  if(!confirm('ล้างรายการนับทั้งหมดของคลังนี้?')) return;
  S.items={}; S.expand=null; render();
  toast('ล้างรายการแล้ว','ok');
}

/* ============================================================
   DESKTOP layout (Direction B, wide screens / PC + USB scanner)
   Left = scan + count list · Right = live summary
   ============================================================ */
function renderDesktop(){
  const items = Object.values(S.items);
  const rows = summaryRows();
  const listHtml = items.length ? items.map(rowB).join('')
    : `<div class="empty sm">${ic('list')}<div>ยังไม่มีรายการ</div><p>ยิงหรือพิมพ์บาร์โค้ดเพื่อเริ่มนับ</p></div>`;
  const egCodes = ['8851959030011','8850999320014','8850987654003'];
  const egChips = egCodes.map(c=>`<button class="eg-chip" onclick="bcFill('${c}')">${c}</button>`).join('');
  return `<div class="dsk">
    <header class="dsk-bar">
      <div class="ab-logo">R</div>
      <div class="dsk-brand">RATTANA <b>STOCK</b></div>
      <div class="dsk-bar-sp"></div>
      <button class="wh-chip dark" onclick="go('warehouse')">${ic('pin')}<span>${S.wh} · ${WH_NAMES[S.wh]||''}</span></button>
      <button class="dsk-userbtn" onclick="logout()">${ic('logout')} ออกจากระบบ</button>
    </header>
    <div class="dsk-body">
      <section class="dsk-left">
        <div class="dsk-scan">
          <div class="dsk-scan-row">
            <div class="bc-input lg">${ic('search')}
              <input id="bcInput" type="text" inputmode="numeric" autocomplete="off"
                     placeholder="ยิงด้วยเครื่องสแกน USB หรือพิมพ์บาร์โค้ด แล้วกด Enter"
                     oninput="bcLive(this)" onkeydown="bcKey(event)">
              <button class="bc-go" onclick="bcSubmit()" title="เพิ่ม">${ic('next')}</button>
            </div>
            <button class="cam-btn lg" onclick="openScan()" title="เปิดกล้อง">${ic('camera')}</button>
          </div>
          <div class="dsk-eg"><span class="bc-eg-l">เครื่องยิงจะกรอกให้อัตโนมัติ · ลองพิมพ์:</span>${egChips}</div>
        </div>
        <div class="dsk-left-head">
          <div class="dsk-h">${ic('list')} รายการที่นับ <span class="dsk-n">${items.length}</span></div>
          ${items.length?`<button class="lnk-clear" onclick="clearAll()">${ic('trash')} ล้างทั้งหมด</button>`:''}
        </div>
        <div class="dsk-list scroll" id="scrollArea">${pendingCardB()}${listHtml}</div>
      </section>
      <aside class="dsk-right">
        <div class="dsk-right-head">
          <div class="dsk-h">${ic('chart')} สรุปผลสด</div>
          <div class="sum-count">${rows.length} รายการ · คลัง ${S.wh}</div>
        </div>
        ${statTilesHtml(rows)}
        <div class="dsk-sum scroll" id="sumScroll">${summaryListHtml(rows)}</div>
        <div class="dsk-actions">
          <button class="btn btn-ghost" onclick="toast('ดาวน์โหลดไฟล์ Excel แล้ว (ตัวอย่าง)','ok')">${ic('download')} Excel</button>
          <button class="btn btn-primary grow" onclick="toast('บันทึกลง Google Sheet แล้ว','ok')">${ic('cloud')} บันทึกผล</button>
        </div>
      </aside>
    </div>
  </div>`;
}

function afterRender(){
  if(DIR==='B' && (isDesktop() || S.screen==='count')){
    if(S._scrollTop){ const sc=document.getElementById('scrollArea'); if(sc) sc.scrollTop=0; S._scrollTop=false; }
    if(S.pendingB){ const i=document.getElementById('pbInput'); if(i){ i.focus(); try{i.select();}catch(e){} } return; }
    if(S._refocusBC){ const inp=document.getElementById('bcInput'); if(inp){ inp.focus(); } S._refocusBC=false; }
  }
}
