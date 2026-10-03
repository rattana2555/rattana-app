/**
 * Rattana Track → LINE  (TrackApp)
 * ส่งลิงก์ติดตามสถานะจัดส่งให้ร้าน ตอนคนขับรับใบคุม (ออกวิ่ง)
 *
 * วางไฟล์นี้ในโปรเจกต์ Apps Script ตัวเดียวกับแอปแจ้งสินค้าขาด
 * (script 1U8A9nbVhJQQJelMUPS4OLMkwugcbFpMpq7hW7k0bL2kftOEod2B6UBYC — เปิดด้วย /u/0/ = rattana.phai)
 * เพราะใช้ CHANNEL_ACCESS_TOKEN ตัวเดิม และแท็บ UID ของชีทที่ผูกอยู่
 *
 * ★ ต้องเพิ่ม 1 บรรทัดใน doPost ของ bot.gs (ต่อจากบรรทัด oosRoute_):
 *     var trk = trkRoute_(e); if (trk) return trk;
 *
 * ข้อมูล: ไฟล์ D-MAN ผ่าน gviz (ชื่อแท็บไทยใช้ไม่ได้ → ใช้ gid)
 *   ใบคุม          gid 1833308111  บิลทั้งหมดที่จัดเข้าเที่ยวแล้ว
 *   ทะเบียนใบคุม   gid 993727140   คนขับ / ทะเบียน / วันเวลาปิดงาน
 * ส่งเมื่อ: ทริปมีชื่อคนขับแล้ว (รับใบคุม) และยังไม่ปิดงาน
 */

var TRK_VERSION = '1.0';
var TRK_TZ = 'Asia/Bangkok';

var TRK_SHEET_ID = '1HoyuILDm8aOrUaLjo1YFbfZOoEiejaxRhh1ahR79Oeo';
var TRK_GID_ORDER = '1833308111';    // ใบคุม
var TRK_GID_TICKET = '993727140';    // ทะเบียนใบคุม
var TRK_APP_URL = 'https://rattana2555.github.io/rattana-app/rattana-shipping-tracker.html';

var TRK_QUEUE = 'คิวส่งลิงก์';
var TRK_HEAD = ['id', 'วันส่ง', 'เลขใบคุม', 'รหัสร้านค้า', 'ชื่อร้านค้า', 'บิล', 'ยอดรวม',
  'คนขับ', 'ทะเบียน', 'ลิงก์', 'สถานะ', 'UID ที่ส่ง', 'เวลาส่ง', 'รอบ', 'ผลลัพธ์', 'อัปเดต'];
var TRK_C = {}; TRK_HEAD.forEach(function (h, i) { TRK_C[h] = i; });
var TRK_ST = { WAIT: 'รอส่ง', SENT: 'ส่งแล้ว', NOUID: 'ไม่มี UID', FAIL: 'ล้มเหลว', CANCEL: 'ยกเลิก' };
var TRK_MAX_MS = 5 * 60 * 1000;

