# Rattana Stock Count — Development Summary

สรุปการพัฒนาแอป **Rattana Stock Count** ตั้งแต่เริ่มต้นจนถึงเวอร์ชันปัจจุบัน (v2.53)

---

## 📌 ภาพรวมแอป

**Rattana Stock Count** — เว็บแอปสำหรับเช็คและนับสต็อกสินค้าของบริษัทรัตนะ เปิดผ่านเบราว์เซอร์ได้ทั้งมือถือและคอม

🔗 **ลิงก์แอป:** https://rattana2555.github.io/rattana-app/rattana-stock-checker.html

📂 **GitHub Repo:** https://github.com/rattana2555/rattana-app

---

## 🎯 ฟีเจอร์หลัก

### 1. 📦 นับสต็อก (Count Mode)
- **สแกนบาร์โค้ด** ผ่านกล้อง (รองรับ EAN/UPC/CODE128/CODE39/ITF) ด้วย ZXing-browser
- **พิมพ์บาร์โค้ด** ในช่อง input ได้
- เลือก **คลังที่นับ** (W1, W2, W3, W4, C4-รัตนมาร์ท) จาก dropdown
- **สแกนหน่วยไหน นับตามหน่วยนั้น** (EA / PA / BP / CS)
- การ์ดใส่จำนวน:
  - แสดงรูปสินค้า (จากคอลัมน์ SKU_USAGE - Google Drive)
  - ปุ่ม +/- พร้อมช่องตัวเลข
  - คีย์บอร์ดเปิดเองอัตโนมัติ
  - แสดง badge IB date + จำนวนวันตั้งแต่รับเข้า
  - บังคับใส่วันหมดอายุถ้าสินค้าเกิน 90 วัน
- **สะสมยอด** ต่อสินค้าได้ — สแกนซ้ำหรือหลายหน่วยรวมกัน
- **กล้องปิดเองอัตโนมัติ**หลังสแกนเจอ
- **🔦 ปุ่มไฟแฟลช** เปิด/ปิดไฟกล้องช่วยตอนสแกนยาก
- กล้อง resolution 1080p + continuous focus + TRY_HARDER hint

### 2. 📊 สรุปผล (Summary Tab)
- รวมรายการที่นับทั้งหมดในคลังนั้น
- แปลงทุกหน่วยเป็น **ชิ้น (EA)** แล้วเทียบกับสต็อกระบบ
- แสดง:
  - 🟢 **ตรง** (counted = system)
  - 🔴 **ขาด** (counted < system)
  - 🟡 **เกิน** (counted > system)
- ส่วนต่างเป็นทั้ง **จำนวนชิ้น** และ **CS.EA**
- สรุปจำนวนรายการตามสถานะ + ยอดรวม
- ปุ่ม **"✓ ตรวจสอบแล้ว — บันทึกลง Google Sheet"** บันทึกทั้งหมดในคลิกเดียว

### 3. 📜 ประวัติ (History Tab)
- รวมการเช็คสต็อกที่บันทึกแล้ว — **group ตามวัน + คน + คลัง**
- คลิกเข้าไปดูรายละเอียดแต่ละรายการ:
  - **คอลัมน์เวลา** สำหรับแต่ละแถว (HH.MM)
  - ส่วนต่างแสดงทั้งชิ้นและ CS.EA breakdown
  - วันหมดอายุ (ถ้ามี)
  - สถานะสีสันชัดเจน
- กรองตาม Role:
  - Role ≥ 4 → เห็นทุกคน ทุกคลัง
  - Role < 4 → เห็นเฉพาะของตัวเอง ในคลังตัวเอง

---

## 🔐 ระบบ Login + Role

- **Google OAuth** สำหรับ login
- ตรวจสิทธิ์จาก **Users Sheet** (ต้อง Status = Active)
- จำ session 30 วัน
- **กรองคลังตาม Role:**

| Role | ระดับ | สิทธิ์ |
|------|------|--------|
| 1-3 | Viewer / Staff / Sr Staff | เห็นเฉพาะคลังตัวเอง (คอลัมน์ W ในชีท) |
| **4-8** | **Supervisor+** | **เห็นทุกคลัง** |

---

## 🗂 โครงสร้างข้อมูล

