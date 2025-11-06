<#
.SYNOPSIS
    Efficiently delete emails from a specific sender across Exchange mailboxes with advanced filtering

.DESCRIPTION
    This script provides an efficient method to delete emails from a specific sender
    across all mailboxes in an Exchange 2019 organization. It first identifies which
    mailboxes have received emails from the specified sender using message tracking
    logs, then performs a live verification on those candidates to see who still has
    matching items (excluding Recoverable Items), and finally deletes only from the
    verified set.

    Enhanced with additional filtering options for date ranges and subject matching.

.PARAMETER SenderEmail
    The email address of the sender whose emails should be deleted

.PARAMETER Method
    The method to use for deletion:
    - ComplianceSearch: Uses New-ComplianceSearch/New-ComplianceSearchAction (recommended for large orgs)
    - SearchMailbox: Uses Search-Mailbox cmdlet (legacy method, limited to 10,000 items per mailbox)

.PARAMETER DaysBack
    Number of days back to search in message tracking logs (default: 30)
    This parameter is ignored if FromDate is specified

.PARAMETER FromDate
    Optional: Filter emails sent on or after this date (format: DD/MM/YYYY)
    Overrides DaysBack parameter when specified

.PARAMETER ToDate
    Optional: Filter emails sent on or before this date (format: DD/MM/YYYY)
    If not specified, current date is used

.PARAMETER SubjectEqual
    Optional: Only delete emails with this exact subject line (case-insensitive)
    Cannot be used together with SubjectContains

.PARAMETER SubjectContains
    Optional: Only delete emails where subject contains this text (case-insensitive)
    Cannot be used together with SubjectEqual

.PARAMETER WhatIf
    Shows what would be deleted without actually performing the deletion

.PARAMETER LogFile
    Path to log file for script execution details

.PARAMETER AutoConfirm
    Skip interactive confirmation prompts (useful when running non-interactively)

.PARAMETER AllowHardDelete
    Enable fallback cleanup using Search-Mailbox -DeleteContent (hard delete).
    Disabled by default to preserve Recoverable Items so they remain recoverable by admins.

.EXAMPLE
    .\Remove-EmailsEnhanced.ps1 -SenderEmail "spammer@badsite.com" -WhatIf

.EXAMPLE
    .\Remove-EmailsEnhanced.ps1 -SenderEmail "user@company.com" -FromDate "01/01/2024" -ToDate "31/01/2024" -SubjectContains "Invoice"

.EXAMPLE
    .\Remove-EmailsEnhanced.ps1 -SenderEmail "newsletter@site.com" -SubjectEqual "Weekly Newsletter" -Method ComplianceSearch -AutoConfirm

.NOTES
    Version: 1.2.7 (customised for automation)
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$SenderEmail,

    [Parameter(Mandatory = $false)]
    [ValidateSet("ComplianceSearch", "SearchMailbox")]
    [string]$Method = "ComplianceSearch",

    [Parameter(Mandatory = $false)]
    [int]$DaysBack = 30,

    [Parameter(Mandatory = $false)]
    [string]$FromDate,

    [Parameter(Mandatory = $false)]
    [string]$ToDate,

    [Parameter(Mandatory = $false)]
    [string]$SubjectEqual,

    [Parameter(Mandatory = $false)]
    [string]$SubjectContains,

    [Parameter(Mandatory = $false)]
    [switch]$WhatIf,

    [Parameter(Mandatory = $false)]
    [string]$LogFile = "C:\temp\EmailDeletion_$(Get-Date -Format 'yyyyMMdd_HHmmss').log",

    [Parameter(Mandatory = $false)]
    [switch]$AutoConfirm,

    [Parameter(Mandatory = $false)]
    [switch]$AllowHardDelete
)
$WarningPreference = 'SilentlyContinue'

function Write-Log {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    Write-Host $logMessage
    if ($LogFile) {
        Add-Content -Path $LogFile -Value $logMessage
    }
}

