
$CUST_URL  = "https://docs.google.com/spreadsheets/d/1dAxF4Mz-zhJIVbuJ_Ql126gt08qvVS1wndJD50pqCZI/gviz/tq?tqx=out:csv&sheet=Customer"
$BP_URL    = "https://docs.google.com/spreadsheets/d/1NxFkxiQev0xxGir93-qt0flNfzHz848-KuE7jDRSxQE/gviz/tq?tqx=out:csv&sheet=BP"
$USERS_URL = "https://docs.google.com/spreadsheets/d/1M6HdISsLN684qRWyQ73CA4AmUzmYtZaOlffDJXZZIXQ/gviz/tq?tqx=out:csv&sheet=Rattana%20Users%20for%20apps"
$AVG3M_CSV = "D:\New\bq_avg3m.csv"
$OUT_FILE  = "D:\New\bq_merged.js"
$LOG_FILE  = "D:\New\update_merged.log"

function Write-Log([string]$msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $msg"
    Write-Host $line
    Add-Content -Path $LOG_FILE -Value $line -Encoding UTF8
}

function Parse-CsvText([string]$text) {
    if ($text.Length -gt 0 -and [int][char]$text[0] -eq 0xFEFF) { $text = $text.Substring(1) }
    $rows = [System.Collections.Generic.List[string[]]]::new()
    $row  = [System.Collections.Generic.List[string]]::new()
    $cell = [System.Text.StringBuilder]::new()
    $inQ  = $false
    $i    = 0
    while ($i -lt $text.Length) {
        $ch = $text[$i]
        if ($inQ) {
            if ($ch -eq '"') {
                if ($i+1 -lt $text.Length -and $text[$i+1] -eq '"') { $null = $cell.Append('"'); $i++ }
                else { $inQ = $false }
            } else { $null = $cell.Append($ch) }
        } else {
            if ($ch -eq '"') { $inQ = $true }
            elseif ($ch -eq ',') { $row.Add($cell.ToString()); $null = $cell.Clear() }
            elseif ($ch -eq "`n") {
                $row.Add($cell.ToString()); $null = $cell.Clear()
                $rows.Add($row.ToArray()); $row.Clear()
            } elseif ($ch -ne "`r") { $null = $cell.Append($ch) }
        }
        $i++
    }
    if ($cell.Length -gt 0 -or $row.Count -gt 0) { $row.Add($cell.ToString()); $rows.Add($row.ToArray()) }
    return $rows
}

