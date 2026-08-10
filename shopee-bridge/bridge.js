// ============================================================
//  bridge.js — ทำงานในบริบทของส่วนขยาย (world: ISOLATED)
//
//  รับข้อมูลที่ hook.js ดักมา → แปลงเป็นรูปแบบของ Chat Hub → ส่งขึ้น Supabase
//
//  โครงสร้างจริงของ Shopee (สำรวจแล้วเมื่อ 2026-08-06):
//    GET /webchat/api/v1.2/mini/conversations/{convId}/messages
//    → คืน array ของข้อความ แต่ละอันมี:
//        id, from_id, to_id, from_user_name, to_user_name, type, content
//    type ที่พบ: text | image | notification | order | sticker
//
//  ทิศทางข้อความ: เทียบ from_id กับ user id ของร้าน
//  (ได้มาจาก URL /mini/users/{id}/... ที่หน้าเว็บเรียกตอนเปิดแชท)
// ============================================================
const ENDPOINT = "https://tsudgtzcskoopbymklfg.supabase.co/functions/v1/ingest-shopee";
const TAG = "[RCH]";

let cfg = { secret: "", discovery: true, enabled: true, shopUser: "" };
const convMeta = new Map();                 // convId → {name}

chrome.storage.local.get(["secret", "discovery", "enabled", "shopUser"], (v) => {
  cfg = { ...cfg, ...v };
  console.log(TAG, "โหมด:", cfg.discovery ? "สำรวจ (ยังไม่ส่ง)" : "ส่งจริง",
              "| เปิดใช้งาน:", cfg.enabled, "| ชื่อร้าน:", cfg.shopUser || "⚠️ ยังไม่ได้ตั้ง");
});
chrome.storage.onChanged.addListener((ch) => {
  for (const k in ch) cfg[k] = ch[k].newValue;
});

// ── ตัวช่วย ───────────────────────────────────────────────
const RE_MESSAGES = /\/conversations\/(\d+)\/messages/;

// ข้อความจากร้านจะมี from_user_name เป็นชื่อร้าน
// พนักงานแต่ละคนใช้รูปแบบ "ชื่อร้าน:ชื่อพนักงาน" เช่น rattana_2555:main
//
// เทียบแบบผ่อนปรน: ตัด _ - . และช่องว่างออก แล้วเทียบตัวพิมพ์เล็ก
// เพราะคนกรอกมักพิมพ์ "rattana 2555" บ้าง "Rattana_2555" บ้าง
const norm = (s) => String(s || "").toLowerCase().replace(/[\s._-]/g, "");

function isShopUser(name) {
  const shop = norm(cfg.shopUser);
  const raw  = String(name || "").trim();
  if (!shop || !raw) return false;
  const base = norm(raw.split(":")[0]);   // ตัดส่วน :ชื่อพนักงาน ออกก่อน
  return base === shop;
}

function pickTime(m) {
  const v = m.created_timestamp ?? m.create_time ?? m.ctime ?? m.timestamp ?? m.created_at;
  if (v == null) return Date.now();
  const n = Number(v);
  if (!isNaN(n)) return n < 1e12 ? n * 1000 : n;   // วินาที → มิลลิวินาที
  const p = Date.parse(v);
  return isNaN(p) ? Date.now() : p;
}

// แปลง content ของ Shopee เป็น {text, imageUrl} ตามชนิดข้อความ
function pickContent(m) {
  const c = m.content ?? {};
  switch (m.type) {
    case "text":
      return { text: c.text ?? "" };
    case "image":
      return { imageUrl: c.url ?? c.image_url ?? c.thumb_url ?? c.file_url ?? "" };
    case "sticker":
      return { imageUrl: c.url ?? c.thumb_url ?? "", text: c.url ? "" : "[สติกเกอร์]" };
    case "order":
      return { text: `[คำสั่งซื้อ] ${c.order_sn ?? ""}`.trim() };
    case "item":
    case "product":
      return { text: `[สินค้า] ${c.name ?? c.title ?? ""}`.trim() };
    case "voucher":
      return { text: "[คูปองส่วนลด]" };
    case "notification":
      return {};                                   // ข้อความระบบ ไม่ต้องเก็บ
    default: {
      const t = typeof c.text === "string" ? c.text : "";
      return t ? { text: t } : { text: `[${m.type}]` };
    }
  }
}

