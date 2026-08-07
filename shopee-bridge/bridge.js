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

let cfg = { secret: "", discovery: true, enabled: true };
let sellerUserId = null;                    // เดาจาก URL ที่หน้าเว็บเรียก
const convMeta = new Map();                 // convId → {name}

chrome.storage.local.get(["secret", "discovery", "enabled", "sellerUserId"], (v) => {
  cfg = { ...cfg, ...v };
  if (v.sellerUserId) sellerUserId = String(v.sellerUserId);
  console.log(TAG, "โหมด:", cfg.discovery ? "สำรวจ (ยังไม่ส่ง)" : "ส่งจริง",
              "| เปิดใช้งาน:", cfg.enabled, "| ร้าน:", sellerUserId ?? "ยังไม่รู้");
});
chrome.storage.onChanged.addListener((ch) => {
  for (const k in ch) cfg[k] = ch[k].newValue;
});

// ── ตัวช่วย ───────────────────────────────────────────────
const RE_MESSAGES = /\/conversations\/(\d+)\/messages/;
const RE_USER     = /\/mini\/users\/(\d+)\//;

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

    const fromId = String(m.from_id ?? "");
    const isSeller = sellerUserId ? fromId === sellerUserId
                                  : !!(m.from_shop_id && m.from_shop_id !== 0 && m.type !== "notification");

    // ชื่อลูกค้า = ฝั่งที่ไม่ใช่ร้าน
    if (!customerName) {
      customerName = isSeller ? (m.to_user_name ?? "") : (m.from_user_name ?? "");
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

  const meta = convMeta.get(convId) ?? {};
  if (customerName && !meta.name) { meta.name = customerName; convMeta.set(convId, meta); }

  return {
    convId,
    name: meta.name || customerName || "ลูกค้า Shopee",
    avatar: "",
    messages,
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

  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": cfg.secret },
    body: JSON.stringify({ conversations: batch }),
  })
    .then((r) => r.json())
    .then((j) => console.log(TAG, "ส่งแล้ว:", j))
    .catch((e) => console.warn(TAG, "ส่งไม่สำเร็จ:", e.message));
}

// ── รับข้อมูลจาก hook.js ──────────────────────────────────
window.addEventListener("message", (ev) => {
  const d = ev.data;
  if (!d || d.__rch !== true || !cfg.enabled) return;

  // จำ user id ของร้านไว้ ใช้แยกว่าข้อความไหนเราส่ง ข้อความไหนลูกค้าส่ง
  const um = String(d.url).match(RE_USER);
  if (um && !sellerUserId) {
    sellerUserId = um[1];
    chrome.storage.local.set({ sellerUserId });
    console.log(TAG, "รู้แล้วว่า user id ของร้านคือ", sellerUserId);
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

  const conv = parseMessages(String(d.url), parsed);
  if (!conv) return;

  queue.push(conv);
  if (!timer) timer = setTimeout(flush, 3000);
});
