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

// ── TikTok ────────────────────────────────────────────────
// TikTok ส่งแชทเป็น protobuf ทาง WebSocket ถอดไม่ได้ จึงอ่านจากหน้าจอแทน
//
// ชื่อคลาสของ TikTok เป็นแบบ "css-1k81tbu-7937d88b--PText e1jltgo015"
// ส่วน css-xxxx เปลี่ยนทุกครั้งที่เขา deploy แต่ท้าย --PText คือชื่อคอมโพเนนต์
// ซึ่งอยู่ยาวกว่ามาก จึงจับด้วย [class*="--PText"]
//   --PInfoNickname / --SpanInfoExtract / --SpanInfoTime  = รายการแชทฝั่งซ้าย
//   --PNickname / --PUniqueId / --PText                   = แชทที่เปิดอยู่
//
// ส่วน user_id + รูปโปรไฟล์ ได้จาก /tiktok/v1/im/user/profile/ ที่ดักมาจากเน็ตเวิร์ก
const IS_TIKTOK = /(^|\.)tiktok\.com$/i.test(location.hostname);

const ttByName   = new Map();   // ชื่อที่แสดง → ข้อมูลผู้ใช้
const ttByUnique = new Map();   // @username  → ข้อมูลผู้ใช้

chrome.storage.local.get(["ttUsers"], (v) => {
  for (const u of v.ttUsers || []) {
    if (u.name)   ttByName.set(u.name, u);
    if (u.unique) ttByUnique.set(u.unique, u);
  }
});

function ttSaveUsers() {
  chrome.storage.local.set({ ttUsers: [...ttByUnique.values()].slice(-400) });
}

function ttNote(u) {
  if (!u || !u.uid) return;
  if (u.name)   ttByName.set(u.name, u);
  if (u.unique) ttByUnique.set(u.unique, u);
}

// อ่านข้อมูลผู้ใช้จาก 2 endpoint ที่ TikTok เรียกเองอยู่แล้ว
function ttLearnUsers(body) {
  let j; try { j = JSON.parse(body); } catch { return; }
  let n = 0;

  for (const w of j.users || []) {                      // /tiktok/v1/im/user/profile/
    const p = w.im_user_profile; if (!p) continue;
    ttNote({
      uid: String(p.user_id_str || p.user_id || ""),
      name: String(p.nick_name || ""),
      unique: String(p.unique_id || ""),
      avatar: p.avatars?.avatar_small?.url_list?.[0] || p.avatars?.avatar_medium?.url_list?.[0] || "",
    }); n++;
  }
  for (const f of j.followings || []) {                 // /api/im/spotlight/relation
    ttNote({
      uid: String(f.uid || ""),
      name: String(f.nickname || ""),
      unique: String(f.unique_id || ""),
      avatar: f.avatar_thumb?.url_list?.[0] || "",
    }); n++;
  }
  if (n) { ttSaveUsers(); console.log(TAG, "TikTok รู้จักผู้ใช้แล้ว", ttByUnique.size, "คน"); }
}

// ── แปลงวันเวลาแบบไทยเป็นเวลาเครื่อง ──────────────────────
const TH_MONTH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

function ttTime(txt) {
  const t = String(txt || "").trim();

  // "1 สิงหาคม 2026 10:29"
  let m = t.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (m) {
    const mi = TH_MONTH.indexOf(m[2]);
    if (mi >= 0) return new Date(+m[3], mi, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime();
  }
  // "13/8/2026"
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]).getTime();

  // "วันนี้ 10:29" / "เมื่อวาน 22:42" / "10:29"
  m = t.match(/^(วันนี้|เมื่อวาน)?\s*(\d{1,2}):(\d{2})$/);
  if (m) {
    const d = new Date();
    if (m[1] === "เมื่อวาน") d.setDate(d.getDate() - 1);
    d.setHours(+m[2], +m[3], 0, 0);
    return d.getTime();
  }
  return 0;
}

const isTtDate = (t) => ttTime(t) > 0;