$script:ExchangeShellLoaded = $false
function Ensure-ExchangeShell {
    if ($script:ExchangeShellLoaded) {
        return $true
    }

    if (Get-Command "Get-Mailbox" -ErrorAction SilentlyContinue) {
        $script:ExchangeShellLoaded = $true
        return $true
    }

    $remoteExchangePath = $null
    if ($env:ExchangeInstallPath) {
        $remoteExchangePath = Join-Path $env:ExchangeInstallPath 'Bin/RemoteExchange.ps1'
    }
    if (-not $remoteExchangePath -or -not (Test-Path $remoteExchangePath)) {
        $remoteExchangePath = 'C:/Program Files/Microsoft/Exchange Server/V15/bin/RemoteExchange.ps1'
    }

    if (Test-Path $remoteExchangePath) {
        try {
            Write-Log "Loading Exchange Management Shell via RemoteExchange.ps1"
            . $remoteExchangePath
            Connect-ExchangeServer -Auto -ClientApplication:ManagementShell | Out-Null
        } catch {
            Write-Log "Failed to run RemoteExchange.ps1: $_" "WARNING"
        }
    }

    if (Get-Command "Get-Mailbox" -ErrorAction SilentlyContinue) {
        $script:ExchangeShellLoaded = $true
        Write-Log "Exchange cmdlets loaded successfully."
        return $true
    }

    try {
        Write-Log "Attempting to add Exchange snap-in..."
        Add-PSSnapin Microsoft.Exchange.Management.PowerShell.SnapIn -ErrorAction Stop
    } catch {
        Write-Log "Failed to add Exchange snap-in: $_" "WARNING"
    }

    if (Get-Command "Get-Mailbox" -ErrorAction SilentlyContinue) {
        $script:ExchangeShellLoaded = $true
        Write-Log "Exchange cmdlets loaded via snap-in."
        return $true
    }

    Write-Log "Exchange Management Shell not available. Please run this script from Exchange Management Shell." "ERROR"
    return $false
}

function Parse-DateString {
    param([string]$DateString)

    if ([string]::IsNullOrWhiteSpace($DateString)) {
        return $null
    }

    try {
        return [DateTime]::ParseExact($DateString, "dd/MM/yyyy", $null)
    } catch {
        try {
            $parsed = [DateTime]::ParseExact($DateString, "MM/dd/yyyy", $null)
            Write-Log "Warning: Date '$DateString' parsed as MM/dd/yyyy. Please use DD/MM/YYYY format." "WARNING"
            return $parsed
        } catch {
            Write-Log "Error: Unable to parse date '$DateString'. Please use DD/MM/YYYY format (e.g., 31/12/2024)." "ERROR"
            return $null
        }
    }
}

