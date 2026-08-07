// ============================================================
//  bridge.js — ทำงานในบริบทของส่วนขยาย (world: ISOLATED)
//
//  รับข้อมูลที่ hook.js ดักมา → แปลงเป็นรูปแบบของ Chat Hub → ส่งขึ้น Supabase
//
//  โหมดการทำงาน (ตั้งได้ที่หน้า popup):
//    discovery = true  → แค่พิมพ์ตัวอย่างข้อมูลลง Console ยังไม่ส่งไปไหน
//                        ใช้ตอนยังไม่รู้ว่า Shopee ส่งข้อมูลมาหน้าตาแบบไหน
//    discovery = false → แปลงแล้วส่งเข้า Chat Hub จริง
// ============================================================
const ENDPOINT = "https://tsudgtzcskoopbymklfg.supabase.co/functions/v1/ingest-shopee";
const TAG = "[RCH]";

let cfg = { secret: "", discovery: true, enabled: true };

chrome.storage.local.get(["secret", "discovery", "enabled"], (v) => {
  cfg = { ...cfg, ...v };
  console.log(TAG, "โหมด:", cfg.discovery ? "สำรวจ (ยังไม่ส่งข้อมูล)" : "ส่งจริง",
              "| เปิดใช้งาน:", cfg.enabled);
});
chrome.storage.onChanged.addListener((ch) => {
  for (const k in ch) cfg[k] = ch[k].newValue;
});

// ── ตัวแปลงข้อมูล ─────────────────────────────────────────
// ยังไม่รู้โครงสร้างจริงของ Shopee — ตัวนี้เดาจากรูปแบบที่พบบ่อย
// พอได้ตัวอย่างจากโหมดสำรวจแล้วจะแก้ให้ตรงของจริง
function toConversations(url, data) {
  const out = [];
  const pick = (o, keys) => keys.map((k) => o?.[k]).find((v) => v != null);

  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }

    const convId = pick(node, ["conversation_id", "conversationId", "convId", "chat_id"]);
    const msgs   = pick(node, ["messages", "message_list", "msgs", "records"]);

    if (convId && Array.isArray(msgs)) {
      out.push({
        convId: String(convId),
        name:   pick(node, ["to_name", "username", "user_name", "nickname", "buyer_name"]) || "",
        avatar: pick(node, ["to_avatar", "avatar", "portrait"]) || "",
        messages: msgs.map((m) => {
          const id   = pick(m, ["message_id", "messageId", "msg_id", "id"]);
          const text = pick(m, ["text", "content", "message"]);
          const img  = pick(m?.content ?? {}, ["url", "image_url", "thumb_url"]);
          const from = pick(m, ["from_id", "sender", "from_shop_id"]);
          const ts   = pick(m, ["created_timestamp", "create_time", "timestamp", "ctime", "created_at"]);
          return {
            id: String(id ?? ""),
            from: String(from ?? "").match(/shop|seller/i) ? "seller" : "buyer",
            text: typeof text === "string" ? text : "",
            imageUrl: typeof img === "string" ? img : "",
            sentAt: typeof ts === "number" ? (ts < 1e12 ? ts * 1000 : ts) : (ts ?? Date.now()),
          };
        }).filter((m) => m.id && (m.text || m.imageUrl)),
      });
    }

    Object.values(node).forEach(walk);
  };

  walk(data);
  return out.filter((c) => c.messages.length);
}

// ── ส่งขึ้น Chat Hub (รวมเป็นชุด ไม่ยิงถี่) ────────────────
let queue = [];
let timer = null;

function flush() {
  timer = null;
  if (!queue.length || !cfg.secret) return;
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

window.addEventListener("message", (ev) => {
  const d = ev.data;
  if (!d || d.__rch !== true || !cfg.enabled) return;

  let parsed;
  try { parsed = JSON.parse(d.body); } catch { return; }   // ไม่ใช่ JSON ก็ข้าม

  if (cfg.discovery) {
    // โหมดสำรวจ: พิมพ์ให้ดูอย่างเดียว ไม่ส่งไปไหน
    console.log(TAG, "พบข้อมูล:", d.url);
    console.log(JSON.stringify(parsed).slice(0, 3000));
    return;
  }

  const convs = toConversations(d.url, parsed);
  if (!convs.length) return;

  queue.push(...convs);
  if (!timer) timer = setTimeout(flush, 3000);   // รวบยอดทุก 3 วินาที
});
