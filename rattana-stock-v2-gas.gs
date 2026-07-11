// ═══════════════════════════════════════════════════════
//  Rattana Stock Count — GAS Backend  v1.22  (เวลาบันทึก includes seconds → precise sort)
//  Sheet: 18Yn-gru-0BG1FPgsqxANFvuXULgFurK2t1TPIz1vOG4
//  Used by: rattana-stock-v2.html
//
//  v1.3 — All written timestamps are Thai-formatted text:
//         "DD/MM/YYYY HH.mm.ss" with พ.ศ. year, Asia/Bangkok TZ.
//         getDraft / getAllDrafts / getHistory still return epoch ms
//         to the app (so app code is unchanged).
// ═══════════════════════════════════════════════════════

const SS_ID = '18Yn-gru-0BG1FPgsqxANFvuXULgFurK2t1TPIz1vOG4';   // default file (W1, W2, W3, …)
const TZ    = 'Asia/Bangkok';
const GAS_VERSION = 'v1.24';   // bump on every deploy — check with ?action=ping

// ═════════════════════════════════════════════════════════════
//  PER-WAREHOUSE SPREADSHEET ROUTING
//  C4 and W4 each live in their own Google Sheet file.
//  1) Run setupC4W4Sheets() once from the Apps Script editor —
//     check the Logger output for the new spreadsheet IDs.
//  2) Paste those IDs below.
//  3) Anything not listed here falls back to the default SS_ID.
// ═════════════════════════════════════════════════════════════
const WAREHOUSE_SS_ID = {
  'C4':  '18L3B1A5e2xEGW1Hgh4lBvskb5tVKqIeao9C3ift9CpU',   // C4 V2 — fresh empty sheet (old 1rWZ7... kept for the 9,300 prior rows)
  'W4':  '18RojK-hmI3-sqh6bRh3YVdt4EZ8EGYHgMGRLxrqkqxw',
  'EW4': '18RojK-hmI3-sqh6bRh3YVdt4EZ8EGYHgMGRLxrqkqxw'  // คลังของเสีย — ใช้ไฟล์เดียวกับ W4
};

function ssFor(wh) {
  const id = WAREHOUSE_SS_ID[String(wh || '').toUpperCase()] || SS_ID;
  return SpreadsheetApp.openById(id);
}

// Run this ONCE from the Apps Script editor. It creates two new Google
// Sheets (one for C4, one for W4) in your Drive and prints the IDs +
// URLs to the Logger. Copy the IDs into the WAREHOUSE_SS_ID map above.
function setupC4W4Sheets() {
  const c4 = SpreadsheetApp.create('Rattana Stock — C4');
  const w4 = SpreadsheetApp.create('Rattana Stock — W4');
  Logger.log('────── C4 ──────');
  Logger.log('ID:  ' + c4.getId());
  Logger.log('URL: ' + c4.getUrl());
  Logger.log('────── W4 ──────');
  Logger.log('ID:  ' + w4.getId());
  Logger.log('URL: ' + w4.getUrl());
  Logger.log('');
  Logger.log('→ paste the IDs above into WAREHOUSE_SS_ID and redeploy.');
}

// ── TIME HELPERS ──────────────────────────────────────
function thaiDateTime(input) {
  let d = input;
  if (!d) d = new Date();
  else if (!(d instanceof Date)) d = new Date(d);
  if (!d || isNaN(d)) return '';
  const s = Utilities.formatDate(d, TZ, 'dd/MM/yyyy HH:mm');
  const parts = s.split(' ');
  const dmy = parts[0].split('/');
  const beYear = parseInt(dmy[2], 10) + 543;
  return dmy[0] + '/' + dmy[1] + '/' + beYear + ' ' + parts[1];
}

// Like thaiDateTime but WITH seconds — used for เวลาบันทึก so same-minute scans
// get distinct timestamps and sort correctly (newest first).
function thaiDateTimeSec(input) {
  let d = input;
  if (!d) d = new Date();
  else if (!(d instanceof Date)) d = new Date(d);
  if (!d || isNaN(d)) return '';
  const s = Utilities.formatDate(d, TZ, 'dd/MM/yyyy HH:mm:ss');
  const parts = s.split(' ');
  const dmy = parts[0].split('/');
  const beYear = parseInt(dmy[2], 10) + 543;
  return dmy[0] + '/' + dmy[1] + '/' + beYear + ' ' + parts[1];
}

