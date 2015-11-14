del /s /q build

md build\bower_components\bootstrap
robocopy bower_components\bootstrap\dist build\bower_components\bootstrap\dist /s

md build\bower_components\jquery\dist
copy bower_components\jquery\dist\jquery.min.js build\bower_components\jquery\dist

md build\bower_components\ace-builds\src-min
copy bower_components\ace-builds\src-min\ace.js build\bower_components\ace-builds\src-min
copy bower_components\ace-builds\src-min\theme-eclipse.js build\bower_components\ace-builds\src-min
copy bower_components\ace-builds\src-min\mode-markdown.js build\bower_components\ace-builds\src-min

md build\bower_components\jquery-ui
copy bower_components\jquery-ui\jquery-ui.min.js build\bower_components\jquery-ui

md build\bower_components\jquery-ui-layout-bower\source\stable
copy bower_components\jquery-ui-layout-bower\source\stable\jquery.layout.min.js build\bower_components\jquery-ui-layout-bower\source\stable

md build\bower_components\bootbox
copy bower_components\bootbox\bootbox.js build\bower_components\bootbox

md build\bower_components\chosen
copy bower_components\chosen\chosen.jquery.min.js build\bower_components\chosen
copy bower_components\chosen\chosen.min.css build\bower_components\chosen
copy bower_components\chosen\*.png build\bower_components\chosen

copy desktop.* build
copy editor.css build
copy example.squiffy build
copy index.html build
copy *.js build
md build\node_modules
robocopy node_modules build\node_modules /s
copy package.json build
copy squiffy.png build

electron-packager build Squiffy --platform=win32 --arch=ia32 --version=0.34.3 --app-bundle-id=uk.co.textadventures.squiffy --icon=squiffy.ico --app-version=5.0.0 --ignore=Output --version-string.ProductName=Squiffy --version-string.FileDescription=Squiffy --version-string.LegalCopyright="Copyright (c) 2015 Alex Warren" --version-string.OriginalFilename=Squiffy.exe --version-string.FileVersion=5.0.0 --version-string.ProductVersion=5.0.0 --version-string.InternalName=Squiffy --version-string.CompanyName="Alex Warren"