// ── ตัวแปลงหลัก ───────────────────────────────────────────
function parseMessages(url, arr) {
  const mt = url.match(RE_MESSAGES);
  if (!mt || !Array.isArray(arr)) return null;
  const convId = mt[1];

  const messages = [];
  let customerName = "";

  for (const m of arr) {
    if (!m || !m.id) continue;

    const isSeller = isShopUser(m.from_user_name);

    // ชื่อลูกค้า = ฝั่งที่ไม่ใช่ร้าน (เช็คทั้งสองฝั่ง เผื่อบางข้อความมีแค่ฝั่งเดียว)
    if (!customerName) {
      const cand = isSeller ? m.to_user_name : m.from_user_name;
      if (cand && !isShopUser(cand)) customerName = String(cand);
    }

    const { text, imageUrl } = pickContent(m);
    if (!text && !imageUrl) continue;              // ข้ามข้อความระบบ

    messages.push({
      id: String(m.id),
      from: isSeller ? "seller" : "buyer",
      text: text ?? "",
      imageUrl: imageUrl ?? "",
      sentAt: pickTime(m),
    });
  }

  if (!messages.length) return null;

  // กันพลาด: ถ้าชื่อที่ได้ดันเป็นชื่อร้านเอง อย่าใช้
  if (customerName && isShopUser(customerName)) customerName = "";

  const meta = convMeta.get(convId) ?? {};
  if (customerName) { meta.name = customerName; convMeta.set(convId, meta); }

  return {
    convId,
    name: meta.name || customerName || "ลูกค้า Shopee",
    avatar: "",
    messages,
  };
}

// ── รายการแชท (ไม่ต้องคลิกเปิด) ───────────────────────────
// หน้าเว็บโหลดรายการนี้เองเป็นระยะ ทำให้รู้ว่ามีใครทักมาใหม่
// โดยไม่ต้องรอพนักงานคลิกเปิดทีละอัน
// เก็บได้แค่ "ข้อความล่าสุด" 1 บรรทัด — เนื้อหาเต็มมาตอนเปิดแชท
function parseConvList(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];

  for (const c of arr) {
    if (!c || typeof c !== "object") continue;
    const convId = c.conversation_id ?? c.conversationId ?? c.id;
    if (!convId) continue;

    const name = [c.to_name, c.to_user_name, c.username, c.nickname]
      .find((n) => n && !isShopUser(n));
    const preview = c.latest_message_content?.text
                 ?? c.last_message_content?.text
                 ?? (typeof c.latest_message_content === "string" ? c.latest_message_content : "")
                 ?? "";
    const ts = c.last_message_timestamp ?? c.latest_message_time ?? c.update_time ?? c.mtime;
    const msgId = c.latest_message_id ?? c.last_message_id;

    if (!preview || !msgId) continue;   // ไม่มีข้อความล่าสุดก็ข้าม

    const meta = convMeta.get(String(convId)) ?? {};
    if (name) { meta.name = String(name); convMeta.set(String(convId), meta); }

    out.push({
      convId: String(convId),
      name: meta.name || "ลูกค้า Shopee",
      avatar: c.to_avatar || c.avatar || "",
      messages: [{
        id: String(msgId),
        from: isShopUser(c.latest_message_sender_name ?? "") ? "seller" : "buyer",
        text: String(preview),
        imageUrl: "",
        sentAt: pickTime({ created_timestamp: ts }),
      }],
    });
  }
  return out;
}

// ── ส่งขึ้น Chat Hub (รวบยอด ไม่ยิงถี่) ────────────────────
let queue = [];
let timer = null;

function flush() {
  timer = null;
  if (!queue.length) return;
  if (!cfg.secret) { console.warn(TAG, "ยังไม่ได้ใส่รหัสลับ — ข้ามการส่ง"); queue = []; return; }
  const batch = queue; queue = [];

  const platform = /line\.biz/i.test(location.hostname) ? "line" : "shopee";
  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": cfg.secret },
    body: JSON.stringify({ platform, conversations: batch }),
  })
    .then((r) => r.json())
    .then((j) => console.log(TAG, "ส่งแล้ว:", j))
    .catch((e) => console.warn(TAG, "ส่งไม่สำเร็จ:", e.message));
}

