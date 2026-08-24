<#
  get-farsi-audio.ps1
  Downloads the free companion files for:
    Reading & Writing Farsi (Persian): A Workbook for Self-Study
    Pegah Vil & Amir Hossein Ahooie, Tuttle Publishing, ISBN 9780804852890

  Grabs 187 audio tracks, the printable flash cards PDF, and the answer key PDF,
  then writes an audio-index.json manifest the Language Hub can read.

  HOW TO RUN
    1. Save this file to C:\Projects\dev-team\
    2. Open PowerShell.
    3. Type this and press Enter:
         cd C:\Projects\dev-team
    4. Type this and press Enter:
         powershell -ExecutionPolicy Bypass -File .\get-farsi-audio.ps1
    5. Wait. It prints a line per file. Roughly 5-15 minutes.

  Safe to re-run. Files that already downloaded are skipped, so if your
  connection drops, just run it again and it picks up where it left off.
#>

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # much faster downloads

$Root    = "C:\Projects\dev-team\data\curriculum\fa"
$AudioIn = Join-Path $Root "audio\tuttle-rw-farsi"
$DocsIn  = Join-Path $Root "docs"
$Base    = "https://www.tuttlepublishing.com/content/docs/9780804852890"

New-Item -ItemType Directory -Force -Path $AudioIn | Out-Null
New-Item -ItemType Directory -Force -Path $DocsIn  | Out-Null

# ---------------------------------------------------------------
# Build the full download list
# ---------------------------------------------------------------
$S1 = "Introduction%20%26%20Section%201%20audios"
$S2 = "section%202%20audios"
$S3 = "Section%203%20audios"
$S4 = "Section%204%20audios"

$items = New-Object System.Collections.Generic.List[object]

function Add-Track($track, $folder, $file) {
    $items.Add([pscustomobject]@{
        Track = $track
        Url   = "$Base/Audios/$folder/$file"
        Name  = "$track.mp3"
    })
}

# Introduction (1 track)
Add-Track "I-01" $S1 "I-01_edited.mp3"

# Section 1 - the alphabet overview (7 tracks)
1..7   | ForEach-Object { $n = "{0:00}" -f $_; Add-Track "A01-$n" $S1 "A01-${n}_edited.mp3" }

# Section 2 - reading and writing the alphabet (134 tracks, the bulk of the book)
1..134 | ForEach-Object { $n = "{0:00}" -f $_; Add-Track "A02-$n" $S2 "A02-${n}_edited.mp3" }

# Section 3 - reading and writing practice (24 tracks)
1..24  | ForEach-Object { $n = "{0:00}" -f $_; Add-Track "A03-$n" $S3 "A03-${n}_edited.mp3" }

# Section 4 - basic sentences and grammar (21 tracks)
1..21  | ForEach-Object { $n = "{0:00}" -f $_; Add-Track "A04-$n" $S4 "A04-${n}_edited.mp3" }

Write-Host ""
Write-Host "Reading & Writing Farsi - companion files" -ForegroundColor Cyan
Write-Host "$($items.Count) audio tracks + 2 PDFs" -ForegroundColor Cyan
Write-Host "Saving to $AudioIn" -ForegroundColor DarkGray
Write-Host ""

# ---------------------------------------------------------------
# Download with retry
# ---------------------------------------------------------------
function Get-FileWithRetry($url, $outPath, $label) {
    if (Test-Path $outPath) {
        $size = (Get-Item $outPath).Length
        if ($size -gt 1024) { Write-Host "  skip    $label (already have it)" -ForegroundColor DarkGray; return "skipped" }
        Remove-Item $outPath -Force        # zero-byte leftover from a failed run
    }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -Uri $url -OutFile $outPath -UseBasicParsing -TimeoutSec 60
            Write-Host "  ok      $label" -ForegroundColor Green
            return "ok"
        } catch {
            if ($attempt -eq 3) {
                Write-Host "  FAILED  $label  ($($_.Exception.Message))" -ForegroundColor Red
                if (Test-Path $outPath) { Remove-Item $outPath -Force }
                return "failed"
            }
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
}

$ok = 0; $skipped = 0; $failed = @()

foreach ($item in $items) {
    $out = Join-Path $AudioIn $item.Name
    switch (Get-FileWithRetry $item.Url $out $item.Track) {
        "ok"      { $ok++ }
        "skipped" { $skipped++ }
        "failed"  { $failed += $item.Track }
    }
}

# ---------------------------------------------------------------
# The two PDFs
# ---------------------------------------------------------------
Write-Host ""
$pdfs = @(
    @{ Url = "$Base/Flash%20Cards/Online%20Flashcard_Read%20%26%20Write%20Farsi.pdf"; Name = "flash-cards.pdf";  Label = "flash cards" },
    @{ Url = "$Base/Answer%20Key/RW%20Farsi_Answer%20Online.pdf";                     Name = "answer-key.pdf";   Label = "answer key"  }
)
foreach ($p in $pdfs) {
    $out = Join-Path $DocsIn $p.Name
    switch (Get-FileWithRetry $p.Url $out $p.Label) {
        "ok"      { $ok++ }
        "skipped" { $skipped++ }
        "failed"  { $failed += $p.Label }
    }
}

# ---------------------------------------------------------------
# Manifest for the Language Hub
# ---------------------------------------------------------------
$manifest = [ordered]@{
    book        = "Reading & Writing Farsi (Persian): A Workbook for Self-Study"
    isbn        = "9780804852890"
    generatedOn = (Get-Date -Format "yyyy-MM-dd")
    audioPath   = "audio/tuttle-rw-farsi/"
    sections    = [ordered]@{
        introduction = @("I-01")
        section1     = (1..7   | ForEach-Object { "A01-{0:00}" -f $_ })
        section2     = (1..134 | ForEach-Object { "A02-{0:00}" -f $_ })
        section3     = (1..24  | ForEach-Object { "A03-{0:00}" -f $_ })
        section4     = (1..21  | ForEach-Object { "A04-{0:00}" -f $_ })
    }
    tracks      = @{}
}
Get-ChildItem $AudioIn -Filter *.mp3 | Sort-Object Name | ForEach-Object {
    $manifest.tracks[$_.BaseName] = $_.Name
}
$manifestPath = Join-Path $Root "audio-index.json"
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding UTF8

# ---------------------------------------------------------------
# Summary
# ---------------------------------------------------------------
Write-Host ""
Write-Host "-----------------------------------------" -ForegroundColor Cyan
Write-Host "Downloaded : $ok"      -ForegroundColor Green
Write-Host "Already had: $skipped" -ForegroundColor DarkGray
if ($failed.Count -gt 0) {
    Write-Host "Failed     : $($failed.Count)" -ForegroundColor Red
    Write-Host "  $($failed -join ', ')" -ForegroundColor Red
    Write-Host "  Run this script again to retry just those." -ForegroundColor Yellow
} else {
    Write-Host "Failed     : 0" -ForegroundColor Green
}
Write-Host ""
Write-Host "Audio     -> $AudioIn"   -ForegroundColor DarkGray
Write-Host "PDFs      -> $DocsIn"    -ForegroundColor DarkGray
Write-Host "Manifest  -> $manifestPath" -ForegroundColor DarkGray
Write-Host "-----------------------------------------" -ForegroundColor Cyan
Write-Host ""
