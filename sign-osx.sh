rm Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squiffy\ Helper.app/Contents/MacOS/Squiffy\ Helper.cstemp
rm Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squiffy\ Helper\ EH.app/Contents/MacOS/Squiffy\ Helper\ EH.cstemp
rm Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squiffy\ Helper\ NP.app/Contents/MacOS/Squiffy\ Helper\ NP.cstemp
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squiffy\ Helper.app
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squiffy\ Helper\ EH.app/Contents/MacOS/Squiffy\ Helper\ EH
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squiffy\ Helper\ EH.app
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squiffy\ Helper\ NP.app/Contents/MacOS/Squiffy\ Helper\ NP
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squiffy\ Helper\ NP.app
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Electron\ Framework.framework/Versions/Current/Electron\ Framework
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Electron\ Framework.framework
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Mantle.framework
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/ReactiveCocoa.framework
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squirrel.framework
codesign -s "Developer ID Application: Alex Warren (6RPC48SJ57)" Squiffy-darwin-x64/Squiffy.app
spctl --verbose=4 --assess --type execute Squiffy-darwin-x64/Squiffy.app