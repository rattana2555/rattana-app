/**
 * Rattana แจ้งสินค้าขาด → LINE  (OOSApp — ต่อท้าย auto.gs)  v1.12
 * อยู่ในโปรเจกต์ Apps Script ที่ผูกกับชีทส่ง (E-Slip / UID / Keep Send / FlexMessage)
 *
 * - แอปเรียกผ่าน doPost เดิม (ต้องเพิ่มบรรทัดแยกทางไว้บนสุดของ doPost — ดูไฟล์ webhook)
 * - คิวเก็บใน "ชีทไฟล์แยก" (สร้างเองตอน oosSetup · id ใน Script Property OOS_QUEUE_ID)
 *   เพราะชีทส่งมีสูตรหนัก เพิ่มแท็บ/เขียนทีละแถวแล้วช้าเป็นนาที
 * - UID อ่านจากชีทส่ง · ประวัติที่ส่งแล้วเก็บในชีทคิวที่เดียว (ไม่ลง Keep Send)
 * - ตั้งเวลาส่ง: trigger oosTick ทุก 10 นาที → ถึงเวลารอบไหน (เช่น 13:00 / 18:00) ส่งรอบนั้นวันละครั้ง
 * - ส่ง push ไปที่ User ID ของแต่ละร้าน (แท็บ UID: User ID / รหัสร้านค้า) ร้านมีหลาย UID = ส่งทุกตัว
 * - ใช้ CHANNEL_ACCESS_TOKEN (ไฟล์ webhook) และ rtnForwardCards_ (ไฟล์ E-Slip) ตัวเดิม
 *
 * ครั้งแรก: เลือกฟังก์ชัน oosSetup → Run → อนุญาตสิทธิ์ → ดู Log จะได้ "รหัสแอป" ไปใส่ในแอป
 */

var OOS_VERSION = '1.12';
var OOS_TZ = 'Asia/Bangkok';
var OOS_QUEUE = 'คิวส่งแอป';
var OOS_HEAD = ['id', 'วันส่ง', 'รหัสร้านค้า', 'ชื่อร้านค้า', 'คลัง', 'บิล', 'เซลล์ผู้ดูแล',
  'สินค้าขาด', 'สินค้าเพิ่ม', 'สถานะ', 'UID ที่ส่ง', 'เวลาส่ง', 'รอบ', 'ผลลัพธ์',
  'บันทึกโดย', 'อัปเดต', 'hash', 'ออเดอร์'];   // ออเดอร์ = billIdORD… จาก DI_REMARK ใบจอง (ออเดอร์ ROO)
var OOS_C = {}; OOS_HEAD.forEach(function (h, i) { OOS_C[h] = i; });
var OOS_ST = { WAIT: 'รอส่ง', SENT: 'ส่งแล้ว', NOUID: 'ไม่มี UID', FAIL: 'ล้มเหลว', CANCEL: 'ยกเลิก' };
var OOS_MAX_MS = 5 * 60 * 1000;   // กันชน 6 นาทีของ Apps Script

/* ───────────── ทางเข้าจาก doPost ───────────── */
function oosRoute_(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return null; }
  if (!body || body.app !== 'oos') return null;              // ไม่ใช่แอป → ให้ webhook LINE ทำงานต่อ
  var out;
  try {
    var key = oosProps_().getProperty('OOS_KEY');
    if (!key || String(body.key || '') !== key) throw new Error('รหัสแอปไม่ถูกต้อง');
    out = oosHandle_(body);
    out.ok = true;
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  out.v = OOS_VERSION;
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function oosHandle_(b) {
  switch (b.action) {
    case 'state': return oosState_(b);
    case 'save': return oosSave_(b);
    case 'cancel': return oosSetStatus_(b.ids || [], OOS_ST.CANCEL);
    case 'requeue': return oosSetStatus_(b.ids || [], OOS_ST.WAIT);
    case 'sendNow': return oosSendPending_({ ids: b.ids || null, round: 'กดส่งเอง' + (b.by ? ' (' + b.by + ')' : '') });
    case 'setSchedule': return oosSetSchedule_(b);
    case 'testSend': return oosTestSend_(b);
    case 'xlsx': return oosXlsx_(b.file);
    case 'xlsxMeta': return oosXlsxMeta_(b.file, b.pack);
    case 'xlsxPart': return oosXlsxPart_(b.ck, b.from, b.to);   // ck = คีย์แคช (ห้ามใช้ชื่อ key — ชนกับรหัสแอป)
    default: throw new Error('ไม่รู้จักคำสั่ง ' + b.action);
  }
}

/* ───────────── ตั้งค่า / trigger ───────────── */
function oosProps_() { return PropertiesService.getScriptProperties(); }

function oosSetup() {
  var p = oosProps_();
  if (!p.getProperty('OOS_KEY')) p.setProperty('OOS_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 12));
  if (!p.getProperty('OOS_TIMES')) p.setProperty('OOS_TIMES', '13:00,18:00');
  if (!p.getProperty('OOS_ENABLED')) p.setProperty('OOS_ENABLED', '1');
  Logger.log('รหัสแอป (ใส่ในหน้า ⚙️ ของแอป) = ' + p.getProperty('OOS_KEY'));
  var sh = oosQueueSheet_();
  Logger.log('ชีทคิว = ' + sh.getParent().getUrl());
  var x = oosXlsxFile_();   // ขอสิทธิ์ Drive ไปด้วย
  Logger.log('ไฟล์ต้นฉบับ = ' + x.getName() + ' (แก้ล่าสุด ' + x.getLastUpdated() + ')');
  oosInstallTrigger_();
  Logger.log('เวลาส่ง = ' + p.getProperty('OOS_TIMES') + ' · เปิดอยู่ = ' + p.getProperty('OOS_ENABLED') + ' · ติดตั้งตัวตั้งเวลาแล้ว');
}

function oosInstallTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'oosTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('oosTick').timeBased().everyMinutes(10).create();
}

function oosTriggerOk_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'oosTick'; });
}

