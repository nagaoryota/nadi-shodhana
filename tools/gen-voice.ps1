# Voice guide synthesis via Windows SAPI.
#
# IMPORTANT: this file must stay ASCII-only. Windows PowerShell 5.1 reads a
# BOM-less script as ANSI, so any non-ASCII character here (even in a comment)
# corrupts parsing. All spoken text lives in voice-phrases.json, which is read
# explicitly as UTF-8.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/gen-voice.ps1
#
# Output: tools/build/<lang>/<name>.wav

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$json = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'voice-phrases.json') | ConvertFrom-Json

# Slightly slower than default for a calmer delivery. English is left at the
# default rate because the sentences are longer and must fit the 3s prep step.
$voices = @{ ja = 'Microsoft Haruka Desktop'; en = 'Microsoft Zira Desktop' }
$rates  = @{ ja = -1; en = 0 }

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

foreach ($lang in @('ja','en')) {
    $dir = Join-Path $root ('build/' + $lang)
    New-Item -ItemType Directory -Force -Path $dir | Out-Null

    $synth.SelectVoice($voices[$lang])
    $synth.Rate = $rates[$lang]
    $synth.Volume = 100

    foreach ($p in $json.$lang.PSObject.Properties) {
        $out = Join-Path $dir ($p.Name + '.wav')
        $synth.SetOutputToWaveFile($out)
        $synth.Speak($p.Value)
        $synth.SetOutputToNull()
        Write-Output ('  ' + $lang + '/' + $p.Name + '.wav')
    }
}

$synth.Dispose()
Write-Output 'done'