/* ───────────── ทางเข้าจาก doPost ───────────── */
function trkRoute_(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return null; }
  if (!body || body.app !== 'track') return null;
  var out;
  try {
    if (body.action === 'login') out = trkLogin_(body.credential);
    else {
      var key = trkKey_();
      if (!key || String(body.key || '') !== key) throw new Error('รหัสแอปไม่ถูกต้อง');
      out = trkHandle_(body);
    }
    out.ok = true;
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  out.v = TRK_VERSION;
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

var TRK_CLIENT_ID = '615875645128-gasjjvkt6lu8g449cbnhl40k1pu25r0b.apps.googleusercontent.com';
var TRK_USERS_ID = '1M6HdISsLN684qRWyQ73CA4AmUzmYtZaOlffDJXZZIXQ', TRK_USERS_TAB = 'Rattana Users for apps';

function trkLogin_(cred) {
  if (!cred) throw new Error('ไม่มีข้อมูลเข้าสู่ระบบ');
  var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(cred),
    { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('ตรวจสอบบัญชีไม่ผ่าน');
  var t = JSON.parse(r.getContentText());
  if (String(t.aud) !== TRK_CLIENT_ID) throw new Error('บัญชีไม่ตรงกับแอปนี้');
  if (String(t.email_verified) !== 'true' && t.email_verified !== true) throw new Error('อีเมลยังไม่ยืนยัน');
  var email = String(t.email || '').trim().toLowerCase();
  if (!email) throw new Error('ไม่พบอีเมล');

  var sh = SpreadsheetApp.openById(TRK_USERS_ID).getSheetByName(TRK_USERS_TAB);
  if (!sh) throw new Error('ไม่พบชีทผู้ใช้');
  var vals = sh.getDataRange().getDisplayValues(), head = vals[0].map(function (s) { return String(s).trim(); });
  var cE = head.indexOf('E-mail'); if (cE < 0) cE = head.indexOf('email');
  var cS = head.indexOf('Status'), cN = head.indexOf('ชื่อ - สกุล');
  var found = null;
  for (var i = 1; i < vals.length; i++) {
    var em = String(vals[i][cE] || '').replace(/[​-‍﻿\s]/g, '').toLowerCase();
    if (em === email) { found = vals[i]; break; }
  }
  if (!found) throw new Error('ไม่พบอีเมลนี้ในระบบ');
  if (String(found[cS] || '').trim().toLowerCase() !== 'active') throw new Error('บัญชีถูกระงับ');
  return { key: trkKey_(), email: email, name: cN >= 0 ? found[cN] : '' };
}

function trkHandle_(b) {
  switch (b.action) {
    case 'state': return trkState_(b);
    case 'list': return trkList_(b);
    case 'save': return trkSave_(b);
    case 'cancel': return trkSetStatus_(b.ids || [], TRK_ST.CANCEL);
    case 'requeue': return trkSetStatus_(b.ids || [], TRK_ST.WAIT);
    case 'sendNow': return trkSendPending_({ ids: b.ids || null, round: 'กดส่งเอง' + (b.who ? ' (' + b.who + ')' : '') });
    case 'setSchedule': return trkSetSchedule_(b);
    case 'autoPreview': return trkAutoQueue_(true);
    default: throw new Error('ไม่รู้จักคำสั่ง ' + b.action);
  }
}

/* ───────────── ตั้งค่า / trigger ───────────── */
function trkProps_() { return PropertiesService.getScriptProperties(); }

function trkSetup() {
  var p = trkProps_();
  if (!p.getProperty('TRK_KEY')) p.setProperty('TRK_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 12));
  var sh = trkQueueSheet_();
  trkCfg_();
  Logger.log('รหัสแอป = ' + trkKey_());
  Logger.log('ชีทคิว = ' + sh.getParent().getUrl());
  trkInstallTrigger_();
  Logger.log('ติดตั้งตัวตั้งเวลาแล้ว (ทุก 10 นาที)');
}

function trkInstallTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'trkTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('trkTick').timeBased().everyMinutes(10).create();
}
function trkTriggerOk_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'trkTick'; });
}

/* ───────────── ตั้งค่า (แท็บ "ตั้งค่า" ในไฟล์ชีทคิว) ───────────── */
var TRK_CFG_TAB = 'ตั้งค่า', TRK_CFG_EXCL = 'ร้านที่ไม่ส่ง LINE (รหัสร้าน)', trkCfgCache_ = null;

function trkIsOff_(v) { return /^(ปิด|off|false|0|no|ไม่)$/i.test(String(v).trim()); }

function trkCfg_() {
  if (trkCfgCache_) return trkCfgCache_;
  var ss = trkQueueSheet_().getParent(), sh = ss.getSheetByName(TRK_CFG_TAB);
  if (!sh) { trkCfgWrite_({ enabled: true, auto: true, days: ['today'], exclude: [{ id: '7500000000', name: 'ร้าน หน้าร้าน' }], key: trkProps_().getProperty('TRK_KEY') || '' }, 'ตั้งค่าเริ่มต้น'); sh = ss.getSheetByName(TRK_CFG_TAB); }
  var vals = sh.getDataRange().getDisplayValues();
  var c = { enabled: false, auto: true, days: ['today'], exclude: [], key: '', testUid: '' }, inEx = false;
  vals.forEach(function (r) {
    var k = String(r[0] || '').trim(), v = String(r[1] || '').trim();
    if (k === TRK_CFG_EXCL) { inEx = true; return; }
    if (inEx) { if (/^\d{6,}$/.test(k)) c.exclude.push({ id: k, name: v }); return; }
    if (k === 'ส่งอัตโนมัติ') c.enabled = !trkIsOff_(v);
    else if (k === 'เตรียมรายการเอง') c.auto = !trkIsOff_(v);
    else if (k === 'บิลที่ส่ง') c.days = /พรุ่งนี้/.test(v) ? (/วันนี้/.test(v) ? ['today', 'tomorrow'] : ['tomorrow']) : ['today'];
    else if (k === 'รหัสแอป') c.key = v;
    else if (k === 'โหมดทดสอบ (UID)') c.testUid = /^U[0-9a-f]{32}$/i.test(v) ? v : '';
  });
  trkCfgCache_ = c;
  return c;
}