function oosTimes_() {
  return String(oosProps_().getProperty('OOS_TIMES') || '13:00,18:00').split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return /^\d{1,2}:\d{2}$/.test(s); })
    .map(function (s) { var a = s.split(':'); return ('0' + a[0]).slice(-2) + ':' + a[1]; })
    .sort();
}

function oosSetSchedule_(b) {
  var p = oosProps_();
  if (b.times) {
    var t = (b.times || []).map(String).filter(function (s) { return /^\d{1,2}:\d{2}$/.test(s); });
    if (!t.length) throw new Error('ต้องมีเวลาส่งอย่างน้อย 1 รอบ');
    p.setProperty('OOS_TIMES', t.join(','));
  }
  if (b.enabled != null) p.setProperty('OOS_ENABLED', b.enabled ? '1' : '0');
  if (!oosTriggerOk_()) oosInstallTrigger_();
  return oosState_({});
}

/** trigger ทุก 10 นาที — ถึงเวลารอบไหนแล้วยังไม่ได้ส่งวันนี้ ก็ส่งรอบนั้น (ไม่ไล่ส่งย้อนเกิน 2 ชม.) */
function oosTick() {
  var p = oosProps_();
  try { oosXlsxMeta_(OOS_ORDER_FILE, true); } catch (e) { }   // อุ่นแคชข้อมูลบิลไว้ก่อน — เปิดแอปแล้วไม่ต้องรอแกะไฟล์
  if (p.getProperty('OOS_ENABLED') !== '1') return;
  var now = new Date();
  var today = Utilities.formatDate(now, OOS_TZ, 'yyyy-MM-dd');
  var hm = Utilities.formatDate(now, OOS_TZ, 'HH:mm');
  var nowMin = oosMin_(hm);
  var slots = oosTimes_();
  for (var i = 0; i < slots.length; i++) {
    var s = slots[i], sm = oosMin_(s);
    if (nowMin < sm || nowMin - sm > 120) continue;
    var doneKey = 'OOS_DONE_' + today + '_' + s;
    if (p.getProperty(doneKey)) continue;
    var r = oosSendPending_({ round: 'รอบ ' + s });
    if (!r.timedOut) p.setProperty(doneKey, hm);
    oosCleanDoneKeys_(today);
    return;
  }
}

function oosMin_(hm) { var a = hm.split(':'); return (+a[0]) * 60 + (+a[1]); }

function oosCleanDoneKeys_(today) {
  var p = oosProps_(), all = p.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('OOS_DONE_') === 0 && k.slice(9, 19) < today) p.deleteProperty(k);
  });
}

