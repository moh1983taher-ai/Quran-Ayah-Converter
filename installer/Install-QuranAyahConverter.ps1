[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string]$ManifestFile
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ConverterAppId = '4d4f5a8e-0c2e-4d89-9b45-7a2e0a7e1f36'
$AssistantAppId = 'f8a582b1-eaf2-44f9-8166-d034255586ad'
$PreferredCatalogId = '4B78E8D1-1F8A-43B0-9859-4C10A5E127D2'
$ResearchRoot = Join-Path $env:LOCALAPPDATA 'ResearchTools'
$LogDirectory = Join-Path $ResearchRoot 'Logs'
$BackupDirectory = Join-Path $ResearchRoot 'Backup\QuranAyahConverter'
$LogFile = Join-Path $LogDirectory 'QuranAyahConverter-Setup.log'

$script:Form = $null
$script:StatusLabel = $null
$script:ProgressBar = $null

New-Item -ItemType Directory -Path $LogDirectory,$BackupDirectory -Force | Out-Null

function Write-SetupLog([string]$Message) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'),$Message
    Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value $line
}

function Set-Stage([int]$Value,[string]$Message) {
    Write-SetupLog $Message
    if ($script:StatusLabel) {
        $script:StatusLabel.Text = $Message
        $script:ProgressBar.Value = [Math]::Max(0,[Math]::Min(100,$Value))
        $script:Form.Refresh()
        [System.Windows.Forms.Application]::DoEvents()
    }
}

function Show-ProgressWindow {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'تثبيت محوّل الآيات القرآنية'
    $form.Width = 590
    $form.Height = 218
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.ControlBox = $false
    $form.TopMost = $true
    $form.RightToLeft = 'Yes'
    $form.RightToLeftLayout = $true

    $title = New-Object System.Windows.Forms.Label
    $title.Text = 'إضافة محوّل الآيات إلى كتالوج Word المشترك'
    $title.Font = New-Object System.Drawing.Font('Segoe UI',13,[System.Drawing.FontStyle]::Bold)
    $title.TextAlign = 'MiddleRight'
    $title.SetBounds(24,18,530,32)
    $form.Controls.Add($title)

    $status = New-Object System.Windows.Forms.Label
    $status.Text = 'التحقق من بيئة Word والكتالوج المسجّل...'
    $status.TextAlign = 'MiddleRight'
    $status.SetBounds(24,66,530,28)
    $form.Controls.Add($status)

    $bar = New-Object System.Windows.Forms.ProgressBar
    $bar.Minimum = 0
    $bar.Maximum = 100
    $bar.Value = 3
    $bar.SetBounds(24,111,530,20)
    $form.Controls.Add($bar)

    $note = New-Object System.Windows.Forms.Label
    $note.Text = 'لن تُنشأ مشاركة جديدة، ولن تُمس إضافات Word الأخرى.'
    $note.TextAlign = 'MiddleRight'
    $note.ForeColor = [System.Drawing.Color]::DimGray
    $note.SetBounds(24,143,530,24)
    $form.Controls.Add($note)

    $script:Form = $form
    $script:StatusLabel = $status
    $script:ProgressBar = $bar
    $form.Show()
    $form.Refresh()
    [System.Windows.Forms.Application]::DoEvents()
}

function Get-ManifestAppId([string]$Path) {
    [xml]$document = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $node = $document.SelectSingleNode("/*[local-name()='OfficeApp']/*[local-name()='Id']")
    if (-not $node -or [string]::IsNullOrWhiteSpace($node.InnerText)) {
        throw ('ملف Manifest لا يحتوي على معرّف إضافة Office صالح: ' + $Path)
    }
    return $node.InnerText.Trim().ToLowerInvariant()
}

