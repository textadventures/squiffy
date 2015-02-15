if (process.platform =='darwin') {
    var gui = require('nw.gui');
    var mb = new gui.Menu({type:'menubar'});
    mb.createMacBuiltin('Squiffy');
    gui.Window.get().menu = mb;
}