/* ───────────── ชีทคิว (ไฟล์แยก) ───────────── */
var oosQueueSh_ = null;
function oosQueueSheet_() {
  if (oosQueueSh_) return oosQueueSh_;
  var p = oosProps_(), id = p.getProperty('OOS_QUEUE_ID'), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Rattana แจ้งสินค้าขาด – คิวส่ง LINE');
    p.setProperty('OOS_QUEUE_ID', ss.getId());
  }
  var sh = ss.getSheetByName(OOS_QUEUE);
  if (!sh) { sh = ss.getSheets()[0]; sh.setName(OOS_QUEUE); }
  if (String(sh.getRange(1, 1).getValue()) !== 'id') {
    sh.getRange('A:Q').setNumberFormat('@');   // เก็บเป็นข้อความทั้งหมด กัน Sheets แปลงวันที่/รหัสร้าน
    sh.getRange(1, 1, 1, OOS_HEAD.length).setValues([OOS_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  if (String(sh.getRange(1, OOS_HEAD.length).getValue()) !== OOS_HEAD[OOS_HEAD.length - 1]) {   // ชีทรุ่นเก่ายังไม่มีคอลัมน์ใหม่
    sh.getRange(1, OOS_HEAD.length).setValue(OOS_HEAD[OOS_HEAD.length - 1]).setFontWeight('bold');
    sh.getRange(1, OOS_HEAD.length, sh.getMaxRows(), 1).setNumberFormat('@');
  }
  oosQueueSh_ = sh;
  return sh;
}

function oosReadQueue_() {
  var sh = oosQueueSheet_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return { sh: sh, rows: [] };
  var vals = sh.getRange(2, 1, n, OOS_HEAD.length).getDisplayValues();
  return { sh: sh, rows: vals.map(function (r, i) { return { row: i + 2, v: r }; }) };
}

function oosRowObj_(r) {
  var o = { row: r.row };
  OOS_HEAD.forEach(function (h, i) { o[h] = r.v[i]; });
  return {
    id: o.id, date: o['วันส่ง'], cusId: o['รหัสร้านค้า'], cusName: o['ชื่อร้านค้า'], wh: o['คลัง'],
    bills: o['บิล'], sale: o['เซลล์ผู้ดูแล'], short: o['สินค้าขาด'], add: o['สินค้าเพิ่ม'],
    status: o['สถานะ'], uids: o['UID ที่ส่ง'], sentAt: o['เวลาส่ง'], round: o['รอบ'],
    result: o['ผลลัพธ์'], by: o['บันทึกโดย'], updated: o['อัปเดต'], orders: o['ออเดอร์']
  };
}

function oosNow_() { return Utilities.formatDate(new Date(), OOS_TZ, 'yyyy-MM-dd HH:mm:ss'); }
function oosToday_() { return Utilities.formatDate(new Date(), OOS_TZ, 'yyyy-MM-dd'); }

function oosHash_(it) {
  var raw = [it.bills, it.sale, it.short, it.add, it.orders || ''].join('|');
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw, Utilities.Charset.UTF_8));
}

/** บันทึกเข้าคิว — คีย์ = วันส่ง|รหัสร้าน · ส่งแล้วและเนื้อหาเหมือนเดิม = ไม่ส่งซ้ำ · เนื้อหาเปลี่ยน = กลับเป็นรอส่ง */
function oosSave_(b) {
  var date = String(b.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('วันส่งไม่ถูกต้อง');
  var items = b.items || [];
  if (!items.length) throw new Error('ไม่มีร้านที่จะบันทึก');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var q = oosReadQueue_(), sh = q.sh, idx = {};
    q.rows.forEach(function (r) { idx[r.v[0]] = r; });
    var now = oosNow_(), by = String(b.by || ''), added = 0, changed = 0, same = 0, appends = [];
    items.forEach(function (it) {
      var cusId = String(it.cusId || '').trim();
      if (!cusId) return;
      var id = date + '|' + cusId;
      var h = oosHash_(it);
      var rowVals = [id, date, cusId, String(it.cusName || ''), String(it.wh || ''), String(it.bills || ''),
        String(it.sale || ''), String(it.short || '-'), String(it.add || '-')];
      var ex = idx[id];
      if (!ex) {
        appends.push(rowVals.concat([OOS_ST.WAIT, '', '', '', '', by, now, h, String(it.orders || '')]));
        added++;
        return;
      }
      var st = ex.v[OOS_C['สถานะ']];
      if (ex.v[OOS_C.hash] === h && st !== OOS_ST.CANCEL) { same++; return; }
      var full = rowVals.concat([OOS_ST.WAIT, ex.v[OOS_C['UID ที่ส่ง']], ex.v[OOS_C['เวลาส่ง']],
        ex.v[OOS_C['รอบ']], st === OOS_ST.SENT ? 'แก้ไขหลังส่ง — รอส่งใหม่' : '', by, now, h, String(it.orders || '')]);
      sh.getRange(ex.row, 1, 1, OOS_HEAD.length).setValues([full]);
      changed++;
    });
    if (appends.length) {
      var start = sh.getLastRow() + 1;
      sh.getRange(start, 1, appends.length, OOS_HEAD.length).setNumberFormat('@').setValues(appends);
    }
    return { added: added, changed: changed, same: same };
  } finally { lock.releaseLock(); }
}

