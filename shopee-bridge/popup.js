// หน้าตั้งค่าของส่วนขยาย — เก็บค่าไว้ในเครื่องเท่านั้น (chrome.storage.local)
const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["secret", "discovery", "enabled"], (v) => {
  $("secret").value      = v.secret ?? "";
  $("discovery").checked = v.discovery !== false;   // ค่าเริ่มต้น = โหมดสำรวจ
  $("enabled").checked   = v.enabled !== false;     // ค่าเริ่มต้น = เปิด
});

$("save").addEventListener("click", () => {
  chrome.storage.local.set({
    secret:    $("secret").value.trim(),
    discovery: $("discovery").checked,
    enabled:   $("enabled").checked,
  }, () => {
    $("ok").textContent = "บันทึกแล้ว ✓ รีเฟรชหน้า Shopee ด้วย";
    setTimeout(() => ($("ok").textContent = ""), 3000);
  });
});
