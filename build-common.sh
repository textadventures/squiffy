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

mkdir -p build/bower_components/chosen
cp bower_components/chosen/chosen.jquery.min.js build/bower_components/chosen
cp bower_components/chosen/chosen.min.css build/bower_components/chosen
cp bower_components/chosen/*.png build/bower_components/chosen

cp desktop.* build
cp editor.css build
cp example.squiffy build
cp desktop.html build
cp *.js build
cp -r node_modules build
cp package.json build
cp squiffy.png build