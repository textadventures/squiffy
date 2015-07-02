rm -r Squiffy.app
rm -r build

mkdir -p build/bower_components/bootstrap
cp -r bower_components/bootstrap/dist build/bower_components/bootstrap

mkdir -p build/bower_components/jquery/dist
cp bower_components/jquery/dist/jquery.min.js build/bower_components/jquery/dist

mkdir -p build/bower_components/ace-builds/src-min
cp bower_components/ace-builds/src-min/ace.js build/bower_components/ace-builds/src-min
cp bower_components/ace-builds/src-min/theme-eclipse.js build/bower_components/ace-builds/src-min
cp bower_components/ace-builds/src-min/mode-markdown.js build/bower_components/ace-builds/src-min

mkdir -p build/bower_components/jquery-ui
cp bower_components/jquery-ui/jquery-ui.min.js build/bower_components/jquery-ui

mkdir -p build/bower_components/jquery-ui-layout-bower/source/stable
cp bower_components/jquery-ui-layout-bower/source/stable/jquery.layout.min.js build/bower_components/jquery-ui-layout-bower/source/stable

mkdir -p build/bower_components/bootbox
cp bower_components/bootbox/bootbox.js build/bower_components/bootbox

cp desktop.* build
cp editor.css build
cp index.html build
cp *.js build
cp -r node_modules build
cp package.json build
cp squiffy.png build

electron-packager ./build Squiffy --platform=darwin --arch=x64 --version=0.27.3 --app-bundle-id=uk.co.textadventures.squiffy --helper-bundle-id=uk.co.textadventures.squiffy.helper --icon=squiffy.icns --app-version=3.9.0
cp file\ association\ -\ Info.plist Squiffy.app/Contents/Info.plist
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -lint -f Squiffy.app