param(
    [string]$MakeAppx = "",
    [string]$Version = "0.21.1",
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$layout = Join-Path $root "artifacts\msix-layout"
$publish = Join-Path $root "artifacts\msix-publish"
$output = Join-Path $root "artifacts\OC-editor-$Version.msix"

if (-not $MakeAppx) {
    $candidates = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter makeappx.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending
    if ($candidates) { $MakeAppx = $candidates[0].FullName }
}
if (-not $MakeAppx -or -not (Test-Path $MakeAppx)) {
    throw "找不到 makeappx.exe，请用 -MakeAppx 指定路径（Windows SDK 或 Microsoft.Windows.SDK.BuildTools）。"
}

foreach ($dir in @($layout, $publish)) {
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
New-Item -ItemType Directory -Force -Path (Split-Path $output) | Out-Null

Write-Host "publish app (single file, compressed)..."
dotnet publish (Join-Path $root "portable\OCEditor.Launcher\OCEditor.Launcher.csproj") `
    -c $Configuration -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true -p:DebugType=None `
    -o $publish | Out-Host

Copy-Item (Join-Path $publish "OCeditor.exe") $layout -Force
Copy-Item (Join-Path $publish "wwwroot") $layout -Recurse -Force
Copy-Item (Join-Path $PSScriptRoot "Assets") $layout -Recurse -Force

# 清单里的版本号以参数为准，避免忘记改。
$manifest = Get-Content (Join-Path $PSScriptRoot "AppxManifest.xml") -Raw -Encoding UTF8
# 只替换 Identity 的四段式 Version，不能误伤 MinVersion/MaxVersionTested。
$manifest = $manifest -replace '(?<!Min)Version="\d+\.\d+\.\d+\.\d+"', "Version=`"$Version.0`""
[System.IO.File]::WriteAllText((Join-Path $layout "AppxManifest.xml"), $manifest, (New-Object System.Text.UTF8Encoding($false)))

if (Test-Path $output) { Remove-Item $output -Force }
Write-Host "pack msix..."
& $MakeAppx pack /d $layout /p $output /o | Out-Host
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $output)) {
    throw "makeappx pack 失败"
}

$size = [math]::Round((Get-Item $output).Length / 1MB, 1)
Write-Host "done: $output ($size MB)"
Write-Host "上传到 Partner Center 的「包」页面即可；商店会在提交时签名。"
