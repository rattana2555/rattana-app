@echo off
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app="https://rattana2555.github.io/rattana-app/rattana-cashier-ads.html" --user-data-dir="C:\rattana-ads" --no-first-run --disable-features=Translate --autoplay-policy=no-user-gesture-required
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((Get-Content -LiteralPath '%~f0' -Encoding UTF8 | Select-Object -Skip 5) -join [char]10)"
exit /b
REM ==== PowerShell: pin ad window always-on-top; $cut 0 = keep title bar (draggable), 33 = remove it (fixed) ====
$cut = 0
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
if (-not $p) { exit }
Start-Sleep 2
$h = [IntPtr]$p.MainWindowHandle
$r = New-Object WP+RECT
[WP]::GetWindowRect($h, [ref]$r) | Out-Null
if ($cut -gt 0) { [WP]::SetWindowRgn($h, [WP]::CreateRectRgn(0, $cut, ($r.R - $r.L), ($r.B - $r.T)), $true) | Out-Null }
[WP]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0063) | Out-Null
