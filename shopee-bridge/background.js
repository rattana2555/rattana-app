// ============================================================
//  background.js — ตัวดึงข้อความที่ทีมตอบใน LINE OA อัตโนมัติ
//
//  ทำไมต้องมี:
//  LINE ไม่มี webhook/API แจ้งว่า "แอดมินตอบอะไรไป" ทางเดียวที่รู้คืออ่านจากหน้า OA
//  เดิมต้องเปิดแท็บ OA ค้างไว้ตลอด ตัวนี้ทำให้ดึงเองได้เบื้องหลัง
//  โดยยิงไปที่ API เดียวกับที่หน้า OA Manager เรียกเอง (ใช้คุกกี้ล็อกอินของเบราว์เซอร์)
//
//  เงื่อนไข: ต้องล็อกอิน LINE OA Manager ค้างไว้ใน Chrome เครื่องนี้
//           และเคยเปิดหน้า OA อย่างน้อย 1 ครั้ง (เพื่อให้รู้ botId)
//
//  ⚠️ อ่านอย่างเดียว — ไม่ส่งข้อความแทน ไม่แก้ไขอะไรบนบัญชี
// ============================================================
const ENDPOINT = "https://tsudgtzcskoopbymklfg.supabase.co/functions/v1/ingest-shopee";
const TAG = "[RCH-bg]";
const POLL_MIN = 1;                 // ดึงทุก 1 นาที
const SEEN_CAP = 800;               // จำรหัสข้อความที่ส่งแล้ว กันส่งซ้ำ

chrome.runtime.onInstalled.addListener(() => setupAlarm());
chrome.runtime.onStartup.addListener(() => setupAlarm());
function setupAlarm() {
  chrome.alarms.create("line-poll", { periodInMinutes: POLL_MIN, delayInMinutes: 0.2 });
}
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "line-poll") pollLine(); });

const get = (keys) => new Promise((r) => chrome.storage.local.get(keys, r));
const set = (obj)  => new Promise((r) => chrome.storage.local.set(obj, r));

// อ่านคุกกี้ CSRF ของ LINE (ถ้ามี) เพื่อแนบไปกับคำขอ ไม่งั้นบาง endpoint จะปฏิเสธ
function getCookie(url, name) {
  return new Promise((r) => {
    try { chrome.cookies.get({ url, name }, (c) => r(c ? c.value : "")); }
    catch { r(""); }
  });
}

// แปลง event หนึ่งอันจากรายการแชท เป็นข้อความของ Chat Hub
function shape(ev, botId) {
  const m = ev && ev.message;
  if (!m || !m.id) return null;
  // เอาเฉพาะฝั่งร้าน — ข้อความลูกค้ามาทาง webhook อยู่แล้ว ไม่ต้องดึงซ้ำ
  const fromShop = ev.type === "messageSent" || ev.source?.userId === botId;
  if (!fromShop) return null;

  let text = "", imageUrl = "";
  switch (m.type) {
    case "text":    text = m.text || ""; break;
    case "sticker":
      imageUrl = `https://stickershop.line-scdn.net/stickershop/v1/sticker/${m.stickerId}/android/sticker.png`; break;
    case "image":   text = "[รูปภาพ]";      break;
    case "video":   text = "[วิดีโอ]";       break;
    case "audio":   text = "[ข้อความเสียง]"; break;
    case "file":    text = `[ไฟล์] ${m.fileName ?? ""}`.trim(); break;
    case "location":text = `[ตำแหน่ง] ${m.address ?? ""}`.trim(); break;
    default:        text = m.text || `[${m.type || "ข้อความ"}]`;
  }
  if (!text && !imageUrl) return null;
  return { id: String(m.id), from: "seller", text, imageUrl, sentAt: Number(ev.timestamp) || Date.now() };
}

async function pollLine() {
  const cfg = await get(["secret", "enabled", "lineBotId", "lineHost", "lineSeen"]);
  const status = (note, extra) => set({ lineBgStatus: { at: Date.now(), note, ...extra } });

  if (cfg.enabled === false) return;
  if (!cfg.secret)  return status("ยังไม่ได้ใส่รหัสลับในหน้าตั้งค่า");
  if (!cfg.lineBotId || !cfg.lineHost)
    return status("ยังไม่รู้บัญชี OA — เปิดหน้า LINE OA Manager สัก 1 ครั้งก่อน");

  const host  = cfg.lineHost;                          // เช่น https://chat.line.biz
  const botId = cfg.lineBotId;
  const seen  = new Set(cfg.lineSeen || []);

  // ยิง API รายการแชท อันเดียวกับที่หน้า OA Manager เรียกเอง (แนบคุกกี้ล็อกอิน)
  const xsrf = await getCookie(host, "XSRF-TOKEN");
  let res;
  try {
    res = await fetch(`${host}/api/v2/bots/${botId}/chats?limit=25`, {
      method: "GET",
      credentials: "include",
      headers: xsrf ? { "x-xsrf-token": xsrf } : {},
    });
  } catch (e) { return status("เชื่อมต่อ LINE ไม่ได้: " + e.message); }

  if (res.status === 401 || res.status === 403)
    return status("LINE ยังไม่ได้ล็อกอิน หรือ session หมดอายุ — เปิด LINE OA Manager แล้วล็อกอินใหม่", { code: res.status });
  if (!res.ok) return status(`LINE ตอบ ${res.status}`, { code: res.status });

  let data;
  try { data = await res.json(); } catch { return status("อ่านข้อมูล LINE ไม่ได้"); }
  const list = Array.isArray(data.list) ? data.list : [];
  if (!list.length) return status("ดึงสำเร็จ — ยังไม่มีแชท", { chats: 0 });

  // เก็บเฉพาะข้อความฝั่งร้านที่ยังไม่เคยส่ง
  const convs = [];
  for (const c of list) {
    if (!c || !c.chatId) continue;
    const msg = shape(c.latestEvent, botId);
    if (!msg || seen.has(msg.id)) continue;

    const name   = c.profile?.name || "";
    const avatar = c.profile?.iconHash ? `https://profile.line-scdn.net/${c.profile.iconHash}` : "";
    convs.push({ convId: c.chatId, name, avatar, messages: [msg] });
    seen.add(msg.id);
  }

  if (!convs.length) return status("ดึงสำเร็จ — ไม่มีข้อความใหม่ที่ทีมตอบ", { chats: list.length, sent: 0 });

  // ส่งเข้า Chat Hub
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingest-secret": cfg.secret },
      body: JSON.stringify({ platform: "line", conversations: convs }),
    });
    const j = await r.json().catch(() => ({}));
    // จำรหัสที่ส่งแล้ว (เก็บท้ายสุด SEEN_CAP อัน)
    await set({ lineSeen: [...seen].slice(-SEEN_CAP) });
    await status(`ดึงอัตโนมัติสำเร็จ — ส่ง ${convs.length} ข้อความที่ทีมตอบ`,
                 { chats: list.length, sent: convs.length, saved: j.newMessages ?? "?" });
    console.log(TAG, "ส่งข้อความทีมตอบ", convs.length, "อัน →", j);
  } catch (e) {
    await status("ส่งเข้า Hub ไม่สำเร็จ: " + e.message);
  }
}

// เผื่อ service worker เพิ่งตื่น ให้ตั้ง alarm และลองดึงเลย 1 รอบ
setupAlarm();
pollLine();
