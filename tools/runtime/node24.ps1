param(
  [switch]$Install,
  [switch]$Node,
  [string[]]$Arguments = @('--version')
)

$ErrorActionPreference = 'Stop'
$taskVersion = '24.22.3'
$taskArchiveName = "node-v$taskVersion-win-x64.zip"
$taskToolsRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'LivioTools/node'))
$taskRuntime = [System.IO.Path]::GetFullPath((Join-Path $taskToolsRoot "node-v$taskVersion-win-x64"))
if (-not $taskRuntime.StartsWith($taskToolsRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Runtime directory outside the managed tools root'
}
$taskExecutable = Join-Path $taskRuntime 'node.exe'
if (-not (Test-Path -LiteralPath $taskExecutable)) {
  if (-not $Install) { throw 'Portable Node is missing. Run tools/runtime/node24.ps1 -Install first.' }
  if (Test-Path -LiteralPath $taskRuntime) { throw 'Runtime destination already exists; no files overwritten.' }
  $taskDownload = Join-Path ([System.IO.Path]::GetTempPath()) ('livio-node-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $taskDownload | Out-Null
  $taskBaseUrl = "https://nodejs.org/dist/v$taskVersion"
  $taskChecksums = (Invoke-WebRequest -UseBasicParsing -Uri "$taskBaseUrl/SHASUMS256.txt").Content
  $taskChecksumLine = @($taskChecksums -split "`n" | Where-Object { $_.Trim().EndsWith(" $taskArchiveName") })
  if ($taskChecksumLine.Count -ne 1) { throw 'Official archive checksum is ambiguous or missing' }
  $taskExpectedHash = ($taskChecksumLine[0].Trim() -split '\s+')[0]
  $taskArchive = Join-Path $taskDownload $taskArchiveName
  Invoke-WebRequest -UseBasicParsing -Uri "$taskBaseUrl/$taskArchiveName" -OutFile $taskArchive
  if ((Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash -ne $taskExpectedHash) {
    throw 'Official Node archive checksum mismatch'
  }
  Expand-Archive -LiteralPath $taskArchive -DestinationPath $taskDownload
  New-Item -ItemType Directory -Path $taskToolsRoot -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $taskDownload "node-v$taskVersion-win-x64") -Destination $taskRuntime -Recurse
}
if ((& $taskExecutable --version) -ne "v$taskVersion") { throw 'Unexpected portable Node version' }
$taskOriginalPath = $env:PATH
try {
  $env:PATH = $taskRuntime + ';' + $taskOriginalPath
  $taskProcessArguments = @($Arguments)
  if (-not $Node) {
    $taskProcessArguments = @((Join-Path $taskRuntime 'node_modules/npm/bin/npm-cli.js')) + $taskProcessArguments
  }
  # Windows PowerShell 5 loses embedded quotes with native argument arrays.
  # Launch node directly, without cmd.exe, and encode Windows argv explicitly.
  $taskEncodedArguments = @($taskProcessArguments | ForEach-Object {
    $taskQuotedValue = [regex]::Replace([string]$_, '(\\*)"', '$1$1\"')
    $taskQuotedValue = [regex]::Replace($taskQuotedValue, '(\\+)$', '$1$1')
    '"' + $taskQuotedValue + '"'
  })
  if (-not ('LivioNodeProcess' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Text;
public static class LivioNodeProcess {
  public static int Run(string executable, string arguments, string directory) {
    using (var child = new Process()) {
      child.StartInfo = new ProcessStartInfo(executable, arguments) {
        WorkingDirectory = directory,
        UseShellExecute = false,
        CreateNoWindow = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        StandardOutputEncoding = Encoding.UTF8,
        StandardErrorEncoding = Encoding.UTF8
      };
      child.OutputDataReceived += (sender, line) => { if (line.Data != null) Console.Out.WriteLine(line.Data); };
      child.ErrorDataReceived += (sender, line) => { if (line.Data != null) Console.Error.WriteLine(line.Data); };
      child.Start();
      child.BeginOutputReadLine();
      child.BeginErrorReadLine();
      child.WaitForExit();
      return child.ExitCode;
    }
  }
}
'@
  }
  $taskExitCode = [LivioNodeProcess]::Run($taskExecutable, ($taskEncodedArguments -join ' '), (Get-Location).Path)
} finally {
  $env:PATH = $taskOriginalPath
}
exit $taskExitCode