function EscJs([string]$s) {
    $s.Replace('\','\\').Replace('"','\"').Replace("`r","").Replace("`n",' ').Trim()
}

$ErrorActionPreference = 'Stop'
try {
    Write-Log "=== START update_merged.ps1 ==="

    Write-Log "Fetching Customer sheet..."
    $custText = (Invoke-WebRequest -Uri $CUST_URL -UseBasicParsing -TimeoutSec 60).Content
    $custRows = Parse-CsvText $custText
    $customers = [System.Collections.Generic.List[hashtable]]::new()
    for ($i = 1; $i -lt $custRows.Count; $i++) {
        $r = $custRows[$i]
        if ($r.Length -lt 2) { continue }
        $code = $r[1].Trim(); $name = $r[0].Trim()
        if (-not $code -and -not $name) { continue }
        $route  = if ($r.Length -gt 11) { $r[11].Trim() } else { '' }
        $seller = if ($r.Length -gt 13) { $r[13].Trim() } else { '' }
        $customers.Add(@{ c=$code; n=$name; r=$route; s=$seller })
    }
    Write-Log "Customer: $($customers.Count) rows"

    Write-Log "Fetching BP sheet..."
    $bpText = (Invoke-WebRequest -Uri $BP_URL -UseBasicParsing -TimeoutSec 120).Content
    $bpRows = Parse-CsvText $bpText
    $salesMap = @{}
    for ($i = 1; $i -lt $bpRows.Count; $i++) {
        $r = $bpRows[$i]
        if ($r.Length -lt 14) { continue }
        $code = $r[2].Trim(); $val = 0.0
        [double]::TryParse($r[13], [ref]$val) | Out-Null
        if ($code) { $salesMap[$code] = ($salesMap[$code] -as [double]) + $val }
    }
    Write-Log "BP Sales: $($salesMap.Count) codes"

    $avgMap = @{}
    if (Test-Path $AVG3M_CSV) {
        $avgRows = Parse-CsvText ([System.IO.File]::ReadAllText($AVG3M_CSV, [System.Text.UTF8Encoding]::new($false)))
        for ($i = 1; $i -lt $avgRows.Count; $i++) {
            $r = $avgRows[$i]; if ($r.Length -lt 3) { continue }
            $code = $r[0].Trim(); $val = 0.0
            [double]::TryParse($r[2], [ref]$val) | Out-Null
            if ($code) { $avgMap[$code] = $val }
        }
        Write-Log "avg3m: $($avgMap.Count) codes"
    } else {
        Write-Log "bq_avg3m.csv not found, avg3m=0"
    }

    Write-Log "Merging..."
    $sb    = [System.Text.StringBuilder]::new()
    $null  = $sb.Append("window.MERGED_DATA=[")
    $first = $true
    foreach ($c in $customers) {
        $code  = $c.c
        $sales = if ($salesMap.ContainsKey($code)) { [Math]::Round($salesMap[$code], 2) } else { 0 }
        $avg3m = if ($avgMap.ContainsKey($code))   { [Math]::Round($avgMap[$code],   2) } else { 0 }
        $obj   = '{"c":"' + (EscJs $code) + '","n":"' + (EscJs $c.n) + '","r":"' +
                 (EscJs $c.r) + '","s":"' + (EscJs $c.s) + '","v":' + $sales + ',"a":' + $avg3m + '}'
        if (-not $first) { $null = $sb.Append(",") }
        $null = $sb.Append($obj)
        $first = $false
    }
    $null = $sb.Append("];")

    $jsContent = $sb.ToString()
    [System.IO.File]::WriteAllText($OUT_FILE, $jsContent, [System.Text.UTF8Encoding]::new($false))
    $sizeKB = [int]((Get-Item $OUT_FILE).Length / 1024)
    Write-Log "Done: $($customers.Count) rows -> $OUT_FILE ($sizeKB KB)"

    # embed inline into HTML files
    $patternMD = '(?s)<script>\s*window\.MERGED_DATA=\[.*?\];\s*</script>'
    $inlineMD  = "<script>`n$jsContent`n</script>"
    foreach ($HTML_FILE in @("D:\New\rattana-low-sales.html", "D:\New\rattana-sales-dashboard.html")) {
      if (Test-Path $HTML_FILE) {
        $html    = [System.IO.File]::ReadAllText($HTML_FILE, [System.Text.UTF8Encoding]::new($false))
        $newHtml = [System.Text.RegularExpressions.Regex]::Replace($html, $patternMD, $inlineMD)
        [System.IO.File]::WriteAllText($HTML_FILE, $newHtml, [System.Text.UTF8Encoding]::new($false))
        $htmlKB = [int]((Get-Item $HTML_FILE).Length / 1024)
        Write-Log "HTML updated: $HTML_FILE ($htmlKB KB)"
      }
    }
    # embed USER_MAP inline into HTML
    Write-Log "Fetching Rattana Users sheet..."
    $usersText = (Invoke-WebRequest -Uri $USERS_URL -UseBasicParsing -TimeoutSec 30).Content
    $usersRows = Parse-CsvText $usersText
    $userMapSb = [System.Text.StringBuilder]::new()
    $null = $userMapSb.Append("window.USER_MAP={")
    $firstU = $true
    for ($i = 1; $i -lt $usersRows.Count; $i++) {
        $r = $usersRows[$i]
        if ($r.Length -lt 30) { continue }
        $code = $r[29].Trim()   # รหัสเซลล์
        $name = $r[4].Trim()    # ชื่อ - สกุล
        if (-not $code) { continue }
        if (-not $firstU) { $null = $userMapSb.Append(",") }
        $null = $userMapSb.Append('"' + (EscJs $code.ToUpper()) + '":"' + (EscJs $name) + '"')
        $firstU = $false
    }
    $null = $userMapSb.Append("};")
    $userMapJs = $userMapSb.ToString()

    if (Test-Path $HTML_FILE) {
        $html2 = [System.IO.File]::ReadAllText($HTML_FILE, [System.Text.UTF8Encoding]::new($false))
        $inlineU  = "<script>`n$userMapJs`n</script>"
        $patternU = '(?s)<script>\s*window\.USER_MAP=\{.*?\};\s*</script>'
        $html2    = [System.Text.RegularExpressions.Regex]::Replace($html2, $patternU, $inlineU)
        [System.IO.File]::WriteAllText($HTML_FILE, $html2, [System.Text.UTF8Encoding]::new($false))
        Write-Log "USER_MAP embedded: $($usersRows.Count - 1) users"
    }

    Write-Log "=== SUCCESS ==="
    exit 0
} catch {
    Write-Log "ERROR: $_"
    exit 1
}