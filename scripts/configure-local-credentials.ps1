$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot 'backend/.env'

function Read-HiddenValue([string]$Prompt) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        $secure.Dispose()
    }
}

Write-Host 'This saves credentials only to backend/.env on this computer. Input is hidden.'
$projectId = Read-Host 'Google Cloud project ID (not a secret)'
$geminiKey = Read-HiddenValue 'Gemini API key'
$serviceJson = Read-HiddenValue 'Paste the complete Earth Engine service-account JSON on one line'

if ([string]::IsNullOrWhiteSpace($projectId) -or [string]::IsNullOrWhiteSpace($geminiKey) -or [string]::IsNullOrWhiteSpace($serviceJson)) {
    throw 'A required value was empty. No credentials were saved.'
}

try {
    $serviceInfo = $serviceJson | ConvertFrom-Json
}
catch {
    throw 'The service-account input is not valid JSON. No credentials were saved.'
}
if ([string]::IsNullOrWhiteSpace([string]$serviceInfo.client_email) -or [string]::IsNullOrWhiteSpace([string]$serviceInfo.private_key)) {
    throw 'The service-account JSON is missing required identity or key fields. No credentials were saved.'
}
if ($serviceInfo.project_id -and $serviceInfo.project_id -ne $projectId) {
    throw 'The service-account JSON project ID differs from the project ID entered. No credentials were saved.'
}

# Normalize and quote JSON as one dotenv line. Service-account private keys and API
# keys never go to the console. Preserve unrelated settings already in backend/.env.
$compactJson = $serviceInfo | ConvertTo-Json -Depth 30 -Compress
$updates = [ordered]@{
    GEMINI_API_KEY = $geminiKey
    EE_PROJECT_ID = $projectId
    EE_SERVICE_ACCOUNT_KEY_JSON = $compactJson
}
$content = if (Test-Path -LiteralPath $envPath) { [IO.File]::ReadAllText($envPath) } else { '' }
foreach ($name in $updates.Keys) {
    $value = [string]$updates[$name]
    $encoded = "'" + $value.Replace("'", "\'") + "'"
    $line = [regex]::Escape($name) + '=.*'
    if ([regex]::IsMatch($content, "(?m)^$line$")) {
        $replacement = "$name=$encoded"
        $content = [regex]::Replace($content, "(?m)^$line$", [Text.RegularExpressions.MatchEvaluator]{ param($match) $replacement })
    }
    else {
        $content = $content.TrimEnd() + "`n$name=$encoded`n"
    }
}
[IO.File]::WriteAllText($envPath, $content, [Text.UTF8Encoding]::new($false))
$geminiKey = $null
$serviceJson = $null
$compactJson = $null
$serviceInfo = $null
Write-Host 'Local credentials saved to backend/.env. Values were not displayed.'
Write-Host 'Restart the backend, then check GET http://localhost:8000/api/earth-engine/status.'
