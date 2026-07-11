// ═══════════════════════════════════════════════════════════════
//  Rattana Stock Checker — GAS Backend  v2.2
//  Deploy ครั้งเดียว — route ข้อมูลไปยัง Sheet แยกต่อคลังอัตโนมัติ
//
//  วิธี setup (ครั้งแรก):
//  1. วาง code นี้ใน Apps Script project ใหม่ (standalone)
//  2. รัน setupSheets() — จะสร้าง Google Sheet 5 ไฟล์ให้อัตโนมัติ
//     แล้ว log Spreadsheet ID ออกมาใน Execution log
//  3. Copy ID แต่ละคลัง ใส่ใน WAREHOUSE_SHEET_IDS ด้านล่าง
//  4. Deploy → New deployment → Web app
//       Execute as: Me / Who has access: Anyone
//  5. Copy URL ใส่ใน COUNT_SAVE_URL ในแอป
//
//  Sheets ที่สร้างให้เองในแต่ละ Spreadsheet:
//    History — บันทึกผลการนับรอบสุดท้าย
//
//  Draft ระหว่างนับ → CacheService (ไม่แตะ Sheet, auto-expire 6 ชั่วโมง)
// ═══════════════════════════════════════════════════════════════

// ── ใส่ Spreadsheet ID ของแต่ละคลังที่นี่ ──────────────────
// (รัน setupSheets() แล้ว copy ID จาก Execution log มาวางที่นี่)
const WAREHOUSE_SHEET_IDS = {
  W1: "17nTzpxVarjRZ19emirnol-k25RDuLgICUynf1-q2ZL8",
  W2: "15Ul4_M17EjTE6Q7mQi2EjSuU1f9rlXVvwArmJ4_FkB0",
  W3: "18PYOY8bcyFbSysxQ_Vd04hDLs9eV6FTaIfuyDryi54E",
  W4: "16oVMcnO-Oet110GmjJnbCqsBhubeE2HKr6kBPSDuflo",
  C4: "1tM1Nz8uDkdvXA19Pfmn50zy-pY1cXUN7WkUEvTk687E",
};

// ── รันครั้งเดียวเพื่อสร้าง Google Sheet ทุกคลัง ────────────
function setupSheets() {
  const WH_NAMES = { W1:'สมุทรสงคราม', W2:'สุพรรณบุรี', W3:'ราชบุรี', W4:'นครปฐม', C4:'รัตนมาร์ท' };
  const results = [];
  Object.keys(WH_NAMES).forEach(function(wh) {
    const existing = WAREHOUSE_SHEET_IDS[wh];
    if (existing) {
      Logger.log(wh + ' (' + WH_NAMES[wh] + '): ใช้ ID เดิม → ' + existing);
      results.push(wh + ': "' + existing + '"');
      return;
    }
    const ss = SpreadsheetApp.create('Rattana Stock Checker — ' + wh + ' ' + WH_NAMES[wh]);
    Logger.log(wh + ' (' + WH_NAMES[wh] + '): สร้างใหม่ → ' + ss.getId());
    Logger.log('  URL: ' + ss.getUrl());
    results.push(wh + ': "' + ss.getId() + '"');
  });
  Logger.log('');
  Logger.log('═══ copy ไปใส่ใน WAREHOUSE_SHEET_IDS ═══');
  Logger.log('const WAREHOUSE_SHEET_IDS = {');
  results.forEach(function(line) { Logger.log('  ' + line + ','); });
  Logger.log('};');
}

function ssFor_(wh) {
  const id = WAREHOUSE_SHEET_IDS[String(wh || '').toUpperCase()];
  if (!id) throw new Error('ไม่พบ Spreadsheet ID สำหรับคลัง ' + wh + ' — กรุณารัน setupSheets() ก่อน');
  return SpreadsheetApp.openById(id);
}

// ── HELPERS ──────────────────────────────────────────────────
const TZ = 'Asia/Bangkok';

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreate_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (_) { return { ok: false, error: 'ระบบยุ่ง ลองใหม่อีกครั้ง' }; }
  try { return fn(); } finally { try { lock.releaseLock(); } catch (_) {} }
}

function draftKey_(userKey, warehouse) {
  return 'draft_' + String(userKey || '').toLowerCase() + '_' + String(warehouse || '').toUpperCase();
}

// ── ROUTING ──────────────────────────────────────────────────
function doGet(e) {
  const p = e.parameter || {};
  try {
    if (p.action === 'ping')    return json_({ ok: true, v: '2.2' });
    if (p.action === 'history') return json_(getHistory_());
    if (p.action === 'draft')   return json_(getDraft_(p.userKey, p.warehouse));
    if (p.action === 'putaway') return json_(putawayList_());
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) { return json_({ ok: false, error: err.message }); }
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (_) {}
  const action = body.action || '';
  try {
    if (action === 'saveDraft')     return json_(saveDraft_(body));
    if (action === 'clearDraft')    return json_(clearDraft_(body));
    if (action === 'putawayAdd')    return json_(withLock_(() => putawayAdd_(body)));
    if (action === 'putawayRemove') return json_(withLock_(() => putawayRemove_(body)));
    if (!action && Array.isArray(body.rows)) return json_(withLock_(() => saveCount_(body)));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) { return json_({ ok: false, error: err.message }); }
}