function oosSetStatus_(ids, status) {
  if (!ids.length) throw new Error('ไม่ได้เลือกรายการ');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var q = oosReadQueue_(), set = {}, n = 0, now = oosNow_();
    ids.forEach(function (id) { set[id] = 1; });
    q.rows.forEach(function (r) {
      if (!set[r.v[0]]) return;
      q.sh.getRange(r.row, OOS_C['สถานะ'] + 1).setValue(status);
      q.sh.getRange(r.row, OOS_C['อัปเดต'] + 1).setValue(now);
      n++;
    });
    return { updated: n };
  } finally { lock.releaseLock(); }
}

/* ───────────── UID ───────────── */
function oosUidMap_() {
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

/* ───────────── สถานะให้แอป ───────────── */
function oosState_(b) {
  var p = oosProps_();
  var from = String(b.from || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    from = Utilities.formatDate(new Date(Date.now() - 7 * 864e5), OOS_TZ, 'yyyy-MM-dd');
  }
  var queue = oosReadQueue_().rows.map(oosRowObj_).filter(function (o) { return o.date >= from; });
  var uidMap = oosUidMap_(), uidCount = {};
  Object.keys(uidMap).forEach(function (k) { uidCount[k] = uidMap[k].length; });
  var last = null;
  try { last = JSON.parse(p.getProperty('OOS_LAST') || 'null'); } catch (e) {}
  var today = oosToday_(), done = {};
  oosTimes_().forEach(function (s) { done[s] = p.getProperty('OOS_DONE_' + today + '_' + s) || ''; });
  return {
    times: oosTimes_(), enabled: p.getProperty('OOS_ENABLED') === '1', triggerOk: oosTriggerOk_(),
    last: last, doneToday: done, queue: queue, uidCount: uidCount, now: oosNow_(),
    queueUrl: oosQueueSheet_().getParent().getUrl()
  };
}

/* ───────────── ส่ง ───────────── */
/**
 * ส่งรายการที่ยังไม่ได้ส่ง (รอส่ง / ไม่มี UID / ล้มเหลว) ที่วันส่ง >= วันนี้
 * opt.ids = ส่งเฉพาะ id ที่เลือก (ไม่สนวันส่ง)
 */
function oosSendPending_(opt) {
  opt = opt || {};
  var t0 = Date.now();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { busy: true, sent: 0 };
  var res = { sent: 0, failed: 0, noUid: 0, skipped: 0, timedOut: false, round: opt.round || '' };
  try {
    var q = oosReadQueue_(), sh = q.sh, today = oosToday_(), uidMap = oosUidMap_();
    var only = null;
    if (opt.ids && opt.ids.length) { only = {}; opt.ids.forEach(function (id) { only[id] = 1; }); }
    for (var i = 0; i < q.rows.length; i++) {
      var r = q.rows[i], o = oosRowObj_(r);
      if (only) { if (!only[o.id]) continue; }
      else if (o.date < today) continue;
      if (o.status === OOS_ST.SENT || o.status === OOS_ST.CANCEL) { if (!only || o.status === OOS_ST.CANCEL) continue; }
      if (Date.now() - t0 > OOS_MAX_MS) { res.timedOut = true; break; }

      var uids = uidMap[o.cusId] || [];
      var now = oosNow_(), status, result;
      if (!uids.length) {
        status = OOS_ST.NOUID; result = 'ไม่พบ User ID ของร้านในแท็บ UID'; res.noUid++;
      } else {
        var okN = 0, errs = [];
        uids.forEach(function (uid) {
          var rr = oosPush_(uid, o);
          if (rr.ok) okN++; else errs.push(uid.slice(0, 8) + '…: ' + rr.error);
        });
        if (okN) {
          status = OOS_ST.SENT; result = 'ส่งสำเร็จ ' + okN + '/' + uids.length + (errs.length ? ' · ' + errs.join(' | ') : '');
          res.sent++;
        } else {
          status = OOS_ST.FAIL; result = errs.join(' | ').slice(0, 450); res.failed++;
        }
      }
      sh.getRange(r.row, OOS_C['สถานะ'] + 1, 1, 5).setValues([[status, uids.join(' '),
        status === OOS_ST.SENT ? now : o.sentAt, opt.round || '', result]]);
      sh.getRange(r.row, OOS_C['อัปเดต'] + 1).setValue(now);
    }
  } finally { lock.releaseLock(); }
  res.at = oosNow_();
  oosProps_().setProperty('OOS_LAST', JSON.stringify(res));
  return res;
}

function oosThaiDate_(iso) {
  var a = String(iso).split('-');
  return a.length === 3 ? (+a[2]) + '/' + (+a[1]) + '/' + a[0] : iso;
}

function oosPush_(uid, o) {
  var msg = { type: 'flex', altText: ('แจ้งสินค้าขาด · ร้าน ' + o.cusName).slice(0, 380), contents: oosFlex_(o) };
  var payload = { to: uid, messages: [msg] };
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + CHANNEL_ACCESS_TOKEN },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code === 200) {
      try { rtnForwardCards_(uid, payload.messages, res); } catch (e) {}
      return { ok: true };
    }
    var m = res.getContentText();
    try { m = JSON.parse(m).message || m; } catch (e) {}
    return { ok: false, error: code + ' ' + String(m).slice(0, 150) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err).slice(0, 150) };
  }
}