// Accept Date object, ISO string, epoch ms, or Thai-formatted text.
// Returns Date or null.
function parseAnyTs(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') {
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  const s = String(v).trim();
  // Thai format: DD/MM/YYYY HH.MM.SS (year is BE)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})[.:](\d{2})(?:[.:](\d{2}))?$/);
  if (m) {
    const day   = m[1].length === 1 ? '0' + m[1] : m[1];
    const month = m[2].length === 1 ? '0' + m[2] : m[2];
    const year  = parseInt(m[3], 10) - 543;
    const hh    = m[4].length === 1 ? '0' + m[4] : m[4];
    const mm    = m[5];
    const ss    = m[6] || '00';
    // Build ISO with +07:00 — works in every modern engine
    const d = new Date(year + '-' + month + '-' + day + 'T' + hh + ':' + mm + ':' + ss + '+07:00');
    return isNaN(d) ? null : d;
  }
  // ISO or other parseable form
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function tsMs(v) { const d = parseAnyTs(v); return d ? d.getTime() : 0; }

// Robust timestamp (ms) for sort. Handles เวลาบันทึก cells that Sheets auto-typed
// to a DATE, reading the Buddhist year (e.g. 2569) literally as CE → a date ~543y in
// the future. We detect year>2200 and shift it back so old + new rows are comparable.
function lotTs_(v) {
  if (v instanceof Date) {
    if (isNaN(v)) return 0;
    var y = v.getFullYear();
    if (y > 2200) return new Date(y - 543, v.getMonth(), v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds()).getTime();
    return v.getTime();
  }
  return tsMs(v);   // text path — tsMs/parseAnyTs already converts BE→CE
}

// Normalize any expiry value → "YYYY-MM-DD" (handles Date cells and ISO-with-time
// like "2027-12-31T17:00:00.000Z" that Sheets produces when a cell auto-types to date).
function isoDate_(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return isNaN(v) ? '' : Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const m = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(v).trim();
}

// Thai expiry "DD/MM/BE" (or a Date / ISO) → "YYYY-MM-DD". Fallback for the
// วันหมดอายุ column (O) when expiryISO (P) is blank on older / imported rows.
function thaiToIso_(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    if (isNaN(v)) return '';
    var y = v.getFullYear();
    if (y > 2200) y -= 543;   // BE year read literally as CE
    return Utilities.formatDate(new Date(y, v.getMonth(), v.getDate(), 12, 0, 0), TZ, 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);           // already ISO
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);       // DD/MM/YYYY (BE or CE)
  if (m) {
    var day = ('0' + m[1]).slice(-2);
    var mon = ('0' + m[2]).slice(-2);
    var yr  = parseInt(m[3], 10);
    if (yr > 2200) yr -= 543;                              // BE → CE
    return yr + '-' + mon + '-' + day;
  }
  return '';
}

