// ════════════════════════════════════════════════════════
//  Rattana Member System — GAS v1.24
// ════════════════════════════════════════════════════════

const SHEET_ID        = '1gbBrJtE36fX8TM7KC0RbXgPZI6AyNpbC3XhJ6uiLsOE';
const SHEET_NAME      = 'Members';
const POINT_SHEET     = 'Member Point';
// v1.21: ไม่เก็บ webhook ในโค้ดอีกแล้ว (repo เป็น public — URL เคยหลุดโดนบอทสแปม)
// ตั้งค่าที่ Apps Script → ⚙️ การตั้งค่าโครงการ → คุณสมบัติของสคริปต์
//   ชื่อ: DISCORD_WEBHOOK   ค่า: <URL ของ webhook>
function getDiscordWebhook_() {
  try {
    return PropertiesService.getScriptProperties().getProperty('DISCORD_WEBHOOK') || '';
  } catch (e) {
    return '';
  }
}

const HEADERS = [
  'LINE User ID','ชื่อ LINE','ชื่อ','นามสกุล',
  'เบอร์โทร','วันเกิด','ที่อยู่','ตำบล/แขวง','อำเภอ/เขต','จังหวัด','รหัสไปรษณีย์',
  'ทราบจาก','รูป Profile URL','วันสมัคร (ISO)','วันสมัคร (ไทย)','อัปเดตล่าสุด',
  'เลขบัตรประชาชน',
  'ยินยอมเงื่อนไข','Consent Version','วันยินยอม'
];

// ─── Helpers ───────────────────────────────────────────
const padZero = (val, len) => {
  let s = String(val == null ? '' : val).trim();
  if (s.indexOf('.') > -1) s = s.split('.')[0];
  while (s.length && s.length < len) s = '0' + s;
  return s;
};

function dateToISO(d) {
  if (!d) return '';
  if (d instanceof Date) {
    const pad = n => String(n).padStart(2,'0');
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
  }
  const s = String(d).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m2) {
    let year = parseInt(m2[3]);
    if (year > 2400) year -= 543;
    return year + '-' + m2[2].padStart(2,'0') + '-' + m2[1].padStart(2,'0');
  }
  return s;
}

// v1.19: ขยายคอลัมน์ให้พอ + เขียนหัวคอลัมน์ทุกครั้ง (ซ่อมของเดิมที่หัวหาย/ไม่ครบ)
function ensureHeaders_(sheet) {
  // 1) ขยายจำนวนคอลัมน์ให้ครบ 20 ก่อน ไม่งั้น getRange(...,20) จะ error
  const need = HEADERS.length;
  const have = sheet.getMaxColumns();
  if (have < need) sheet.insertColumnsAfter(have, need - have);

  // 2) เขียนหัวคอลัมน์ทับเสมอ ถ้ามีช่องไหนว่าง/ไม่ตรง
  const cur = sheet.getRange(1, 1, 1, need).getValues()[0];
  let fix = false;
  for (let i = 0; i < need; i++) {
    if (String(cur[i] || '').trim() !== HEADERS[i]) { fix = true; break; }
  }
  if (fix) {
    sheet.getRange(1, 1, 1, need).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, need)
      .setFontWeight('bold').setBackground('#0d1b3e').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
}

// v1.19: แปลงวัน/เวลาเป็นรูปแบบไทย dd/mm/พ.ศ. hh:mm (เหมือนคอลัมน์ "วันสมัคร (ไทย)")
function toThaiDateTime_(v) {
  if (!v) return '';
  const d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const p = n => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth()+1) + '/' + (d.getFullYear()+543) +
         ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function getSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  ensureHeaders_(sheet);
  // บังคับเป็น text: E เบอร์โทร, F วันเกิด, G ที่อยู่ (กัน "1/1" กลายเป็นวันที่),
  // H ตำบล, I อำเภอ, J จังหวัด, K ไปรษณีย์, Q เลขบัตร, T วันยินยอม
  ['E:E','F:F','G:G','H:H','I:I','J:J','K:K','Q:Q','T:T'].forEach(function(r){
    sheet.getRange(r).setNumberFormat('@STRING@');
  });
  return sheet;
}