// รหัสข้อความ — TikTok ไม่ให้มา จึงสร้างจากเนื้อหา+เวลาให้ได้ค่าเดิมทุกครั้ง
function h32(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const q = (sel, root) => [...(root || document).querySelectorAll(sel)];

// ── อ่านแชทที่เปิดอยู่ ─────────────────────────────────────
let ttWhy = "";
function ttReadOpenChat() {
  const uidEl  = q('[class*="--PUniqueId"]')[0];
  const nameEl = q('[class*="--PNickname"]')[0];
  const bubbles = q('[class*="--PText"]');

  ttWhy = `PUniqueId=${uidEl ? 1 : 0} PNickname=${nameEl ? 1 : 0} PText=${bubbles.length} รู้จักผู้ใช้=${ttByUnique.size}`;

  const unique = (uidEl?.textContent || "").trim().replace(/^@/, "");
  const shown  = (nameEl?.textContent || "").trim();
  if (!unique && !shown) { ttWhy += " → ยังไม่ได้เปิดแชท"; return null; }
  if (!bubbles.length)   { ttWhy += " → เปิดแชทแล้วแต่ยังไม่เห็นฟองข้อความ"; return null; }

  const user = ttByUnique.get(unique) || ttByName.get(shown) || {};
  const convId = user.uid || unique || shown;
  const name = user.name || shown || unique;

  // กล่องข้อความ = บรรพบุรุษร่วมของทุกฟอง ใช้ขอบซ้าย/ขวาตัดสินว่าใครส่ง
  // ต้องเดินขึ้นจนกล่องกว้างกว่าฟองพอสมควร ไม่งั้นตอนมีข้อความเดียวจะได้กล่องรัดรูป
  // ซึ่งวัดซ้าย/ขวาไม่ได้ และหาบรรทัดวันที่ไม่เจอ
  let box = bubbles[0].parentElement;
  for (let i = 0; i < 12 && box && box.parentElement; i++) {
    const covers = bubbles.every((el) => box.contains(el));
    const wide   = box.getBoundingClientRect().width > 320;
    if (covers && wide) break;
    box = box.parentElement;
  }
  if (!box) { ttWhy += " → หากล่องข้อความไม่เจอ"; return null; }
  const br = box.getBoundingClientRect();

  const messages = [];
  const usedIds = new Set();
  let ts = 0;

  for (const el of q("span,p,div", box)) {
    const cls = String(el.className || "");
    const txt = (el.textContent || "").trim().replace(/\s+/g, " ");
    if (!txt) continue;

    if (!el.children.length && isTtDate(txt)) { ts = ttTime(txt); continue; }
    if (!cls.includes("--PText")) continue;

    const r = el.getBoundingClientRect();
    // ฟองของเราชิดขอบขวา ฟองลูกค้าชิดขอบซ้าย — จริงเสมอไม่ว่าหน้าตาจะเปลี่ยนยังไง
    const fromShop = (br.right - r.right) < (r.left - br.left);
    const when = ts || Date.now();

    // ข้อความใต้บรรทัดวันที่เดียวกันได้เวลาเท่ากันหมด ถ้าเนื้อความซ้ำด้วยรหัสจะชนกัน
    // แล้วฐานข้อมูลจะปฏิเสธทั้งชุด — เติมลำดับต่อท้ายให้ไม่ซ้ำ
    let mid = `tt:${convId}:${when}:${h32(txt)}`;
    for (let k = 2; usedIds.has(mid); k++) mid = `tt:${convId}:${when}:${h32(txt)}:${k}`;
    usedIds.add(mid);

    messages.push({
      id: mid,
      from: fromShop ? "seller" : "buyer",
      text: txt,
      imageUrl: "",
      sentAt: when,
    });
  }

  if (!messages.length) { ttWhy += " → อ่านฟองข้อความไม่ออก"; return null; }
  ttWhy += ` → อ่านได้ ${messages.length} ข้อความ`;
  return { convId: String(convId), name, avatar: user.avatar || "", messages };
}

// ── รายการแชทฝั่งซ้าย ─────────────────────────────────────
// คืนทั้ง element ด้วย เพราะต้องเอาไปคลิกตอนดึงอัตโนมัติและตอนส่งข้อความ
function ttListRows() {
  const out = [];
  for (const el of q('[class*="--PInfoNickname"]')) {
    const name = (el.textContent || "").trim();
    if (!name || name === "คำขอส่งข้อความ") continue;

    let row = el, ex = null, tm = null;
    for (let i = 0; i < 6 && row; i++) {
      ex = q('[class*="--SpanInfoExtract"]', row)[0];
      tm = q('[class*="--SpanInfoTime"]', row)[0];
      if (ex && tm) break;
      row = row.parentElement;
    }
    if (!ex || !tm || !row) continue;

    const badge = q('[class*="--SpanNewMessage"]', row)[0];
    out.push({
      name, row,
      preview: (ex.textContent || "").trim(),
      at: ttTime((tm.textContent || "").trim()) || Date.now(),
      unread: Math.max(0, parseInt((badge?.textContent || "0").trim(), 10) || 0),
    });
  }
  return out;
}

function ttReadList() {
  const out = [];
  for (const r of ttListRows()) {
    const user = ttByName.get(r.name);
    if (!user || !user.uid) continue;        // ยังไม่รู้รหัส รอ TikTok โหลดโปรไฟล์ก่อน
    out.push({
      convId: String(user.uid),
      name: r.name,
      avatar: user.avatar || "",
      messages: [],
      preview: r.preview,
      previewAt: r.at,
      unread: r.unread,
    });
  }
  return out;
}

// ── ตัวช่วยสำหรับงานอัตโนมัติ ─────────────────────────────
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// นับเวลาที่ "คนจริง" แตะเครื่องล่าสุด — เหตุการณ์ที่โค้ดสร้างเองจะมี isTrusted=false
// ใช้กันไม่ให้ระบบไปคลิกแย่งขณะพนักงานกำลังใช้งานอยู่
let ttLastHuman = Date.now();
if (IS_TIKTOK) {
  ["mousemove", "mousedown", "keydown", "wheel", "touchstart"].forEach((t) =>
    window.addEventListener(t, (e) => { if (e.isTrusted) ttLastHuman = Date.now(); }, true));
}
const ttIdle = () => Date.now() - ttLastHuman;

function ttClick(el) {
  el.scrollIntoView({ block: "center" });
  for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
    el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
}

// ── ดึงแชททั้งหมดเอง ──────────────────────────────────────
// TikTok โหลดเนื้อหาแชทเมื่อถูกเปิดเท่านั้น จึงต้องเปิดทีละอันแล้วอ่าน
// ทำเฉพาะตอนไม่มีคนแตะเครื่อง จะได้ไม่ไปแย่งเมาส์พนักงานกลางคัน
let ttSweeping = false;
let ttSweptAt = 0;

async function ttSweep(manual) {
  if (ttSweeping || !cfg.secret || cfg.discovery) return;
  ttSweeping = true;
  try {
    const rows = ttListRows();
    console.log(`%c${TAG} TikTok เริ่มดึงทั้งหมด ${rows.length} แชท`,
                "background:#25F4EE;color:#000;font-weight:bold;padding:2px 6px");

    let got = 0;
    for (const r of rows) {
      if (!manual && ttIdle() < 20000) break;     // มีคนกลับมาใช้งาน หยุดทันที
      ttClick(r.row);
      await wait(1400 + Math.floor(Math.random() * 600));   // เว้นจังหวะแบบคนอ่าน
      const conv = ttReadOpenChat();
      if (conv && conv.messages.length) { queue.push(conv); got += conv.messages.length; }
    }
    ttSweptAt = Date.now();
    console.log(`${TAG} TikTok ดึงครบแล้ว — ได้ ${got} ข้อความ`);
    if (queue.length && !timer) timer = setTimeout(flush, 1500);
  } finally { ttSweeping = false; }
}

// ── ตรวจหน้าจอเป็นระยะ ส่งเฉพาะตอนมีอะไรเปลี่ยน ──────────
let ttLastSig = "";

let ttTick = 0;
function ttScan() {
  if (!cfg.enabled) return;
  if (cfg.discovery) {
    if (++ttTick % 6 === 1) console.warn(TAG, "TikTok: 'โหมดสำรวจ' ยังเปิดอยู่ — ปิดก่อนถึงจะส่งข้อมูล");
    return;
  }
  if (!cfg.secret) {
    if (++ttTick % 6 === 1) console.warn(TAG, "TikTok: ยังไม่ได้ใส่รหัสลับในหน้าตั้งค่า");
    return;
  }

  const batch = [];
  const open = ttReadOpenChat();
  if (open) batch.push(open);
  const list = ttReadList();
  batch.push(...list);

  // บอกสถานะทุก ~30 วินาที เพื่อให้รู้ว่าติดตรงไหนโดยไม่ต้องเดา
  if (++ttTick % 6 === 1)
    console.log(`%c${TAG} TikTok สถานะ — แชทที่เปิดอยู่: ${ttWhy} | รายการซ้าย: ${list.length} แชท`,
                "background:#25F4EE;color:#000;padding:2px 6px");

  if (!batch.length) return;

  const sig = JSON.stringify(batch.map((c) =>
    [c.convId, c.preview || "", c.messages.length, c.messages.at(-1)?.id || ""]));
  if (sig === ttLastSig) return;               // ไม่มีอะไรเปลี่ยน ไม่ต้องยิงซ้ำ
  ttLastSig = sig;

  const n = batch.reduce((s, c) => s + c.messages.length, 0);
  console.log(`%c${TAG} TikTok → เตรียมส่ง ${batch.length} แชท / ${n} ข้อความ`,
              "background:#25F4EE;color:#000;font-weight:bold;padding:2px 6px");
  queue.push(...batch);
  if (!timer) timer = setTimeout(flush, 3000);
}

// ── ตอบกลับจาก Chat Hub ───────────────────────────────────
// TikTok ไม่มี API ส่งข้อความ ทางเดียวคือพิมพ์ลงกล่องบนหน้าเว็บแล้วกดส่ง
// Chat Hub เก็บข้อความไว้ในคิว (status = queued) ตัวนี้มารับไปส่งให้
async function ttAck(id, ok, why) {
  await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": cfg.secret },
    body: JSON.stringify({ action: "ack", ids: [id], ok, note: why || "" }),
  }).catch(() => {});
}