function Test-Prerequisites {
    Write-Log "Checking prerequisites..."

    if (-not (Ensure-ExchangeShell)) {
        return $false
    }

    if ($SubjectEqual -and $SubjectContains) {
        Write-Log "SubjectEqual and SubjectContains cannot be used together. Please specify only one." "ERROR"
        return $false
    }

    $parsedFromDate = Parse-DateString -DateString $FromDate
    $parsedToDate = Parse-DateString -DateString $ToDate

    if ($FromDate -and -not $parsedFromDate) {
        Write-Log "FromDate parameter is invalid. Please use DD/MM/YYYY format." "ERROR"
        return $false
    }

    if ($ToDate -and -not $parsedToDate) {
        Write-Log "ToDate parameter is invalid. Please use DD/MM/YYYY format." "ERROR"
        return $false
    }

    if ($parsedFromDate -and $parsedToDate -and $parsedFromDate -gt $parsedToDate) {
        Write-Log "FromDate cannot be later than ToDate." "ERROR"
        return $false
    }

    if (-not (Get-Command "New-ComplianceSearch" -ErrorAction SilentlyContinue) -and $Method -eq "ComplianceSearch") {
        Write-Log "New-ComplianceSearch cmdlet not available. Choose -Method SearchMailbox or ensure compliance cmdlets are available." "ERROR"
        return $false
    }

    $searchMailboxCmd = Get-Command "Search-Mailbox" -ErrorAction SilentlyContinue
    if (-not $searchMailboxCmd) {
        Write-Log "Search-Mailbox cmdlet not available. Live verification of candidates will be skipped, which may cause WhatIf to show stale candidates." "WARNING"
    } else {
        try {
            $currentAssignee = (whoami)
            $roles = Get-ManagementRoleAssignment -RoleAssignee $currentAssignee -ErrorAction SilentlyContinue
            $hasSearchRole = $false
            if ($roles) {
                $hasSearchRole = $roles | Where-Object { $_.Role -match "Mailbox Search" } | ForEach-Object { $true } | Select-Object -First 1
            }
            if (-not $hasSearchRole) {
                Write-Log "Mailbox Search role not assigned to $currentAssignee. Search-Mailbox estimation may fail." "WARNING"
            }
        } catch {
            Write-Log "Unable to verify role assignments for Search-Mailbox: $_" "WARNING"
        }
    }

    if ($Method -eq "SearchMailbox") {
        $currentAssignee = (whoami)
        $roles = Get-ManagementRoleAssignment -RoleAssignee $currentAssignee -ErrorAction SilentlyContinue
        $hasSearchRole = $roles | Where-Object { $_.Role -match "Mailbox Search" }
        $hasImportExportRole = $roles | Where-Object { $_.Role -match "Mailbox Import Export" }

        if (-not $hasSearchRole) {
          Write-Log "Mailbox Search role not assigned. Required for Search-Mailbox operations." "ERROR"
          return $false
        }
        if (-not $hasImportExportRole) {
          Write-Log "Mailbox Import Export role not assigned. Required for Search-Mailbox -DeleteContent operations." "ERROR"
          return $false
        }
    }

    Write-Log "Prerequisites check completed successfully."
    return $true
}

function Build-SearchQuery {
    param(
        [string]$Sender,
        [DateTime]$StartDate,
        [DateTime]$EndDate,
        [string]$SubjEqual,
        [string]$SubjContains
    )

    $queryParts = @("kind:email", "From:$Sender")

    if ($StartDate -ne [DateTime]::MinValue) {
        $startDateString = $StartDate.ToString('MM/dd/yyyy')
        $queryParts += "Received>=$startDateString"
    }

    if ($EndDate -ne [DateTime]::MinValue) {
        $exclusiveEnd = $EndDate.AddDays(1)
        $endDateString = $exclusiveEnd.ToString('MM/dd/yyyy')
        $queryParts += "Received<$endDateString"
    }

    if ($SubjEqual) {
        $escapedSubject = $SubjEqual -replace '"', '""'
        $queryParts += "Subject:`"$escapedSubject`""
    } elseif ($SubjContains) {
        $escapedSubject = $SubjContains -replace '[\\"]', ''
        $queryParts += "Subject:`"*$escapedSubject*`""
    }

    $query = $queryParts -join " AND "
    Write-Log "Built search query: $query"
    return $query
}

function Get-EffectiveDateRange {
    param(
        [string]$FromDateString,
        [string]$ToDateString,
        [int]$DaysBackParam
    )

    $effectiveStartDate = [DateTime]::MinValue
    $effectiveEndDate = [DateTime]::MinValue

    if (-not [string]::IsNullOrWhiteSpace($FromDateString)) {
        $effectiveStartDate = Parse-DateString -DateString $FromDateString
        if ($effectiveStartDate) {
            Write-Log "Using FromDate parameter: $($effectiveStartDate.ToString('dd/MM/yyyy'))"
        }
    }

    if ($effectiveStartDate -eq [DateTime]::MinValue) {
        $effectiveStartDate = (Get-Date).AddDays(-$DaysBackParam)
        Write-Log "Using DaysBack parameter ($DaysBackParam days): $($effectiveStartDate.ToString('dd/MM/yyyy'))"
    }

    if (-not [string]::IsNullOrWhiteSpace($ToDateString)) {
        $effectiveEndDate = Parse-DateString -DateString $ToDateString
        if ($effectiveEndDate) {
            $effectiveEndDate = $effectiveEndDate.AddDays(1).AddSeconds(-1)
            Write-Log "Using ToDate parameter: $($effectiveEndDate.ToString('dd/MM/yyyy'))"
        }
    }

    if ($effectiveEndDate -eq [DateTime]::MinValue) {
        $effectiveEndDate = Get-Date
        Write-Log "Using current date as end date: $($effectiveEndDate.ToString('dd/MM/yyyy'))"
    }

    return @{ StartDate = $effectiveStartDate; EndDate = $effectiveEndDate }
}

