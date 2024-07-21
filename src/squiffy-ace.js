export const init = () => {
    define('ace/theme/squiffy', [], function (require, exports, module) {
        exports.isDark = false;
        exports.cssClass = 'ace-squiffy';
    });

    define('ace/folding/squiffy', [], function (require, exports, module) {
        var oop = require('ace/lib/oop');
        var BaseFoldMode = require('ace/mode/folding/markdown').FoldMode;
        var FoldMode = function () { };
        oop.inherits(FoldMode, BaseFoldMode);
        exports.FoldMode = FoldMode;

        (function () {
            this.foldingStartMarker = /^(?:\[\[(.*)\]\]:|\[(.*)\]:)$/;
        }).call(FoldMode.prototype);
    });

    define('ace/mode/squiffy', [], function (require, exports, module) {
        var oop = require('ace/lib/oop');
        var MarkdownMode = require('ace/mode/markdown').Mode;
        var TextHighlightRules = require('ace/mode/text_highlight_rules').TextHighlightRules;
        var JsHighlightRules = require('ace/mode/javascript_highlight_rules').JavaScriptHighlightRules;
        var SquiffyFoldMode = require('ace/folding/squiffy').FoldMode;

        var Mode = function () {
            this.HighlightRules = SquiffyHighlightRules;
            this.foldingRules = new SquiffyFoldMode();
        };
        oop.inherits(Mode, MarkdownMode);
        exports.Mode = Mode;

        var SquiffyHighlightRules = function () {
            this.$rules = {
                'start': [
                    {
                        token: 'markup.heading.section',
                        regex: /^\[\[(.*)\]\]:$/
                    },
                    {
                        token: 'markup.heading.passage',
                        regex: /^\[(.*)\]:$/
                    },
                    {
                        token: 'keyword',
                        regex: /^(\t| {4})/,
                        next: 'js-start'
                    },
                    {
                        token: 'markup.heading.passage',
                        regex: /(\[\[[\s\S]*?\]\](\,|\.|\s|\:|\;)|\[\[[\s\S]*?\]\]\([\s\S]*?\))/
                    },
                    {
                        token: 'constant.language',
                        regex: /(\[[\s\S]*?\](\,|\.|\s|\:|\;)|\[[\s\S]*?\]\([\s\S]*?\))/
                    },
                    {
                        token: 'support.other',
                        regex: /<\!\-\-[\s\S]*?\-\->/
                    },
                    {
                        token: 'support.variable',
                        regex: /^\@(clear|set|start|replace|title|import|unset|inc|dec)(.*)$/
                    },
                    {
                        token: 'string',
                        regex: /\{(.*)(\}|\}\})/
                    },
                    {
                        token: 'support.other',
                        regex: /^\+\+\+(.*)$/
                    },
                    {
                        token: 'storage.type',
                        regex: /<(.*)>/
                    }

                ]
            };

            this.embedRules(JsHighlightRules, 'js-', [{
                token: 'keyword',
                regex: '$',
                next: 'start'
            }]);
        };
        oop.inherits(SquiffyHighlightRules, TextHighlightRules);
        exports.SquiffyHighlightRules = SquiffyHighlightRules;
    });
};