// ── ROUTING ───────────────────────────────────────────
function doGet(e) {
  const p = e.parameter || {};
  const action = p.action || '';
  try {
    if (action === 'ping')       return json({ ok: true, version: GAS_VERSION });
    if (action === 'liveLots')   return json(getLiveLots(p));
    if (action === 'summary')    return json(getSummary(p));
    if (action === 'getHistory' || action === 'history') return json(getHistory(p));
    // Retired Drafts endpoints — answer harmlessly for any cached old client.
    if (action === 'draft')      return json({ ok: true, draft: null });
    if (action === 'allDrafts')  return json({ ok: true, drafts: [] });
    return json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

// All write operations go through a script-wide lock so two users editing
// at the same time can't interleave a read-modify-write on the sheet
// (which would otherwise duplicate or lose rows). Reads (doGet) are NOT
// locked — they can run concurrently and only ever read.
function withLock(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);   // wait up to 20s for our turn
  } catch (e) {
    return { ok: false, error: 'busy — ระบบกำลังถูกใช้งานหนัก ลองใหม่อีกครั้ง' };
  }
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (_) {}
  const action = body.action || '';
  try {
    if (action === 'upsertLot')  return json(withLock(() => upsertLot(body)));
    if (action === 'deleteLot')  return json(withLock(() => deleteLot(body)));
    if (action === 'deleteByKey') return json(withLock(() => deleteByKey(body)));
    if (action === 'clearLive')  return json(withLock(() => clearLiveForUser(body)));
    if (action === 'reserveDocNo') return json(withLock(() => reserveDocNo(body)));
    if (action === 'confirmDone')  return json(withLock(() => confirmDone(body)));
    if (action === 'saveCount' || (!action && Array.isArray(body.rows))) {
      return json(withLock(() => saveCount(body)));
    }
    // Retired Drafts endpoints — accept and ignore so old clients don't error
    // or recreate the Drafts sheet.
    if (action === 'saveDraft' || action === 'clearDraft') return json({ ok: true });
    return json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

// ── RUNNING DOCUMENT NUMBERS (shared, collision-free) ────────
// Stored in a "DocCounters" sheet: kind | lastDocNo. Under the script lock,
// reserveDocNo hands out a contiguous block so two users exporting at the
// same moment can never get overlapping numbers.
function gsNextDocNo(s){
  const m = String(s || '').match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return String(s || '');
  const width = m[2].length;
  const n = (parseInt(m[2], 10) + 1).toString().padStart(width, '0');
  return m[1] + n + m[3];
}
function gsDocNum(s){ const m = String(s || '').match(/(\d+)(\D*)$/); return m ? parseInt(m[1], 10) : -1; }

// body: { kind, current, count }
//   kind    — 'move' | 'in' | 'out'
//   current — the doc number the user typed (a floor)
//   count   — how many documents to reserve
// returns { ok, first }  — the first doc number to use; reserves `count` of them.
function reserveDocNo(b){
  const sh = getOrCreate(SpreadsheetApp.openById(SS_ID), 'DocCounters', ['kind','lastDocNo']);
  const data = sh.getDataRange().getValues();
  const kind = String(b.kind || '');
  const count = Math.max(1, parseInt(b.count, 10) || 1);
  let rowIdx = -1, stored = '';
  for (let i = 1; i < data.length; i++){
    if (String(data[i][0]) === kind){ rowIdx = i + 1; stored = String(data[i][1]); break; }
  }
  // Base = whichever is higher: the stored last number, or the user's current.
  let base = (gsDocNum(stored) >= gsDocNum(b.current)) ? stored : String(b.current || '');
  const first = gsNextDocNo(base);
  let last = first;
  for (let k = 1; k < count; k++) last = gsNextDocNo(last);
  if (rowIdx > 0) { sh.getRange(rowIdx, 2).setNumberFormat('@'); sh.getRange(rowIdx, 2).setValue(last); }
  else { sh.appendRow([kind, '']); const r = sh.getLastRow(); sh.getRange(r, 2).setNumberFormat('@'); sh.getRange(r, 2).setValue(last); }
  return { ok: true, first: first, last: last };
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// getOrCreate(name, headers)              → default spreadsheet (back-compat)
// getOrCreate(ss,   name, headers)         → a specific spreadsheet
function getOrCreate(a, b, c) {
  let ss, name, headers;
  if (a && typeof a === 'object' && a.getSheetByName) {
    ss = a; name = b; headers = c;
  } else {
    ss = SpreadsheetApp.openById(SS_ID); name = a; headers = b;
  }
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

// ── (Drafts sheet retired — Live_<wh> is the only backend now) ──

// ── SAVE COUNT (final submit — writes flat rows) ──────
function saveCount(b) {
  const sh = getOrCreate(ssFor(b.warehouse), 'StockCount', [
    'savedAt','warehouse','location','empId','name','email',
    'sessionStart','รหัสสินค้า','ชื่อสินค้า',
    'CS','BP','PA','EA','นับได้(ชิ้น)',
    'สต็อกระบบ(CS.EA)','สต็อกระบบ(ชิ้น)',
    'ต่าง(ชิ้น)','ต่าง(CS.EA)','สถานะ','วันหมดอายุ'
  ]);
  const now = thaiDateTime(new Date());
  const startThai = thaiDateTime(b.sessionStart || b.startedAt || new Date());
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) return { ok: false, error: 'no rows' };

  const out = rows.map(function(r){
    return [
      now,
      b.warehouse || '',
      r.location || b.location || '',
      b.empId || '',
      b.counterName || b.name || '',
      b.email || '',
      startThai,
      r.key || '',
      r.name || '',
      r.cs || 0,
      r.bp || 0,
      r.pa || 0,
      r.ea || 0,
      r.countedPieces || 0,
      r.systemRaw || '',
      r.systemPieces || 0,
      r.diffPieces || 0,
      r.diffCSEA || '',
      r.status || '',
      r.expiryDate ? thaiDateTime(r.expiryDate + 'T00:00:00+07:00').split(' ')[0] : ''
    ];
  });
  sh.getRange(sh.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);

  // Remove this user's live lot rows after a final save.
  try { clearLiveForUser({ userKey: b.userKey, warehouse: b.warehouse }); } catch (_) {}

  return { ok: true, written: out.length };
}

// ═══════════════════════════════════════════════════════
//  LIVE LOT SHEET  (1 lot = 1 row, fully addressable by lotId)
//  Columns:
//   0  lotId         (uuid)
//   1  เวลาบันทึก    (Thai-formatted)
//   2  warehouse
//   3  location
//   4  empId
//   5  ผู้นับ
//   6  userKey        (machine — for filtering own rows)
//   7  รหัสสินค้า
//   8  ชื่อสินค้า
//   9  factors_json   (so the app can compute pieces correctly)
//  10  CS
//  11  BP
//  12  PA
//  13  EA
//  14  วันหมดอายุ    (DD/MM/YYYY BE)
//  15  expiryISO      (YYYY-MM-DD — for parsing)
//  16  sessionStart   (Thai-formatted)
// ═══════════════════════════════════════════════════════
const LIVE_HEADERS = [
  'lotId','เวลาบันทึก','warehouse','location','empId','ผู้นับ','userKey',
  'รหัสสินค้า','ชื่อสินค้า','factors_json',
  'CS','BP','PA','EA','วันหมดอายุ','expiryISO','sessionStart',
  'นับได้(ชิ้น)','สต็อกระบบ(CS.EA)','สต็อกระบบ(ชิ้น)','ต่าง(ชิ้น)','ต่าง(CS.EA)',
  'เวลายืนยัน'
];
const DONE_COL = LIVE_HEADERS.length;   // 1-based column index of เวลายืนยัน (23)

// Per-warehouse sheets: Live_W1, Live_W2, Live_W3, Live_W4, Live_C4.
function liveSheetName(wh) {
  return 'Live_' + String(wh || '').toUpperCase();
}
function liveSheetFor(wh) {
  if (!wh) return null;
  return getOrCreate(ssFor(wh), liveSheetName(wh), LIVE_HEADERS);
}
// Backward-compat: search the legacy "Live" sheet in BOTH the warehouse's
// own spreadsheet and the default one so historical rows still surface.
function legacyLiveSheetsFor(wh) {
  const out = [];
  if (wh) {
    const s1 = ssFor(wh).getSheetByName('Live'); if (s1) out.push(s1);
  }
  const s2 = SpreadsheetApp.openById(SS_ID).getSheetByName('Live');
  if (s2 && (!out.length || out[0].getParent().getId() !== s2.getParent().getId())) out.push(s2);
  return out;
}
function findLiveRow(sh, lotId) {
  if (!sh || !lotId) return -1;
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(lotId)) return i + 1; // 1-based row index
  }
  return -1;
}

// Upsert one lot by lotId. Body must include: lotId, warehouse, userKey,
// key (product key), name, counts{EA,PA,BP,CS}, factors{...}, expiryDate,
// location, empId, counterName (optional), sessionStart (optional).
function upsertLot(b) {
  if (!b.lotId) return { ok:false, error:'lotId required' };
  if (!b.warehouse) return { ok:false, error:'warehouse required' };
  const sh = liveSheetFor(b.warehouse);
  const c = b.counts || {EA:0,PA:0,BP:0,CS:0};
  const f = b.factors || {EA:1,PA:1,BP:1,CS:1};
  const expIso = isoDate_(b.expiryDate);   // normalize (strips any time part) so the Thai column always computes
  const expThai = /^\d{4}-\d{2}-\d{2}$/.test(expIso) ? thaiDateTime(expIso + 'T00:00:00+07:00').split(' ')[0] : '';
  // Compute pieces / diff vs system stock (app sends systemRaw + systemPieces).
  const factorCS = f.CS || 1;
  const countedPieces = ['EA','PA','BP','CS'].reduce((s,u) => s + (c[u]||0) * (f[u]||1), 0);
  const systemRaw    = b.systemRaw != null ? String(b.systemRaw) : '';
  const systemPieces = (b.systemPieces != null) ? Number(b.systemPieces) || 0 : 0;
  const diffPieces   = countedPieces - systemPieces;
  const diffCSEA = (function() {
    if (diffPieces === 0) return '0';
    const sign = diffPieces > 0 ? '+' : '-';
    const a = Math.abs(diffPieces);
    const cs = Math.floor(a / factorCS), ea = a - cs * factorCS;
    return sign + cs + '.' + ea;
  })();
  const rowVals = [
    b.lotId,
    thaiDateTimeSec(new Date()),   // seconds → distinct sort key for same-minute scans
    b.warehouse || '',
    b.location || '',
    b.empId || '',
    b.counterName || b.name || '',
    (b.userKey || '').toString().toLowerCase(),
    b.key || '',
    b.productName || b.name || '',
    JSON.stringify(f),
    c.CS || 0,
    c.BP || 0,
    c.PA || 0,
    c.EA || 0,
    expThai,
    expIso,
    b.sessionStart ? thaiDateTime(b.sessionStart) : '',
    countedPieces,
    systemRaw,
    systemPieces,
    diffPieces,
    diffCSEA
  ];
  const row = findLiveRow(sh, b.lotId);
  const target = row > 0 ? row : sh.getLastRow() + 1;
  // Force the รหัสสินค้า column (col 8) to TEXT BEFORE writing, otherwise
  // Google Sheets converts an all-digit key like "00500100008" to the number
  // 500100008 and drops the leading zeros.
  sh.getRange(target, 8).setNumberFormat('@');
  // Keep เวลาบันทึก (2) as TEXT so the Buddhist-year string isn't auto-typed to a
  // far-future date (which broke newest-first sorting), and วันหมดอายุ (15) +
  // expiryISO (16) as TEXT so they don't become date cells either.
  sh.getRange(target, 2).setNumberFormat('@');
  sh.getRange(target, 15, 1, 2).setNumberFormat('@');
  sh.getRange(target, 1, 1, rowVals.length).setValues([rowVals]);
  return { ok: true };
}

// One-time cleanup — run from the Apps Script editor: backfillExpiryThai('C4').
// Fills blank วันหมดอายุ (col 15) from expiryISO (col 16) across the warehouse's
// live + archive sheets. Returns how many cells were filled.
function backfillExpiryThai(wh) {
  wh = String(wh || '').toUpperCase();
  const sheets = [liveSheetFor(wh)].concat(legacyLiveSheetsFor(wh));
  archiveSpecs_(wh).forEach(function (spec) {
    try { sheets.push(archiveSheet_(SpreadsheetApp.openById(spec.id), spec.gid, wh)); } catch (_) {}
  });
  let n = 0;
  sheets.filter(Boolean).forEach(function (sh) {
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const o = data[i][14];                 // วันหมดอายุ (0-based 14)
      const iso = isoDate_(data[i][15]);     // expiryISO  (0-based 15)
      if ((o === '' || o == null) && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        sh.getRange(i + 1, 15).setNumberFormat('@');
        sh.getRange(i + 1, 15).setValue(thaiDateTime(iso + 'T00:00:00+07:00').split(' ')[0]);
        n++;
      }
    }
  });
  try { cacheDelBig_('arch_' + wh); } catch (_) {}
  return n;
}