function trkCfgWrite_(c, by) {
  var ss = trkQueueSheet_().getParent(), sh = ss.getSheetByName(TRK_CFG_TAB) || ss.insertSheet(TRK_CFG_TAB);
  sh.clear();
  var dayTxt = c.days.indexOf('tomorrow') >= 0 ? (c.days.indexOf('today') >= 0 ? 'วันนี้ + พรุ่งนี้' : 'พรุ่งนี้') : 'วันนี้';
  var rows = [
    ['ตั้งค่า Rattana Track → LINE', '', 'แก้ในชีทนี้ได้เลย ระบบอ่านใหม่ทุกครั้ง'],
    ['ส่งอัตโนมัติ', c.enabled ? 'เปิด' : 'ปิด', 'ปิด = ไม่ส่งเอง ต้องกดส่งจากแอป'],
    ['เตรียมรายการเอง', c.auto ? 'เปิด' : 'ปิด', 'เปิด = หาทริปที่คนขับรับแล้วเข้าคิวให้เอง'],
    ['บิลที่ส่ง', dayTxt, 'วันที่ส่งสินค้าของบิล'],
    ['รหัสแอป', c.key || '', 'ใส่ในแอปครั้งแรก (ปกติล็อกอิน Google แล้วได้เอง)'],
    ['โหมดทดสอบ (UID)', c.testUid || '', '★ ใส่ User ID ของตัวเอง = ทุกข้อความวิ่งมาที่คุณคนเดียว ร้านไม่ได้รับ · ว่าง = ส่งร้านจริง'],
    ['', '', ''],
    [TRK_CFG_EXCL, 'ชื่อร้าน', 'เพิ่มเมื่อ']
  ];
  (c.exclude || []).forEach(function (e) { rows.push([e.id, e.name || '', e.at || by || '']); });
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold');
  sh.getRange(rows.length - (c.exclude || []).length, 1, 1, 3).setFontWeight('bold');
  sh.setColumnWidth(1, 240); sh.setColumnWidth(2, 200); sh.setColumnWidth(3, 380);
  trkCfgCache_ = null;
  return c;
}

function trkKey_() {
  var cache = CacheService.getScriptCache(), k = cache.get('trk_key');
  if (k) return k;
  try { k = trkCfg_().key || ''; } catch (e) { k = ''; }
  k = k || trkProps_().getProperty('TRK_KEY') || '';
  if (k) cache.put('trk_key', k, 60);
  return k;
}
function trkExclude_() { return trkCfg_().exclude.map(function (e) { return e.id; }); }

function trkSetSchedule_(b) {
  var c = trkCfg_();
  if (b.enabled != null) c.enabled = !!b.enabled;
  if (b.auto != null) c.auto = !!b.auto;
  if (b.days) c.days = b.days;
  if (b.exclude) c.exclude = b.exclude;
  if (b.testUid != null) c.testUid = /^U[0-9a-f]{32}$/i.test(String(b.testUid).trim()) ? String(b.testUid).trim() : '';
  if (!c.key) c.key = trkProps_().getProperty('TRK_KEY') || '';
  trkCfgWrite_(c, b.who || '');
  CacheService.getScriptCache().remove('trk_key');
  return { cfg: trkCfg_() };
}

/* ───────────── ตัวตั้งเวลา ───────────── */
function trkTick() {
  var c = trkCfg_();
  if (!c.enabled) return;
  var r = { at: trkNow_() };
  if (c.auto) {
    try { r.auto = trkAutoQueue_(false); } catch (e) { r.auto = { error: String(e && e.message || e) }; }
  }
  var s = trkSendPending_({ round: 'อัตโนมัติ' });
  r.send = s;
  trkProps_().setProperty('TRK_LAST', JSON.stringify(r));
}