function oosTestSend_(b) {
  var uid = String(b.uid || '').trim();
  if (!/^U[0-9a-f]{32}$/i.test(uid)) throw new Error('User ID ไม่ถูกต้อง');
  var it = b.item || {};
  var r = oosPush_(uid, {
    cusId: it.cusId || '0000000000', cusName: it.cusName || 'ร้านทดสอบ', date: it.date || oosToday_(),
    bills: it.bills || 'DC000000/00000', sale: it.sale || '-', short: it.short || '🔴ทดสอบ 1 ลังx12(CS)', add: it.add || '-', orders: it.orders || ''
  });
  if (!r.ok) throw new Error(r.error);
  return { sent: 1 };
}

/* ───────────── ไฟล์ Excel ต้นฉบับ (Power Query จาก SQL) ───────────── */
var OOS_XLSX_FOLDER = '1CFKu6FnpGxa35bYf6s-hUbK_apTmeunp';   // โฟลเดอร์ "Order scanner"
var OOS_XLSX_NAME = 'สินค้าขาด ส่งไลน์.xlsx';
// ไฟล์ที่แอปขอได้ (กันขออ่านไฟล์อื่นในโฟลเดอร์) — Check Out.xlsx = BVBK ใบจอง + DSDC บิล (task RefreshExcelSQL รีเฟรชทุก 1 ชม.)
var OOS_XLSX_ALLOW = [OOS_XLSX_NAME, 'Check Out.xlsx'];

function oosXlsxFile_(name) {
  name = name || OOS_XLSX_NAME;
  if (OOS_XLSX_ALLOW.indexOf(name) < 0) throw new Error('ไม่อนุญาตให้อ่านไฟล์ ' + name);
  var it = DriveApp.getFolderById(OOS_XLSX_FOLDER).getFilesByName(name), best = null;
  while (it.hasNext()) {
    var f = it.next();
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  if (!best) throw new Error('ไม่พบไฟล์ ' + name + ' ในโฟลเดอร์ Order scanner');
  return best;
}

/**
 * ส่งไฟล์เป็นท่อน — Check Out.xlsx ~2.9MB (base64 ~3.9MB) ส่งก้อนเดียว/หลายก้อนใหญ่ Google ตอบ 404 เป็นช่วง ๆ
 * v1.12 pack: แกะ xlsx ในหลังบ้าน (Utilities.unzip + อ่าน XML) เอาเฉพาะ 11 คอลัมน์ที่แอปใช้ ของแท็บ BVBK + DSDC
 *   → JSON → gzip → base64 (~0.8MB เล็กลง ~5 เท่า) · แอปไม่ต้องแกะ Excel เอง
 * xlsxMeta: ทำครั้งเดียวต่อไฟล์เวอร์ชัน → แบ่งท่อนละ 90,000 ตัว (CacheService รับ ≤100KB/ค่า) เก็บ 6 ชม.
 *           คีย์ = id ไฟล์ + เวลาแก้ล่าสุด → ไฟล์ไม่เปลี่ยน = ใช้แคชเดิม · oosTick อุ่นแคชไว้ก่อนทุก 10 นาที
 * xlsxPart: ส่งท่อน [from, to) จากแคช
 */
var OOS_PART = 90000;
var OOS_ORDER_FILE = 'Check Out.xlsx';
var OOS_ORDER_COLS = ['DI_DATE', 'DI_REF', 'AR_CODE', 'AR_NAME', 'SLMN_NAME', 'WL_CODE', 'SKU_NAME', 'TRD_UTQNAME', 'TRD_QTY', 'TRD_Q_FREE', 'DI_REMARK'];
function oosXlsxMeta_(name, pack) {
  pack = !!pack && name === OOS_ORDER_FILE;
  var f = oosXlsxFile_(name);
  var upd = f.getLastUpdated();
  var key = (pack ? 'p_' : 'x_') + f.getId().slice(-12) + '_' + upd.getTime();
  var cache = CacheService.getScriptCache();
  var n = +(cache.get(key + '_n') || 0);
  if (!n) {
    var b64 = pack
      ? Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(oosOrderPack_(f.getBlob())), 'application/json', 'o.json')).getBytes())
      : Utilities.base64Encode(f.getBlob().getBytes());
    n = Math.ceil(b64.length / OOS_PART);
    var all = {};
    for (var i = 0; i < n; i++) all[key + '_' + i] = b64.slice(i * OOS_PART, (i + 1) * OOS_PART);
    var ks = Object.keys(all);
    for (var j = 0; j < ks.length; j += 20) {          // putAll ทีละ 20 ท่อน
      var sub = {}; ks.slice(j, j + 20).forEach(function (k) { sub[k] = all[k]; });
      cache.putAll(sub, 21600);
    }
    cache.put(key + '_n', String(n), 21600);
  }
  return { name: f.getName(), updated: Utilities.formatDate(upd, OOS_TZ, 'yyyy-MM-dd HH:mm:ss'), key: key, n: n, pack: pack };
}
function oosXlsxPart_(key, from, to) {
  if (!/^[xp]_[\w-]+_\d+$/.test(String(key || ''))) throw new Error('คีย์ไม่ถูกต้อง');
  from = Math.max(0, +from || 0); to = Math.max(from, +to || 0);
  var ks = []; for (var i = from; i < to; i++) ks.push(key + '_' + i);
  var got = CacheService.getScriptCache().getAll(ks);
  var parts = ks.map(function (k) { return got[k]; });
  if (parts.some(function (p) { return p == null; })) throw new Error('แคชหมดอายุ — โหลดใหม่');
  return { from: from, data: parts.join('') };
}

