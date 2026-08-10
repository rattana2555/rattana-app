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

// ── รู้ให้ได้ว่า "ฝั่งไหนคือร้าน" โดยไม่ต้องพึ่งชื่อที่พิมพ์ ──
// ชื่อที่กรอกในหน้าตั้งค่ามักไม่ตรงกับที่ Shopee ส่งมาเป๊ะ (ชื่อร้าน ≠ username,
// พนักงานบางคนใช้ชื่อย่อย) พอเทียบไม่ตรง ข้อความของร้านเลยไปโผล่ฝั่งลูกค้า
// จึงเรียนรู้จากข้อมูลเองแทน 2 ทาง:
//   1) รายการแชท — to_id ของแต่ละแชทคือ "ลูกค้า" เสมอ (รายการมองจากฝั่งร้าน)
//   2) id ที่โผล่ในหลายแชท = ร้าน (ลูกค้า 1 คนมีได้แชทเดียว)
let shopId = null;
const buyerOf = new Map();   // convId → id ลูกค้า
const idConvs = new Map();   // userId → Set(convId) ที่เคยเห็น id นี้

chrome.storage.local.get(["shopId"], (v) => { if (v.shopId) shopId = String(v.shopId); });

const idOf = (v) => (v === null || v === undefined || v === "" ? "" : String(v));

function noteId(convId, id) {
  const k = idOf(id);
  if (!k || k === "0") return;
  let s = idConvs.get(k);
  if (!s) idConvs.set(k, (s = new Set()));
  s.add(String(convId));
  if (!shopId && s.size >= 2) {
    shopId = k;
    chrome.storage.local.set({ shopId: k });
    console.log(TAG, "รู้แล้วว่ารหัสผู้ใช้ของร้านคือ", k, "— แยกฝั่งได้ถูกต้องแล้ว");
  }
}

// ร้านเป็นคนส่งข้อความนี้หรือเปล่า — ไล่จากสัญญาณที่เชื่อถือได้มากไปน้อย
function sellerSent(m, convId) {
  const from  = idOf(m.from_id ?? m.fromId ?? m.from_user_id);
  const buyer = buyerOf.get(String(convId));
  if (from && buyer) return from !== buyer;          // แน่นอนที่สุด
  if (from && shopId) return from === shopId;        // เรียนรู้มาแล้ว
  return isShopUser(m.from_user_name);               // ทางสำรอง
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

  // จำรหัสผู้ใช้ทั้งสองฝั่งไว้ก่อน — พอเปิดแชทที่ 2 จะรู้เองว่า id ไหนคือร้าน
  for (const m of arr) {
    if (!m) continue;
    noteId(convId, m.from_id ?? m.fromId ?? m.from_user_id);
    noteId(convId, m.to_id ?? m.toId ?? m.to_user_id);
  }

  for (const m of arr) {
    if (!m || !m.id) continue;

    const isSeller = sellerSent(m, convId);

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

    // to_id ในรายการแชท = "ลูกค้า" เสมอ เพราะรายการนี้มองจากฝั่งร้าน
    // เก็บไว้เป็นหลักฐานชั้นดีที่สุดว่าข้อความไหนใครส่ง
    const buyerId = idOf(c.to_id ?? c.toId ?? c.to_user_id);
    if (buyerId) buyerOf.set(String(convId), buyerId);

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
        from: sellerSent({
          from_id: c.latest_message_from_id ?? c.last_message_from_id,
          from_user_name: c.latest_message_sender_name,
        }, convId) ? "seller" : "buyer",
        text: String(preview),
        imageUrl: "",
        sentAt: pickTime({ created_timestamp: ts }),
      }],
    });
  }
  return out;
}

// ── LINE OA Manager ───────────────────────────────────────
// โครงสร้างจริง (สำรวจแล้ว 2026-08-08):
//   GET /api/v2/bots/{botId}/chats                     → รายการแชท (latestEvent อันเดียวต่อแชท)
//   GET /api/v3/bots/{botId}/chats/{chatId}/messages   → ข้อความทั้งหมดในแชทนั้น
//
// ทิศทาง: type "messageSent" = ร้านส่ง · "message" = ลูกค้าส่ง
//         (ยืนยันซ้ำด้วย source.userId ที่จะเท่ากับ botId เมื่อร้านเป็นคนส่ง)
// chatId = userId ของลูกค้า → ตรงกับที่ webhook เก็บไว้ จึงรวมเป็นบทสนทนาเดียวกันเอง
const RE_LINE_BOT  = /\/bots\/([^/]+)\//i;
const RE_LINE_MSGS = /\/bots\/[^/]+\/chats\/([^/?]+)\/messages/i;
const RE_LINE_LIST = /\/bots\/[^/]+\/chats\/?(\?|$)/i;

