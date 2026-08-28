// ════════════════════════════════════════════════════════
//  Rattana Member System — GAS v1.18
// ════════════════════════════════════════════════════════

const SHEET_ID        = '1gbBrJtE36fX8TM7KC0RbXgPZI6AyNpbC3XhJ6uiLsOE';
const SHEET_NAME      = 'Members';
const POINT_SHEET     = 'Member Point';
const DISCORD_WEBHOOK = 'https://discordapp.com/api/webhooks/1514920273910956034/QQxs7EoSmxHVGZiu284OELLcXns93acZc1-YTLpzSfP-Nhn86l-kRQY-iq-EGAvcEBs2';

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

function getSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1,1,1,HEADERS.length).setFontWeight('bold').setBackground('#0d1b3e').setFontColor('#ffffff');
  } else if (!sheet.getLastRow() || sheet.getRange(1,1).getValue()==='') {
    sheet.appendRow(HEADERS);
    sheet.getRange(1,1,1,HEADERS.length).setFontWeight('bold').setBackground('#0d1b3e').setFontColor('#ffffff');
  }
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
  if (!DISCORD_WEBHOOK) return;
  try {
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
  const res = UrlFetchApp.fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify({ content: '🧪 Test — Rattana Member webhook ใช้งานได้!' }),
    muteHttpExceptions: true,
  });
  Logger.log('Status: ' + res.getResponseCode());
  Logger.log('Body: ' + res.getContentText());
}

// ─── GET ──────────────────────────────────────────────
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};

    if (p.phone && p.checkPoint) {
      const r = lookupPointByPhone(p.phone);
      const memberSheet = getSheet();
      const target = padZero(p.phone, 10);
      const registered = findRowBy(memberSheet, row => padZero(row[4], 10) === target) > 0;
      if (registered) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'registered',
          data: r.firstName ? r : null
        })).setMimeType(ContentService.MimeType.JSON);
      }
      if (r.firstName || r.lastName) {
        return ContentService.createTextOutput(JSON.stringify({status:'found', data: r})).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({status:'not_found'})).setMimeType(ContentService.MimeType.JSON);
    }

    if (!p.userId && !p.phone) {
      return ContentService.createTextOutput(JSON.stringify({status:'ok', msg:'GAS v1.18 running'})).setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = getSheet();
    let row = -1;
    if (p.userId) {
      row = findRowBy(sheet, r => String(r[0]).trim() === String(p.userId).trim());
    }
    if (row < 0 && p.phone && p.dob) {
      const targetPhone = padZero(p.phone, 10);
      row = findRowBy(sheet, r => {
        const rowPhone = padZero(r[4], 10);
        const rowDob   = dateToISO(r[5]);
        return rowPhone === targetPhone && rowDob === String(p.dob).trim();
      });
    }
    if (row < 0) {
      return ContentService.createTextOutput(JSON.stringify({status:'not_found'})).setMimeType(ContentService.MimeType.JSON);
    }
    const values = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
    return ContentService.createTextOutput(JSON.stringify({status:'found', data: rowToObject(values)})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status:'error', message: err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── POST ─────────────────────────────────────────────
function doPost(e) {
  try {
    const data  = JSON.parse(e.postData.contents);
    const sheet = getSheet();
    const pad   = n => String(n).padStart(2,'0');
    const d     = new Date(data.registeredAt);
    const thDate = pad(d.getDate())+'/'+pad(d.getMonth()+1)+'/'+(d.getFullYear()+543)+' '+pad(d.getHours())+':'+pad(d.getMinutes());
    const n     = new Date();
    const nowTh = pad(n.getDate())+'/'+pad(n.getMonth()+1)+'/'+(n.getFullYear()+543)+' '+pad(n.getHours())+':'+pad(n.getMinutes());

    let row = -1;
    if (data.lineUserId) {
      row = findRowBy(sheet, r => String(r[0]).trim() === String(data.lineUserId).trim());
    }
    if (row < 0 && data.phone && data.dateOfBirth) {
      row = findRowBy(sheet, r => {
        const rowPhone = padZero(r[4], 10);
        const rowDob   = dateToISO(r[5]);
        return rowPhone === padZero(data.phone, 10) && rowDob === String(data.dateOfBirth).trim();
      });
    }
    const isNew = row < 0;

    const rowValues = [
      data.lineUserId || '', data.lineName || '',
      data.firstName, data.lastName,
      "'" + String(data.phone || ''),
      "'" + String(data.dateOfBirth || ''),
      "'" + String(data.address || ''),
      "'" + String(data.subDistrict || ''),
      "'" + String(data.district || ''),
      "'" + String(data.province || ''),
      "'" + String(data.postcode || ''),
      data.source,
      data.pictureUrl || '',
      data.registeredAt, thDate, nowTh,
      "'" + String(data.nationalId || ''),
      data.consent === true ? 'TRUE' : (data.consent === false ? 'FALSE' : ''),
      String(data.consentVersion || ''),
      data.consentDate || ''
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

    notifyDiscord(data, isNew);

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

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🛠 Rattana Admin')
    .addItem('🔍 ตรวจสอบข้อมูล Members vs Member Point', 'checkMismatch')
    .addToUi();
}