/* ───────────── ชีทคิว (ไฟล์แยก) ───────────── */
var trkQueueSh_ = null;
function trkQueueSheet_() {
  if (trkQueueSh_) return trkQueueSh_;
  var p = trkProps_(), id = p.getProperty('TRK_QUEUE_ID'), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Rattana Track – คิวส่งลิงก์ LINE');
    p.setProperty('TRK_QUEUE_ID', ss.getId());
  }
  var sh = ss.getSheetByName(TRK_QUEUE);
  if (!sh) { sh = ss.getSheets()[0]; sh.setName(TRK_QUEUE); }
  if (String(sh.getRange(1, 1).getValue()) !== 'id') {
    sh.getRange('A:P').setNumberFormat('@');
    sh.getRange(1, 1, 1, TRK_HEAD.length).setValues([TRK_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  trkQueueSh_ = sh;
  return sh;
}

function trkReadQueue_() {
  var sh = trkQueueSheet_(), n = sh.getLastRow() - 1;
  if (n < 1) return { sh: sh, rows: [] };
  var vals = sh.getRange(2, 1, n, TRK_HEAD.length).getDisplayValues();
  return { sh: sh, rows: vals.map(function (r, i) { return { row: i + 2, v: r }; }) };
}

function trkRowObj_(r) {
  var o = {}; TRK_HEAD.forEach(function (h, i) { o[h] = r.v[i]; });
  return {
    row: r.row, id: o['id'], date: o['วันส่ง'], trip: o['เลขใบคุม'],
    cusId: o['รหัสร้านค้า'], cusName: o['ชื่อร้านค้า'], bills: o['บิล'], total: o['ยอดรวม'],
    driver: o['คนขับ'], plate: o['ทะเบียน'], link: o['ลิงก์'],
    status: o['สถานะ'], uids: o['UID ที่ส่ง'], sentAt: o['เวลาส่ง'], round: o['รอบ'], result: o['ผลลัพธ์']
  };
}

function trkNow_() { return Utilities.formatDate(new Date(), TRK_TZ, 'yyyy-MM-dd HH:mm:ss'); }
function trkToday_() { return Utilities.formatDate(new Date(), TRK_TZ, 'yyyy-MM-dd'); }
function trkTomorrow_() {
  var d = new Date(); d.setDate(d.getDate() + 1);
  return Utilities.formatDate(d, TRK_TZ, 'yyyy-MM-dd');
}

/* ───────────── UID (แท็บ UID ของชีทที่ผูกกับโปรเจกต์) ───────────── */
function trkUidMap_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('UID');
  var map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  var vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(3, sh.getLastColumn())).getDisplayValues();
  var head = vals[0].map(function (s) { return String(s).trim(); });
  var cU = head.indexOf('User ID'), cC = head.indexOf('รหัสร้านค้า');
  if (cU < 0) cU = 0;
  if (cC < 0) cC = 1;
  for (var i = 1; i < vals.length; i++) {
    var uid = String(vals[i][cU] || '').trim(), cus = String(vals[i][cC] || '').trim();
    if (!/^U[0-9a-f]{32}$/i.test(uid) || !cus) continue;
    (map[cus] = map[cus] || []);
    if (map[cus].indexOf(uid) < 0) map[cus].push(uid);
  }
  return map;
}

/* ───────────── อ่านไฟล์ D-MAN ───────────── */
function trkCsv_(gid) {
  var url = 'https://docs.google.com/spreadsheets/d/' + TRK_SHEET_ID +
    '/gviz/tq?tqx=out:csv&headers=1&gid=' + gid;
  var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (r.getResponseCode() !== 200) throw new Error('อ่านชีท gid ' + gid + ' ไม่สำเร็จ (' + r.getResponseCode() + ')');
  return trkParseCsv_(r.getContentText());
}

function trkParseCsv_(text) {
  if (!text) return [];
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  var rows = [], row = [], cell = '', inQ = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\r') { /* ข้าม */ }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  var clean = function (s) { return String(s == null ? '' : s).replace(/[​-‍﻿]/g, '').replace(/ /g, ' ').trim(); };
  var head = rows[0].map(clean);
  return rows.slice(1).filter(function (r) {
    return r.some(function (c) { return clean(c); });
  }).map(function (r) {
    var o = {}; head.forEach(function (h, i) { o[h] = clean(r[i]); }); return o;
  });
}

/** วันที่ในชีทเป็น DD/MM/YYYY (พ.ศ. ก็ได้) หรือ YYYY-MM-DD → คืน yyyy-MM-dd */
function trkDate_(s) {
  s = String(s || '');
  var m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    var y1 = +m[1]; if (y1 > 2500) y1 -= 543;
    return y1 + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  var y = +m[3]; if (y > 2500) y -= 543;
  return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
}