async function ttSendOne(item) {
  const row = ttListRows().find((r) => r.name === item.name);
  if (!row) { await ttAck(item.id, false, "หาแชทในรายการไม่เจอ"); return false; }

  ttClick(row.row);
  await wait(1600);

  // กันส่งผิดคน — ตรวจว่าหัวแชทเป็นคนเดียวกับที่ตั้งใจจริงๆ
  const head = (q('[class*="--PNickname"]')[0]?.textContent || "").trim();
  if (head && head !== item.name) {
    await ttAck(item.id, false, `เปิดผิดแชท (ได้ ${head})`);
    return false;
  }

  const ed = q('[contenteditable="true"]').pop();
  if (!ed) { await ttAck(item.id, false, "ไม่พบช่องพิมพ์ข้อความ"); return false; }

  ed.focus();
  await wait(200);
  // execCommand เป็นวิธีเดียวที่ตัวแก้ไขข้อความของ TikTok (DraftJS) รับรู้
  // ถ้าไปยัด textContent ตรงๆ ตัวแก้ไขจะไม่รู้ว่ามีข้อความ แล้วปุ่มส่งจะไม่ทำงาน
  document.execCommand("insertText", false, item.text);
  await wait(400);

  for (const type of ["keydown", "keypress", "keyup"])
    ed.dispatchEvent(new KeyboardEvent(type, {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));

  await wait(1600);

  // ยืนยันผล: ช่องพิมพ์ต้องว่าง และต้องมีฟองข้อความนั้นโผล่ขึ้นมา
  const cleared = !(ed.textContent || "").trim();
  const shown = q('[class*="--PText"]').some((el) =>
    (el.textContent || "").trim() === item.text.trim());

  if (cleared && shown) {
    console.log(`%c${TAG} TikTok ส่งถึง ${item.name} แล้ว`,
                "background:#2ecc71;color:#fff;font-weight:bold;padding:2px 6px");
    await ttAck(item.id, true);
    return true;
  }
  await ttAck(item.id, false, "กดส่งแล้วแต่ข้อความไม่ขึ้น");
  return false;
}

let ttSending = false;
async function ttOutbox() {
  if (ttSending || !cfg.secret || cfg.discovery) return;
  ttSending = true;
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingest-secret": cfg.secret },
      body: JSON.stringify({ action: "outbox", platform: "tiktok" }),
    });
    const j = await r.json();
    for (const item of j.items || []) {
      await ttSendOne(item);
      await wait(1200);
    }
  } catch (e) { console.warn(TAG, "อ่านคิวข้อความไม่สำเร็จ:", e.message); }
  finally { ttSending = false; }
}

