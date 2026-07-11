/**
 * Rattana Stock Count — Apps Script Web App (v1.9)
 * v1.9 — apostrophe-prefix + per-cell text format for System Stock too
 * v1.8 — add Email column (counter's email) after Expiry Date
 * v1.7 — append Diff CS.EA with apostrophe prefix + per-cell text format (Sheets was still coercing it to a number)
 * v1.6 — Diff CS.EA stored as numeric-text "+1.2" / "-0.12"; column forced to text
 * v1.5 — add Diff CS.EA column (e.g. "-4 CS 17 EA")
 * v1.4 — add Expiry Date column (user-entered, optional)
 * v1.3 — sync in-progress draft counts per user across devices
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

var SHEET_ID    = 'PASTE_YOUR_SPREADSHEET_ID_HERE';
var TAB_NAME    = 'StockCount';
var DRAFT_TAB   = 'Drafts';
var DRAFT_HEADERS = ['UserKey','Email','EmpId','Warehouse','SessionStart','UpdatedAt','Payload'];

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
  'Status',          // ตรง / ขาด / เกิน
  'Diff CS.EA',      // ต่าง รูปแบบ CS.EA (เช่น "-1.2")
  'Expiry Date',     // วันหมดอายุ (ผู้ใช้กรอก, YYYY-MM-DD; ว่างได้)
  'Email'            // อีเมลผู้นับ
];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.openById(SHEET_ID);
    if (data.action === 'saveDraft')  return _saveDraft(ss, data);
    if (data.action === 'clearDraft') return _clearDraft(ss, data);
    var sheet = ss.getSheetByName(TAB_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(TAB_NAME);
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    // Force PLAIN TEXT on columns that must keep leading/trailing zeros:
    //   col 6  — Product Key (barcodes like 0812345678 / 13-digit EAN)
    //   col 13 — System Stock (CS.EA from the master sheet)
    //   col 16 — Diff CS.EA (so "0.10" stays "0.10" = 10 EA, not "0.1")
    sheet.getRange(1, 6,  sheet.getMaxRows(), 1).setNumberFormat('@');
    sheet.getRange(1, 13, sheet.getMaxRows(), 1).setNumberFormat('@');
    sheet.getRange(1, 16, sheet.getMaxRows(), 1).setNumberFormat('@');
    var savedAt = data.savedAt || new Date().toISOString();
    (data.rows || []).forEach(function (r) {
      // Prefix CS.EA values with apostrophe so Sheets treats them as text
      // and preserves trailing zeros (e.g. "0.20" must stay 20 EA).
      var systemRaw = r.systemRaw || '';
      if (systemRaw && systemRaw.charAt(0) !== "'") systemRaw = "'" + systemRaw;
      var diffCSEA = r.diffCSEA || '';
      if (diffCSEA && diffCSEA.charAt(0) !== "'") diffCSEA = "'" + diffCSEA;
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
        systemRaw,
        r.systemPieces || 0,
        r.diffPieces || 0,
        r.status || '',
        diffCSEA,
        r.expiryDate || '',
        data.email || ''
      ]);
      // Belt + suspenders — force System Stock (col 13) and Diff CS.EA (col 16)
      // on this exact row to plain text format
      try {
        var rowN = sheet.getLastRow();
        sheet.getRange(rowN, 13).setNumberFormat('@');
        sheet.getRange(rowN, 16).setNumberFormat('@');
      } catch (e2) {}
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
    if (action === 'draft') {
      var ss = SpreadsheetApp.openById(SHEET_ID);
      var key = String((e.parameter.userKey || '')).toLowerCase();
      var wh  = String((e.parameter.warehouse || '')).toUpperCase();
      var sheet = ss.getSheetByName(DRAFT_TAB);
      if (!sheet || sheet.getLastRow() < 2) return _json({ ok: true, draft: null });
      var vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, DRAFT_HEADERS.length).getValues();
      for (var i = 0; i < vals.length; i++) {
        if (String(vals[i][0]).toLowerCase() === key && String(vals[i][3]).toUpperCase() === wh) {
          try {
            return _json({ ok: true, draft: {
              sessionStart: _iso(vals[i][4]),
              updatedAt:    _iso(vals[i][5]),
              items:        JSON.parse(vals[i][6] || '{}'),
            }});
          } catch (er) { return _json({ ok: true, draft: null }); }
        }
      }
      return _json({ ok: true, draft: null });
    }
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
          diffCSEA:      String(r[16] || ''),
          expiryDate:    _iso(r[17]),
          email:         String(r[18] || ''),
        };
      });
      return _json({ ok: true, rows: rows });
    }
    return _json({ ok: true, msg: 'Rattana Stock Count endpoint is live' });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function _ensureDraftSheet(ss) {
  var sheet = ss.getSheetByName(DRAFT_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(DRAFT_TAB);
    sheet.appendRow(DRAFT_HEADERS);
    sheet.getRange(1, 1, 1, DRAFT_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Find a draft row by (userKey, warehouse). Returns 1-based row number or 0.
function _findDraftRow(sheet, userKey, warehouse) {
  if (sheet.getLastRow() < 2) return 0;
  var vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  var k = String(userKey || '').toLowerCase();
  var w = String(warehouse || '').toUpperCase();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).toLowerCase() === k && String(vals[i][3]).toUpperCase() === w) {
      return i + 2;
    }
  }
  return 0;
}

function _saveDraft(ss, data) {
  var sheet = _ensureDraftSheet(ss);
  var row = _findDraftRow(sheet, data.userKey, data.warehouse);
  var values = [
    String(data.userKey || '').toLowerCase(),
    String(data.email || ''),
    String(data.empId || ''),
    String(data.warehouse || '').toUpperCase(),
    data.sessionStart || new Date().toISOString(),
    new Date().toISOString(),
    JSON.stringify(data.items || {}),
  ];
  if (row) {
    sheet.getRange(row, 1, 1, DRAFT_HEADERS.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
  return _json({ ok: true });
}

function _clearDraft(ss, data) {
  var sheet = ss.getSheetByName(DRAFT_TAB);
  if (!sheet) return _json({ ok: true });
  var row = _findDraftRow(sheet, data.userKey, data.warehouse);
  if (row) sheet.deleteRow(row);
  return _json({ ok: true });
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
