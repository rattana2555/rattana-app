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
  // LINE  : ยังไม่รู้โครงสร้าง จับกว้างไว้ก่อนเพื่อสำรวจ แล้วค่อยแคบลงทีหลัง
  const IS_LINE = /\.line\.biz$/i.test(location.hostname);
  const WANTED  = IS_LINE
    ? /\.line\.biz\//i
    : /seller\.shopee\.[a-z.]+\/webchat\/api\//i;

  const NOISE = /dem\.shopee\.com|web-performance|web-custom-event|analytics|tracking|beacon|\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ico|map)(\?|$)/i;

  function report(url, kind, body) {
    if (!body) return;
    if (NOISE.test(url)) return;
    try {
      window.postMessage({ __rch: true, url, kind, body: String(body).slice(0, 200000) }, "*");
    } catch (_) {}
  }

  // ── fetch ─────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";
      if (WANTED.test(url)) res.clone().text().then((t) => report(url, "fetch", t)).catch(() => {});
    } catch (_) {}
    return res;
  };

  // ── XMLHttpRequest ───────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__rchUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
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

  console.log(TAG, "hook v2 พร้อม — ดัก fetch / xhr / websocket แล้ว");
})();
