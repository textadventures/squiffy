./build-common.sh

rm -r Squiffy.app

electron-packager ./build Squiffy --platform=darwin --arch=x64 --version=0.33.3 --app-bundle-id=uk.co.textadventures.squiffy --helper-bundle-id=uk.co.textadventures.squiffy.helper --icon=squiffy.icns --app-version=4.0.0
cp file\ association\ -\ Info.plist Squiffy.app/Contents/Info.plist
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -lint -f Squiffy.app