// ─── Member Point lookup ──────────────────────────────
function lookupPointByPhone(phone) {
  const empty = { points: 0, tier: 'ทั่วไป' };
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(POINT_SHEET);
    if (!sheet) return empty;
    const last = sheet.getLastRow();
    if (last < 2) return empty;
    const data = sheet.getRange(2, 1, last - 1, 18).getValues();
    const target = padZero(phone, 10);
    for (let i = 0; i < data.length; i++) {
      if (padZero(data[i][0], 10) === target) {
        const r = data[i];
        const addrParts = [r[10], r[11], r[12]].map(x => String(x||'').trim()).filter(Boolean);
        return {
          firstName: String(r[3]||'').trim(),
          lastName:  String(r[4]||'').trim(),
          tier:      String(r[6]||'ทั่วไป').trim(),
          points:    Number(r[7]) || 0,
          dateOfBirth: dateToISO(r[8]),
          address:     addrParts.join(' '),
          subDistrict: String(r[13]||'').trim(),
          district:    String(r[14]||'').trim(),
          province:    String(r[15]||'').trim(),
          postcode:    padZero(r[17], 5),
        };
      }
    }
    return empty;
  } catch(e) { return empty; }
}

function rowToObject(values) {
  const phone = padZero(values[4], 10);
  const pt    = lookupPointByPhone(phone);
  return {
    lineUserId:  values[0], lineName: values[1],
    firstName:   values[2], lastName: values[3],
    phone,
    dateOfBirth: dateToISO(values[5]),
    address:     values[6] instanceof Date ? '' : String(values[6] || ''),
    subDistrict: String(values[7] || ''),
    district:    String(values[8] || ''),
    province:    String(values[9] || ''),
    postcode:    padZero(values[10], 5),
    source:      values[11],
    pictureUrl:  values[12],
    registeredAt:values[13],
    nationalId:  padZero(values[16], 13),
    consent:        String(values[17]||'').toUpperCase() === 'TRUE',
    consentVersion: String(values[18]||''),
    consentDate:    values[19] instanceof Date ? values[19].toISOString() : String(values[19]||''),
    points:      pt.points,
    tier:        pt.tier,
  };
}

function findRowBy(sheet, predicate) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const data = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  for (let i = 0; i < data.length; i++) {
    if (predicate(data[i])) return i + 2;
  }
  return -1;
}

// ─── Discord notification ─────────────────────────────
function notifyDiscord(data, isNew) {
  var DISCORD_WEBHOOK = getDiscordWebhook_();
  if (!DISCORD_WEBHOOK) { Logger.log("ยังไม่ได้ตั้ง Script Property: DISCORD_WEBHOOK"); return; }
  try {
    // v1.20: กันแจ้งซ้ำ — เบอร์เดิม + สถานะเดิม ภายใน 90 วินาที ส่งครั้งเดียว
    var dupKey = 'dc_' + (isNew ? 'n_' : 'u_') + String(data.phone || '');
    var cache  = CacheService.getScriptCache();
    if (cache.get(dupKey)) { Logger.log('Discord skipped (duplicate): ' + dupKey); return; }
    cache.put(dupKey, '1', 90);

    const title = isNew ? '🎉 สมาชิกใหม่!' : '✏️ แก้ไขข้อมูลสมาชิก';
    const fullName = (String(data.firstName || '') + ' ' + String(data.lastName || '')).trim();
    const text = title + '\n```\n' +
      '👤 ชื่อ-นามสกุล : ' + (fullName || '-') + '\n' +
      '📱 เบอร์โทร     : ' + (data.phone || '-') + '\n' +
      '📢 ทราบจาก      : ' + (data.source || '-') + '\n```';
    UrlFetchApp.fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({ content: text }),
      muteHttpExceptions: true,
    });
  } catch(e) { Logger.log('Discord failed: ' + e.message); }
}

