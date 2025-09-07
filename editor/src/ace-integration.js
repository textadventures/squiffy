import * as ace from 'ace-builds/src-noconflict/ace';
import 'ace-builds/src-noconflict/mode-markdown';
import 'ace-builds/src-noconflict/ext-searchbox';

export const init = () => {
    ace.define('ace/theme/squiffy', [], function (require, exports, module) {
        exports.isDark = false;
        exports.cssClass = 'ace-squiffy';
        exports.cssText = `
            /* syntax highlighting: section and passage inline links */
            .ace-squiffy .ace_markup.ace_link.ace_section,
            .ace-squiffy .ace_markup.ace_link.ace_passage {
                color: #0066cc;
                text-decoration: underline;
            }
        `;
    });

    ace.define('ace/folding/squiffy', [], function (require, exports, module) {
        var oop = require('ace/lib/oop');
        var BaseFoldMode = require('ace/mode/folding/markdown').FoldMode;
        var FoldMode = function () { };
        oop.inherits(FoldMode, BaseFoldMode);
        exports.FoldMode = FoldMode;

        (function () {
            this.foldingStartMarker = /^(?:\[\[(.*)\]\]:|\[(.*)\]:)$/;
        }).call(FoldMode.prototype);
    });

    ace.define('ace/mode/squiffy', [], function (require, exports, module) {
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
                    // Inline section links: [[...]] with optional (target)
                    {
                        token: 'markup.link.section',
                        regex: /\[\[(?:\\.|[^\]\r\n])+]](?:\((?:\\.|[^)\r\n])+\))?(?=$|[\s.,:;!?\)\]"'’”»])/
                    },
                    // Inline passage links: [...] with optional (target)
                    {
                        token: 'markup.link.passage',
                        regex: /\[(?:\\.|[^\]\r\n])+](?:\((?:\\.|[^)\r\n])+\))?(?=$|[\s.,:;!?\)\]"'’”»])/
                    },
                    {
                        token: 'support.other',
                        regex: /<\!\-\-[\s\S]*?\-\->/
                    },
                    {
                        token: 'support.variable',
                        regex: /^\@(clear|set|start|title|import|unset|inc|dec|ui)(.*)$/
                    },
                    {
                        token: 'string',
                        regex: /\{\{(.*)\}\}/
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