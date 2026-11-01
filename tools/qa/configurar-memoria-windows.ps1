[CmdletBinding()]
param(
  [ValidateSet('Diagnostico', 'Configurar', 'Testar')]
  [string]$Acao = 'Diagnostico',
  [switch]$ElevatedChild
)

$ErrorActionPreference = 'Stop'
$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:TestResults = [System.Collections.Generic.List[object]]::new()

function Get-MemorySnapshot {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem
  $computer = Get-CimInstance -ClassName Win32_ComputerSystem
  $pageUsage = @(Get-CimInstance -ClassName Win32_PageFileUsage -ErrorAction SilentlyContinue)
  $pageSettings = @(Get-CimInstance -ClassName Win32_PageFileSetting -ErrorAction SilentlyContinue)
  $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'"
  $memoryKey = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management'

  $committedKB = [math]::Max(0, [double]$os.TotalVirtualMemorySize - [double]$os.FreeVirtualMemory)
  $topProcesses = @(Get-Process -ErrorAction SilentlyContinue |
    Sort-Object -Property WorkingSet64 -Descending |
    Select-Object -First 15 @{Name='Name';Expression={$_.ProcessName}},
      @{Name='PID';Expression={$_.Id}},
      @{Name='WorkingSetMB';Expression={[math]::Round($_.WorkingSet64 / 1MB)}},
      @{Name='PrivateMB';Expression={[math]::Round($_.PrivateMemorySize64 / 1MB)}})

  $projectNeedle = $script:RepoRoot.TrimEnd('\')
  $specialProcesses = @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -match '^(node|chrome|chromium|ms-playwright).*\.exe$' -or
      $_.CommandLine -match '(?i)vitest|playwright|controle-livio'
    } | ForEach-Object {
      $process = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
      [pscustomobject]@{
        Name = $_.Name
        PID = $_.ProcessId
        ParentPID = $_.ParentProcessId
        WorkingSetMB = if ($process) { [math]::Round($process.WorkingSet64 / 1MB) } else { $null }
        PrivateMB = if ($process) { [math]::Round($process.PrivateMemorySize64 / 1MB) } else { $null }
        Started = if ($process) { $process.StartTime } else { $null }
        IsLivioProcess = [bool]($_.CommandLine -and $_.CommandLine.IndexOf($projectNeedle, [StringComparison]::OrdinalIgnoreCase) -ge 0)
        IsTestProcess = [bool]($_.CommandLine -match '(?i)vitest|playwright')
      }
    })

  [pscustomobject]@{
    CapturedAt = Get-Date
    RamTotalMB = [math]::Round([double]$computer.TotalPhysicalMemory / 1MB)
    RamAvailableMB = [math]::Round([double]$os.FreePhysicalMemory / 1KB)
    CommitMB = [math]::Round($committedKB / 1KB)
    CommitLimitMB = [math]::Round([double]$os.TotalVirtualMemorySize / 1KB)
    CommitAvailableMB = [math]::Round([double]$os.FreeVirtualMemory / 1KB)
    AutomaticManagedPagefile = [bool]$computer.AutomaticManagedPagefile
    PageFileUsage = $pageUsage
    PageFileSettings = $pageSettings
    PagingFilesRegistry = @($memoryKey.PagingFiles)
    CFreeGB = [math]::Round([double]$disk.FreeSpace / 1GB, 2)
    TopProcesses = $topProcesses
    NodeAndBrowserProcesses = $specialProcesses
  }
}

function Format-PageFileState {
  param([Parameter(Mandatory)]$Snapshot)

  if ($Snapshot.PageFileSettings.Count -gt 0) {
    return @($Snapshot.PageFileSettings | ForEach-Object {
      if ([int64]$_.InitialSize -eq 0 -and [int64]$_.MaximumSize -eq 0) {
        '{0}: tamanho gerenciado pelo sistema (WMI 0/0)' -f $_.Name
      } else {
        '{0}: inicial {1} MB, máximo {2} MB' -f $_.Name, $_.InitialSize, $_.MaximumSize
      }
    }) -join '; '
  }

  if ($Snapshot.AutomaticManagedPagefile) { return 'Gerenciado automaticamente pelo Windows' }
  return 'Nenhuma configuração Win32_PageFileSetting encontrada'
}

