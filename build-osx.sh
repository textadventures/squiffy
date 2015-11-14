./build-common.sh

rm -r Squiffy-darwin-x64/

# electron-packager supports this option:
#   --sign="Developer ID Application: Alex Warren (6RPC48SJ57)"
# but we're hacking in a custom Info.plist so we sign afterwards

electron-packager ./build Squiffy --platform=darwin --arch=x64 --version=0.34.3 --app-bundle-id=uk.co.textadventures.squiffy --helper-bundle-id=uk.co.textadventures.squiffy.helper --icon=squiffy.icns --app-version=5.0.0
cp file\ association\ -\ Info.plist Squiffy-darwin-x64/Squiffy.app/Contents/Info.plist
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -lint -f Squiffy-darwin-x64/Squiffy.app