// REVERSE of backfillExpiryThai: fills blank expiryISO (col 16 / P) from the Thai
// วันหมดอายุ (col 15 / O) across the warehouse's live + archive sheets. Run once
// to make the expiry data actually appear in column P. Returns cells filled.
// Usage in the editor: select backfillExpiryIso_C4 from the function list → Run.
function backfillExpiryIso(wh) {
  wh = String(wh || '').toUpperCase();
  const sheets = [liveSheetFor(wh)].concat(legacyLiveSheetsFor(wh));
  archiveSpecs_(wh).forEach(function (spec) {
    try { sheets.push(archiveSheet_(SpreadsheetApp.openById(spec.id), spec.gid, wh)); } catch (_) {}
  });
  let n = 0;
  sheets.filter(Boolean).forEach(function (sh) {
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const p   = isoDate_(data[i][15]);     // expiryISO    (0-based 15 / col P)
      const iso = thaiToIso_(data[i][14]);   // from วันหมดอายุ (0-based 14 / col O)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p) && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        sh.getRange(i + 1, 16).setNumberFormat('@');   // keep as TEXT, not a date cell
        sh.getRange(i + 1, 16).setValue(iso);
        n++;
      }
    }
  });
  try { cacheDelBig_('arch_' + wh); } catch (_) {}
  return n;
}
function backfillExpiryIso_C4()  { return backfillExpiryIso('C4');  }
function backfillExpiryIso_W4()  { return backfillExpiryIso('W4');  }
function backfillExpiryIso_EW4() { return backfillExpiryIso('EW4'); }