function Show-Diagnostics {
  $snapshot = Get-MemorySnapshot
  $pageUsageText = if ($snapshot.PageFileUsage.Count -gt 0) {
    @($snapshot.PageFileUsage | ForEach-Object {
      '{0}: alocado {1} MB, em uso {2} MB, pico {3} MB' -f $_.Name, $_.AllocatedBaseSize, $_.CurrentUsage, $_.PeakUsage
    }) -join '; '
  } else { 'Nenhum arquivo de paginação ativo reportado pelo Windows' }

  [pscustomobject]@{
    MedidoEm = $snapshot.CapturedAt.ToString('yyyy-MM-dd HH:mm:ss zzz')
    RAMFisicaTotalMB = $snapshot.RamTotalMB
    RAMFisicaDisponivelMB = $snapshot.RamAvailableMB
    MemoriaComprometidaMB = $snapshot.CommitMB
    LimiteDeCommitMB = $snapshot.CommitLimitMB
    CommitDisponivelMB = $snapshot.CommitAvailableMB
    GerenciamentoAutomaticoGlobal = $snapshot.AutomaticManagedPagefile
    ConfiguracaoPagefile = Format-PageFileState -Snapshot $snapshot
    UsoAtualPagefile = $pageUsageText
    PagingFilesRegistro = ($snapshot.PagingFilesRegistry -join '; ')
    CLivreGB = $snapshot.CFreeGB
  } | Format-List

  Write-Host 'Maiores consumidores de memória (working set / memória privada, MiB):' -ForegroundColor Cyan
  $snapshot.TopProcesses | Format-Table -AutoSize
  Write-Host 'Processos Node, Playwright e Chromium/Chrome (sem imprimir linhas de comando):' -ForegroundColor Cyan
  if ($snapshot.NodeAndBrowserProcesses.Count -gt 0) {
    $snapshot.NodeAndBrowserProcesses | Format-Table Name, PID, ParentPID, WorkingSetMB, PrivateMB, IsLivioProcess, IsTestProcess -AutoSize
  } else {
    Write-Host 'Nenhum processo correspondente encontrado.'
  }

  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  $playwright = Join-Path $script:RepoRoot 'node_modules\.bin\playwright.cmd'
  $vitest = Join-Path $script:RepoRoot 'node_modules\.bin\vitest.cmd'
  Write-Host ('Node: {0}' -f $(if ($node) { $node.Source } else { 'indisponível' }))
  Write-Host ('npm.cmd: {0}' -f $(if ($npm) { $npm.Source } else { 'indisponível' }))
  Write-Host ('Playwright local: {0}' -f (Test-Path -LiteralPath $playwright))
  Write-Host ('Vitest local: {0}' -f (Test-Path -LiteralPath $vitest))
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Save-OriginalPageFileState {
  param([Parameter(Mandatory)]$Snapshot)

  $stateDirectory = Join-Path $env:LOCALAPPDATA 'LivioQA\Pagefile'
  New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
  $stateFile = Join-Path $stateDirectory ('original-{0}.json' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  $computer = Get-CimInstance -ClassName Win32_ComputerSystem
  $record = [pscustomobject]@{
    CapturedAt = $Snapshot.CapturedAt.ToString('o')
    AutomaticManagedPagefile = [bool]$computer.AutomaticManagedPagefile
    PageFileSettings = @($Snapshot.PageFileSettings | Select-Object Name, InitialSize, MaximumSize)
    PagingFilesRegistry = @($Snapshot.PagingFilesRegistry)
    PageFileUsage = @($Snapshot.PageFileUsage | Select-Object Name, AllocatedBaseSize, CurrentUsage, PeakUsage)
    CFreeGB = $Snapshot.CFreeGB
  }
  $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $stateFile -Encoding UTF8
  return $stateFile
}

function Request-UacConfiguration {
  $powershell = Join-Path $PSHOME 'powershell.exe'
  $quotedScript = '"{0}"' -f $PSCommandPath
  $argumentLine = '-NoProfile -File {0} -Acao Configurar -ElevatedChild' -f $quotedScript
  try {
    Write-Host 'Abrindo a solicitação normal de elevação UAC para configurar o pagefile...' -ForegroundColor Yellow
    $child = Start-Process -FilePath $powershell -Verb RunAs -ArgumentList $argumentLine -Wait -PassThru
    if ($child.ExitCode -ne 0) { throw "A configuração elevada terminou com código $($child.ExitCode)." }
  } catch {
    Write-Warning ('A elevação não foi concluída; nada foi alterado. Detalhe: {0}' -f $_.Exception.Message)
  }
}

function Invoke-PageFileConfiguration {
  $snapshot = Get-MemorySnapshot
  $activeC = @($snapshot.PageFileUsage | Where-Object { $_.Name -match '^(?i)C:\\pagefile\.sys$' }) | Select-Object -First 1
  $settingC = @($snapshot.PageFileSettings | Where-Object { $_.Name -match '^(?i)C:\\pagefile\.sys$' }) | Select-Object -First 1
  $explicitLargeSetting = @($snapshot.PageFileSettings | Where-Object { [int64]$_.MaximumSize -gt 14336 })
  $commitFreeGB = $snapshot.CommitAvailableMB / 1024

  if ($snapshot.AutomaticManagedPagefile) {
    Write-Host 'Configuração preservada: o Windows já gerencia automaticamente a paginação.' -ForegroundColor Green
    return 'NOT_NEEDED'
  }
  if ($explicitLargeSetting.Count -gt 0) {
    Write-Host 'Configuração preservada: existe pagefile com máximo maior que 14 GiB; não será reduzido.' -ForegroundColor Green
    return 'NOT_NEEDED'
  }
  if ($commitFreeGB -ge 2 -and $activeC -and $activeC.AllocatedBaseSize -ge 8192) {
    Write-Host ('Configuração preservada: C: já tem {0} MiB alocados e há {1:N2} GiB de margem de commit.' -f $activeC.AllocatedBaseSize, $commitFreeGB) -ForegroundColor Green
    return 'NOT_NEEDED'
  }
  if ($snapshot.CFreeGB -lt 32) {
    Write-Warning ('Configuração recusada: C: tem {0:N2} GiB livres; um máximo de 14 GiB não preservaria 18 GiB no pior caso.' -f $snapshot.CFreeGB)
    return 'BLOCKED'
  }
  if ($commitFreeGB -ge 2 -and $settingC -and [int64]$settingC.InitialSize -eq 0 -and [int64]$settingC.MaximumSize -eq 0) {
    Write-Host ('Configuração preservada: pagefile em C: está sem limite fixo explícito, alocou {0} MiB e há {1:N2} GiB de commit disponível.' -f $(if ($activeC) { $activeC.AllocatedBaseSize } else { 0 }), $commitFreeGB) -ForegroundColor Green
    return 'NOT_NEEDED'
  }

  if (-not (Test-IsAdministrator)) {
    if (-not $ElevatedChild) { Request-UacConfiguration }
    else { Write-Warning 'O processo elevado não recebeu privilégios administrativos; nenhuma mudança foi feita.' }
    return 'BLOCKED'
  }

  $existingAllocation = if ($activeC) { [int64]$activeC.AllocatedBaseSize } else { 0 }
  $targetMaxMB = [math]::Max(14336, $existingAllocation)
  if ($settingC -and [int64]$settingC.MaximumSize -gt 0) {
    if ([int64]$settingC.MaximumSize -gt $targetMaxMB) {
      Write-Host ('Configuração preservada: o máximo C: atual de {0} MiB é superior à referência.' -f $settingC.MaximumSize) -ForegroundColor Green
      return 'NOT_NEEDED'
    }
    $targetMaxMB = [math]::Max($targetMaxMB, [int64]$settingC.InitialSize)
  }
  $diskAfterWorstCaseGB = $snapshot.CFreeGB - ($targetMaxMB / 1024)
  if ($diskAfterWorstCaseGB -lt 18) {
    Write-Warning ('Configuração recusada: o pior caso deixaria {0:N2} GiB livres em C:.' -f $diskAfterWorstCaseGB)
    return 'BLOCKED'
  }

  $backupFile = Save-OriginalPageFileState -Snapshot $snapshot
  Write-Host ('Estado original salvo em: {0}' -f $backupFile) -ForegroundColor Cyan
  $targetInitialMB = [math]::Max(8192, $(if ($settingC) { [int64]$settingC.InitialSize } else { 0 }))
  $computer = Get-CimInstance -ClassName Win32_ComputerSystem
  if ($computer.AutomaticManagedPagefile) {
    Write-Warning 'O gerenciamento automático mudou durante a execução; alteração cancelada.'
    return 'BLOCKED'
  }
  if ($settingC) {
    Set-CimInstance -InputObject $settingC -Property @{ InitialSize = [uint32]$targetInitialMB; MaximumSize = [uint32]$targetMaxMB } | Out-Null
  } else {
    New-CimInstance -ClassName Win32_PageFileSetting -Property @{
      Name = 'C:\pagefile.sys'
      InitialSize = [uint32]$targetInitialMB
      MaximumSize = [uint32]$targetMaxMB
    } | Out-Null
  }

  $verifySetting = @(Get-CimInstance -ClassName Win32_PageFileSetting | Where-Object { $_.Name -match '^(?i)C:\\pagefile\.sys$' }) | Select-Object -First 1
  if (-not $verifySetting -or $verifySetting.InitialSize -ne $targetInitialMB -or $verifySetting.MaximumSize -ne $targetMaxMB) {
    throw 'O Windows não confirmou os novos limites do pagefile C:.'
  }
  Write-Host ('Configuração gravada e verificada: C: inicial {0} MiB, máximo {1} MiB. Reinicialização necessária para aplicar.' -f $targetInitialMB, $targetMaxMB) -ForegroundColor Yellow
  return 'REBOOT_REQUIRED'
}

function Get-AvailableMemoryMB {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem
  return [math]::Round([double]$os.FreePhysicalMemory / 1KB)
}

function Get-CommitAvailableMB {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem
  return [math]::Round([double]$os.FreeVirtualMemory / 1KB)
}

function Get-OwnedProcessIds {
  param([Parameter(Mandatory)][int]$RootProcessId)

  $all = @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue)
  $tree = [System.Collections.Generic.HashSet[int]]::new()
  [void]$tree.Add($RootProcessId)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $all) {
      if ($tree.Contains([int]$process.ParentProcessId) -and $tree.Add([int]$process.ProcessId)) { $changed = $true }
    }
  }
  return @($tree)
}

