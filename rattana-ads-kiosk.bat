@echo off
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app="https://rattana2555.github.io/rattana-app/rattana-cashier-ads.html" --user-data-dir="C:\rattana-ads" --no-first-run --disable-features=Translate --autoplay-policy=no-user-gesture-required
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "iex ((Get-Content -LiteralPath '%~f0' -Encoding UTF8 | Select-Object -Skip 5) -join [char]10)"
exit /b
REM ==== PowerShell: keep ad window always-on-top (re-assert every 3s); $cut 0 = keep title bar, 33 = remove it ====
# NOTE: เครื่องที่ใช้แบบเต็มจอถาวร ให้แก้บรรทัดที่ 2 จาก --app="URL" เป็น --kiosk "URL" (เต็มจอตลอด ไม่มีทางหลุด ไม่ต้องกด F)
# $mon2 = 1 จะย้ายหน้าต่างไปจอที่ 2 (จอลูกค้า) ให้อัตโนมัติตอนเปิด — เครื่องหน้าต่างลอยที่จัดตำแหน่งเองให้ใช้ 0
$cut = 0
$mon2 = 0
Add-Type 'using System;using System.Runtime.InteropServices;public class WP{[DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int c,uint f);[DllImport("user32.dll")]public static extern int SetWindowRgn(IntPtr h,IntPtr r,bool b);[DllImport("gdi32.dll")]public static extern IntPtr CreateRectRgn(int l,int t,int r,int b);[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT rc);public struct RECT{public int L;public int T;public int R;public int B;}}'
$p = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep 1
  $cand = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'Rattana Cashier Ads*' } | Select-Object -First 1
  if ($cand -and $cand.MainWindowHandle -ne 0) {
    $r = New-Object WP+RECT
    [WP]::GetWindowRect([IntPtr]$cand.MainWindowHandle, [ref]$r) | Out-Null
    if (($r.R - $r.L) -gt 120) { $p = $cand; break }
  }
}
if ($p -and $mon2 -gt 0) {
  Add-Type -AssemblyName System.Windows.Forms
  $t = [System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1
  if ($t) {
    $b = $t.Bounds
    [WP]::SetWindowPos([IntPtr]$p.MainWindowHandle, [IntPtr]::Zero, $b.X, $b.Y, $b.Width, $b.Height, 0x0060) | Out-Null
    Start-Sleep 1
  }
}
if ($p -and $cut -gt 0) {
  Start-Sleep 2
  $h = [IntPtr]$p.MainWindowHandle
  $r = New-Object WP+RECT
  [WP]::GetWindowRect($h, [ref]$r) | Out-Null
  [WP]::SetWindowRgn($h, [WP]::CreateRectRgn(0, $cut, ($r.R - $r.L), ($r.B - $r.T)), $true) | Out-Null
}
while ($true) {
  $c = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'Rattana Cashier Ads*' } | Select-Object -First 1
  if ($c -and $c.MainWindowHandle -ne 0) {
    $h = [IntPtr]$c.MainWindowHandle
    [WP]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0013) | Out-Null
    [WP]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, 0, 0, 0x0013) | Out-Null
  }
  Start-Sleep 3
}