function testDiscord() {
  const res = UrlFetchApp.fetch(getDiscordWebhook_(), {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify({ content: '🧪 Test — Rattana Member webhook ใช้งานได้!' }),
    muteHttpExceptions: true,
  });
  Logger.log('Status: ' + res.getResponseCode());
  Logger.log('Body: ' + res.getContentText());
}

// ─── v1.23: ยืนยันตัวตน LINE ─────────────────────────
// Channel ID ของ LINE Login channel "Rattana Member" (= ตัวเลขหน้า LIFF ID) — ไม่ใช่ความลับ
const LINE_CHANNEL_ID = '2010284376';

// ส่ง ID token ให้ LINE ตรวจ → คืน User ID (sub) ถ้าจริง · ปลอม/หมดอายุ → ''
function verifyLineIdToken_(idToken) {
  if (!idToken) return '';
  const cache = CacheService.getScriptCache();
  const key = 'idt_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(idToken))).slice(0, 40);
  const hit = cache.get(key);
  if (hit) return hit === '-' ? '' : hit;
  try {
    const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'post',
      payload: { id_token: String(idToken), client_id: LINE_CHANNEL_ID },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) { cache.put(key, '-', 300); return ''; }
    const body = JSON.parse(res.getContentText());
    const uid = String(body.sub || '');
    // จำผลไว้ไม่เกินอายุ token (สูงสุด 10 นาที) ไม่ต้องถาม LINE ทุกคำขอ
    const ttl = Math.max(30, Math.min(600, Math.floor((Number(body.exp || 0) * 1000 - Date.now()) / 1000)));
    if (uid) cache.put(key, uid, ttl);
    return uid;
  } catch (e) {
    Logger.log('verifyLineIdToken failed: ' + e.message);
    return '';
  }
}

// ─── v1.23: จำกัดการเดาวันเกิด ────────────────────────
const LOGIN_MAX_FAIL = 5;      // ผิดได้ 5 ครั้ง
const LOGIN_LOCK_SEC = 900;    // แล้วล็อกเบอร์นั้น 15 นาที (นับจากครั้งที่ผิดล่าสุด)
function loginKey_(phone) { return 'lf_' + padZero(phone, 10); }
function loginLocked_(phone) {
  return Number(CacheService.getScriptCache().get(loginKey_(phone)) || 0) >= LOGIN_MAX_FAIL;
}
function loginFail_(phone) {
  const c = CacheService.getScriptCache(), k = loginKey_(phone);
  const n = Number(c.get(k) || 0) + 1;
  c.put(k, String(n), LOGIN_LOCK_SEC);
  return n;
}
function loginOk_(phone) { CacheService.getScriptCache().remove(loginKey_(phone)); }

// v1.22: helpers
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
// ปิดชื่อบางส่วน: ภักรวรรณ งั่วสมบูรณ์ → ภั***ณ งั***
function maskName_(first, last) {
  const m = function (s, keepEnd) {
    s = String(s || '').trim();
    if (!s) return '';
    const chars = Array.from(s);
    if (chars.length <= 2) return chars[0] + '*';
    return chars.slice(0, 2).join('') + '***' + (keepEnd ? chars[chars.length - 1] : '');
  };
  return (m(first, true) + ' ' + m(last, false)).trim();
}