// ── DRAFTS (CacheService — ไม่มี Sheet) ─────────────────────
const DRAFT_TTL = 21600; // 6 ชั่วโมง

function saveDraft_(b) {
  const key = draftKey_(b.userKey, b.warehouse);
  const val = JSON.stringify({
    userKey:      String(b.userKey || '').toLowerCase(),
    warehouse:    String(b.warehouse || '').toUpperCase(),
    items:        b.items || {},
    updatedAt:    new Date().toISOString(),
    sessionStart: b.sessionStart || ''
  });
  CacheService.getScriptCache().put(key, val, DRAFT_TTL);
  return { ok: true };
}

function clearDraft_(b) {
  CacheService.getScriptCache().remove(draftKey_(b.userKey, b.warehouse));
  return { ok: true };
}

function getDraft_(userKey, warehouse) {
  const raw = CacheService.getScriptCache().get(draftKey_(userKey, warehouse));
  if (!raw) return { ok: true, draft: null };
  try { return { ok: true, draft: JSON.parse(raw) }; }
  catch (_) { return { ok: true, draft: null }; }
}

// ── HISTORY ──────────────────────────────────────────────────
const HIST_HEADERS = [
  'savedAt','warehouse','empId','counterName','sessionStart','email',
  'key','name','cs','bp','pa','ea','countedPieces',
  'systemRaw','systemPieces','diffPieces','diffCSEA','status','expiryDate'
];

// แปลงวันที่ทุกอันให้เป็นรูปแบบเดียวกัน → "yyyy-MM-dd HH:mm:ss" เวลาไทย เช่น 2026-07-01 14:00:50
function fmtDT_(v) {
  if (!v) return '';
  const d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm:ss');
}

function saveCount_(b) {
  const ss = ssFor_(b.warehouse);
  const sh = getOrCreate_(ss, 'History', HIST_HEADERS);
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) return { ok: false, error: 'no rows' };
  const savedAt = fmtDT_(b.savedAt || new Date().toISOString());
  const session = fmtDT_(b.sessionStart || '');
  const out = rows.map(function(r) {
    return [
      savedAt,
      b.warehouse || '',
      b.empId || '',
      b.counterName || b.name || '',
      session,
      b.email || '',
      r.key || '',
      r.name || '',
      r.cs || 0, r.bp || 0, r.pa || 0, r.ea || 0,
      r.countedPieces || 0,
      r.systemRaw || '',
      r.systemPieces || 0,
      r.diffPieces || 0,
      r.diffCSEA || '',
      r.status || '',
      r.expiryDate || ''
    ];
  });
  const startRow = sh.getLastRow() + 1;
  // ตั้ง format เป็น "ข้อความ" ก่อนเขียน เพื่อกัน 0 หน้าบาร์โค้ดหาย
  sh.getRange(startRow, 1, out.length, 1).setNumberFormat('@'); // savedAt
  sh.getRange(startRow, 7, out.length, 1).setNumberFormat('@'); // key (บาร์โค้ด)
  sh.getRange(startRow, 1, out.length, out[0].length).setValues(out);
  return { ok: true, written: out.length };
}

// ── BACKFILL ─────────────────────────────────────────────────
// รันครั้งเดียว: แปลง savedAt + sessionStart ของแถวเก่าให้เป็น "yyyy-MM-dd HH:mm:ss"
// และลบคอลัมน์ "(ไทย)" 2 คอลัมน์ท้ายตารางออก (ถ้ามี) ให้รูปแบบเหมือนกันหมด
function backfillDateFormat() {
  Object.keys(WAREHOUSE_SHEET_IDS).forEach(function(wh) {
    const id = WAREHOUSE_SHEET_IDS[wh];
    if (!id) return;
    const sh = SpreadsheetApp.openById(id).getSheetByName('History');
    if (!sh) { Logger.log(wh + ': ไม่มีชีต History'); return; }

    // ลบคอลัมน์ไทยท้ายตาราง (U แล้ว T) ถ้าหัวตรง
    [21, 20].forEach(function(col) {
      if (sh.getMaxColumns() >= col) {
        const hdr = String(sh.getRange(1, col).getValue() || '');
        if (hdr.indexOf('ไทย') !== -1) sh.deleteColumn(col);
      }
    });

    const lastRow = sh.getLastRow();
    if (lastRow < 2) { Logger.log(wh + ': ไม่มีข้อมูล'); return; }
    const n = lastRow - 1;
    const savedVals   = sh.getRange(2, 1, n, 1).getValues();  // col A
    const sessionVals = sh.getRange(2, 5, n, 1).getValues();  // col E
    const outSaved = [], outStart = [];
    for (let i = 0; i < n; i++) {
      outSaved.push([ fmtDT_(savedVals[i][0]) ]);
      outStart.push([ fmtDT_(sessionVals[i][0]) ]);
    }
    sh.getRange(2, 1, n, 1).setNumberFormat('@').setValues(outSaved);
    sh.getRange(2, 5, n, 1).setNumberFormat('@').setValues(outStart);
    Logger.log(wh + ': แปลงแล้ว ' + n + ' แถว');
  });
  Logger.log('เสร็จสิ้น ✓');
}

