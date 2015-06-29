rm -r Squiffy.app
electron-packager ./ Squiffy --platform=darwin --arch=x64 --version=0.27.3 --app-bundle-id=uk.co.textadventures.squiffy --helper-bundle-id=uk.co.textadventures.squiffy.helper --icon=squiffy.icns --app-version=3.9.0
cp file\ association\ -\ Info.plist Squiffy.app/Contents/Info.plist
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -lint -f Squiffy.app