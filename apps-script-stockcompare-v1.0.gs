/**
 * Rattana เทียบสต็อก (Stock Compare) — Apps Script Web App (v1.0)
 * ผูกกับ "ไฟล์เช็คสต็อก" (ไฟล์ผลการนับ ที่มีแท็บ W4 / C4)
 *
 *  doGet?action=check   → อ่านแท็บ W4 + C4 ส่งกลับเป็น JSON (ให้แอปฝั่งเบราว์เซอร์อ่าน)
 *  doPost {action:'writeSummary', tabs:[{name, rows:[[...]]}]} → เขียนผลสรุปกลับลงไฟล์
 *
 * ── วิธีติดตั้ง ──
 * 1. เปิด "ไฟล์เช็คสต็อก" (Google Sheet ที่มีแท็บ W4 / C4) ใน Google Sheets
 * 2. เมนู Extensions → Apps Script
 * 3. ลบโค้ดเดิม วางโค้ดนี้แทน → Save
 * 4. (ไม่ต้องแก้ CHECK_ID ถ้าผูก Apps Script ไว้ในไฟล์เช็คโดยตรง — ใช้ getActiveSpreadsheet)
 *    ถ้า deploy แยกไฟล์ ให้ใส่ Spreadsheet ID ของไฟล์เช็คที่ CHECK_ID ด้านล่าง
 * 5. Deploy → New deployment → type = Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    กด Deploy → ก๊อป "Web app URL"
 * 6. เปิดแอป Rattana เทียบสต็อก → แท็บ ⚙️ ตั้งค่า → วาง URL ในช่อง Apps Script URL → บันทึก
 */

// ใส่ Spreadsheet ID ของไฟล์เช็ค (ส่วนระหว่าง /d/ กับ /edit ใน URL)
// ถ้า script ผูกอยู่ในไฟล์เช็คอยู่แล้ว ปล่อยว่าง '' ได้ (จะใช้ getActiveSpreadsheet)
var CHECK_ID   = '17ycdlxPl5SRfbIqWPMpdm0SffNgXK-19rlsww-ck038';
var CHECK_TABS = ['W4', 'C4'];

function _ss() {
  if (CHECK_ID) return SpreadsheetApp.openById(CHECK_ID);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'check';
    if (action === 'check') return _json(_readCheck());
    return _json({ ok: true, msg: 'Rattana Stock Compare endpoint is live' });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function _readCheck() {
  var ss = _ss();
  var out = {};
  CHECK_TABS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) { out[name] = []; return; }
    var vals = sh.getDataRange().getValues();
    var hdr = vals[0].map(function (h) { return String(h).trim(); });
    var rows = [];
    for (var i = 1; i < vals.length; i++) {
      var r = vals[i];
      if (r.join('') === '') continue;
      var o = {};
      for (var j = 0; j < hdr.length; j++) { if (hdr[j]) o[hdr[j]] = _cell(r[j]); }
      rows.push(o);
    }
    out[name] = rows;
  });
  return { ok: true, sheets: out, generatedAt: new Date().toISOString() };
}

function _cell(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  return String(v);
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.action === 'writeSummary') return _writeSummary(data);
    return _json({ ok: false, error: 'unknown action' });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function _writeSummary(data) {
  var ss = _ss();
  var written = [];
  (data.tabs || []).forEach(function (t) {
    var sh = ss.getSheetByName(t.name);
    if (!sh) sh = ss.insertSheet(t.name); else sh.clear();
    var rows = t.rows || [];
    if (rows.length) {
      sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
      sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
      sh.setFrozenRows(1);
      // คอลัมน์รหัสสินค้า (คอลัมน์แรก) บังคับเป็นข้อความ กัน 0 หาย
      sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');
    }
    written.push(t.name + ':' + rows.length);
  });
  return _json({ ok: true, written: written });
}

function _json(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