// ─── GET ──────────────────────────────────────────────
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};

    // v1.22: เช็คเบอร์ — ตอบแค่ "มี/ไม่มี" + ชื่อปิดบางส่วน ห้ามส่งวันเกิด/ที่อยู่
    //        (เดิมส่งทุกอย่าง → ใครรู้เบอร์ก็ได้วันเกิด ซึ่งเป็นรหัสผ่านล็อกอิน)
    if (p.phone && p.checkPoint) {
      const r = lookupPointByPhone(p.phone);
      const memberSheet = getSheet();
      const target = padZero(p.phone, 10);
      const registered = findRowBy(memberSheet, row => padZero(row[4], 10) === target) > 0;
      if (registered) return json_({ status: 'registered' });
      if (r.firstName || r.lastName) {
        return json_({ status: 'found', masked: maskName_(r.firstName, r.lastName), canPrefill: !!r.dateOfBirth });
      }
      return json_({ status: 'not_found' });
    }

    // v1.22: ข้อมูลเต็มสำหรับ pre-fill → ต้องยืนยันวันเกิดให้ตรงกับ Member Point ก่อน
    if (p.phone && p.dob && p.prefill) {
      if (loginLocked_(p.phone)) return json_({ status: 'locked', retryMin: LOGIN_LOCK_SEC / 60 });
      const r = lookupPointByPhone(p.phone);
      if ((r.firstName || r.lastName) && r.dateOfBirth && r.dateOfBirth === String(p.dob).trim()) {
        loginOk_(p.phone);
        return json_({ status: 'found', data: r });
      }
      loginFail_(p.phone);
      return json_({ status: 'mismatch' });
    }

    if (!p.idToken && !p.userId && !p.phone) {
      return json_({ status: 'ok', msg: 'GAS v1.24 running' });
    }

    const sheet = getSheet();
    let row = -1;

    // v1.23: เข้าผ่าน LINE — เชื่อเฉพาะ User ID ที่ LINE ยืนยันจาก ID token
    //        (เดิมเชื่อ ?userId= ที่ส่งมาตรงๆ → ใครรู้ User ID คนอื่นก็ดึงข้อมูลได้)
    if (p.idToken) {
      const uid = verifyLineIdToken_(p.idToken);
      if (!uid) return json_({ status: 'invalid_token' });
      row = findRowBy(sheet, r => String(r[0]).trim() === uid);
      if (row < 0 && !p.phone) return json_({ status: 'not_found' });
    }

    // เข้าด้วยเบอร์ + วันเกิด — จำกัดผิดได้ 5 ครั้ง / 15 นาที ต่อเบอร์
    if (row < 0 && p.phone && p.dob) {
      if (loginLocked_(p.phone)) return json_({ status: 'locked', retryMin: LOGIN_LOCK_SEC / 60 });
      const targetPhone = padZero(p.phone, 10);
      row = findRowBy(sheet, r => {
        const rowPhone = padZero(r[4], 10);
        const rowDob   = dateToISO(r[5]);
        return rowPhone === targetPhone && rowDob === String(p.dob).trim();
      });
      if (row < 0) {
        const n = loginFail_(p.phone);
        return json_({ status: 'not_found', attemptsLeft: Math.max(0, LOGIN_MAX_FAIL - n) });
      }
      loginOk_(p.phone);
    }
    if (row < 0) return json_({ status: 'not_found' });
    const values = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
    return ContentService.createTextOutput(JSON.stringify({status:'found', data: rowToObject(values)})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status:'error', message: err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── POST ─────────────────────────────────────────────
// v1.22: ล็อกทั้งช่วง "ค้นหา → เขียน" กัน 2 คำขอพร้อมกันต่อท้ายซ้ำเป็น 2 แถว
function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    return json_({ status: 'error', message: 'ระบบกำลังบันทึกรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง' });
  }
  try {
    return doPost_(e);
  } finally {
    lock.releaseLock();
  }
}