function deleteLot(b) {
  if (!b.lotId) return { ok:false, error:'lotId required' };
  const wh = String(b.warehouse || '');
  // Scan the warehouse's own sheet + the default one + any ARCHIVE (old) sheets,
  // so a lot can be deleted from the app no matter which file it lives in
  // (incl. old C4 history). Each entry tracks whether it's an archive sheet.
  const tried = [];
  const seen = {};
  function consider(sh, isArchive) {
    if (!sh) return;
    const tag = sh.getParent().getId() + '::' + sh.getName();
    if (seen[tag]) return; seen[tag] = 1; tried.push({ sh: sh, isArchive: !!isArchive });
  }
  if (wh) consider(liveSheetFor(wh), false);
  [ssFor(wh), SpreadsheetApp.openById(SS_ID)].forEach(ss => {
    ss.getSheets().forEach(s => {
      const n = s.getName();
      if (n === 'Live' || n.indexOf('Live_') === 0) consider(s, false);
    });
  });
  archiveSpecs_(wh).forEach(spec => {
    try {
      const ss = SpreadsheetApp.openById(spec.id);
      // the exact gid tab the data lives in...
      consider(archiveSheet_(ss, spec.gid, wh), true);
      // ...plus any other Live* tabs, in case rows landed elsewhere.
      ss.getSheets().forEach(s => {
        const n = s.getName();
        if (n === 'Live' || n.indexOf('Live_') === 0) consider(s, true);
      });
    } catch (_) {}
  });
  let deletedArchive = false;
  for (const t of tried) {
    const row = findLiveRow(t.sh, b.lotId);
    if (row > 0) { t.sh.deleteRow(row); if (t.isArchive) deletedArchive = true; break; }
  }
  // If an archived row was removed, drop it from the 6h cache too so it
  // disappears immediately — surgically (no re-read of the big old sheet).
  if (deletedArchive && wh) {
    try {
      const cacheKey = 'arch_' + wh;
      const cached = cacheGetBig_(cacheKey);
      if (cached) {
        const arr = JSON.parse(cached).filter(function (l) { return String(l.lotId) !== String(b.lotId); });
        cachePutBig_(cacheKey, JSON.stringify(arr), 21600);
      }
    } catch (_) { cacheDelBig_('arch_' + wh); }
  }
  return { ok: true };
}

