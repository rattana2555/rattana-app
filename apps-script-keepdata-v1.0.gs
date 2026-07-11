// ═══════════════════════════════════════════════════════════
// Rattana — Delivery Queue · Apps Script (Keepdata)
// v1.0 — 2026-05-20
//
// บันทึกข้อมูลจัดรถจากแอปลงชีท "Keepdata"
// ลบเฉพาะแถวที่ "วันส่ง" ผ่านมาแล้ว ≥ 3 วันเท่านั้น
// แถววันส่งในอนาคต / ภายใน 3 วัน → คงไว้
// ═══════════════════════════════════════════════════════════

const SHEET_NAME = 'Keepdata';
const KEEP_DAYS  = 3;   // ลบแถวที่วันส่งผ่านมาแล้ว ≥ KEEP_DAYS วัน
const DATE_COL   = 2;   // คอลัมน์ "วันที่ส่ง" (B)

// ────────────────────────────────────────────────────────────
// Entry points (Web App)
// ────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    return handleAction(payload);
  } catch (err) {
    return jsonOut({ ok: false, message: 'doPost: ' + err.message });
  }
}

function doGet(e) {
  try {
    if (!e.parameter.data) return jsonOut({ ok: false, message: 'no data param' });
    const payload = JSON.parse(e.parameter.data);
    return handleAction(payload);
  } catch (err) {
    return jsonOut({ ok: false, message: 'doGet: ' + err.message });
  }
}

function handleAction(p) {
  if (p && p.action === 'save') return saveRows(p);
  return jsonOut({ ok: false, message: 'unknown action: ' + (p && p.action) });
}

// ────────────────────────────────────────────────────────────
// Save: เขียนแถวใหม่ + ลบเฉพาะแถวเก่าที่วันส่งผ่านมาแล้ว ≥ 3 วัน
// ────────────────────────────────────────────────────────────
function saveRows(p) {
  const { deliveryDate, headers, rows } = p;
  if (!deliveryDate || !headers || !rows) {
    return jsonOut({ ok: false, message: 'missing deliveryDate/headers/rows' });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  // ── 1) อ่านข้อมูลเดิมทั้งหมด (ยกเว้นหัวคอลัมน์) ──
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(headers.length, sh.getLastColumn());
  const existing = lastRow > 1
    ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues()
    : [];

  // ── 2) คำนวณวันตัด: วันนี้ − KEEP_DAYS ──
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  const delivDate = parseThaiDate(deliveryDate);

  // ── 3) กรองแถวเดิม ──
  //   เก็บไว้ถ้า: วันส่งยังไม่ผ่าน 3 วัน (≥ cutoff)
  //              และไม่ใช่วันเดียวกับที่กำลังบันทึก (จะถูกเขียนใหม่ทดแทน)
  //   ลบทิ้งถ้า: วันส่ง < cutoff (ผ่านมาแล้ว ≥ 3 วัน)
  //              หรือเป็นวันเดียวกับ deliveryDate
  let deletedOld = 0;
  let replaced   = 0;
  const kept = existing.filter(row => {
    // แถวว่าง (ทั้งแถว) → ข้าม
    if (row.every(c => c === '' || c === null)) return false;
    const d = parseThaiDate(row[DATE_COL - 1]);
    if (!d) return true;               // อ่านวันที่ไม่ออก → เก็บไว้ก่อน (กันลบผิด)
    if (d < cutoff) { deletedOld++; return false; }
    if (delivDate && sameDay(d, delivDate)) { replaced++; return false; }
    return true;
  });

  // ── 4) เคลียร์พื้นที่ข้อมูล แล้วเขียนใหม่ ──
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }
  // ปรับให้ทุกแถวมีจำนวนคอลัมน์เท่ากับ headers
  const norm = arr => {
    const out = arr.slice(0, headers.length);
    while (out.length < headers.length) out.push('');
    return out;
  };
  const combined = kept.map(norm).concat(rows.map(norm));
  if (combined.length > 0) {
    sh.getRange(2, 1, combined.length, headers.length).setValues(combined);
  }

  return jsonOut({
    ok: true,
    message: `บันทึก ${rows.length} แถว · ลบเก่า ${deletedOld} · ทดแทนวัน ${deliveryDate} ${replaced} แถว · คงไว้ ${kept.length}`
  });
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function parseThaiDate(s) {
  if (!s) return null;
  // ถ้าเป็น Date object อยู่แล้ว
  if (Object.prototype.toString.call(s) === '[object Date]') {
    if (isNaN(s.getTime())) return null;
    const d = new Date(s); d.setHours(0, 0, 0, 0); return d;
  }
  const str = String(s).trim();
  const parts = str.split('/');
  if (parts.length !== 3) return null;
  const d = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  let y   = parseInt(parts[2], 10);
  if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
  if (y > 2500) y -= 543;             // พ.ศ. → ค.ศ.
  if (y < 100)  y += 2000;            // YY → YYYY
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function sameDay(a, b) {
  return a && b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth() &&
    a.getDate()     === b.getDate();
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
