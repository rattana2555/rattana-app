// หน้าตั้งค่าของส่วนขยาย — เก็บค่าไว้ในเครื่องเท่านั้น (chrome.storage.local)
const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["secret", "discovery", "enabled", "shopUser"], (v) => {
  $("shopUser").value    = v.shopUser ?? "";
  $("secret").value      = v.secret ?? "";
  $("discovery").checked = v.discovery !== false;   // ค่าเริ่มต้น = โหมดสำรวจ
  $("enabled").checked   = v.enabled !== false;     // ค่าเริ่มต้น = เปิด
});

// แสดงตัวอย่างที่ดักได้ — เก็บ 2 ชุด: รายการแชท กับ ข้อความในแชท
// เก็บอันที่ใหญ่ที่สุดของแต่ละชุด เพราะอันเล็กมักไม่มีข้อมูลจริง
chrome.storage.local.get(["sampleChatList", "sampleChatMsgs"], (v) => {
  const parts = [];
  if (v.sampleChatList) parts.push(`===== รายการแชท (${v.sampleChatList.size} ตัวอักษร) =====\n${v.sampleChatList.path}\n${v.sampleChatList.body}`);
  if (v.sampleChatMsgs) parts.push(`===== ข้อความในแชท (${v.sampleChatMsgs.size} ตัวอักษร) =====\n${v.sampleChatMsgs.path}\n${v.sampleChatMsgs.body}`);
  $("sample").value = parts.join("\n\n");
});

// ล้างตัวอย่างเก่า เพื่อเริ่มเก็บใหม่
$("clear").addEventListener("click", () => {
  chrome.storage.local.remove(["sampleChatList", "sampleChatMsgs", "lastChatSample"], () => {
    $("sample").value = "";
    $("ok").style.color = "#2ecc71";
    $("ok").textContent = "ล้างแล้ว — รีเฟรชหน้า LINE เพื่อเก็บใหม่";
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
    $("ok").textContent = "บันทึกแล้ว ✓ รีเฟรชหน้า Shopee ด้วย";
    setTimeout(() => ($("ok").textContent = ""), 3000);
  });
});