function trkAmount_(s) {
  var n = parseFloat(String(s == null ? '0' : s).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

/** รหัสกำกับลิงก์ — ★ ต้องตรงกับ docKey() ในไฟล์ rattana-shipping-tracker.html เป๊ะ ๆ
 *  แก้ฝั่งไหนต้องแก้อีกฝั่งด้วย ไม่งั้นลิงก์ที่ส่งไปจะเปิดไม่ได้ */
function trkDocKey_(docNo, cusCode) {
  var s = String(docNo || '') + '|' + String(cusCode || '') + '|rtn';
  var h1 = 0x811c9dc5, h2 = 0x01000193;
  for (var i = 0; i < s.length; i++) {
    h1 = (h1 ^ s.charCodeAt(i)) >>> 0; h1 = (h1 * 0x01000193) >>> 0;
    h2 = (h2 + s.charCodeAt(i) * (i + 7)) >>> 0; h2 = (h2 ^ (h2 << 5)) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 10);
}

function trkLink_(docNo, cusCode) {
  return TRK_APP_URL + '?doc=' + encodeURIComponent(docNo) + '&k=' + trkDocKey_(docNo, cusCode);
}

/* ───────────── รวมรายการที่ควรส่ง ─────────────
 * ส่งเมื่อ: ทริปนั้นมีชื่อคนขับแล้ว (รับใบคุม) และยังไม่ปิดงาน · บิลวันที่ส่ง = ตามตั้งค่า
 * 1 ข้อความ = 1 ร้าน ต่อ 1 ทริป (95% มีบิลเดียว) */
function trkBuild_(opt) {
  opt = opt || {};
  var days = opt.days || trkCfg_().days;
  var want = {};
  if (days.indexOf('today') >= 0) want[trkToday_()] = 1;
  if (days.indexOf('tomorrow') >= 0) want[trkTomorrow_()] = 1;
  if (opt.date) { want = {}; want[opt.date] = 1; }

  var tickets = trkCsv_(TRK_GID_TICKET), tmap = {};
  tickets.forEach(function (t) {
    var code = t['รหัสใบคุม'] || t['Row ID'] || t['🔒 Row ID'] || t['Trans_Code'] || '';
    if (!code) return;
    tmap[code] = {
      driver: String(t['ชื่อคนขับ'] || '').trim(),
      plate: String(t['ทะเบียน'] || '').trim(),
      closed: String(t['วันเวลาปิดงาน'] || '').trim()
    };
  });

  var excl = {}; trkExclude_().forEach(function (id) { excl[id] = 1; });
  var orders = trkCsv_(TRK_GID_ORDER), group = {}, out = [];
  orders.forEach(function (o) {
    var trip = String(o['Trans_Code'] || '').trim();
    var cus = String(o['Customer_Code'] || '').trim();
    var doc = String(o['Doc_No'] || '').trim();
    if (!trip || !cus || !doc) return;
    var d = trkDate_(o['วันที่ส่งสินค้า']);
    if (!want[d]) return;
    if (excl[cus]) return;
    var t = tmap[trip];
    if (!t || !t.driver) return;          // ยังไม่มีคนขับ = ยังไม่รับใบคุม
    if (t.closed) return;                 // ปิดงานแล้ว = ส่งถึงร้านไปแล้ว ไม่ต้องแจ้ง
    var k = d + '|' + trip + '|' + cus;
    if (!group[k]) {
      group[k] = {
        id: k, date: d, trip: trip, cusId: cus,
        cusName: String(o['Customer_Name'] || '').trim(),
        driver: t.driver, plate: t.plate, items: [], total: 0
      };
      out.push(group[k]);
    }
    group[k].items.push({ doc: doc, amount: trkAmount_(o['TotalBaht']), link: trkLink_(doc, cus) });
    group[k].total += trkAmount_(o['TotalBaht']);
  });
  return out;
}

/* ───────────── เข้าคิวอัตโนมัติ ───────────── */
function trkAutoQueue_(dry) {
  var list = trkBuild_({});
  if (dry) {
    var uidMap = trkUidMap_();
    return {
      dry: true, found: list.length,
      withUid: list.filter(function (s) { return (uidMap[s.cusId] || []).length; }).length,
      stores: list.slice(0, 200).map(function (s) {
        return { id: s.id, trip: s.trip, cusId: s.cusId, cusName: s.cusName, driver: s.driver, plate: s.plate, bills: s.items.length };
      })
    };
  }
  return trkSave_({ stores: list, auto: true });
}

/* ───────────── บันทึกเข้าคิว ───────────── */
function trkSave_(b) {
  var stores = b.stores || [];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { busy: true, added: 0 };
  var res = { added: 0, kept: 0, updated: 0 };
  try {
    var q = trkReadQueue_(), sh = q.sh, byId = {};
    q.rows.forEach(function (r) { var o = trkRowObj_(r); byId[o.id] = { row: r.row, o: o }; });
    var now = trkNow_(), add = [];
    stores.forEach(function (s) {
      var bills = s.items.map(function (i) { return i.doc; }).join(', ');
      var link = s.items.map(function (i) { return i.link; }).join(' ');
      var ex = byId[s.id];
      if (ex) {
        // มีอยู่แล้ว — ยกเลิกไว้ หรือส่งไปแล้วและข้อมูลเหมือนเดิม = ไม่ทำอะไร
        if (ex.o.status === TRK_ST.CANCEL) { res.kept++; return; }
        if (ex.o.status === TRK_ST.SENT && ex.o.bills === bills) { res.kept++; return; }
        if (ex.o.status === TRK_ST.SENT) { res.kept++; return; }   // ส่งไปแล้ว ไม่รบกวนร้านซ้ำ
        sh.getRange(ex.row, TRK_C['บิล'] + 1, 1, 4).setValues([[bills, s.total, s.driver, s.plate]]);
        sh.getRange(ex.row, TRK_C['ลิงก์'] + 1).setValue(link);
        sh.getRange(ex.row, TRK_C['อัปเดต'] + 1).setValue(now);
        res.updated++;
        return;
      }
      add.push([s.id, s.date, s.trip, s.cusId, s.cusName, bills, s.total, s.driver, s.plate, link,
        TRK_ST.WAIT, '', '', b.auto ? 'เตรียมอัตโนมัติ' : 'เตรียมจากแอป', '', now]);
    });
    if (add.length) {
      sh.getRange(sh.getLastRow() + 1, 1, add.length, TRK_HEAD.length).setValues(add);
      res.added = add.length;
    }
  } finally { lock.releaseLock(); }
  res.at = trkNow_();
  return res;
}

function trkSetStatus_(ids, status) {
  var q = trkReadQueue_(), sh = q.sh, want = {}, n = 0, now = trkNow_();
  ids.forEach(function (id) { want[id] = 1; });
  q.rows.forEach(function (r) {
    var o = trkRowObj_(r);
    if (!want[o.id]) return;
    sh.getRange(r.row, TRK_C['สถานะ'] + 1).setValue(status);
    sh.getRange(r.row, TRK_C['อัปเดต'] + 1).setValue(now);
    n++;
  });
  return { changed: n, status: status };
}

/* ───────────── ส่ง ───────────── */
function trkSendPending_(opt) {
  opt = opt || {};
  var t0 = Date.now();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { busy: true, sent: 0 };
  var res = { sent: 0, failed: 0, noUid: 0, timedOut: false, round: opt.round || '' };
  try {
    var q = trkReadQueue_(), sh = q.sh, today = trkToday_(), uidMap = trkUidMap_();
    var testUid = trkCfg_().testUid || '';
    var only = null;
    if (opt.ids && opt.ids.length) { only = {}; opt.ids.forEach(function (id) { only[id] = 1; }); }
    for (var i = 0; i < q.rows.length; i++) {
      var r = q.rows[i], o = trkRowObj_(r);
      if (only) { if (!only[o.id]) continue; }
      else if (o.date < today) continue;
      if (o.status === TRK_ST.SENT || o.status === TRK_ST.CANCEL) continue;
      if (Date.now() - t0 > TRK_MAX_MS) { res.timedOut = true; break; }

      var realUids = uidMap[o.cusId] || [], now = trkNow_(), status, result;
      // ★ โหมดทดสอบ: ยังมีค่าอยู่ = ส่งมาที่ UID นั้นคนเดียว ร้านจริงไม่ได้รับอะไรเลย
      var uids = testUid ? (realUids.length ? [testUid] : []) : realUids;
      if (!uids.length) {
        status = TRK_ST.NOUID; result = 'ไม่พบ User ID ของร้านในแท็บ UID'; res.noUid++;
      } else {
        var okN = 0, errs = [];
        uids.forEach(function (uid) {
          var rr = trkPush_(uid, o, !!testUid);
          if (rr.ok) okN++; else errs.push(uid.slice(0, 8) + '…: ' + rr.error);
        });
        if (okN) {
          status = TRK_ST.SENT;
          result = (testUid ? '[ทดสอบ] ' : '') + 'ส่งสำเร็จ ' + okN + '/' + uids.length + (errs.length ? ' · ' + errs.join(' | ') : '');
          res.sent++; if (testUid) res.test = true;
        } else { status = TRK_ST.FAIL; result = errs.join(' | ').slice(0, 450); res.failed++; }
      }
      sh.getRange(r.row, TRK_C['สถานะ'] + 1, 1, 5).setValues([[status, uids.join(' '),
        status === TRK_ST.SENT ? now : o.sentAt, opt.round || '', result]]);
      sh.getRange(r.row, TRK_C['อัปเดต'] + 1).setValue(now);
    }
  } finally { lock.releaseLock(); }
  res.at = trkNow_();
  trkProps_().setProperty('TRK_LAST_SEND', JSON.stringify(res));
  return res;
}

function trkPush_(uid, o, isTest) {
  var msg = {
    type: 'flex',
    altText: ((isTest ? '[ทดสอบ] ' : '') + 'สินค้ากำลังจัดส่ง · ร้าน ' + o.cusName).slice(0, 380),
    contents: trkFlex_(o, isTest)
  };
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + CHANNEL_ACCESS_TOKEN },
      payload: JSON.stringify({ to: uid, messages: [msg] }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code === 200) return { ok: true };
    return { ok: false, error: code + ' ' + res.getContentText().slice(0, 200) };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/* ───────────── Flex (ธีมเดียวกับแอป: กรมท่า #0d1b3e + ทอง #c9a84c) ───────────── */
function trkFlex_(o, isTest) {
  var bills = String(o.bills || '').split(/,\s*/).filter(String);
  var links = String(o.link || '').split(/\s+/).filter(String);
  var body = [];
  if (isTest) body.push({
    type: 'box', layout: 'vertical', backgroundColor: '#fdecea', cornerRadius: '6px',
    paddingAll: '8px', margin: 'none',
    contents: [{ type: 'text', text: '🧪 ข้อความทดสอบ — ร้านไม่ได้รับฉบับนี้', size: 'xs', color: '#c0392b', weight: 'bold', wrap: true }]
  });
  body = body.concat([
    { type: 'text', text: String(o.cusName || ''), weight: 'bold', size: 'lg', wrap: true, color: '#0d1b3e' },
    { type: 'text', text: 'รหัสร้าน ' + o.cusId, size: 'xs', color: '#6b7896', margin: 'xs' },
    {
      type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
      backgroundColor: '#f4f6fb', cornerRadius: '8px', paddingAll: '12px',
      contents: [
        trkRow_('คนขับ', o.driver || '-'),
        trkRow_('ทะเบียนรถ', o.plate || '-')
      ]
    }
  ]);

  var billBox = [{ type: 'text', text: 'รายการจัดส่ง', size: 'xs', color: '#6b7896', weight: 'bold' }];
  bills.slice(0, 8).forEach(function (b, i) {
    billBox.push({
      type: 'box', layout: 'baseline', margin: 'sm',
      contents: [
        { type: 'text', text: b, size: 'sm', color: '#0d1b3e', flex: 1, wrap: true }
      ]
    });
  });
  if (bills.length > 8) billBox.push({ type: 'text', text: 'และอีก ' + (bills.length - 8) + ' รายการ', size: 'xs', color: '#6b7896', margin: 'sm' });
  billBox.push({
    type: 'box', layout: 'baseline', margin: 'md',
    contents: [
      { type: 'text', text: 'ยอดรวม', size: 'sm', color: '#6b7896', flex: 0 },
      { type: 'text', text: '฿' + trkMoney_(o.total), size: 'md', weight: 'bold', color: '#0d1b3e', align: 'end' }
    ]
  });
  body.push({ type: 'box', layout: 'vertical', margin: 'lg', contents: billBox });

  var buttons = links.slice(0, 5).map(function (u, i) {
    return {
      type: 'button', style: 'primary', height: 'sm', color: '#c9a84c', margin: i ? 'sm' : 'none',
      action: { type: 'uri', label: links.length > 1 ? ('ติดตาม ' + (bills[i] || (i + 1))).slice(0, 40) : 'ติดตามสถานะจัดส่ง', uri: u }
    };
  });

  return {
    type: 'bubble', size: 'giga',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#0d1b3e', paddingAll: '16px',
      contents: [
        { type: 'text', text: '🚚 สินค้ากำลังจัดส่ง', color: '#ffffff', weight: 'bold', size: 'lg' },
        { type: 'text', text: 'รัตนไพบูลย์ สมุทรสงคราม 2555', color: '#c9a84c', size: 'xs', margin: 'xs' }
      ]
    },
    body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: body },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'none',
      contents: buttons.concat([
        { type: 'text', text: 'กดปุ่มเพื่อดูสถานะและคนขับแบบเรียลไทม์', size: 'xxs', color: '#6b7896', align: 'center', margin: 'md', wrap: true }
      ])
    },
    styles: { header: { separator: true, separatorColor: '#c9a84c' } }
  };
}

