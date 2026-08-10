// ============================================================
//  hook.js — ทำงานในบริบทของหน้าเว็บ Shopee (world: MAIN)
//
//  หน้าที่: ดักอ่าน "ผลลัพธ์" ของ API ที่หน้า Seller Center เรียกเองอยู่แล้ว
//  ไม่ได้ยิง API เพิ่ม ไม่ได้ล็อกอินแทน ไม่ได้แก้ไขอะไรบนหน้าเว็บ
//  = ข้อมูลชุดเดียวกับที่พนักงานเห็นบนจอ แค่ส่งต่อไปเก็บที่ Chat Hub
//
//  ดัก 3 ทาง: fetch / XMLHttpRequest / WebSocket
//  (แชทส่วนใหญ่ส่งข้อความผ่าน WebSocket ไม่ใช่ HTTP)
// ============================================================
(() => {
  const TAG = "[RCH]";

  // Shopee: รู้ endpoint แน่นอนแล้ว จับเฉพาะที่ต้องการ
  // LINE  : หน้าเว็บเรียก API ด้วย path สั้นๆ เช่น "/api/v1/chats?..." ไม่มีชื่อโดเมนอยู่ในนั้น
  //         จึงจับทุกอย่างไว้ก่อน (content script ทำงานเฉพาะบน line.biz อยู่แล้ว)
  //         แล้วค่อยกรองด้วย NOISE กับตัวแปลงอีกที
  const IS_LINE = /\.line\.biz$/i.test(location.hostname);
  const WANTED  = IS_LINE
    ? /^/                                        // ผ่านหมด
    : /seller\.shopee\.[a-z.]+\/webchat\/api\//i;

  const NOISE = /dem\.shopee\.com|web-performance|web-custom-event|analytics|tracking|beacon|\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ico|map)(\?|$)/i;

  let captured = 0;
  function report(url, kind, body) {
    if (!body) return;
    if (NOISE.test(url)) return;
    captured++;
    if (IS_LINE && captured <= 3) console.log(TAG, "hook จับได้:", kind, String(url).slice(0, 90));
    try {
      window.postMessage({ __rch: true, url, kind, body: String(body).slice(0, 200000) }, "*");
    } catch (_) {}
  }

  // บอกทุก 10 วินาทีว่าจับได้กี่รายการ — ใช้ดูว่า hook ทำงานหรือเปล่า
  if (IS_LINE) setInterval(() => console.log(TAG, "จับได้สะสม", captured, "รายการ"), 10000);

  // ── ดัก "คำขาออก" ด้วย ───────────────────────────────────
  // LINE ไม่มีทางแจ้งกลับมาว่าแอดมินตอบอะไรไปบ้าง (ไม่มี webhook สำหรับข้อความฝั่งร้าน)
  // วิธีเดียวที่รู้ได้คืออ่านตอนที่หน้าเว็บ "กดส่ง" ออกไป
  function reportReq(url, method, body) {
    if (!body || typeof body !== "string") return;
    if (!/^(post|put|patch)$/i.test(String(method || ""))) return;
    if (NOISE.test(url)) return;
    try {
      window.postMessage(
        { __rch: true, req: true, url, kind: "req", method, body: body.slice(0, 20000) }, "*");
    } catch (_) {}
  }

  // ── fetch ─────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    let url = "", method = "GET", reqBody = null;
    try {
      const a0 = args[0], a1 = args[1] || {};
      url    = typeof a0 === "string" ? a0 : a0?.url ?? "";
      method = a1.method ?? a0?.method ?? "GET";
      if (typeof a1.body === "string") reqBody = a1.body;
      if (IS_LINE && reqBody) reportReq(url, method, reqBody);
    } catch (_) {}

    const res = await origFetch.apply(this, args);
    try {
      if (WANTED.test(url)) res.clone().text().then((t) => report(url, "fetch", t)).catch(() => {});
    } catch (_) {}
    return res;
  };

  // ── XMLHttpRequest ───────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__rchUrl = url;
    this.__rchMethod = method;
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    try {
      if (IS_LINE && typeof args[0] === "string") {
        reportReq(this.__rchUrl || "", this.__rchMethod, args[0]);
      }
    } catch (_) {}
    this.addEventListener("load", () => {
      try {
        if (WANTED.test(this.__rchUrl || "")) report(this.__rchUrl, "xhr", this.responseText);
      } catch (_) {}
    });
    return origSend.apply(this, args);
  };

  // ── WebSocket ────────────────────────────────────────────
  // แชทมักส่งข้อความใหม่มาทางนี้แบบเรียลไทม์ ไม่ผ่าน HTTP
  const OrigWS = window.WebSocket;
  function PatchedWS(url, protocols) {
    const ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
    ws.addEventListener("message", (ev) => {
      try {
        if (typeof ev.data === "string") report(String(url), "ws", ev.data);
      } catch (_) {}
    });
    return ws;
  }
  PatchedWS.prototype = OrigWS.prototype;
  ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach((k, i) => { PatchedWS[k] = i; });
  window.WebSocket = PatchedWS;

  console.log(TAG, "hook v4 พร้อม —", location.hostname,
              window.top === window ? "(หน้าหลัก)" : "(เฟรมซ้อน)");
})();
