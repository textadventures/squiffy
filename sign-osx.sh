rm Squiffy.app/Contents/Frameworks/Electron\ Helper.app/Contents/MacOS/Electron\ Helper.cstemp
rm Squiffy.app/Contents/Frameworks/Electron\ Helper\ EH.app/Contents/MacOS/Electron\ Helper\ EH.cstemp
rm Squiffy.app/Contents/Frameworks/Electron\ Helper\ NP.app/Contents/MacOS/Electron\ Helper\ NP.cstemp
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy.app/Contents/Frameworks/Electron\ Helper.app
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy.app/Contents/Frameworks/Electron\ Helper\ EH.app
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy.app/Contents/Frameworks/Electron\ Helper\ NP.app
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy.app/Contents/Frameworks/Electron\ Framework.framework/Versions/Current/Electron\ Framework
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy.app/Contents/Frameworks/Electron\ Framework.framework
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy.app/Contents/Frameworks/Mantle.framework
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy.app/Contents/Frameworks/ReactiveCocoa.framework
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy.app/Contents/Frameworks/Squirrel.framework
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy.app
spctl --verbose=4 --assess --type execute Squiffy.app