function lineMsg(ev, botId) {
  const m = ev && ev.message;
  if (!m || !m.id) return null;
  const fromShop = ev.type === "messageSent" || ev.source?.userId === botId;

  let text = "", imageUrl = "";
  switch (m.type) {
    case "text":    text = m.text || ""; break;
    case "sticker":
      imageUrl = `https://stickershop.line-scdn.net/stickershop/v1/sticker/${m.stickerId}/android/sticker.png`;
      break;
    case "image":   text = "[รูปภาพ]";      break;   // ไฟล์จริงดึงผ่านหน้าเว็บไม่ได้
    case "video":   text = "[วิดีโอ]";       break;
    case "audio":   text = "[ข้อความเสียง]"; break;
    case "file":    text = `[ไฟล์] ${m.fileName ?? ""}`.trim(); break;
    case "location":text = `[ตำแหน่ง] ${m.address ?? ""}`.trim(); break;
    default:        text = m.text || `[${m.type || "ข้อความ"}]`;
  }
  if (!text && !imageUrl) return null;

  return {
    id: String(m.id),
    from: fromShop ? "seller" : "buyer",
    text, imageUrl,
    sentAt: Number(ev.timestamp) || Date.now(),
  };
}

function parseLine(url, data) {
  const bot = url.match(RE_LINE_BOT);
  if (!bot || !data) return [];
  const botId = bot[1];
  const list = Array.isArray(data.list) ? data.list : null;
  if (!list || !list.length) return [];

  // ── ข้อความในแชทเดียว ──
  const mm = url.match(RE_LINE_MSGS);
  if (mm) {
    const chatId = mm[1];
    const messages = list.map((ev) => lineMsg(ev, botId)).filter(Boolean);
    if (!messages.length) return [];
    const meta = convMeta.get(chatId) ?? {};
    return [{ convId: chatId, name: meta.name || "", avatar: meta.avatar || "", messages }];
  }

  // ── รายการแชท (ได้ข้อความล่าสุดของแต่ละแชท โดยไม่ต้องคลิกเปิด) ──
  if (RE_LINE_LIST.test(url)) {
    const out = [];
    for (const c of list) {
      if (!c || !c.chatId) continue;
      const msg = lineMsg(c.latestEvent, botId);
      if (!msg) continue;

      const name   = c.profile?.name || "";
      const avatar = c.profile?.iconHash ? `https://profile.line-scdn.net/${c.profile.iconHash}` : "";
      if (name) convMeta.set(c.chatId, { name, avatar });

      out.push({ convId: c.chatId, name, avatar, messages: [msg] });
    }
    return out;
  }

  return [];
}

// ── ข้อความที่ทีมงานตอบจาก LINE OA Manager ────────────────
// LINE ไม่มี webhook แจ้งว่า "แอดมินตอบอะไรไป" (มีแต่ฝั่งลูกค้าทัก)
// จึงต้องอ่านตอนหน้าเว็บกดส่งออกไป — hook.js ส่งเนื้อคำขอ (req) มาให้
//
// ยังไม่รู้รหัสข้อความจริงตอนนี้ จึงใส่ id ขึ้นต้นว่า local:
// ฝั่งเซิร์ฟเวอร์จะเก็บเป็น "ยังไม่มีรหัส" ไว้ก่อน แล้วเติมให้เองเมื่อรหัสจริงตามมา
// (ไม่งั้นพอ LINE ส่งข้อความเดียวกันกลับมา จะกลายเป็นข้อความเบิ้ล)
function parseLineSend(url, body) {
  let b;
  try { b = JSON.parse(body); } catch { return null; }
  if (!b || typeof b !== "object") return null;

  const inPath = url.match(/\/chats\/([^/?#]+)/i);
  const chatId = inPath?.[1] || b.chatId || b.to
              || (Array.isArray(b.chatIds) ? b.chatIds[0] : "");
  if (!chatId) return null;

  const text = b.text ?? b.message?.text
            ?? (Array.isArray(b.messages) ? b.messages[0]?.text : "");
  if (!text || typeof text !== "string") return null;   // ไม่ใช่คำขอส่งข้อความ

  const meta = convMeta.get(String(chatId)) ?? {};
  return {
    convId: String(chatId),
    name:   meta.name || "",
    avatar: meta.avatar || "",
    messages: [{
      id: `local:${chatId}:${Date.now()}`,
      from: "seller",
      text,
      imageUrl: "",
      sentAt: Date.now(),
    }],
  };
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

  // ── LINE OA Manager ──────────────────────────────────────
  if (/line\.biz/i.test(location.hostname)) {
    let lineData;
    try { lineData = JSON.parse(d.body); } catch { return; }   // ไม่ใช่ JSON ก็ข้าม

    const batchLine = parseLine(String(d.url), lineData);
    if (batchLine.length) {
      const n = batchLine.reduce((s, c) => s + c.messages.length, 0);
      console.log(`%c${TAG} LINE → เตรียมส่ง ${batchLine.length} แชท / ${n} ข้อความ`,
                  "background:#06C755;color:#fff;font-weight:bold;padding:2px 6px");
      queue.push(...batchLine);
      if (!timer) timer = setTimeout(flush, 3000);
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