### ชีทข้อมูลสต็อก
- **ID:** `16mYDqAqqJma-_0vCIAajy6bcjdOZ7F6VagxkdkqAB2I`
- ดึงเฉพาะ **15 คอลัมน์ที่ใช้** ผ่าน `gviz select` (เร็วขึ้น ~85%)
- คอลัมน์ที่ดึง:
  - `PRODUCT NAME, SHORT NAME`
  - `CODE EA/PA/BP/CS` (บาร์โค้ด)
  - `RATTANA UNIT EA/PA/BP/CS` (ชื่อหน่วย)
  - `UNIT EA/PA/BP/CS` (เช่น "ลังx12(CS)")
  - `QTY EA/PA/BP/CS` (ตัวคูณ)
  - `CAT GROUP/BRAND/SIZE`
  - `STOCK W1/W2/W3/W4/C4` (สต็อกระบบ รูปแบบ CS.EA)
  - `IB W1/W2/W3/W4/C4` (วันที่รับเข้าล่าสุด)
  - `SKU_USAGE` (URL รูปสินค้าจาก Drive)

### ชีท Users
- **ID:** `1M6HdISsLN684qRWyQ73CA4AmUzmYtZaOlffDJXZZIXQ`
- แท็บ: `Rattana Users for apps`

### ชีทผลการนับ (Google Sheet ของผู้ใช้)
- แท็บ **StockCount** (16 คอลัมน์):
  - Saved At, Session Start, Warehouse
  - Emp ID, Counter Name
  - Product Key, Product Name
  - Counted CS/BP/PA/EA, Counted Pieces
  - System Stock, System Pieces, Diff Pieces
  - Status (ตรง/ขาด/เกิน)
  - **Expiry Date**
- แท็บ **Drafts** (cross-device sync):
  - UserKey, Email, EmpId, Warehouse
  - SessionStart, UpdatedAt
  - Payload (JSON ของรายการที่นับค้างไว้)

---

## 🔄 Cross-Device Draft Sync

**ปัญหา:** นับบนเครื่อง A อยู่ แล้วอยากดูต่อบนเครื่อง B
**วิธีแก้:**
- ทุกครั้งที่นับ → POST `saveDraft` ไป Apps Script (debounce 400ms)
- เปิดเครื่อง B → fetch draft → adopt อัตโนมัติ
- **Last-write-wins** by `updatedAt`
- หลังกดบันทึกลง Sheet → clear ทั้ง local + remote draft
- **30s guard** กันการ adopt remote draft ของตัวเองหลัง save
- **Polling 5s** ในแท็บนับ — เครื่องอื่น save จะอัปเดตอัตโนมัติ
- **ปุ่ม ↻** บังคับ pull draft (ข้าม guard)

---

## ⚡ ประสิทธิภาพ

- **ดึงเฉพาะคอลัมน์ที่ใช้** (15 จาก 120+) → payload เล็กลง 85%
- **Cache TTL** 1 นาที + show cache ทันที + revalidate ข้างหลัง
- **Preconnect** ไป Google Drive/Docs/lh3 ตั้งแต่โหลดหน้า
- **รูปสินค้า** ขอขนาดที่ใช้จริง (w64/w128) ไม่ใช่ full size
- **Auto sync** เมื่อ focus/online/visibilitychange — ข้อมูลสดเสมอ

---

## 🎨 ดีไซน์