function doPost_(e) {
  try {
    const data  = JSON.parse(e.postData.contents);
    const sheet = getSheet();
    const pad   = n => String(n).padStart(2,'0');
    const d     = new Date(data.registeredAt);
    const thDate = pad(d.getDate())+'/'+pad(d.getMonth()+1)+'/'+(d.getFullYear()+543)+' '+pad(d.getHours())+':'+pad(d.getMinutes());
    const n     = new Date();
    const nowTh = pad(n.getDate())+'/'+pad(n.getMonth()+1)+'/'+(n.getFullYear()+543)+' '+pad(n.getHours())+':'+pad(n.getMinutes());

    // v1.23: ใช้ LINE User ID เฉพาะที่ LINE ยืนยันแล้ว — ห้ามเชื่อ data.lineUserId ตรงๆ
    //        (เดิมส่ง lineUserId ของคนอื่นมา = เขียนทับแถวของเขาได้เลย)
    const verifiedUid = verifyLineIdToken_(data.idToken);
    // ค้นด้วย LINE เฉพาะตอนแอปตั้งใจจัดการ "สมาชิกหลักของ LINE นี้" เท่านั้น
    // (โหมดดูสมาชิกอื่นส่ง lineUserId ว่าง → ต้องไม่ไปเจอแถวสมาชิกหลักแล้วเขียนทับ)
    const actsOnLineRow = !!verifiedUid && String(data.lineUserId || '') === verifiedUid;

    const byPhoneDob = (ph, dob) => findRowBy(sheet, r =>
      padZero(r[4], 10) === padZero(ph, 10) && dateToISO(r[5]) === String(dob).trim());
    const byPhone = ph => findRowBy(sheet, r => padZero(r[4], 10) === padZero(ph, 10));
    const conflict_ = msg => json_({ status: 'conflict', message: msg });

    let row = -1;
    let bindLine = false;

    if (data.mode === 'link_line') {
      // v1.24: ผูก LINE กับสมาชิกที่เพิ่งล็อกอินด้วยเบอร์+วันเกิด
      //   ต้องหาแถว "จากเบอร์+วันเกิด" เท่านั้น — เดิมหาจาก LINE ก่อน
      //   → เจอแถวสมาชิกหลักของ LINE นี้ แล้วเขียนข้อมูลอีกคนทับ (ข้อมูลหาย)
      if (!actsOnLineRow) return json_({ status: 'error', message: 'ยืนยันตัวตน LINE ไม่สำเร็จ' });
      row = byPhoneDob(data.phone, data.dateOfBirth);
      if (row < 0) return json_({ status: 'not_found' });
      const uidRow = findRowBy(sheet, r => String(r[0]).trim() === verifiedUid);
      if (uidRow > 0 && uidRow !== row) return conflict_('บัญชี LINE นี้ผูกกับสมาชิกคนอื่นอยู่แล้ว');
      const curUid = String(sheet.getRange(row, 1).getValue() || '').trim();
      if (curUid && curUid !== verifiedUid) return conflict_('สมาชิกนี้ผูกกับบัญชี LINE อื่นอยู่แล้ว');
      bindLine = true;
    } else {
      if (actsOnLineRow) row = findRowBy(sheet, r => String(r[0]).trim() === verifiedUid);
      // v1.24: แก้ไขข้อมูล → หาแถวจากเบอร์+วันเกิด "ค่าเดิม" ก่อน
      //        (เดิมหาจากค่าใหม่ → แก้เบอร์/วันเกิดแล้วหาไม่เจอ → สร้างสมาชิกซ้ำ)
      if (row < 0 && data.origPhone && data.origDob) row = byPhoneDob(data.origPhone, data.origDob);
      if (row < 0 && data.phone && data.dateOfBirth) row = byPhoneDob(data.phone, data.dateOfBirth);
      bindLine = actsOnLineRow;
    }
    const isNew = row < 0;

    // v1.24: เบอร์ = รหัสสมาชิก ห้ามซ้ำ
    //   บล็อกเฉพาะ "สมัครใหม่" หรือ "เปลี่ยนเบอร์" — แก้ข้อมูลอื่นโดยไม่เปลี่ยนเบอร์ผ่านเสมอ
    //   (กันคนที่มีแถวเบอร์ซ้ำค้างจากก่อน v1.24 แก้ข้อมูลตัวเองไม่ได้)
    if (data.phone) {
      if (isNew) {
        if (byPhone(data.phone) > 0) return conflict_('เบอร์นี้เป็นสมาชิกอยู่แล้ว กรุณาเข้าสู่ระบบ');
      } else {
        const curPhone = padZero(sheet.getRange(row, 5).getValue(), 10);
        if (curPhone !== padZero(data.phone, 10) && byPhone(data.phone) > 0) {
          return conflict_('เบอร์นี้ถูกใช้กับสมาชิกคนอื่นแล้ว');
        }
      }
    }

    // คอลัมน์ A/B/M: ผูก LINE ได้เฉพาะเมื่อยืนยันแล้ว และตรงกับที่แอปขอผูกจริง
    //   ไม่ยืนยัน → แถวเดิมคงค่าเดิม (รวมรูปโปรไฟล์ — กันรูปไลน์คนดูไปทับของเจ้าของ) · แถวใหม่ = ว่าง
    let lineUidToWrite = '';
    let lineNameToWrite = '';
    let pictureToWrite = '';
    if (bindLine) {
      lineUidToWrite  = verifiedUid;
      lineNameToWrite = data.lineName || '';
      pictureToWrite  = data.pictureUrl || '';
    } else if (row > 0) {
      lineUidToWrite  = String(sheet.getRange(row, 1).getValue() || '');
      lineNameToWrite = String(sheet.getRange(row, 2).getValue() || '');
      pictureToWrite  = String(sheet.getRange(row, 13).getValue() || '');
    }

    const rowValues = [
      lineUidToWrite, lineNameToWrite,
      data.firstName, data.lastName,
      "'" + String(data.phone || ''),
      "'" + String(data.dateOfBirth || ''),
      "'" + String(data.address || ''),
      "'" + String(data.subDistrict || ''),
      "'" + String(data.district || ''),
      "'" + String(data.province || ''),
      "'" + String(data.postcode || ''),
      data.source,
      pictureToWrite,
      data.registeredAt, thDate, nowTh,
      "'" + String(data.nationalId || ''),
      data.consent === true ? 'TRUE' : (data.consent === false ? 'FALSE' : ''),
      String(data.consentVersion || ''),
      toThaiDateTime_(data.consentDate)   // v1.19: วันยินยอม = รูปแบบไทยเหมือน "วันสมัคร (ไทย)"
    ];

    if (row > 0) {
      const origRegISO = sheet.getRange(row, 14).getValue();
      const origRegTh  = sheet.getRange(row, 15).getValue();
      if (origRegISO) rowValues[13] = origRegISO;
      if (origRegTh)  rowValues[14] = origRegTh;
      sheet.getRange(row, 1, 1, HEADERS.length).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
      row = sheet.getLastRow();
    }
    [5,6,7,8,9,10,11,17,20].forEach(function(c){
      sheet.getRange(row, c).setNumberFormat('@STRING@');
    });

    // v1.20: consent-update (กดยอมรับย้อนหลัง) ไม่ต้องแจ้ง Discord
    if (data.mode !== 'consent-update') notifyDiscord(data, isNew);

    return ContentService.createTextOutput(JSON.stringify({status:'ok'})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status:'error', message: err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}

// ════════════════════════════════════════════════════════
//  Admin Tools
// ════════════════════════════════════════════════════════

function checkMismatch() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const members = ss.getSheetByName(SHEET_NAME);
  const points  = ss.getSheetByName(POINT_SHEET);
  if (!members || !points) { SpreadsheetApp.getUi().alert('ไม่พบ sheet Members หรือ Member Point'); return; }
  const pLast = points.getLastRow();
  if (pLast < 2) { SpreadsheetApp.getUi().alert('ไม่มีข้อมูลใน Member Point'); return; }
  const pData = points.getRange(2, 1, pLast - 1, 18).getValues();
  const pointMap = {};
  pData.forEach(r => {
    const phone = padZero(r[0], 10);
    if (!phone) return;
    pointMap[phone] = {
      firstName: String(r[3]||'').trim(), lastName: String(r[4]||'').trim(),
      dateOfBirth: dateToISO(r[8]),
      subDistrict: String(r[13]||'').trim(), district: String(r[14]||'').trim(),
      province: String(r[15]||'').trim(), postcode: padZero(r[17], 5),
    };
  });

  const mLast = members.getLastRow();
  if (mLast < 2) { SpreadsheetApp.getUi().alert('ไม่มีข้อมูลใน Members'); return; }
  const mData = members.getRange(2, 1, mLast - 1, HEADERS.length).getValues();

  const mismatches = [], notFoundInPoint = [];
  mData.forEach(r => {
    const phone = padZero(r[4], 10);
    const fullName = (String(r[2]) + ' ' + String(r[3])).trim();
    if (!phone) return;
    const p = pointMap[phone];
    if (!p) { notFoundInPoint.push([phone, fullName, 'ไม่พบใน Member Point', '', '']); return; }
    const checks = [
      ['ชื่อ',        String(r[2]||'').trim(), p.firstName],
      ['นามสกุล',      String(r[3]||'').trim(), p.lastName],
      ['วันเกิด',      dateToISO(r[5]),         p.dateOfBirth],
      ['ตำบล/แขวง',    String(r[7]||'').trim(), p.subDistrict],
      ['อำเภอ/เขต',    String(r[8]||'').trim(), p.district],
      ['จังหวัด',       String(r[9]||'').trim(), p.province],
      ['รหัสไปรษณีย์',  padZero(r[10], 5),       p.postcode],
    ];
    checks.forEach(c => {
      const field = c[0], mVal = c[1], pVal = c[2];
      if (mVal !== pVal && (mVal || pVal)) mismatches.push([phone, fullName, field, mVal, pVal]);
    });
  });

  const reportName = 'Mismatch Report';
  let report = ss.getSheetByName(reportName);
  if (report) report.clear(); else report = ss.insertSheet(reportName);
  report.appendRow(['เบอร์โทร','ชื่อ-นามสกุล','ฟิลด์ที่ไม่ตรง','ค่าใน Members','ค่าใน Member Point']);
  report.getRange(1,1,1,5).setFontWeight('bold').setBackground('#0d1b3e').setFontColor('#ffffff');

  const allRows = mismatches.concat(notFoundInPoint);
  if (allRows.length > 0) {
    report.getRange(2, 1, allRows.length, 5).setValues(allRows);
    mismatches.forEach((_, i) => report.getRange(i+2, 3).setBackground('#fef3c7').setFontColor('#92400e'));
    notFoundInPoint.forEach((_, i) => report.getRange(mismatches.length+i+2, 3).setBackground('#fee2e2').setFontColor('#991b1b'));
  }
  report.autoResizeColumns(1, 5);

  SpreadsheetApp.getUi().alert('ตรวจสอบเรียบร้อย',
    '✓ ตรวจสอบทั้งหมด: ' + mData.length + ' ราย\n' +
    '⚠ ข้อมูลไม่ตรง: ' + mismatches.length + ' รายการ\n' +
    '❌ ไม่พบใน Member Point: ' + notFoundInPoint.length + ' ราย\n\n' +
    'ดูผลที่ sheet "' + reportName + '"',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

// v1.19: ซ่อมหัวคอลัมน์ด้วยมือ (เผื่อหัวหาย/คอลัมน์ไม่ครบ 20)
function repairHeaders() {
  const sheet = getSheet();
  SpreadsheetApp.getUi().alert('ซ่อมหัวคอลัมน์เรียบร้อย',
    'ชีท "' + SHEET_NAME + '" มีคอลัมน์ ' + sheet.getMaxColumns() + ' คอลัมน์\n' +
    'หัวคอลัมน์ครบ ' + HEADERS.length + ' ช่อง (A–T)\n\n' +
    'R = ยินยอมเงื่อนไข\nS = Consent Version\nT = วันยินยอม',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🛠 Rattana Admin')
    .addItem('🔍 ตรวจสอบข้อมูล Members vs Member Point', 'checkMismatch')
    .addItem('🩹 ซ่อมหัวคอลัมน์ (A–T)', 'repairHeaders')
    .addToUi();
}
