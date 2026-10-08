# Source/resources stay in Codex; both development and portable use one data home.
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskHomeFile = Join-Path $taskRoot '.local\development-data-home.txt'
if (-not (Test-Path -LiteralPath $taskHomeFile)) { throw 'Development data home has not been configured.' }
$taskPrevious = $env:NOZEOMICS_HOME
try {
    $env:NOZEOMICS_HOME = (Get-Content -LiteralPath $taskHomeFile -Encoding UTF8 -Raw).Trim()
    $taskConnection = Join-Path $env:NOZEOMICS_HOME 'connection.json'
    if (Test-Path -LiteralPath $taskConnection) {
        $taskPortable = Join-Path (Split-Path -Parent $env:NOZEOMICS_HOME) 'NozeOmics.exe'
        if (-not (Test-Path -LiteralPath $taskPortable)) { throw 'Quit the current NozeOmics before opening the development build.' }
        Start-Process -FilePath $taskPortable -ArgumentList '--quit' -Environment @{ NOZEOMICS_HOME = $env:NOZEOMICS_HOME } -WindowStyle Hidden -Wait
        for ($taskAttempt = 0; $taskAttempt -lt 150 -and (Test-Path -LiteralPath $taskConnection); $taskAttempt++) {
            Start-Sleep -Milliseconds 100
        }
        if (Test-Path -LiteralPath $taskConnection) { throw 'The current NozeOmics has not finished quitting.' }
    }
    $taskExe = Join-Path $taskRoot 'release\NozeOmics-win32-x64\NozeOmics.exe'
    Start-Process -FilePath $taskExe -WorkingDirectory (Split-Path -Parent $taskExe) -Environment @{ NOZEOMICS_HOME = $env:NOZEOMICS_HOME } -WindowStyle Hidden
} finally {
    $env:NOZEOMICS_HOME = $taskPrevious
}
