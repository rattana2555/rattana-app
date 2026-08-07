// หน้าตั้งค่าของส่วนขยาย — เก็บค่าไว้ในเครื่องเท่านั้น (chrome.storage.local)
const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["secret", "discovery", "enabled", "shopUser"], (v) => {
  $("shopUser").value    = v.shopUser ?? "";
  $("secret").value      = v.secret ?? "";
  $("discovery").checked = v.discovery !== false;   // ค่าเริ่มต้น = โหมดสำรวจ
  $("enabled").checked   = v.enabled !== false;     // ค่าเริ่มต้น = เปิด
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