- **โทนสี:** Deep Navy (#0d1b3e) + Navy Accent
- **ฟอนต์:** Prompt (Google Fonts)
- **Mobile-first:** การ์ดกระชับ ปุ่มใหญ่พอแตะ
- **Dark mode** toggle
- **PWA-ready:** เพิ่มลงหน้าจอโฮมได้

---

## 📜 ประวัติเวอร์ชัน (Highlights)

| Version | Feature |
|---------|---------|
| v1.0 | สแกนบาร์โค้ด → แสดงสต็อก CS.EA |
| v1.1 | Login Google + กรองคลังตาม Role |
| v2.0 | โหมดนับสต็อก + Summary + บันทึกลง Sheet |
| v2.2 | แก้บั๊กกล้อง iOS + แจ้งเตือนใน LINE in-app browser |
| v2.4 | เปลี่ยน scanner เป็น ZXing-browser (อ่านบาร์โค้ดดีขึ้นมาก) |
| v2.6 | ลบแท็บ "เช็คสต็อก" เหลือ "นับ + สรุปผล" |
| v2.8 | รูปสินค้าจริงจาก Google Drive |
| v2.14 | ปรับ performance — โหลดเร็วขึ้น 5-7 เท่า |
| v2.17 | สแกนแล้วเด้ง popup ใส่จำนวน (default = 1) |
| v2.19 | เพิ่มคลัง C4 (รัตนมาร์ท) |
| v2.21 | บันทึกลง Google Sheet ทำงาน |
| v2.24 | เพิ่มแท็บประวัติ |
| v2.26 | Cross-device draft sync |
| v2.33 | Parse IB date + flag สินค้าเก่ากว่า 90 วัน |
| v2.34 | เพิ่มช่องวันหมดอายุ + เก็บลงชีท |
| v2.36 | Group history ตามวัน |
| v2.40 | แก้บั๊ก history detail เปิดไม่ได้ |
| v2.45 | ทำหน้าจอกระชับขึ้นบนมือถือ |
| v2.47 | ปุ่ม ↻ บังคับ pull draft |
| v2.50 | กล้อง 1080p + TRY_HARDER + ปุ่มไฟแฟลช |
| v2.51 | คีย์บอร์ดเปิดเองทันทีบน iOS |
| **v2.53** | **เวอร์ชันปัจจุบัน** |

---

## 🛠 Apps Script (Google Sheet Backend)

### Endpoints
- `POST` — บันทึกผลการนับลง StockCount sheet
- `POST action=saveDraft` — อัปเดต draft row ใน Drafts sheet
- `POST action=clearDraft` — ลบ draft row
- `GET ?action=history` — return ผลการนับทั้งหมด
- `GET ?action=draft&userKey=&warehouse=` — return draft ของ user

### Versions
- v1.0 — บันทึกผลการนับ
- v1.1 — Product Key เป็น plain text
- v1.2 — History endpoint
- v1.3 — Draft sync (Drafts tab)
- **v1.4** — เพิ่มคอลัมน์ Expiry Date

---

## 📂 ไฟล์ในโปรเจกต์

```
rattana-app/
├── rattana-stock-checker.html       # แอปหลัก (single file)
├── apps-script-stockcount-v1.0.gs   # Apps Script สำหรับ Google Sheet
├── design-preview.html              # หน้าทดสอบดีไซน์ (9 styles)
└── RATTANA_STOCK_DEV_SUMMARY.md     # ไฟล์นี้
```

---

## 🚀 วิธี deploy & ใช้งาน

### Setup ครั้งแรก
1. สร้าง Google Sheet สำหรับเก็บผลการนับ
2. เปิด **Extensions → Apps Script** ใน Sheet
3. วางโค้ดจาก `apps-script-stockcount-v1.0.gs`
4. เปลี่ยน `SHEET_ID` ให้ตรงกับ Sheet ID ของตน
5. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. ก๊อป Web App URL ไปวางใน `COUNT_SAVE_URL` ในไฟล์ HTML
7. (สำหรับ Google OAuth) สร้าง OAuth Client ID ใน Google Cloud Console
   - Authorized JavaScript origin: `https://rattana2555.github.io`
   - ใส่ Client ID ใน `data-client_id` ของ `g_id_onload`
8. Push ขึ้น GitHub Pages

### การใช้งานประจำวัน
1. เปิดลิงก์แอป → Login Google
2. เลือกคลังที่จะนับ
3. กดเปิดกล้อง → สแกนบาร์โค้ดสินค้า
4. ใส่จำนวน (default = 1) → กดบันทึก
5. ทำซ้ำจนนับครบ
6. ไปแท็บ **📊 สรุปผล** ตรวจสอบ
7. กด **"✓ ตรวจสอบแล้ว — บันทึกลง Google Sheet"**
8. ดูประวัติย้อนหลังได้ที่แท็บ **📜 ประวัติ**

---

## 💡 เทคนิคการสแกน

| ปัญหา | วิธีแก้ |
|------|---------|
| บาร์ยับ/ขรุขระ | ดึงให้ตึงด้วยนิ้วก่อนสแกน |
| บาร์สะท้อนแสง | เอียงกล้องเล็กน้อย ~15-20° |
| บาร์เล็กมาก | ขยับเข้าใกล้ 5-8 ซม. |
| บาร์ในเงา/มืด | เปิดไฟ 🔦 |
| ไม่อยากใช้กล้อง | เสียบเครื่องสแกน USB หรือพิมพ์เอา |

---

## ⚠️ ข้อจำกัด

- ใน **LINE in-app browser** กล้องจะไม่ทำงาน (iOS block) → ต้องเปิดผ่าน Safari/Chrome
- รูปสินค้าใน Google Drive ต้องตั้งสิทธิ์ "Anyone with the link"
- `mode:'no-cors'` ของ Apps Script POST → แอปอ่าน response ไม่ได้ (เลยใช้ optimistic update)
- IB date threshold (90 วัน) hard-coded ใน `EXPIRY_DAYS` constant

---

*สรุปเมื่อ v2.53 — เอกสารนี้สร้างโดย Claude*