function Find-MailboxesWithSender {
    param(
        [string]$Sender,
        [DateTime]$StartDate,
        [DateTime]$EndDate
    )

    Write-Log "Searching for mailboxes that received emails from $Sender between $($StartDate.ToString('dd/MM/yyyy')) and $($EndDate.ToString('dd/MM/yyyy'))..."

    try {
        $recipientAddresses = Get-MessageTrackingLog -Sender $Sender -Start $StartDate -End $EndDate -ResultSize Unlimited -EventId "DELIVER" |
            Select-Object -ExpandProperty Recipients |
            Where-Object { $_ -and $_.Trim() -ne "" } |
            Sort-Object -Unique

        if (-not $recipientAddresses -or $recipientAddresses.Count -eq 0) {
            Write-Log "No emails found from sender $Sender in message tracking logs for the specified period." "WARNING"
            return @()
        }

        $mailboxes = @()
        foreach ($recipient in $recipientAddresses) {
            try {
                $mbx = Get-Mailbox -Identity $recipient -ErrorAction SilentlyContinue
                if ($mbx) {
                    $mailboxes += $mbx
                }
            } catch {
                Write-Log "Could not resolve mailbox for recipient: $recipient" "WARNING"
            }
        }

        if (-not $mailboxes -or $mailboxes.Count -eq 0) {
            Write-Log "No recipients resolved to local mailboxes." "WARNING"
            return @()
        }

        $unique = $mailboxes |
            Sort-Object -Property PrimarySmtpAddress -Unique |
            Where-Object { $_.PrimarySmtpAddress -and ($_.PrimarySmtpAddress.ToString().ToLower() -ne $Sender.ToLower()) }

        Write-Log "Found $(@($unique).Count) mailboxes that received emails from $Sender"
        return @($unique)
    }
    catch {
        Write-Log "Error searching message tracking logs: $_" "ERROR"
        Write-Log "Falling back to searching all mailboxes..." "WARNING"
        $allMailboxes = Get-Mailbox -ResultSize Unlimited
        Write-Log "Found $(@($allMailboxes).Count) total mailboxes in organization"
        return @($allMailboxes | Where-Object { $_.PrimarySmtpAddress.ToString().ToLower() -ne $Sender.ToLower() })
    }
}