function trkRow_(label, val) {
  return {
    type: 'box', layout: 'baseline',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#6b7896', flex: 2 },
      { type: 'text', text: String(val), size: 'sm', color: '#0d1b3e', weight: 'bold', flex: 3, wrap: true }
    ]
  };
}

function trkMoney_(n) {
  n = trkAmount_(n);
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* ───────────── สถานะ / รายการให้แอป ───────────── */
function trkState_(b) {
  var c = trkCfg_(), last = {};
  try { last = JSON.parse(trkProps_().getProperty('TRK_LAST') || '{}'); } catch (e) { }
  return {
    cfg: { enabled: c.enabled, auto: c.auto, days: c.days, exclude: c.exclude, testUid: c.testUid || '' },
    trigger: trkTriggerOk_(),
    queueUrl: trkQueueSheet_().getParent().getUrl(),
    appUrl: TRK_APP_URL,
    today: trkToday_(), tomorrow: trkTomorrow_(),
    last: last
  };
}

/** รายการร้านที่ควรส่ง + สถานะในคิว (ให้แอปวาดหน้า) */
function trkList_(b) {
  var list = trkBuild_({ days: b.days || null, date: b.date || null });
  var uidMap = trkUidMap_();
  var q = trkReadQueue_(), byId = {};
  q.rows.forEach(function (r) { var o = trkRowObj_(r); byId[o.id] = o; });
  var stores = list.map(function (s) {
    var ex = byId[s.id], uids = uidMap[s.cusId] || [];
    return {
      id: s.id, date: s.date, trip: s.trip, cusId: s.cusId, cusName: s.cusName,
      driver: s.driver, plate: s.plate, total: s.total,
      items: s.items, hasUid: uids.length > 0, uidCount: uids.length,
      status: ex ? ex.status : '', sentAt: ex ? ex.sentAt : '', result: ex ? ex.result : ''
    };
  });
  // แถวในคิวที่ไม่อยู่ในรายการแล้ว (ปิดงานไปแล้ว) แต่ยังรอส่ง → แจ้งให้เห็นด้วย
  return { stores: stores, at: trkNow_(), today: trkToday_() };
}

/* ───────────── ทดสอบ ───────────── */
/** ตรวจว่า trkDocKey_ ตรงกับฝั่งแอป — เอาผลไปเทียบกับ docKey() ในหน้าเว็บ */
function trkTestKey() {
  ['DSI16909/01188|7500100218', 'DC516908/00426|7511300121'].forEach(function (s) {
    var a = s.split('|');
    Logger.log(s + '  →  ' + trkDocKey_(a[0], a[1]) + '   ' + trkLink_(a[0], a[1]));
  });
}

/** ส่งทดสอบไปที่ UID ที่ระบุ (ไม่แตะคิว) */
function trkTestSend(uid) {
  uid = uid || '';
  if (!/^U[0-9a-f]{32}$/i.test(uid)) { Logger.log('ใส่ UID ก่อน เช่น trkTestSend("Uxxxx…")'); return; }
  var r = trkPush_(uid, {
    cusId: '7500000001', cusName: 'ร้านทดสอบ', bills: 'DSI16909/01188',
    total: 56206, driver: 'สมพงษ์ ฉิมชูกุล (ตี๋)', plate: '808810',
    link: trkLink_('DSI16909/01188', '7500100218')
  });
  Logger.log(JSON.stringify(r));
}