// ── PUTAWAY (จุดวาง) — แยกเก็บในไฟล์ของแต่ละคลัง (แท็บ Putaway ใน spreadsheet เดียวกับ History) ──
const PUTAWAY_HEADERS = ['id','savedAt','warehouse','empId','counterName','key','name','pallets','location','status','removedAt','removedBy'];

function putawaySheetFor_(wh) {
  return getOrCreate_(ssFor_(wh), 'Putaway', PUTAWAY_HEADERS);
}

function putawayAdd_(b) {
  const sh = putawaySheetFor_(b.warehouse);
  const id = Utilities.getUuid();
  const row = [ id, fmtDT_(new Date().toISOString()), b.warehouse || '', b.empId || '',
    b.counterName || '', b.key || '', b.name || '', Number(b.pallets) || 0,
    b.location || '', 'active', '', '' ];
  const startRow = sh.getLastRow() + 1;
  sh.getRange(startRow, 1, 1, 1).setNumberFormat('@'); // id เป็นข้อความ
  sh.getRange(startRow, 6, 1, 1).setNumberFormat('@'); // key (บาร์โค้ด) เป็นข้อความ
  sh.getRange(startRow, 1, 1, row.length).setValues([row]);
  return { ok: true, id: id };
}

// ค้นหา id ในทุกคลัง แล้ว mark เป็น removed (soft delete — เก็บประวัติไว้)
function putawayRemove_(b) {
  const target = String(b.id || '');
  if (!target) return { ok: false, error: 'no id' };
  const whs = Object.keys(WAREHOUSE_SHEET_IDS);
  for (let w = 0; w < whs.length; w++) {
    const id = WAREHOUSE_SHEET_IDS[whs[w]];
    if (!id) continue;
    try {
      const sh = SpreadsheetApp.openById(id).getSheetByName('Putaway');
      if (!sh) continue;
      const data = sh.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === target && String(data[i][9]) !== 'removed') {
          sh.getRange(i + 1, 10).setValue('removed');
          sh.getRange(i + 1, 11).setValue(fmtDT_(new Date().toISOString()));
          sh.getRange(i + 1, 12).setValue(b.counterName || '');
          return { ok: true };
        }
      }
    } catch (_) {}
  }
  return { ok: false, error: 'not found' };
}

function putawayList_() {
  const rows = [];
  Object.keys(WAREHOUSE_SHEET_IDS).forEach(function(wh) {
    const id = WAREHOUSE_SHEET_IDS[wh];
    if (!id) return;
    try {
      const sh = SpreadsheetApp.openById(id).getSheetByName('Putaway');
      if (!sh) return;
      const data = sh.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const r = data[i];
        if (String(r[9]) === 'removed') continue; // แสดงเฉพาะที่ยังวางอยู่
        rows.push({
          id: String(r[0] || ''), savedAt: String(r[1] || ''), warehouse: String(r[2] || ''),
          empId: String(r[3] || ''), counterName: String(r[4] || ''), key: String(r[5] || ''),
          name: String(r[6] || ''), pallets: Number(r[7]) || 0, location: String(r[8] || '')
        });
      }
    } catch (_) {}
  });
  rows.sort(function(a, b) { return (b.savedAt || '').localeCompare(a.savedAt || ''); });
  return { ok: true, rows: rows };
}

function getHistory_() {
  const rows = [];
  Object.keys(WAREHOUSE_SHEET_IDS).forEach(function(wh) {
    const id = WAREHOUSE_SHEET_IDS[wh];
    if (!id) return;
    try {
      const sh = SpreadsheetApp.openById(id).getSheetByName('History');
      if (!sh) return;
      const data = sh.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const r = data[i];
        rows.push({
          savedAt:       String(r[0]  || ''),
          warehouse:     String(r[1]  || ''),
          empId:         String(r[2]  || ''),
          counterName:   String(r[3]  || ''),
          sessionStart:  String(r[4]  || ''),
          email:         String(r[5]  || ''),
          key:           String(r[6]  || ''),
          name:          String(r[7]  || ''),
          cs:            Number(r[8])  || 0,
          bp:            Number(r[9])  || 0,
          pa:            Number(r[10]) || 0,
          ea:            Number(r[11]) || 0,
          countedPieces: Number(r[12]) || 0,
          systemRaw:     String(r[13] || ''),
          systemPieces:  Number(r[14]) || 0,
          diffPieces:    Number(r[15]) || 0,
          diffCSEA:      String(r[16] || ''),
          status:        String(r[17] || ''),
          expiryDate:    String(r[18] || '')
        });
      }
    } catch(_) {}
  });
  rows.sort(function(a, b) { return (b.savedAt || '').localeCompare(a.savedAt || ''); });
  return { ok: true, rows: rows.slice(0, 500) };
}
