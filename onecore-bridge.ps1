# Offline bridge to Windows.Media.SpeechSynthesis (OneCore voices).
# Protocol: one JSON object per line on stdin, one JSON object per line on stdout.
#   {"id":1,"cmd":"list"}
#   {"id":2,"cmd":"synth","voiceId":"...","textB64":"<utf-8 base64>","outPath":"C:\\...\\x.wav"}
# Everything runs locally; this script never touches the network.

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Media.Core.SpeechCue, Windows.Media.Core, ContentType = WindowsRuntime]

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
                   $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } |
    Select-Object -First 1

function Wait-WinRT($op, [Type]$resultType) {
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
    $null = $task.Wait(-1)
    return $task.Result
}

$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$synth.Options.IncludeWordBoundaryMetadata = $true
$voices = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices

function Send($obj) {
    [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 5))
    [Console]::Out.Flush()
}

Send @{ id = 0; ready = $true }

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim() -eq '') { continue }
    $req = $null
    try {
        $req = $line | ConvertFrom-Json
        switch ($req.cmd) {
            'list' {
                $list = @($voices | ForEach-Object {
                    @{ id = $_.Id; name = $_.DisplayName; lang = $_.Language; gender = "$($_.Gender)" }
                })
                Send @{ id = $req.id; ok = $true; voices = $list }
            }
            'synth' {
                $text = $utf8.GetString([Convert]::FromBase64String($req.textB64))
                $voice = $voices | Where-Object { $_.Id -eq $req.voiceId } | Select-Object -First 1
                if ($null -eq $voice) { throw "Voice not found: $($req.voiceId)" }
                $synth.Voice = $voice
                $stream = Wait-WinRT ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])

                $fs = [System.IO.File]::Create($req.outPath)
                try {
                    $src = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
                    $src.CopyTo($fs)
                } finally { $fs.Dispose() }

                $cues = @()
                foreach ($track in $stream.TimedMetadataTracks) {
                    foreach ($cue in $track.Cues) {
                        $sc = [Windows.Media.Core.SpeechCue]$cue
                        if ($null -ne $sc.StartPositionInInput) {
                            $cues += , @([math]::Round($sc.StartTime.TotalMilliseconds),
                                        [int]$sc.StartPositionInInput,
                                        [int]$sc.EndPositionInInput)
                        }
                    }
                }
                $stream.Dispose()
                Send @{ id = $req.id; ok = $true; cues = $cues }
            }
            default { throw "Unknown command: $($req.cmd)" }
        }
    } catch {
        $rid = if ($req) { $req.id } else { -1 }
        Send @{ id = $rid; ok = $false; error = "$($_.Exception.Message)" }
    }
}
