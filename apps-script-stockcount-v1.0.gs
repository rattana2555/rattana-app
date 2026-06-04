/**
 * Rattana Stock Count — Apps Script Web App (v1.2)
 * v1.2 — doGet?action=history returns saved rows for the History tab
 * v1.1 — force Product Key column to plain text format
 * รับผลการนับสต็อกจากเว็บแอป แล้วบันทึกลง Google Sheet
 *
 * ── วิธีติดตั้ง ──
 * 1. สร้าง Google Sheet ใหม่ 1 ไฟล์ (เก็บผลการนับ) แล้วก๊อป Spreadsheet ID จาก URL
 *    (ส่วนระหว่าง /d/ กับ /edit) มาวางที่ SHEET_ID ด้านล่าง
 * 2. ใน Sheet นั้น เปิดเมนู Extensions → Apps Script
 * 3. ลบโค้ดเดิมทั้งหมด วางโค้ดนี้แทน แล้วกด Save
 * 4. กด Deploy → New deployment → เลือก type = Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    กด Deploy แล้วก๊อป "Web app URL" ที่ได้
 * 5. เอา URL ไปวางในไฟล์ rattana-stock-checker.html ที่ const COUNT_SAVE_URL = '...'
 *
 * แอปจะสร้างชีทชื่อ "StockCount" ให้อัตโนมัติพร้อม header แถวแรก
 */

var SHEET_ID   = 'PASTE_YOUR_SPREADSHEET_ID_HERE';
var TAB_NAME   = 'StockCount';

var HEADERS = [
  'Saved At',        // เวลาที่บันทึก
  'Session Start',   // เวลาที่เริ่มนับ
  'Warehouse',       // คลัง (W1-W4)
  'Emp ID',          // รหัสพนักงานผู้นับ
  'Counter Name',    // ชื่อผู้นับ
  'Product Key',     // รหัสสินค้า (บาร์โค้ดหลัก)
  'Product Name',    // ชื่อสินค้า
  'Counted CS',
  'Counted BP',
  'Counted PA',
  'Counted EA',
  'Counted Pieces',  // นับได้รวม (ชิ้น)
  'System Stock',    // สต็อกระบบ (รูปแบบ CS.EA)
  'System Pieces',   // สต็อกระบบ (ชิ้น)
  'Diff Pieces',     // ต่าง (+ เกิน / - ขาด)
  'Status'           // ok / short / over
];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(TAB_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(TAB_NAME);
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    // Force Product Key column (6) to PLAIN TEXT so leading zeros & long
    // barcodes are preserved (otherwise Sheets turns "0812345678" into a
    // number and 13-digit codes into 1.23E+12).
    sheet.getRange(1, 6, sheet.getMaxRows(), 1).setNumberFormat('@');
    var savedAt = data.savedAt || new Date().toISOString();
    (data.rows || []).forEach(function (r) {
      sheet.appendRow([
        savedAt,
        data.sessionStart || '',
        data.warehouse || '',
        data.empId || '',
        data.counterName || '',
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
        r.status || ''
      ]);
    });
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, saved: (data.rows || []).length }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'history') {
      var ss = SpreadsheetApp.openById(SHEET_ID);
      var sheet = ss.getSheetByName(TAB_NAME);
      if (!sheet || sheet.getLastRow() < 2) {
        return _json({ ok: true, rows: [] });
      }
      var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
      var rows = values.map(function (r) {
        return {
          savedAt:       _iso(r[0]),
          sessionStart:  _iso(r[1]),
          warehouse:     String(r[2] || ''),
          empId:         String(r[3] || ''),
          counterName:   String(r[4] || ''),
          key:           String(r[5] || ''),
          name:          String(r[6] || ''),
          cs:            Number(r[7] || 0),
          bp:            Number(r[8] || 0),
          pa:            Number(r[9] || 0),
          ea:            Number(r[10] || 0),
          countedPieces: Number(r[11] || 0),
          systemRaw:     String(r[12] || ''),
          systemPieces:  Number(r[13] || 0),
          diffPieces:    Number(r[14] || 0),
          status:        String(r[15] || ''),
        };
      });
      return _json({ ok: true, rows: rows });
    }
    return _json({ ok: true, msg: 'Rattana Stock Count endpoint is live' });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function _iso(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
function _json(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