function Stop-OwnedProcessTree {
  param([Parameter(Mandatory)][int]$RootProcessId)

  $tree = @(Get-OwnedProcessIds -RootProcessId $RootProcessId)
  $descendants = @($tree | Where-Object { $_ -ne $RootProcessId })
  foreach ($processId in $descendants) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue
}

function Invoke-QACommand {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string[]]$Arguments,
    [int]$MinimumFreeMB = 96,
    [switch]$MemoryIntensive
  )

  $freeMB = Get-AvailableMemoryMB
  $commitFreeMB = Get-CommitAvailableMB
  $requiredFreeMB = if ($MemoryIntensive) { [math]::Max($MinimumFreeMB, 768) } else { $MinimumFreeMB }
  if ($freeMB -lt $requiredFreeMB -or $commitFreeMB -lt 1024) {
    $reason = 'RAM disponível {0} MiB (mínimo {1} MiB); commit disponível {2} MiB.' -f $freeMB, $requiredFreeMB, $commitFreeMB
    Write-Warning ("BLOCKED {0}: {1}" -f $Name, $reason)
    $script:TestResults.Add([pscustomobject]@{ Name=$Name; Status='BLOCKED'; ExitCode=$null; StartFreeMB=$freeMB; EndFreeMB=$freeMB; PeakPrivateMB=$null; Reason=$reason })
    return
  }

  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) { throw 'npm.cmd não foi encontrado no PATH.' }
  $runId = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), ([guid]::NewGuid().ToString('N').Substring(0, 6))
  $stdout = Join-Path $env:TEMP ('livio-qa-{0}.out.log' -f $runId)
  $stderr = Join-Path $env:TEMP ('livio-qa-{0}.err.log' -f $runId)
  $startFreeMB = $freeMB
  $lowestFreeMB = $freeMB
  $maxPrivateMB = $null
  $lowMemorySamples = 0
  Write-Host ("RUN {0}: npm.cmd {1}" -f $Name, ($Arguments -join ' ')) -ForegroundColor Cyan

  try {
    $commandArguments = @($Arguments | ForEach-Object {
      if ($_ -match '[\s"]') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
    })
    $commandLine = '"{0}" {1} > "{2}" 2>&1' -f $npm.Source, ($commandArguments -join ' '), $stdout
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $env:ComSpec
    $startInfo.Arguments = '/d /s /c "{0}"' -f $commandLine
    $startInfo.WorkingDirectory = $script:RepoRoot
    $startInfo.UseShellExecute = $false
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw 'Não foi possível iniciar npm.cmd.' }
    while (-not $process.HasExited) {
      Start-Sleep -Seconds 2
      $process.Refresh()
      if ($process.HasExited) { break }
      $currentFreeMB = Get-AvailableMemoryMB
      $lowestFreeMB = [math]::Min($lowestFreeMB, $currentFreeMB)
      $ownedIds = @(Get-OwnedProcessIds -RootProcessId $process.Id)
      $currentTestProcesses = @($ownedIds | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } | Where-Object { $_ })
      if ($currentTestProcesses.Count -gt 0) {
        $sampledPrivateMB = [math]::Round((($currentTestProcesses | Measure-Object -Property PrivateMemorySize64 -Sum).Sum) / 1MB)
        if ($null -eq $maxPrivateMB) { $maxPrivateMB = $sampledPrivateMB }
        else { $maxPrivateMB = [math]::Max($maxPrivateMB, $sampledPrivateMB) }
      }
      if ($currentFreeMB -lt 48) { $lowMemorySamples++ } else { $lowMemorySamples = 0 }
      if ($lowMemorySamples -ge 4) {
        Write-Warning ("Parando somente o processo de teste e seus filhos: RAM disponível permaneceu em {0} MiB." -f $currentFreeMB)
        Stop-OwnedProcessTree -RootProcessId $process.Id
        break
      }
    }
    if (-not $process.HasExited) { $process.WaitForExit() }
    $process.Refresh()
    $exitCode = if ($process.HasExited) { $process.ExitCode } else { 1 }
    if (Test-Path -LiteralPath $stdout) { Get-Content -LiteralPath $stdout -Tail 120 }
    if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Tail 80 }
    $endFreeMB = Get-AvailableMemoryMB
    $status = if ($lowMemorySamples -ge 4) { 'BLOCKED' } elseif ($exitCode -eq 0) { 'PASS' } else { 'FAIL' }
    $reason = if ($status -eq 'BLOCKED') { 'Interrompido pelo limite de segurança de RAM física.' } else { $null }
    $script:TestResults.Add([pscustomobject]@{ Name=$Name; Status=$status; ExitCode=$exitCode; StartFreeMB=$startFreeMB; EndFreeMB=$endFreeMB; LowestFreeMB=$lowestFreeMB; PeakPrivateMB=$maxPrivateMB; Reason=$reason })
    $privatePeakText = if ($null -eq $maxPrivateMB) { 'não amostrado (execução menor que o intervalo de 2 s)' } else { '{0} MiB' -f $maxPrivateMB }
    Write-Host ("{0} {1}: exit {2}; RAM início/fim/mínima {3}/{4}/{5} MiB; pico privado amostrado {6}" -f $status, $Name, $exitCode, $startFreeMB, $endFreeMB, $lowestFreeMB, $privatePeakText) -ForegroundColor $(if ($status -eq 'PASS') { 'Green' } elseif ($status -eq 'BLOCKED') { 'Yellow' } else { 'Red' })
  } catch {
    $endFreeMB = Get-AvailableMemoryMB
    $script:TestResults.Add([pscustomobject]@{ Name=$Name; Status='FAIL'; ExitCode=1; StartFreeMB=$startFreeMB; EndFreeMB=$endFreeMB; LowestFreeMB=$lowestFreeMB; PeakPrivateMB=$maxPrivateMB; Reason=$_.Exception.Message })
    Write-Warning ("FAIL {0}: {1}" -f $Name, $_.Exception.Message)
  } finally {
    Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-Tests {
  $before = Get-MemorySnapshot
  Write-Host ('RAM no início: {0} MiB livre; commit: {1}/{2} MiB.' -f $before.RamAvailableMB, $before.CommitMB, $before.CommitLimitMB) -ForegroundColor Cyan
  if ($before.CommitAvailableMB -lt 1024) {
    Write-Warning 'Testes não iniciados: há menos de 1 GiB de limite de commit disponível.'
    $script:TestResults.Add([pscustomobject]@{ Name='Preflight de memória'; Status='BLOCKED'; ExitCode=$null; StartFreeMB=$before.RamAvailableMB; EndFreeMB=$before.RamAvailableMB; LowestFreeMB=$before.RamAvailableMB; PeakPrivateMB=$null; Reason='Menos de 1 GiB de limite de commit disponível.' })
    return
  }

  $hookTest = Join-Path $script:RepoRoot 'apps/web/features/shared/use-api-data.test.ts'
  if (-not (Test-Path -LiteralPath $hookTest)) {
    Write-Host 'USE_API_DATA_HOOK_TEST=NOT_AVAILABLE; executando o teste existente do cliente HTTP/cache relacionado.' -ForegroundColor Yellow
  }
  Invoke-QACommand -Name 'AuthenticationGuard' -Arguments @('exec','--workspace=@livio/api','--','vitest','run','src/auth/authentication.guard.test.ts','--maxWorkers=1','--minWorkers=1','--no-file-parallelism') -MinimumFreeMB 96
  if ($script:TestResults | Where-Object { $_.Status -eq 'BLOCKED' } | Select-Object -First 1) { return }

  Invoke-QACommand -Name 'cliente HTTP/cache relacionado ao use-api-data' -Arguments @('exec','--workspace=@livio/web','--','vitest','run','lib/api.test.ts','--maxWorkers=1','--minWorkers=1','--no-file-parallelism') -MinimumFreeMB 96
  if ($script:TestResults | Where-Object { $_.Status -eq 'BLOCKED' } | Select-Object -First 1) { return }

  Invoke-QACommand -Name 'lógica de despesas financeiras' -Arguments @('exec','--workspace=@livio/web','--','vitest','run','features/finance/expense-workflow.test.ts','--maxWorkers=1','--minWorkers=1','--no-file-parallelism') -MinimumFreeMB 96
  if ($script:TestResults | Where-Object { $_.Status -eq 'BLOCKED' } | Select-Object -First 1) { return }

  $lintFiles = @(
    'apps/api/src/auth/authentication.guard.ts',
    'apps/api/src/auth/authentication.guard.test.ts',
    'apps/web/features/shared/use-api-data.ts',
    'apps/web/lib/api.test.ts',
    'apps/web/features/finance/expense-workflow.ts',
    'apps/web/features/finance/expense-workflow.test.ts',
    'apps/web/features/finance/finance-operations.tsx',
    'apps/web/features/app/legal-crm.tsx',
    'apps/web/e2e/finance-payment.e2e.ts'
  )
  Invoke-QACommand -Name 'ESLint arquivos afetados' -Arguments (@('exec','--','eslint') + $lintFiles + @('--max-warnings=0')) -MinimumFreeMB 128
  if ($script:TestResults | Where-Object { $_.Status -eq 'BLOCKED' } | Select-Object -First 1) { return }

  Invoke-QACommand -Name 'TypeScript API' -Arguments @('exec','--workspace=@livio/api','--','tsc','-p','tsconfig.json','--noEmit') -MinimumFreeMB 256
  if ($script:TestResults | Where-Object { $_.Status -eq 'BLOCKED' } | Select-Object -First 1) { return }

  Invoke-QACommand -Name 'TypeScript web' -Arguments @('exec','--workspace=@livio/web','--','tsc','--noEmit') -MinimumFreeMB 384
  if ($script:TestResults | Where-Object { $_.Status -eq 'BLOCKED' } | Select-Object -First 1) { return }

  $buildId = Join-Path $script:RepoRoot 'apps/web/.next/BUILD_ID'
  $needsBuild = -not (Test-Path -LiteralPath $buildId)
  if (-not $needsBuild) {
    $buildTime = (Get-Item -LiteralPath $buildId).LastWriteTimeUtc
    $webSources = @(
      'apps/web/features/app/legal-crm.tsx',
      'apps/web/features/shared/use-api-data.ts',
      'apps/web/features/finance/finance-operations.tsx'
    ) | ForEach-Object { Join-Path $script:RepoRoot $_ }
    $needsBuild = [bool]($webSources | Where-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc -gt $buildTime } | Select-Object -First 1)
  }
  if ($needsBuild) {
    Invoke-QACommand -Name 'Build web para E2E' -Arguments @('run','build','-w','@livio/web') -MinimumFreeMB 1536 -MemoryIntensive
    if ($script:TestResults | Where-Object { $_.Status -ne 'PASS' } | Select-Object -First 1) { return }
  }

  Invoke-QACommand -Name 'Playwright financeiro pagamento' -Arguments @('exec','--','playwright','test','apps/web/e2e/finance-payment.e2e.ts','--workers=1','--fully-parallel=false') -MinimumFreeMB 768 -MemoryIntensive
}