// Delete EVERY lot of a product (any user) in a warehouse — across the new sheet,
// legacy sheets, and archive (old) sheets. Powers the app's "ลบรายการนี้" so an
// item fully disappears (incl. teammates' lots + old archived rows).
function deleteByKey(b) {
  const wh = String(b.warehouse || '');
  const key = String(b.key || '');
  if (!wh || !key) return { ok:false, error:'warehouse + key required' };
  const keyAlt = key.replace(/^0+/, '');
  const match = function (v) { const s = String(v || ''); return s === key || s.replace(/^0+/, '') === keyAlt; };
  const targets = [], seen = {};
  function add(sh) { if (!sh) return; const t = sh.getParent().getId() + '::' + sh.getName(); if (seen[t]) return; seen[t] = 1; targets.push(sh); }
  add(liveSheetFor(wh));
  legacyLiveSheetsFor(wh).forEach(add);
  archiveSpecs_(wh).forEach(function (spec) { try { add(archiveSheet_(SpreadsheetApp.openById(spec.id), spec.gid, wh)); } catch (_) {} });
  let total = 0;
  targets.forEach(function (sh) {
    const data = sh.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][2] || '') === wh && match(data[i][7])) { sh.deleteRow(i + 1); total++; }
    }
  });
  try { cacheDelBig_('arch_' + wh); } catch (_) {}
  return { ok: true, deleted: total };
}

// Delete every live row for a given userKey + warehouse (called after final save).
function clearLiveForUser(b) {
  const uk = String(b.userKey || '').toLowerCase();
  const wh = String(b.warehouse || '');
  if (!wh) return { ok:false, error:'warehouse required' };
  const sheetsToScan = [liveSheetFor(wh)].concat(legacyLiveSheetsFor(wh)).filter(Boolean);
  sheetsToScan.forEach(sh => {
    const data = sh.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      const sameWh = String(data[i][2] || '') === wh;
      const sameUser = String(data[i][6] || '').toLowerCase() === uk;
      if (sameUser && (sameWh || sh.getName().indexOf('Live_') === 0)) {
        sh.deleteRow(i + 1);
      }
    }
  });
  return { ok: true };
}

// Return all live lots for a warehouse (everyone — team summary fans out from here)
// ── ARCHIVE (read-only) SPREADSHEETS ─────────────────────────
// Extra spreadsheets whose Live_<wh> rows are MERGED into the live view but never
// written to. Used to keep showing C4's old 9,300-row sheet after C4 moved to a
// fresh file. The old data is static, so it's cached 6h to avoid re-reading it on
// every poll. To turn this off, set the warehouse's list to [] (or remove it).
const ARCHIVE_SS_ID = {
  // old C4 history — read the EXACT tab the user pointed to (gid 796495760)
  'C4': [{ id: '1rWZ7_vWBTx7hcXucAtWNX3ruA5lVro90P3HkQ6amFMg', gid: 796495760 }]
};
// Normalize archive entries (string id OR {id, gid}) → [{id, gid}].
function archiveSpecs_(wh) {
  return (ARCHIVE_SS_ID[String(wh || '').toUpperCase()] || []).map(function (s) {
    return (typeof s === 'string') ? { id: s, gid: null } : { id: s.id, gid: (s.gid != null ? s.gid : null) };
  });
}
// Resolve the archive sheet: by gid if given, else by Live_<wh>/"Live" name.
function archiveSheet_(ss, gid, wh) {
  if (gid != null) {
    const all = ss.getSheets();
    for (var i = 0; i < all.length; i++) if (all[i].getSheetId() === gid) return all[i];
  }
  return ss.getSheetByName(liveSheetName(wh)) || ss.getSheetByName('Live');
}

// One Live row → lot object (shared by live + archive readers).
function rowToLot_(r) {
  let factors = {EA:1,PA:1,BP:1,CS:1};
  try { factors = JSON.parse(r[9] || '{}'); } catch (_) {}
  return {
    lotId:        r[0],
    ts:           lotTs_(r[1]),
    warehouse:    r[2],
    location:     r[3] || '',
    empId:        r[4] || '',
    name:         r[5] || '',
    userKey:      r[6] || '',
    key:          r[7] || '',
    productName:  r[8] || '',
    factors:      factors,
    counts: { CS: r[10]||0, BP: r[11]||0, PA: r[12]||0, EA: r[13]||0 },
    // expiryISO (P / r[15]) is the source of truth; older rows have it blank but
    // keep the Thai date in O (r[14]) — fall back to parsing that so it still shows.
    expiryDate:   isoDate_(r[15]) || thaiToIso_(r[14])
  };
}
function collectLots_(sh, wh, out, seen) {
  if (!sh) return;
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return;
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (String(r[2] || '') !== wh) continue;       // legacy sheet stores all warehouses
    const id = String(r[0] || '');
    if (id && seen[id]) continue;
    if (id) seen[id] = 1;
    out.push(rowToLot_(r));
  }
}

