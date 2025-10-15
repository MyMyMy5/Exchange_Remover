<#
.SYNOPSIS
    Installs Exchange management tools prerequisites (IIS components + VC++ runtime) and then runs Exchange Setup
    for the ManagementTools role.

.PARAMETER ExchangeMediaRoot
    Root folder of the unpacked Exchange installation media (where Setup.exe lives).

.PARAMETER AcceptDiagnosticData
    Switch to control whether diagnostics are sent to Microsoft. Defaults to ON to match the GUI installer.

.PARAMETER VcRuntimePath
    Optional path to an offline copy of vcredist_x64.exe. If not provided the script searches common locations on the
    Exchange media and finally attempts to download it from Microsoft.

.EXAMPLE
    .\Install-ExchangeManagementTools.ps1 -ExchangeMediaRoot "E:\"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path (Join-Path $_ 'Setup.exe') })]
    [string]$ExchangeMediaRoot,

    [switch]$AcceptDiagnosticData,

    [string]$VcRuntimePath
)

$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Message)
    Write-Host "[+] $Message" -ForegroundColor Cyan
}

function Install-WindowsComponents {
    $os = Get-CimInstance Win32_OperatingSystem
    $isServer = $os.ProductType -ne 1 # 1 = Workstation, 2/3 = Domain Controller/Server

    if ($isServer -and (Get-Command Install-WindowsFeature -ErrorAction SilentlyContinue)) {
        Write-Step 'Installing IIS components via Install-WindowsFeature'
        $features = @('Web-Server','Web-Mgmt-Console','Web-Lgcy-Scripting','Web-Metabase')
        Install-WindowsFeature -Name $features -IncludeManagementTools -ErrorAction Stop | Out-Null
    }
    elseif (Get-Command Enable-WindowsOptionalFeature -ErrorAction SilentlyContinue) {
        Write-Step 'Installing IIS components via Enable-WindowsOptionalFeature'
        $clientFeatures = @(
            'IIS-WebServerRole','IIS-WebServer','IIS-WebServerManagementTools','IIS-ManagementConsole','IIS-Metabase'
        )
        foreach ($feature in $clientFeatures) {
            try {
                Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart -ErrorAction Stop | Out-Null
            } catch {
                if ($_.FullyQualifiedErrorId -notmatch 'Error_Unchanged') {
                    throw
                }
            }
        }
    }
    else {
        throw 'Unable to find a cmdlet to manage Windows features (Install-WindowsFeature/Enable-WindowsOptionalFeature).'
    }
}

function Resolve-VcRuntimePath {
    if ($PSBoundParameters.ContainsKey('VcRuntimePath')) {
        if (-not (Test-Path $VcRuntimePath)) {
            throw "The supplied VC runtime path '$VcRuntimePath' cannot be found."
        }
        return (Resolve-Path $VcRuntimePath).Path
    }

    $candidates = @(
        'vcredist_x64.exe',
        'VCREDIST\\vcredist_x64.exe',
        'Setup\\vcredist_x64.exe',
        'vcredist\\vcredist_x64.exe'
    ) | ForEach-Object { Join-Path $ExchangeMediaRoot $_ }

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return (Resolve-Path $candidate).Path
        }
    }

    return $null
}

function Install-VcRuntime2012 {
    $localPath = Resolve-VcRuntimePath
    if ($localPath) {
        Write-Step "Installing Visual C++ 2012 Redistributable (x64) from $localPath"
        $installerPath = $localPath
    } else {
        $vcUrl = 'https://download.microsoft.com/download/1/6/B/16B06F60-3B20-4FF2-B699-67519AE69EEB/vcredist_x64.exe'
        $installerPath = Join-Path $env:TEMP 'vcredist2012_x64.exe'

        if (-not (Test-Path $installerPath)) {
            Write-Step 'Downloading Visual C++ 2012 Redistributable (x64)'
            try {
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            } catch {
                # ignore if not supported
            }
            Invoke-WebRequest -Uri $vcUrl -OutFile $installerPath -UseBasicParsing
        } else {
            Write-Step "Using cached Visual C++ installer at $installerPath"
        }
    }

    Write-Step 'Installing Visual C++ 2012 Redistributable (x64)'
    Start-Process -FilePath $installerPath -ArgumentList '/quiet','/norestart' -Wait -ErrorAction Stop
}

function Run-ExchangeSetup {
    $setupPath = Join-Path $ExchangeMediaRoot 'Setup.exe'
    $licenseSwitch = if ($AcceptDiagnosticData.IsPresent) {
        '/IAcceptExchangeServerLicenseTerms_DiagnosticDataON'
    } else {
        '/IAcceptExchangeServerLicenseTerms_DiagnosticDataOFF'
    }

    Write-Step 'Launching Exchange setup for ManagementTools role'
    $args = @(
        $licenseSwitch,
        '/Role:ManagementTools'
    )

    Start-Process -FilePath $setupPath -ArgumentList $args -Wait -NoNewWindow
}

try {
    Write-Step 'Installing prerequisite Windows features'
    Install-WindowsComponents

    Write-Step 'Installing prerequisite Visual C++ runtimes'
    Install-VcRuntime2012

    Write-Step 'Running Exchange Management Tools setup'
    Run-ExchangeSetup

    Write-Step 'Exchange Management Tools installation completed. Check ExchangeSetup.log for details.'
} catch {
    Write-Error $_
    throw
}
