#define MyAppName "محوّل الآيات القرآنية"
#define MyAppVersion "1.0.0"

[Setup]
AppId={{9A9B5F13-7EA6-4E2A-9232-2F6A7D5A1D44}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=Quran Ayah Converter
DefaultDirName={tmp}\QuranAyahConverterSetup
DisableDirPage=yes
CreateAppDir=no
Uninstallable=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x86 x64
ArchitecturesInstallIn64BitMode=x64
OutputDir=..\dist
OutputBaseFilename=QuranAyahConverter-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
DisableReadyMemo=yes
DisableReadyPage=yes
UsePreviousAppDir=no
ShowLanguageDialog=no
LanguageDetectionMethod=none

[Languages]
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"

[Files]
Source: "..\manifest.xml"; DestDir: "{tmp}"; Flags: dontcopy
Source: "Install-QuranAyahConverter.ps1"; DestDir: "{tmp}"; Flags: dontcopy

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  PowerShellPath: String;
  ScriptPath: String;
  ManifestPath: String;
  Parameters: String;
begin
  if CurStep = ssPostInstall then
  begin
    ExtractTemporaryFile('manifest.xml');
    ExtractTemporaryFile('Install-QuranAyahConverter.ps1');

    PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
    ScriptPath := ExpandConstant('{tmp}\Install-QuranAyahConverter.ps1');
    ManifestPath := ExpandConstant('{tmp}\manifest.xml');
    Parameters := '-NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "' +
      ScriptPath + '" -ManifestFile "' + ManifestPath + '"';

    if not Exec(PowerShellPath, Parameters, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    begin
      MsgBox('تعذر تشغيل مكوّن تثبيت محوّل الآيات.', mbError, MB_OK);
      RaiseException('تعذر تشغيل PowerShell.');
    end;

    if ResultCode <> 0 then
    begin
      MsgBox('لم يكتمل تثبيت محوّل الآيات. راجع سجل التثبيت داخل مجلد ResearchTools ثم أعد المحاولة.', mbError, MB_OK);
      RaiseException('فشل تثبيت محوّل الآيات. ExitCode=' + IntToStr(ResultCode));
    end;
  end;
end;