// ── Chunked CacheService (handles values >100KB) ──
function cachePutBig_(key, str, ttl) {
  try {
    const cache = CacheService.getScriptCache();
    const size = 90000, n = Math.ceil(str.length / size), obj = {};
    obj[key + '_n'] = String(n);
    for (let i = 0; i < n; i++) obj[key + '_' + i] = str.substr(i * size, size);
    cache.putAll(obj, ttl);
  } catch (_) {}
}
function cacheGetBig_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const nStr = cache.get(key + '_n');
    if (!nStr) return null;
    const n = parseInt(nStr, 10), keys = [];
    for (let i = 0; i < n; i++) keys.push(key + '_' + i);
    const got = cache.getAll(keys);
    let s = '';
    for (let i = 0; i < n; i++) { const c = got[key + '_' + i]; if (c == null) return null; s += c; }
    return s;
  } catch (_) { return null; }
}
function cacheDelBig_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const nStr = cache.get(key + '_n');
    if (!nStr) return;
    const n = parseInt(nStr, 10), keys = [key + '_n'];
    for (let i = 0; i < n; i++) keys.push(key + '_' + i);
    cache.removeAll(keys);
  } catch (_) {}
}

// Archived (old, static) lots for a warehouse — cached 6h so the heavy sheet isn't
// re-read on every poll. Fully defensive: any failure returns [].
function getArchiveLots(wh, fresh) {
  const specs = archiveSpecs_(wh);
  if (!specs.length) return [];
  const cacheKey = 'arch_' + wh;
  if (!fresh) {   // fresh=true (manual ↻) bypasses cache → re-reads the sheet now
    const cached = cacheGetBig_(cacheKey);
    if (cached) { try { return JSON.parse(cached); } catch (_) {} }
  }
  const out = [], seen = {};
  specs.forEach(function (spec) {
    try {
      const ss = SpreadsheetApp.openById(spec.id);
      collectLots_(archiveSheet_(ss, spec.gid, wh), wh, out, seen);
    } catch (_) {}
  });
  cachePutBig_(cacheKey, JSON.stringify(out), 21600);   // 6h — old data never changes
  return out;
}

function isFresh_(p) { const v = p && p.fresh; return v === '1' || v === 1 || v === true || v === 'true'; }

function getLiveLots(p) {
  const wh = String(p.warehouse || '');
  if (!wh) return { ok: true, lots: [] };
  const out = [];
  const seen = {}; // dedupe by lotId in case a row exists in more than one sheet
  const sheets = [liveSheetFor(wh)].concat(legacyLiveSheetsFor(wh)).filter(Boolean);
  sheets.forEach(function (sh) { collectLots_(sh, wh, out, seen); });
  // Merge archived (old) lots, deduped by lotId — cached 6h, ?fresh=1 re-reads now.
  try {
    getArchiveLots(wh, isFresh_(p)).forEach(function (lot) {
      const id = String(lot.lotId || '');
      if (id && seen[id]) return;
      if (id) seen[id] = 1;
      out.push(lot);
    });
  } catch (_) {}
  return { ok: true, lots: out, done: getDoneList(wh) };
}

// LIGHT summary — aggregate lots server-side into per-product totals + per-person
// breakdown, so the app downloads ~products instead of thousands of raw lots.
// Loses exact per-lot/per-time detail (keeps per-person counts + their locations
// + expiry dates).
function getSummary(p) {
  const wh = String(p.warehouse || '');
  if (!wh) return { ok: true, items: [] };
  const out = [], seen = {};
  const sheets = [liveSheetFor(wh)].concat(legacyLiveSheetsFor(wh)).filter(Boolean);
  sheets.forEach(function (sh) { collectLots_(sh, wh, out, seen); });
  try {
    getArchiveLots(wh, isFresh_(p)).forEach(function (lot) {
      const id = String(lot.lotId || ''); if (id && seen[id]) return; if (id) seen[id] = 1; out.push(lot);
    });
  } catch (_) {}

  const byKey = {};
  out.forEach(function (lot) {
    const k = lot.key; if (!k) return;
    if (!byKey[k]) byKey[k] = { key: k, name: lot.productName || lot.name || '',
      factors: lot.factors || {EA:1,PA:1,BP:1,CS:1}, total: {EA:0,PA:0,BP:0,CS:0}, lotCount: 0, lastTs: 0, persons: {} };
    const g = byKey[k];
    ['EA','PA','BP','CS'].forEach(function (u) { g.total[u] += (lot.counts[u] || 0); });
    if (lot.factors) g.factors = lot.factors;
    if (lot.ts && lot.ts > g.lastTs) g.lastTs = lot.ts;   // newest scan time of this product
    g.lotCount++;
    const pk = String(lot.empId || lot.userKey || lot.name || '—');
    if (!g.persons[pk]) g.persons[pk] = { name: lot.name || lot.empId || '—', counts: {EA:0,PA:0,BP:0,CS:0}, locs: {}, exps: {} };
    const pp = g.persons[pk];
    ['EA','PA','BP','CS'].forEach(function (u) { pp.counts[u] += (lot.counts[u] || 0); });
    if (lot.location)   pp.locs[lot.location] = 1;
    if (lot.expiryDate) pp.exps[lot.expiryDate] = 1;
  });

  const items = Object.keys(byKey).map(function (k) {
    const g = byKey[k];
    return {
      key: g.key, name: g.name, factors: g.factors, total: g.total, lotCount: g.lotCount, lastTs: g.lastTs,
      by: Object.keys(g.persons).map(function (pk) {
        const pp = g.persons[pk];
        return { name: pp.name, counts: pp.counts, locs: Object.keys(pp.locs), exps: Object.keys(pp.exps) };
      })
    };
  });
  return { ok: true, items: items, done: getDoneList(wh) };
}