try {
  switch ($Acao) {
    'Diagnostico' {
      Show-Diagnostics
    }
    'Configurar' {
      $before = Get-MemorySnapshot
      Write-Host 'Estado original:' -ForegroundColor Cyan
      Show-Diagnostics
      $configurationResult = Invoke-PageFileConfiguration
      Write-Host ('PAGEFILE_RESULT={0}' -f $configurationResult)
      $after = Get-MemorySnapshot
      Write-Host ('Estado observado ao final: RAM livre {0} MiB; commit {1}/{2} MiB; C: livre {3:N2} GiB.' -f $after.RamAvailableMB, $after.CommitMB, $after.CommitLimitMB, $after.CFreeGB)
      if ($configurationResult -eq 'REBOOT_REQUIRED') { Write-Host 'REBOOT_REQUIRED=YES; este script não reinicia o computador.' -ForegroundColor Yellow }
    }
    'Testar' {
      Show-Diagnostics
      Invoke-Tests
      Write-Host 'Resumo dos testes:' -ForegroundColor Cyan
      if ($script:TestResults.Count -gt 0) { $script:TestResults | Format-Table Name, Status, ExitCode, StartFreeMB, EndFreeMB, LowestFreeMB, PeakPrivateMB -AutoSize }
      $after = Get-MemorySnapshot
      Write-Host ('RAM ao final: {0} MiB livre; commit {1}/{2} MiB; C: livre {3:N2} GiB.' -f $after.RamAvailableMB, $after.CommitMB, $after.CommitLimitMB, $after.CFreeGB)
      if ($script:TestResults | Where-Object { $_.Name -like 'Playwright*' -and $_.Status -eq 'PASS' }) { Write-Host 'PLAYWRIGHT=PASS' }
      elseif ($script:TestResults | Where-Object { $_.Name -like 'Playwright*' -and $_.Status -eq 'FAIL' }) { Write-Host 'PLAYWRIGHT=FAIL' }
      elseif ($script:TestResults | Where-Object { $_.Status -eq 'BLOCKED' }) { Write-Host 'PLAYWRIGHT=BLOCKED' }
      else { Write-Host 'PLAYWRIGHT=NOT_RUN' }
      $vitestNames = @('AuthenticationGuard', 'cliente HTTP/cache relacionado ao use-api-data', 'lógica de despesas financeiras')
      $vitestResults = @($script:TestResults | Where-Object { $_.Name -in $vitestNames })
      if ($vitestResults | Where-Object { $_.Status -eq 'BLOCKED' }) { Write-Host 'VITEST=BLOCKED' }
      elseif ($vitestResults | Where-Object { $_.Status -eq 'FAIL' }) { Write-Host 'VITEST=FAIL' }
      elseif ($vitestResults.Count -eq $vitestNames.Count -and @($vitestResults | Where-Object { $_.Status -eq 'PASS' }).Count -eq $vitestNames.Count) { Write-Host 'VITEST=PASS' }
      else { Write-Host 'VITEST=BLOCKED' }
      if ($script:TestResults | Where-Object { $_.Status -eq 'FAIL' }) { exit 1 }
      if ($script:TestResults | Where-Object { $_.Status -eq 'BLOCKED' }) { exit 2 }
    }
  }
} catch {
  Write-Error ('Falha em {0}: {1}' -f $Acao, $_.Exception.Message)
  exit 1
}