function Get-VerifiedMailboxesWithSender {
    param(
        [array]$CandidateMailboxes,
        [string]$SearchQuery
    )

    $canSearch = $null -ne (Get-Command "Search-Mailbox" -ErrorAction SilentlyContinue)
    if (-not $canSearch) {
        Write-Log "Search-Mailbox not available; skipping live verification. Using candidate list from tracking logs." "WARNING"
        return @($CandidateMailboxes)
    }

    Write-Log "Verifying candidate mailboxes contain active messages matching criteria (excluding Recoverable Items)..."
    Write-Log "Search query for verification: $SearchQuery"

    $verified = @()

    foreach ($mbx in $CandidateMailboxes) {
        try {
            $id = $mbx.Identity.ToString()
            Write-Log "Checking mailbox $($mbx.PrimarySmtpAddress) for active messages..."

            try {
                $estimate = Search-Mailbox -Identity $id -SearchQuery $SearchQuery -EstimateResultOnly -SearchDumpster:$false -ErrorAction Stop
                $activeCount = 0
                if ($estimate -and $estimate.ResultItemsCount) {
                    [int]$activeCount = $estimate.ResultItemsCount
                }

                if ($activeCount -gt 0) {
                    Write-Log "Mailbox $($mbx.PrimarySmtpAddress): $activeCount active items (Recoverable Items excluded)"
                    $verified += $mbx
                }
            } catch {
                Write-Log "Error estimating mailbox $($mbx.PrimarySmtpAddress): $_" "WARNING"
            }
        } catch {
            Write-Log "Error processing mailbox $($mbx.PrimarySmtpAddress): $_" "WARNING"
        }
    }

    $verifiedCount = @($verified).Count
    Write-Log "Verification complete. $verifiedCount mailbox(es) currently contain active messages matching the criteria."

    if ($verifiedCount -gt 0) {
        $affectedMailboxes = $verified | ForEach-Object { $_.PrimarySmtpAddress }
        Write-Log "Effected Emails: $($affectedMailboxes -join ', ')"
    }

    if ($verifiedCount -eq 0 -and $CandidateMailboxes -and @($CandidateMailboxes).Count -gt 0) {
        Write-Log "Search-Mailbox verification returned no active matches, but message tracking identified candidate mailboxes. Falling back to candidate list (content index may be lagging)." "WARNING"
        return @($CandidateMailboxes)
    }

    return @($verified)
}

function Remove-EmailsComplianceSearch {
    param(
        [array]$TargetMailboxes,
        [string]$SearchQuery
    )

    if (-not $TargetMailboxes -or $TargetMailboxes.Count -eq 0) {
        Write-Log "No target mailboxes to process for Compliance Search."
        return
    }

    Write-Log "Using Compliance Search method to delete emails matching criteria"

    $searchName = "RemoveEmails_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
    $mailboxLocations = $TargetMailboxes | ForEach-Object { $_.PrimarySmtpAddress.ToString() }

    try {
        Write-Log "Creating compliance search: $searchName"

        if ($WhatIf) {
            Write-Log "[WHATIF] Would create compliance search with query: $SearchQuery"
            Write-Log "[WHATIF] Target mailboxes: $($mailboxLocations -join ', ')"
            return
        }

        New-ComplianceSearch -Name $searchName -ExchangeLocation $mailboxLocations -ContentMatchQuery $SearchQuery | Out-Null

        Write-Log "Starting compliance search..."
        Start-ComplianceSearch -Identity $searchName | Out-Null

        do {
            Start-Sleep -Seconds 15
            $searchStatus = Get-ComplianceSearch -Identity $searchName
            Write-Log "Search status: $($searchStatus.Status)"
        } while ($searchStatus.Status -eq "InProgress" -or $searchStatus.Status -eq "Starting")

        if ($searchStatus.Status -eq "Completed") {
            $itemsFound = $searchStatus.Items
            $locations = $searchStatus.Locations
            Write-Log "Search completed. Found $itemsFound item(s) in $locations location(s)." "SUCCESS"

            if ($itemsFound -gt 0) {
                Write-Log "Creating compliance search action to delete emails..."
                $actionName = "${searchName}_Purge"
                $action = New-ComplianceSearchAction -SearchName $searchName -Purge -PurgeType SoftDelete -Confirm:$false
                $actionIdentity = if ($action -and $action.Identity) { $action.Identity } else { $actionName }
                Write-Log "Email deletion initiated. Items will be moved to Recoverable Items folder."
                Write-Log "Monitoring purge action status..."

                do {
                    Start-Sleep -Seconds 15
                    $actionStatus = Get-ComplianceSearchAction -Identity $actionIdentity
                    Write-Log "Purge status: $($actionStatus.Status)"
                } while ($actionStatus.Status -eq "InProgress" -or $actionStatus.Status -eq "Starting")

                if ($actionStatus.Status -eq "Completed") {
                    Write-Log "Purge action completed." "SUCCESS"

                    $purgeResultText = $null
                    $purgedCount = 0

                    if ($actionStatus.Results) {
                        if ($actionStatus.Results -is [Array]) {
                            $purgeResultText = ($actionStatus.Results -join " | ")
                        } else {
                            $purgeResultText = [string]$actionStatus.Results
                        }

                        Write-Log "Purge results: $purgeResultText"

                        if ($purgeResultText -match 'Item count:\s*(\d+)') {
                            $purgedCount = [int]$matches[1]
                        }
                    }

                    if ($purgedCount -lt $itemsFound) {
                        $remaining = $itemsFound - $purgedCount
                        if ($AllowHardDelete) {
                            if (Get-Command "Search-Mailbox" -ErrorAction SilentlyContinue) {
                                Write-Log "Purge removed $purgedCount of $itemsFound items. Running Search-Mailbox cleanup (hard delete) because -AllowHardDelete was specified." "WARNING"
                                Remove-EmailsSearchMailbox -TargetMailboxes $TargetMailboxes -SearchQuery $SearchQuery
                            } else {
                                Write-Log "Purge removed $purgedCount of $itemsFound items but Search-Mailbox is unavailable for cleanup even though -AllowHardDelete was specified." "WARNING"
                            }
                        } else {
                            Write-Log "Purge removed $purgedCount of $itemsFound items. Skipping Search-Mailbox hard delete to preserve Recoverable Items. Remaining $remaining item(s) likely already reside in Recoverable Items." "WARNING"
                            Write-Log "If permanent removal is required, rerun with -AllowHardDelete to hard delete remaining items." "WARNING"
                        }
                    }
                } else {
                    Write-Log "Purge action finished with status $($actionStatus.Status)." "WARNING"
                }
            } else {
                Write-Log "No emails found matching the criteria."
            }
        } else {
            Write-Log "Search failed with status: $($searchStatus.Status)" "ERROR"
        }
    }
    catch {
        Write-Log "Error in compliance search operation: $_" "ERROR"
    }
}