// โหมดดูข้อมูลดิบ — จำกัดจำนวนไม่ให้ Console ท่วม
let rawSeen = 0;
const RAW_LIMIT = 25;
const url0 = (u) => { try { return new URL(u, location.origin).pathname; } catch (_) { return String(u); } };

// ── รับข้อมูลจาก hook.js ──────────────────────────────────
window.addEventListener("message", (ev) => {
  const d = ev.data;
  if (!d || d.__rch !== true || !cfg.enabled) return;

  // LINE: แสดงเฉพาะ endpoint ที่เกี่ยวกับแชทจริงๆ จะได้ไม่ต้องไล่หาใน Console
  if (/line\.biz/i.test(location.hostname)) {
    const path = url0(d.url);
    const isChat = /\/chats?(\/|\?|$)|\/messages?(\/|\?|$)/i.test(path);
    if (isChat && rawSeen < RAW_LIMIT) {
      rawSeen++;
      const body = String(d.body || "");
      console.log(`%c${TAG} ★ เจอแชท [${rawSeen}] ${path} — ${body.length} ตัวอักษร`,
                  "background:#c9a84c;color:#0d1b3e;font-weight:bold;padding:2px 6px");
      console.log(body.slice(0, 2000));
      // เก็บไว้ใน storage ด้วย เผื่อ Console เลื่อนหาย — ดูได้จากหน้าตั้งค่า
      try { chrome.storage.local.set({ lastChatSample: { path, body: body.slice(0, 4000) } }); } catch (_) {}
    }
    return;
  }

  let parsed;
  try { parsed = JSON.parse(d.body); } catch { return; }

  if (cfg.discovery) {
    let path = d.url;
    try { path = new URL(d.url, location.origin).pathname; } catch (_) {}
    console.log(`${TAG} [${d.kind}] ${path}`);
    console.log(JSON.stringify(parsed).slice(0, 4000));
    return;
  }

  if (!cfg.shopUser) {
    console.warn(TAG, "ยังไม่ได้ตั้ง 'ชื่อร้าน' ในหน้าตั้งค่า — แยกไม่ออกว่าใครส่ง จึงยังไม่ส่งข้อมูล");
    return;
  }

  const url = String(d.url);
  let batch = [];

  // ── LINE OA Manager ──────────────────────────────────────
  // ยังไม่รู้โครงสร้างจริง → พิมพ์ตัวอย่างให้ดูก่อน แล้วค่อยเขียนตัวแปลง
  if (/line\.biz/i.test(location.hostname)) {
    let path = url;
    try { path = new URL(url, location.origin).pathname; } catch (_) {}
    const txt = JSON.stringify(parsed);
    // เอาเฉพาะที่หน้าตาเหมือนข้อมูลแชทจริงๆ ไม่งั้นจะรกจนหาไม่เจอ
    if (!/message|chat|talk|text|content|sender|user/i.test(txt)) return;
    console.log(`${TAG} [LINE ${d.kind}] ${path}  (${txt.length} ตัวอักษร)`);
    console.log(txt.slice(0, 2500));
    return;
  }

  if (RE_MESSAGES.test(url)) {
    const conv = parseMessages(url, parsed);
    if (conv) batch = [conv];
  } else if (/\/conversations(\?|$)/.test(url.split("#")[0])) {
    // รายการแชท — หน้าเว็บโหลดเองเป็นระยะ
    const list = Array.isArray(parsed) ? parsed : (parsed.data ?? parsed.conversations ?? parsed.list);
    batch = parseConvList(list);
    if (!batch.length && list) {
      console.log(TAG, "รายการแชท: ยังแปลงไม่ได้ ส่งตัวอย่างนี้ให้ผู้พัฒนาดู →");
      console.log(JSON.stringify(list).slice(0, 1500));
    }
  }

  if (!batch.length) return;

  queue.push(...batch);
  if (!timer) timer = setTimeout(flush, 3000);
});