/** ข้อความใน XML ของ xlsx → ตัวจริง (entity + _xHHHH_ แบบ Excel เช่น _x000D_) */
function oosXmlText_(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(+d); })
    .replace(/&amp;/g, '&')
    .replace(/_x([0-9A-Fa-f]{4})_/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
}
/** แกะ Check Out.xlsx → { bk: [[หัว...], [แถว...]], ds: [...] } เฉพาะ OOS_ORDER_COLS (ค่าเป็นข้อความทั้งหมด เหมือน SheetJS raw) */
function oosOrderPack_(blob) {
  var by = {};
  Utilities.unzip(blob.setContentType('application/zip')).forEach(function (b) { by[b.getName()] = b; });
  var txt = function (p) { if (!by[p]) throw new Error('ไฟล์ Excel ไม่ครบ (' + p + ')'); return by[p].getDataAsString('UTF-8'); };
  var rel = {};
  txt('xl/_rels/workbook.xml.rels').replace(/<Relationship\b[^>]*>/g, function (t) {
    var id = (t.match(/\bId="([^"]+)"/) || [])[1], tg = (t.match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && tg) rel[id] = tg.charAt(0) === '/' ? tg.slice(1) : 'xl/' + tg;
    return t;
  });
  var sheetPath = {};
  txt('xl/workbook.xml').replace(/<sheet\b[^>]*>/g, function (t) {
    var nm = (t.match(/\bname="([^"]+)"/) || [])[1], id = (t.match(/\br:id="([^"]+)"/) || [])[1];
    if (nm && id) sheetPath[oosXmlText_(nm)] = rel[id];
    return t;
  });
  var S = [];
  if (by['xl/sharedStrings.xml']) {
    var ss = txt('xl/sharedStrings.xml'), re = /<si>([\s\S]*?)<\/si>/g, m;
    while ((m = re.exec(ss))) {
      var t = '', r2 = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, mm;
      while ((mm = r2.exec(m[1]))) t += mm[1];
      S.push(oosXmlText_(t));
    }
  }
  var sheet = function (name) {
    if (!sheetPath[name]) throw new Error('ไม่พบแท็บ ' + name + ' ใน ' + OOS_ORDER_FILE);
    var x = txt(sheetPath[name]), rows = [], want = null;
    var rre = /<row\b[^>]*>([\s\S]*?)<\/row>/g, rm;
    while ((rm = rre.exec(x))) {
      var cells = {}, cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, cm;
      while ((cm = cre.exec(rm[1]))) {
        var a = cm[1], col = (a.match(/\br="([A-Z]+)/) || [])[1];
        if (!col) continue;
        var inner = cm[2] || '', tt = (a.match(/\bt="(\w+)"/) || [])[1], v;
        if (tt === 'inlineStr') v = oosXmlText_((inner.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/) || [])[1] || '');
        else {
          var vv = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          v = vv == null ? '' : tt === 's' ? (S[+vv] || '') : oosXmlText_(vv);
        }
        cells[col] = v;
      }
      if (!want) {   // แถวแรก = หัวคอลัมน์
        want = OOS_ORDER_COLS.map(function (k) {
          for (var c in cells) if (String(cells[c]).replace(/\s+/g, ' ').trim().toUpperCase() === k) return c;
          throw new Error('ไม่พบคอลัมน์ ' + k + ' ในแท็บ ' + name);
        });
        rows.push(OOS_ORDER_COLS.slice());
        continue;
      }
      rows.push(want.map(function (c) { return cells[c] == null ? '' : cells[c]; }));
    }
    return rows;
  };
  return { bk: sheet('BVBK'), ds: sheet('DSDC') };
}

/** ส่งไฟล์ .xlsx ทั้งไฟล์ (base64) ให้แอปแกะเองด้วย SheetJS — ตัวเก่า (ไฟล์เล็ก) */
function oosXlsx_(name) {
  var f = oosXlsxFile_(name);
  return {
    name: f.getName(),
    updated: Utilities.formatDate(f.getLastUpdated(), OOS_TZ, 'yyyy-MM-dd HH:mm:ss'),
    b64: Utilities.base64Encode(f.getBlob().getBytes())
  };
}

/* ───────────── Flex (แบบ A กรมท่า-ทอง · v1.2) ───────────── */
var OOS_NAVY = '#0d1b3e', OOS_GOLD = '#c9a84c', OOS_RED = '#c0392b', OOS_GREEN = '#1e8449', OOS_MAX_ROWS = 40;
var OOS_TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** "2026-10-01" → "1 ต.ค. 2569" */
function oosThaiDateLong_(iso) {
  var a = String(iso).split('-');
  return a.length === 3 ? (+a[2]) + ' ' + OOS_TH_MON[(+a[1]) - 1] + ' ' + ((+a[0]) + 543) : String(iso);
}

/** "🔴แม่ประนอม 980ก. 2 ลังx12(CS) 3 ชิ้นx1(EA)" → { name, qty:'2 ลัง 3 ชิ้น', sub:'x12' } */
function oosParseLine_(line) {
  var s = String(line).replace(/^[\s\u{1F534}\u{1F7E2}\u2B55\uFE0F]+/u, '').trim();
  var re = /(\d+)\s+([^\s\d]+?)x(\d+)\((\w+)\)/g, m, parts = [], first = -1;
  while ((m = re.exec(s))) { if (first < 0) first = m.index; parts.push(m); }
  if (!parts.length) return { name: s, qty: '', sub: '' };
  return {
    name: s.slice(0, first).trim() || s,
    qty: parts.map(function (p) { return p[1] + ' ' + p[2]; }).join(' '),
    sub: parts.filter(function (p) { return +p[3] > 1; }).map(function (p) { return 'x' + p[3]; }).join(' ')
  };
}

function oosLines_(txt) {
  var t = String(txt || '').trim();
  if (!t || t === '-') return [];
  return t.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(oosParseLine_);
}

function oosSection_(label, color, items, maxRows) {
  var out = [{
    type: 'box', layout: 'horizontal', margin: 'xl', spacing: 'md', alignItems: 'center', contents: [
      {
        type: 'box', layout: 'vertical', flex: 0, backgroundColor: color, cornerRadius: '14px',
        paddingStart: '12px', paddingEnd: '12px', paddingTop: '3px', paddingBottom: '3px',
        contents: [{ type: 'text', text: label, color: '#ffffff', size: 'sm', weight: 'bold' }]
      },
      { type: 'text', text: items.length + ' รายการ', size: 'xs', color: '#8a8a8a', flex: 1 }
    ]
  }];
  var shown = items.slice(0, maxRows);
  shown.forEach(function (it, i) {
    if (i) out.push({ type: 'separator', margin: 'md', color: '#eef0f4' });
    var right = [{ type: 'text', text: it.qty || '-', size: 'md', weight: 'bold', color: color === OOS_GREEN ? OOS_GREEN : OOS_RED, align: 'end' }];
    if (it.sub) right.push({ type: 'text', text: it.sub, size: 'xxs', color: '#9a9a9a', align: 'end' });
    out.push({
      type: 'box', layout: 'horizontal', margin: 'md', spacing: 'md', alignItems: 'center', contents: [
        { type: 'text', text: it.name, size: 'sm', color: '#222222', wrap: true, flex: 1 },
        { type: 'box', layout: 'vertical', flex: 0, contents: right }
      ]
    });
  });
  if (items.length > shown.length) {
    out.push({ type: 'text', text: '…และอีก ' + (items.length - shown.length) + ' รายการ', size: 'xs', color: '#8a8a8a', margin: 'md' });
  }
  return out;
}

/** LINE จำกัด JSON ของ bubble ~30KB → ลดจำนวนแถวที่โชว์ลงจนกว่าจะพอดี */
function oosFlex_(o) {
  for (var n = OOS_MAX_ROWS; n > 5; n -= 5) {
    var f = oosFlexBuild_(o, n);
    if (Utilities.newBlob(JSON.stringify(f)).getBytes().length < 28000) return f;
  }
  return oosFlexBuild_(o, 5);
}

function oosFlexBuild_(o, maxRows) {
  var shortItems = oosLines_(o.short), addItems = oosLines_(o.add);
  var body = [
    { type: 'text', text: String(o.cusName || '-'), size: 'lg', weight: 'bold', color: OOS_NAVY, wrap: true },
    { type: 'text', text: 'รหัสร้าน ' + (o.cusId || '-'), size: 'xs', color: '#8a8a8a' }
  ];
  var kv = function (k, v) {
    return {
      type: 'box', layout: 'horizontal', spacing: 'md', contents: [
        { type: 'text', text: k, size: 'xs', color: '#8a8a8a', flex: 0 },
        { type: 'text', text: v, size: 'xs', color: '#222222', weight: 'bold', wrap: true, flex: 1 }
      ]
    };
  };
  var info = [];
  if (o.orders && String(o.orders).trim()) info.push(kv('เลขออเดอร์', String(o.orders).split(/\s*,\s*/).join('\n')));   // ออเดอร์ ROO (billIdORD…)
  if (o.sale && String(o.sale).trim() && String(o.sale).trim() !== '-') info.push(kv('เซลล์', String(o.sale).replace(/\s*\(ROO\)\s*$/, '')));
  if (info.length) {
    body.push({ type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f7fb', cornerRadius: '10px', paddingAll: '10px', spacing: 'xs', contents: info });
  }
  if (shortItems.length) {
    body = body.concat(oosSection_('สินค้าขาด', '#e74c3c', shortItems, maxRows));
    body.push({ type: 'text', text: '* อาจมีสินค้าขาดเพิ่มเติมจากรายการนี้', size: 'xxs', color: '#9a9a9a', wrap: true, margin: 'md' });
  }
  if (addItems.length) {
    body = body.concat(oosSection_('อาจได้รับเพิ่ม / ส่งแทน', OOS_GREEN, addItems, maxRows));
    body.push({ type: 'text', text: '* รายการส่งแทน / เพิ่ม อาจได้รับหรือไม่ได้รับ ขึ้นอยู่กับสินค้าที่มีในวันจัดส่ง', size: 'xxs', color: '#9a9a9a', wrap: true, margin: 'md' });
  }
  return {
    type: 'bubble', size: 'giga',
    header: {
      type: 'box', layout: 'vertical', paddingAll: '0px', contents: [
        {
          type: 'box', layout: 'vertical', backgroundColor: OOS_NAVY, paddingAll: '16px', paddingStart: '18px', contents: [
            { type: 'text', text: 'RATTANA · แจ้งรายละเอียดสินค้า', size: 'xs', color: OOS_GOLD, weight: 'bold' },
            { type: 'text', text: 'สินค้าขาด / ส่งแทน', size: 'xl', color: '#ffffff', weight: 'bold', margin: 'xs' },
            { type: 'text', text: 'วันที่ ' + oosThaiDateLong_(o.date), size: 'xs', color: '#c3c9d6', margin: 'xs' }
          ]
        },
        { type: 'box', layout: 'vertical', height: '4px', backgroundColor: OOS_GOLD, contents: [] }
      ]
    },
    body: { type: 'box', layout: 'vertical', paddingStart: '18px', paddingEnd: '18px', contents: body },
    footer: {
      type: 'box', layout: 'vertical', paddingStart: '18px', paddingEnd: '18px', contents: [
        { type: 'text', text: 'ขออภัยในความไม่สะดวก 🙏', size: 'xs', color: '#6b7896' },
        { type: 'text', text: 'สอบถามเพิ่มเติม ติดต่อเซลล์ผู้ดูแล หรือแชทนี้ได้เลย', size: 'xs', color: '#6b7896', wrap: true }
      ]
    },
    styles: { footer: { separator: true, separatorColor: '#eef0f4' } }
  };
}