function Remove-EmailsSearchMailbox {
    param(
        [array]$TargetMailboxes,
        [string]$SearchQuery
    )

    if (-not $TargetMailboxes -or $TargetMailboxes.Count -eq 0) {
        Write-Log "No target mailboxes to process for Search-Mailbox."
        return
    }

    Write-Log "Using Search-Mailbox method to delete emails matching criteria"
    Write-Log "Processing $($TargetMailboxes.Count) mailboxes..."

    $totalProcessed = 0
    $totalDeleted = 0

    foreach ($mailbox in $TargetMailboxes) {
        $totalProcessed++
        $id = $mailbox.Identity.ToString()
        Write-Log "Processing mailbox $totalProcessed of $($TargetMailboxes.Count): $($mailbox.PrimarySmtpAddress)"

        try {
            if ($WhatIf) {
                $estimateResult = Search-Mailbox -Identity $id -SearchQuery $SearchQuery -EstimateResultOnly
                Write-Log "[WHATIF] Found $($estimateResult.ResultItemsCount) items in $($mailbox.PrimarySmtpAddress)"
                $totalDeleted += $estimateResult.ResultItemsCount
            } else {
                $deleteResult = Search-Mailbox -Identity $id -SearchQuery $SearchQuery -DeleteContent -Force -Confirm:$false
                Write-Log "Deleted $($deleteResult.ResultItemsCount) items from $($mailbox.PrimarySmtpAddress)"
                $totalDeleted += $deleteResult.ResultItemsCount
            }
        }
        catch {
            Write-Log "Error processing mailbox $($mailbox.PrimarySmtpAddress): $_" "ERROR"
        }
    }

    if ($WhatIf) {
        Write-Log "[WHATIF] Would delete $totalDeleted total items from $totalProcessed mailboxes"
    } else {
        Write-Log "Deleted $totalDeleted total items from $totalProcessed mailboxes"
    }
}

