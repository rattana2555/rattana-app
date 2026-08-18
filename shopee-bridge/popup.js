// หน้าตั้งค่าของส่วนขยาย — เก็บค่าไว้ในเครื่องเท่านั้น (chrome.storage.local)
const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["secret", "discovery", "enabled", "shopUser"], (v) => {
  $("shopUser").value    = v.shopUser ?? "";
  $("secret").value      = v.secret ?? "";
  $("discovery").checked = v.discovery !== false;   // ค่าเริ่มต้น = โหมดสำรวจ
  $("enabled").checked   = v.enabled !== false;     // ค่าเริ่มต้น = เปิด
});

// ── แสดงทุกอย่างที่ดักได้ ──────────────────────────────────
// LINE/Shopee : เก็บเป็น 2 ชุด (รายการแชท / ข้อความในแชท)
// TikTok      : เก็บตาม path เพราะยังไม่รู้ว่าอันไหนคืออะไร + โครงหน้าจอที่สำรวจได้
const KEYS = ["sampleChatList", "sampleChatMsgs", "ttSamples", "ttDom"];

chrome.storage.local.get(KEYS, (v) => {
  const parts = [];

  if (v.sampleChatList)
    parts.push(`===== รายการแชท (${v.sampleChatList.size} ตัวอักษร) =====\n${v.sampleChatList.path}\n${v.sampleChatList.body}`);
  if (v.sampleChatMsgs)
    parts.push(`===== ข้อความในแชท (${v.sampleChatMsgs.size} ตัวอักษร) =====\n${v.sampleChatMsgs.path}\n${v.sampleChatMsgs.body}`);

  const tt = v.ttSamples || {};
  for (const path of Object.keys(tt))
    parts.push(`===== TikTok เน็ตเวิร์ก${tt[path].req ? " (ขาออก)" : ""} · ${tt[path].size} ตัวอักษร =====\n${path}\n${tt[path].body}`);

  if (v.ttDom && v.ttDom.rows)
    parts.push(`===== TikTok หน้าจอ · ${v.ttDom.url} · กว้าง ${v.ttDom.w}px =====\n` +
      v.ttDom.rows.map((r) => `[${r.side}] x=${r.x} y=${r.y} <${r.tag}> ${r.cls}\n   ${r.text}`).join("\n"));

  $("sample").value = parts.length ? parts.join("\n\n") : "";
  $("ok").style.color = "#8a98b8";
  $("ok").textContent = parts.length ? `มีข้อมูล ${parts.length} ชุด` : "";
});

// ล้างตัวอย่างเก่า เพื่อเริ่มเก็บใหม่
$("clear").addEventListener("click", () => {
  chrome.storage.local.remove([...KEYS, "lastChatSample"], () => {
    $("sample").value = "";
    $("ok").style.color = "#2ecc71";
    $("ok").textContent = "ล้างแล้ว — รีเฟรชหน้าเว็บเพื่อเก็บใหม่";
    setTimeout(() => ($("ok").textContent = ""), 3000);
  });
});

$("copy").addEventListener("click", () => {
  const el = $("sample");
  if (!el.value) { $("ok").style.color = "#e74c3c"; $("ok").textContent = "ยังไม่มีตัวอย่าง"; return; }
  el.select();
  navigator.clipboard.writeText(el.value).then(() => {
    $("ok").style.color = "#2ecc71";
    $("ok").textContent = "คัดลอกแล้ว ✓ วางในแชทได้เลย";
    setTimeout(() => ($("ok").textContent = ""), 3000);
  });
});

// สั่งให้ส่วนขยายที่หน้า TikTok เริ่มไล่เปิดแชททีละอันเดี๋ยวนี้
// สื่อสารผ่าน storage เพราะไม่ต้องขอสิทธิ์ tabs เพิ่ม
$("sweep").addEventListener("click", () => {
  chrome.storage.local.set({ ttSweepNow: Date.now() }, () => {
    $("ok").style.color = "#25F4EE";
    $("ok").textContent = "สั่งแล้ว — ดูความคืบหน้าใน Console หน้า TikTok";
    setTimeout(() => ($("ok").textContent = ""), 4000);
  });
});

$("save").addEventListener("click", () => {
  const shopUser = $("shopUser").value.trim();
  if (!shopUser) {
    $("ok").style.color = "#e74c3c";
    $("ok").textContent = "ต้องใส่ชื่อร้านก่อน";
    return;
  }
  chrome.storage.local.set({
    shopUser,
    secret:    $("secret").value.trim(),
    discovery: $("discovery").checked,
    enabled:   $("enabled").checked,
  }, () => {
    $("ok").style.color = "#2ecc71";
    $("ok").textContent = "บันทึกแล้ว ✓ รีเฟรชหน้าเว็บด้วย";
    setTimeout(() => ($("ok").textContent = ""), 3000);
  });
});