if (IS_TIKTOK) {
  setInterval(ttScan, 5000);

  // ส่งข้อความที่รออยู่ทุก 8 วินาที — คนกดส่งใน Hub แล้วต้องไปถึงเร็ว
  setInterval(ttOutbox, 8000);

  // ดึงแชททั้งหมดเอง: ครั้งแรกหลังโหลด 25 วินาที แล้วทุก 10 นาที
  // ทำเฉพาะตอนไม่มีคนแตะเครื่องเกิน 45 วินาที จะได้ไม่ไปแย่งเมาส์
  setTimeout(() => ttSweep(false), 25000);
  setInterval(() => {
    if (ttIdle() > 45000 && Date.now() - ttSweptAt > 10 * 60 * 1000) ttSweep(false);
  }, 20000);

  // ปุ่ม "ดึงเดี๋ยวนี้" ในหน้าตั้งค่าสั่งผ่านตรงนี้
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.ttSweepNow) ttSweep(true);
  });
}

function collectTikTok(d) {
  const raw = String(d.url || "");
  const body = String(d.body || "");
  if (body.length < 40 || d.req) return;
  if (/\/im\/user\/profile|\/im\/spotlight\/relation/i.test(raw)) ttLearnUsers(body);
}

// ── ส่งขึ้น Chat Hub (รวบยอด ไม่ยิงถี่) ────────────────────
let queue = [];
let timer = null;

