// ============================================================
//  hook.js — ทำงานในบริบทของหน้าเว็บ Shopee (world: MAIN)
//
//  หน้าที่: ดักอ่าน "ผลลัพธ์" ของ API ที่หน้า Seller Center เรียกเองอยู่แล้ว
//  ไม่ได้ยิง API เพิ่ม ไม่ได้ล็อกอินแทน ไม่ได้แก้ไขอะไรบนหน้าเว็บ
//  = ข้อมูลชุดเดียวกับที่พนักงานเห็นบนจอ แค่ส่งต่อไปเก็บที่ Chat Hub
//
//  ส่งต่อให้ bridge.js ผ่าน window.postMessage เพราะคนละ world คุยกันตรงๆ ไม่ได้
// ============================================================
(() => {
  const TAG = "[RCH]";

  // เอาเฉพาะ URL ที่น่าจะเกี่ยวกับแชท เพื่อไม่ให้ดักข้อมูลอื่นโดยไม่จำเป็น
  const LOOKS_LIKE_CHAT = /(chat|conversation|message|webchat|im\/)/i;

  function report(url, method, body) {
    try {
      window.postMessage({ __rch: true, url, method, body }, "*");
    } catch (_) { /* payload ใหญ่เกินหรือ clone ไม่ได้ ก็ข้าม */ }
  }

  // ── ดัก fetch ──────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";
      if (LOOKS_LIKE_CHAT.test(url)) {
        res.clone().text().then((t) => report(url, "fetch", t)).catch(() => {});
      }
    } catch (_) {}
    return res;
  };

  // ── ดัก XMLHttpRequest ────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__rchUrl = url;
    this.__rchMethod = method;
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        if (LOOKS_LIKE_CHAT.test(this.__rchUrl || "")) {
          report(this.__rchUrl, this.__rchMethod || "xhr", this.responseText);
        }
      } catch (_) {}
    });
    return origSend.apply(this, args);
  };

  console.log(TAG, "hook พร้อมแล้ว — เปิดหน้าแชทใน Seller Center ได้เลย");
})();
