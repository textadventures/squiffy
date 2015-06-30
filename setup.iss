#define SquiffyVersion '3.9.0'
#define SetupVersion '390'

[Setup]
AppName=Squiffy
AppVersion={#SquiffyVersion}
AppVerName=Squiffy {#SquiffyVersion}
AppCopyright=Copyright © 2015 Alex Warren
VersionInfoVersion={#SquiffyVersion}
AppPublisher=Alex Warren
AppPublisherURL=http://textadventures.co.uk/
AppSupportURL=http://textadventures.co.uk/help
AppUpdatesURL=http://textadventures.co.uk/squiffy
OutputBaseFilename=squiffy{#SetupVersion}
DefaultGroupName=Squiffy
DefaultDirName={pf}\Squiffy
UninstallDisplayIcon={app}\Squiffy.exe
OutputDir=..\Output
SourceDir=Squiffy-win32
AllowNoIcons=yes
SolidCompression=yes
PrivilegesRequired=admin
ChangesAssociations=yes
MinVersion=5.1sp3
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
Root: HKCR; Subkey: "Squiffy"; ValueType: string; ValueName: ""; ValueData: "Squiffy Script"; Flags: uninsdeletekey
Root: HKCR; Subkey: "Squiffy\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\Squiffy.exe,0"
Root: HKCR; Subkey: "Squiffy\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Squiffy.exe"" ""%1"""