function Test-WritableDirectory([string]$Path) {
    try {
        if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
        $probe = Join-Path $Path ('.quranayh-' + [Guid]::NewGuid().ToString('N') + '.tmp')
        [IO.File]::WriteAllText($probe,'probe',[Text.Encoding]::UTF8)
        Remove-Item -LiteralPath $probe -Force -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

function Get-RegisteredResearchCatalog {
    $registryRoot = 'HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs'
    if (-not (Test-Path -LiteralPath $registryRoot)) {
        throw 'لم يُعثر على كتالوج Office موثوق مسجّل لهذا المستخدم. لن ينشئ المثبّت كتالوجًا جديدًا.'
    }

    $candidates = @()
    foreach ($key in @(Get-ChildItem -LiteralPath $registryRoot -ErrorAction SilentlyContinue)) {
        try {
            $properties = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop
            $path = [string]$properties.Url
            if (-not $path.StartsWith('\\')) { continue }
            if (-not (Test-WritableDirectory $path)) { continue }

            $assistantFiles = @()
            foreach ($file in @(Get-ChildItem -LiteralPath $path -Filter '*.xml' -File -ErrorAction Stop)) {
                try {
                    if ((Get-ManifestAppId -Path $file.FullName) -eq $AssistantAppId) {
                        $assistantFiles += $file.FullName
                    }
                }
                catch {
                    # Leave malformed and unrelated XML files untouched.
                }
            }

            $catalogId = [string]$properties.Id
            if (-not $catalogId) { $catalogId = [string]$key.PSChildName }
            $normalizedId = $catalogId.Replace('{','').Replace('}','')
            $candidates += [pscustomobject]@{
                Path = $path
                Id = $catalogId
                NormalizedId = $normalizedId
                AssistantFiles = $assistantFiles
                IsPreferred = ($normalizedId -ieq $PreferredCatalogId)
            }
        }
        catch {
            # Inaccessible catalog entries are not candidates.
        }
    }

    $matching = @($candidates | Where-Object { $_.AssistantFiles.Count -eq 1 })
    if ($matching.Count -gt 1) {
        $preferred = @($matching | Where-Object { $_.IsPreferred })
        if ($preferred.Count -eq 1) { $matching = $preferred }
    }
    if ($matching.Count -ne 1) {
        throw 'تعذر تحديد كتالوج أدوات الباحث بصورة فريدة. يجب أن يحتوي الكتالوج المسجّل على نسخة واحدة من إضافة أدوات الباحث، ولن ينشئ المثبّت مشاركة بديلة.'
    }

    Write-SetupLog ('الكتالوج المعتمد: ' + $matching[0].Path + ' | Registry ID: ' + $matching[0].Id)
    return [string]$matching[0].Path
}

function Assert-SourceManifest([string]$Path) {
    $id = Get-ManifestAppId -Path $Path
    if ($id -ne $ConverterAppId) {
        throw 'معرّف محوّل الآيات في ملف التثبيت لا يطابق المعرّف الأصلي؛ أُلغي التثبيت حمايةً من إنشاء إضافة مكررة.'
    }

    [xml]$document = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $source = $document.SelectSingleNode("/*[local-name()='OfficeApp']/*[local-name()='DefaultSettings']/*[local-name()='SourceLocation']")
    if (-not $source -or $source.GetAttribute('DefaultValue') -ne 'https://moh1983taher-ai.github.io/Quran-Ayah-Converter/taskpane.html') {
        throw 'رابط تشغيل محوّل الآيات في ملف Manifest غير مطابق للموقع المنشور.'
    }
}

function Install-ConverterManifest([string]$CatalogPath,[string]$SourcePath) {
    $sameIdFiles = @()
    foreach ($file in @(Get-ChildItem -LiteralPath $CatalogPath -Filter '*.xml' -File -ErrorAction Stop)) {
        try {
            if ((Get-ManifestAppId -Path $file.FullName) -eq $ConverterAppId) {
                $sameIdFiles += $file
            }
        }
        catch {
            # Do not alter unrelated XML files that cannot be parsed.
        }
    }

    if ($sameIdFiles.Count -gt 1) {
        throw 'يوجد أكثر من Manifest يحمل معرّف محوّل الآيات داخل الكتالوج؛ أوقف المثبّت التعديل لتجنب تكرار الإضافة.'
    }

    $destinationName = 'QuranAyahConverter.xml'
    if ($sameIdFiles.Count -eq 1) {
        $destinationName = $sameIdFiles[0].Name
    }

    $destination = Join-Path $CatalogPath $destinationName
    if (($sameIdFiles.Count -eq 0) -and (Test-Path -LiteralPath $destination -PathType Leaf)) {
        throw ('يوجد ملف بالاسم المطلوب لكنه لا يحمل معرّف محوّل الآيات؛ لن يستبدله المثبّت: ' + $destination)
    }

    if (-not (Test-WritableDirectory $CatalogPath)) {
        throw ('مجلد الكتالوج غير قابل للكتابة: ' + $CatalogPath)
    }

    $protectedHashes = @{}
    foreach ($file in @(Get-ChildItem -LiteralPath $CatalogPath -Filter '*.xml' -File -ErrorAction Stop)) {
        if ($file.FullName -ine $destination) {
            $protectedHashes[$file.FullName] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        }
    }

    $sourceHash = (Get-FileHash -LiteralPath $SourcePath -Algorithm SHA256).Hash
    $temporary = Join-Path $CatalogPath ('.QuranAyahConverter-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $backupPath = $null
    $hadExisting = Test-Path -LiteralPath $destination -PathType Leaf
    $committed = $false

    try {
        Copy-Item -LiteralPath $SourcePath -Destination $temporary -Force
        if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $sourceHash) {
            throw 'فشل التحقق من سلامة ملف Manifest المؤقت قبل تثبيته.'
        }
        Assert-SourceManifest -Path $temporary

        if ($hadExisting) {
            $backupName = 'QuranAyahConverter-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.xml'
            $backupPath = Join-Path $BackupDirectory $backupName
            Copy-Item -LiteralPath $destination -Destination $backupPath -ErrorAction Stop
            $oldHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
            if ((Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash -ne $oldHash) {
                throw 'تعذر التحقق من النسخة الاحتياطية؛ لم يُستبدل ملف Manifest الحالي.'
            }
            Write-SetupLog ('نسخة احتياطية محفوظة: ' + $backupPath)
            Move-Item -LiteralPath $temporary -Destination $destination -Force
        }
        else {
            Move-Item -LiteralPath $temporary -Destination $destination
        }

        if ((Get-ManifestAppId -Path $destination) -ne $ConverterAppId) {
            throw 'فشل التحقق النهائي من معرّف الإضافة بعد النسخ.'
        }
        if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $sourceHash) {
            throw 'فشل التحقق النهائي من بصمة ملف Manifest بعد النسخ.'
        }

        foreach ($path in $protectedHashes.Keys) {
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
                throw ('اختفى ملف آخر من الكتالوج أثناء التثبيت: ' + $path)
            }
            if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $protectedHashes[$path]) {
                throw ('تغير ملف آخر في الكتالوج أثناء التثبيت؛ يلزم فحصه: ' + $path)
            }
        }

        $committed = $true
        Write-SetupLog ('تم تثبيت محوّل الآيات دون تغيير بقية ملفات الكتالوج: ' + $destination)
        return $destination
    }
    catch {
        if (-not $committed) {
            if ($hadExisting -and $backupPath -and (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
                try {
                    $restore = $destination + '.restore'
                    Copy-Item -LiteralPath $backupPath -Destination $restore -Force
                    Move-Item -LiteralPath $restore -Destination $destination -Force
                    Write-SetupLog 'تمت استعادة Manifest السابق بعد فشل التحقق.'
                }
                catch {
                    Write-SetupLog ('تعذر استعادة Manifest السابق تلقائيًا: ' + $_.Exception.Message)
                }
            }
            elseif (-not $hadExisting -and (Test-Path -LiteralPath $destination -PathType Leaf)) {
                Remove-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue
            }
        }
        throw
    }
    finally {
        if (Test-Path -LiteralPath $temporary -PathType Leaf) {
            Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
        }
    }
}

$exitCode = 0
try {
    Show-ProgressWindow
    Set-Stage 8 'التحقق من إغلاق Microsoft Word...'
    if (@(Get-Process -Name WINWORD -ErrorAction SilentlyContinue).Count -gt 0) {
        throw 'أغلق Microsoft Word بالكامل قبل تثبيت الإضافة، ثم أعد تشغيل ملف Setup.'
    }

    Set-Stage 22 'التحقق من ملف Manifest ومعرّف الإضافة الأصلي...'
    Assert-SourceManifest -Path $ManifestFile

    Set-Stage 42 'العثور على كتالوج أدوات الباحث المسجّل في Word...'
    $catalog = Get-RegisteredResearchCatalog

    Set-Stage 64 'حفظ نسخة احتياطية وفحص عدم تعارض أسماء الملفات...'
    $installedPath = Install-ConverterManifest -CatalogPath $catalog -SourcePath $ManifestFile

    Set-Stage 92 'التحقق من بقاء أدوات الباحث وبقية الإضافات دون تغيير...'
    $assistantPresent = $false
    foreach ($file in @(Get-ChildItem -LiteralPath $catalog -Filter '*.xml' -File)) {
        try {
            if ((Get-ManifestAppId -Path $file.FullName) -eq $AssistantAppId) { $assistantPresent = $true }
        }
        catch { }
    }
    if (-not $assistantPresent) {
        throw 'اكتمل نسخ المحوّل، لكن تعذر التحقق من بقاء إضافة أدوات الباحث داخل الكتالوج.'
    }

    Set-Stage 100 'اكتمل تثبيت محوّل الآيات في كتالوج Word المشترك بنجاح.'
    Write-SetupLog ('SUCCESS: ' + $installedPath)
    [System.Windows.Forms.MessageBox]::Show(
        ('تم تثبيت محوّل الآيات بنجاح.' + [Environment]::NewLine + [Environment]::NewLine +
         'الكتالوج: ' + $catalog + [Environment]::NewLine +
         'الملف: ' + $installedPath + [Environment]::NewLine + [Environment]::NewLine +
         'احتُفظ بإضافات الكتالوج الأخرى دون تعديل.'),
        'اكتمل التثبيت',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
}
catch {
    $exitCode = 1
    $message = $_.Exception.Message
    try { Write-SetupLog ('ERROR: ' + $message) } catch { }
    $details = 'تعذر تثبيت محوّل الآيات:' + [Environment]::NewLine + $message +
        [Environment]::NewLine + [Environment]::NewLine +
        'لم ينشئ المثبّت كتالوجًا جديدًا، ولم يتعمد حذف أي إضافة.' +
        [Environment]::NewLine + 'سجل العملية: ' + $LogFile
    try {
        [System.Windows.Forms.MessageBox]::Show(
            $details,
            'تعذر إكمال التثبيت',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
    catch {
        Write-Error $details
    }
}
finally {
    if ($script:Form) {
        $script:Form.Close()
        $script:Form.Dispose()
    }
}

exit $exitCode