function flush() {
  timer = null;
  if (!queue.length) return;
  if (!cfg.secret) { console.warn(TAG, "ยังไม่ได้ใส่รหัสลับ — ข้ามการส่ง"); queue = []; return; }
  const batch = queue; queue = [];

  const platform = /line\.biz/i.test(location.hostname) ? "line"
                 : /tiktok\.com$/i.test(location.hostname) ? "tiktok"
                 : "shopee";
  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": cfg.secret },
    body: JSON.stringify({ platform, conversations: batch }),
  })
    .then((r) => r.json())
    .then((j) => {
      // รวมไว้บรรทัดเดียวว่าส่งอะไรไปและได้อะไรกลับ จะได้ไม่ต้องไล่จับคู่บรรทัดเอง
      const sent = batch.reduce((n, c) => n + (c.messages?.length || 0), 0);
      const okAll = j.newMessages > 0 || sent === 0;
      console.log(`%c${TAG} ส่ง ${platform}: ${batch.length} แชท / ${sent} ข้อความ → บันทึกใหม่ ${j.newMessages}`,
                  `background:${okAll ? "#2ecc71" : "#e74c3c"};color:#fff;font-weight:bold;padding:2px 6px`);
      if (j.problems?.length) console.warn(TAG, "สาเหตุที่บันทึกไม่ได้:", j.problems);
    })
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

  // ── TikTok / TikTok Shop ─────────────────────────────────
  if (IS_TIKTOK) { collectTikTok(d); return; }

  // ── LINE OA Manager ──────────────────────────────────────
  if (/line\.biz/i.test(location.hostname)) {
    // คำขาออก = ทีมงานเพิ่งกดส่งข้อความ
    if (d.req === true) {
      const s = parseLineSend(String(d.url), d.body);
      if (s) {
        console.log(`%c${TAG} LINE → ทีมงานตอบ: ${s.messages[0].text.slice(0, 40)}`,
                    "background:#c9a84c;color:#0d1b3e;font-weight:bold;padding:2px 6px");
        queue.push(s);
        if (!timer) timer = setTimeout(flush, 3000);
      }
      return;
    }

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

  if (d.req === true) return;   // Shopee ใช้เฉพาะข้อมูลขาเข้า

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