function Show-FilterSummary {
    param(
        [string]$Sender,
        [DateTime]$StartDate,
        [DateTime]$EndDate,
        [string]$SubjEqual,
        [string]$SubjContains
    )

    Write-Log "=== FILTER SUMMARY ==="
    Write-Log "Sender: $Sender"
    Write-Log "Date Range: $($StartDate.ToString('dd/MM/yyyy')) to $($EndDate.ToString('dd/MM/yyyy'))"

    if ($SubjEqual) {
        Write-Log "Subject Filter: Exact match for '$SubjEqual'"
    } elseif ($SubjContains) {
        Write-Log "Subject Filter: Contains '$SubjContains' (partial match with wildcards)"
    } else {
        Write-Log "Subject Filter: None (all subjects)"
    }

    Write-Log "Method: $Method"
    Write-Log "Verification: Excludes Recoverable Items using -SearchDumpster:$false"
    if ($AllowHardDelete) {
        Write-Log "Hard delete fallback: Enabled (Search-Mailbox cleanup may hard delete Recoverable Items)"
    } else {
        Write-Log "Hard delete fallback: Disabled (Recoverable Items preserved)"
    }
    Write-Log "====================="
}

try {
    Write-Log "Starting enhanced email deletion script for sender: $SenderEmail"
    Write-Log "Method: $Method, WhatIf: $($WhatIf.IsPresent), AutoConfirm: $($AutoConfirm.IsPresent), AllowHardDelete: $($AllowHardDelete.IsPresent)"

    $logDir = Split-Path -Path $LogFile -Parent
    if (-not (Test-Path -Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    if (-not (Test-Prerequisites)) {
        Write-Log "Prerequisites check failed. Exiting." "ERROR"
        exit 1
    }

    $dateRange = Get-EffectiveDateRange -FromDateString $FromDate -ToDateString $ToDate -DaysBackParam $DaysBack
    $effectiveStartDate = $dateRange.StartDate
    $effectiveEndDate = $dateRange.EndDate

    $searchQuery = Build-SearchQuery -Sender $SenderEmail -StartDate $effectiveStartDate -EndDate $effectiveEndDate -SubjEqual $SubjectEqual -SubjContains $SubjectContains

    Show-FilterSummary -Sender $SenderEmail -StartDate $effectiveStartDate -EndDate $effectiveEndDate -SubjEqual $SubjectEqual -SubjContains $SubjectContains

    $candidateMailboxes = Find-MailboxesWithSender -Sender $SenderEmail -StartDate $effectiveStartDate -EndDate $effectiveEndDate

    if (-not $candidateMailboxes -or $candidateMailboxes.Count -eq 0) {
        Write-Log "No mailboxes found with emails from $SenderEmail (candidates). Exiting."
        exit 0
    }

    $verifiedMailboxes = Get-VerifiedMailboxesWithSender -CandidateMailboxes $candidateMailboxes -SearchQuery $searchQuery

    if (-not $verifiedMailboxes -or $verifiedMailboxes.Count -eq 0) {
        Write-Log "No mailboxes currently contain active messages matching the specified criteria. Nothing to do."
        exit 0
    }

    if (-not $WhatIf) {
        if ($AutoConfirm) {
            Write-Log "AutoConfirm enabled. Proceeding without interactive prompt."
        } else {
            Write-Log "About to delete active emails matching the specified criteria in $($verifiedMailboxes.Count) mailbox(es)."
            $confirmation = Read-Host "Continue? (y/N)"
            if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
                Write-Log "Operation cancelled by user."
                exit 0
            }
        }
    }

    switch ($Method) {
        "ComplianceSearch" {
            Remove-EmailsComplianceSearch -TargetMailboxes $verifiedMailboxes -SearchQuery $searchQuery
        }
        "SearchMailbox" {
            Remove-EmailsSearchMailbox -TargetMailboxes $verifiedMailboxes -SearchQuery $searchQuery
        }
    }

    Write-Log "Script execution completed." "SUCCESS"
}
catch {
    Write-Log "Critical error in main execution: $_" "ERROR"
    exit 1
}











