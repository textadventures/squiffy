#define SquiffyVersion '5.1.2'
#define SetupVersion '512'

[Setup]
AppName=Squiffy
AppVersion={#SquiffyVersion}
AppVerName=Squiffy {#SquiffyVersion}
AppCopyright=Copyright © 2017 Luis Felipe Morales
VersionInfoVersion={#SquiffyVersion}
AppPublisher=Luis Felipe Morales
AppPublisherURL=https://textadventures.co.uk/
AppSupportURL=https://textadventures.co.uk/help
AppUpdatesURL=https://textadventures.co.uk/squiffy
OutputBaseFilename=squiffy{#SetupVersion}
DefaultGroupName=Squiffy
DefaultDirName={pf}\Squiffy
UninstallDisplayIcon={app}\Squiffy.exe
OutputDir=..\Output
SourceDir=Squiffy-win32-ia32
AllowNoIcons=yes
SolidCompression=yes
PrivilegesRequired=admin
ChangesAssociations=yes
MinVersion=6.1
UsePreviousSetupType=no

[Files]
Source: "*.*"; DestDir: "{app}"; Flags: recursesubdirs

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Icons]
Name: "{group}\Squiffy"; Filename: "{app}\Squiffy.exe"
Name: "{commondesktop}\Squiffy"; Filename: "{app}\Squiffy.exe"; Tasks: desktopicon; WorkingDir: {app}

[Run]
Filename: "{app}\Squiffy.exe"; Description: "Launch Squiffy"; Flags: nowait postinstall skipifsilent

[Registry]
; File association: .squiffy
Root: HKCR; Subkey: ".squiffy"; ValueType: string; ValueName: ""; ValueData: "Squiffy"; Flags: uninsdeletevalue
Root: HKCR; Subkey: ".sq"; ValueType: string; ValueName: ""; ValueData: "Squiffy"; Flags: uninsdeletevalue
Root: HKCR; Subkey: "Squiffy"; ValueType: string; ValueName: ""; ValueData: "Squiffy Script"; Flags: uninsdeletekey
Root: HKCR; Subkey: "Squiffy\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\Squiffy.exe,0"
Root: HKCR; Subkey: "Squiffy\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Squiffy.exe"" ""%1"""