// ── CONFIRM DONE (per user, per warehouse) ────────────
// No separate sheet — the Thai timestamp is stamped into the "เวลายืนยัน"
// column (last column) of every Live_<wh> row belonging to this user.
// status = 'done' → stamp the time on all their rows.
// status = 'open' → clear the time from all their rows (unlock).
function confirmDone(b) {
  const wh = String(b.warehouse || '');
  if (!wh) return { ok:false, error:'warehouse required' };
  const uk = String(b.userKey || '').toLowerCase();
  if (!uk) return { ok:false, error:'userKey required' };
  const status = (b.status === 'open') ? 'open' : 'done';
  const when = status === 'done' ? thaiDateTime(new Date()) : '';

  const sh = liveSheetFor(wh);
  // Make sure the header cell exists for older sheets created before this column.
  if (String(sh.getRange(1, DONE_COL).getValue() || '') !== 'เวลายืนยัน') {
    sh.getRange(1, DONE_COL).setValue('เวลายืนยัน');
  }
  const data = sh.getDataRange().getValues();
  let n = 0;
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (String(r[2] || '') !== wh) continue;                       // warehouse col (index 2)
    if (String(r[6] || '').toLowerCase() !== uk) continue;          // userKey col (index 6)
    sh.getRange(i + 1, DONE_COL).setValue(when);
    n++;
  }
  return { ok:true, status: status, doneAt: when, rows: n };
}

// All users who have a confirm timestamp on at least one of their rows.
function getDoneList(wh) {
  const sh = ssFor(wh).getSheetByName(liveSheetName(wh));
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  const byUser = {};
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (String(r[0] || '') === '') continue;
    if (String(r[2] || '') !== String(wh)) continue;
    const when = r[DONE_COL - 1];                                   // 0-based index of เวลายืนยัน
    if (!when) continue;
    const uk = String(r[6] || '').toLowerCase();
    const ms = tsMs(when);
    if (!byUser[uk] || ms > byUser[uk].doneAt) {
      byUser[uk] = {
        userKey:    uk,
        empId:      r[4] || '',
        name:       r[5] || '',
        status:     'done',
        doneAt:     ms,
        doneAtText: String(when)
      };
    }
  }
  return Object.keys(byUser).map(function(k){ return byUser[k]; });
}

// ── GET HISTORY ───────────────────────────────────────
function getHistory(p) {
  // If a warehouse is given, look in its SS; otherwise default SS.
  const sh = ssFor(p.warehouse).getSheetByName('StockCount');
  if (!sh) return { ok: true, sessions: [] };
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { ok: true, sessions: [] };

  // Group by (savedAt, warehouse, empId)
  const groups = {};
  const order = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    // Header: savedAt(0) | warehouse(1) | location(2) | empId(3) | name(4) | email(5)
    //       | sessionStart(6) | รหัสสินค้า(7) | ชื่อสินค้า(8)
    //       | CS(9) | BP(10) | PA(11) | EA(12) | นับได้(13)
    //       | สต็อกระบบ CS.EA(14) | สต็อกระบบ ชิ้น(15)
    //       | ต่าง ชิ้น(16) | ต่าง CS.EA(17) | สถานะ(18) | วันหมดอายุ(19)
    const savedAt = tsMs(r[0]);
    const wh = r[1], empId = r[3];
    const k = savedAt + '|' + wh + '|' + empId;
    if (!groups[k]) {
      groups[k] = {
        savedAt: savedAt,
        wh: wh,
        location: r[2] || '',
        empId: empId,
        name: r[4] || '',
        email: r[5] || '',
        startedAt: tsMs(r[6]),
        rows: []
      };
      order.push(k);
    }
    groups[k].rows.push({
      key: r[7], name: r[8],
      cs: r[9], bp: r[10], pa: r[11], ea: r[12],
      countedPieces: r[13],
      systemRaw: r[14], systemPieces: r[15],
      diffPieces: r[16], diffCSEA: r[17], status: r[18],
      expiryDate: r[19]
    });
  }
  const sessions = order.map(function(k){ return groups[k]; })
    .sort(function(a,b){ return b.savedAt - a.savedAt; })
    .slice(0, 100);
  return { ok: true, sessions: sessions };
}
