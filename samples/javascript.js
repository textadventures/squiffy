// Created with Squiffy 2.4.0
// https://github.com/textadventures/squiffy

(function(){
/* jshint quotmark: single */
/* jshint evil: true */

var squiffy = {};

(function () {
    'use strict';

    squiffy.story = {
        begin: function () {
            squiffy.ui.output.on('click', 'a.squiffy-link', function (event) {
                if ($(this).hasClass('disabled')) return;
                var passage = $(this).data('passage');
                var section = $(this).data('section');
                var rotate = $(this).attr('data-rotate');
                var sequence = $(this).attr('data-sequence');
                if (passage) {
                    $(this).addClass('disabled');
                    squiffy.set('_turncount', squiffy.get('_turncount') + 1);
                    passage = squiffy.story.processLink(passage);
                    if (passage) {
                        squiffy.ui.currentSection.append('<hr/>');
                        squiffy.story.passage(passage);
                    }
                    var turnPassage = '@' + squiffy.get('_turncount');
                    if (turnPassage in squiffy.story.section.passages) {
                        squiffy.story.passage(turnPassage);
                    }
                }
                else if (section) {
                    squiffy.ui.currentSection.append('<hr/>');
                    $(this).addClass('disabled');
                    section = squiffy.story.processLink(section);
                    squiffy.story.go(section);
                }
                else if (rotate || sequence) {
                    var result = squiffy.util.rotate(rotate || sequence, rotate ? $(this).text() : '');
                    $(this).html(result[0].replace(/&quot;/g, '"').replace(/&#39;/g, '\''));
                    var dataAttribute = rotate ? 'data-rotate' : 'data-sequence';
                    $(this).attr(dataAttribute, result[1]);
                    if (!result[1]) {
                        $(this).addClass('disabled');
                    }
                    if ($(this).attr('data-attribute')) {
                        squiffy.set($(this).attr('data-attribute'), result[0]);
                    }
                    squiffy.story.save();
                }
            });
            squiffy.ui.output.on('mousedown', 'a.squiffy-link', function (event) {
                event.preventDefault();
            });
            if (!squiffy.story.load()) {
                squiffy.story.go(squiffy.story.start);
            }
        },
        processLink: function(link) {
            var sections = link.split(',');
            var first = true;
            var target = null;
            sections.forEach(function (section) {
                section = section.trim();
                if (squiffy.util.startsWith(section, '@replace ')) {
                    squiffy.story.replaceLabel(section.substring(9));
                }
                else {
                    if (first) {
                        target = section;
                    }
                    else {
                        squiffy.story.setAttribute(section);
                    }
                }
                first = false;
            });
            return target;
        },
        setAttribute: function(expr) {
            var lhs, rhs, op, value;
            var setRegex = /^([\w]*)\s*=\s*(.*)$/;
            var setMatch = setRegex.exec(expr);
            if (setMatch) {
                lhs = setMatch[1];
                rhs = setMatch[2];
                if (isNaN(rhs)) {
                    squiffy.set(lhs, rhs);
                }
                else {
                    squiffy.set(lhs, parseFloat(rhs));
                }
            }
            else {
                var incDecRegex = /^([\w]*)\s*([\+\-])=\s*(.*)$/;
                var incDecMatch = incDecRegex.exec(expr);
                if (incDecMatch) {
                    lhs = incDecMatch[1];
                    op = incDecMatch[2];
                    rhs = parseFloat(incDecMatch[3]);
                    value = squiffy.get(lhs);
                    if (value === null) value = 0;
                    if (op == '+') {
                        value += rhs;
                    }
                    if (op == '-') {
                        value -= rhs;
                    }
                    squiffy.set(lhs, value);
                }
                else {
                    value = true;
                    if (squiffy.util.startsWith(expr, 'not ')) {
                        expr = expr.substring(4);
                        value = false;
                    }
                    squiffy.set(expr, value);
                }
            }
        },
        replaceLabel: function(expr) {
            var regex = /^([\w]*)\s*=\s*(.*)$/;
            var match = regex.exec(expr);
            if (!match) return;
            var label = match[1];
            var text = match[2];
            if (text in squiffy.story.section.passages) {
                text = squiffy.story.section.passages[text].text;
            }
            else if (text in squiffy.story.sections) {
                text = squiffy.story.sections[text].text;
            }
            var stripParags = /^<p>(.*)<\/p>$/;
            var stripParagsMatch = stripParags.exec(text);
            if (stripParagsMatch) {
                text = stripParagsMatch[1];
            }
            var $labels = $('.squiffy-label-' + label);
            $labels.fadeOut(1000, function() {
                $labels.html(squiffy.ui.processText(text));
                $labels.fadeIn(1000, function() {
                    squiffy.story.save();
                });
            });
        },
        go: function(section) {
            squiffy.set('_transition', null);
            squiffy.ui.newSection();
            squiffy.story.section = squiffy.story.sections[section];
            if (!squiffy.story.section) return;
            squiffy.set('_section', section);
            squiffy.story.setSeen(section);
            var master = squiffy.story.sections[''];
            if (master) {
                squiffy.story.run(master);
                squiffy.ui.write(master.text);
            }
            squiffy.story.run(squiffy.story.section);
            // The JS might have changed which section we're in
            if (squiffy.get('_section') == section) {
                squiffy.set('_turncount', 0);
                squiffy.ui.write(squiffy.story.section.text);
                squiffy.story.save();
            }
        },
        run: function(section) {
            if (section.clear) {
                squiffy.ui.clearScreen();
            }
            if (section.attributes) {
                squiffy.story.processAttributes(section.attributes);
            }
            if (section.js) {
                section.js();
            }
        },
        passage: function(passageName) {
            var passage = squiffy.story.section.passages[passageName];
            if (!passage) return;
            squiffy.story.setSeen(passageName);
            var masterSection = squiffy.story.sections[''];
            if (masterSection) {
                var masterPassage = masterSection.passages[''];
                if (masterPassage) {
                    squiffy.story.run(masterPassage);
                    squiffy.ui.write(masterPassage.text);
                }
            }
            var master = squiffy.story.section.passages[''];
            if (master) {
                squiffy.story.run(master);
                squiffy.ui.write(master.text);
            }
            squiffy.story.run(passage);
            squiffy.ui.write(passage.text);
            squiffy.story.save();
        },
        processAttributes: function(attributes) {
            attributes.forEach(function (attribute) {
                if (squiffy.util.startsWith(attribute, '@replace ')) {
                    squiffy.story.replaceLabel(attribute.substring(9));
                }
                else {
                    squiffy.story.setAttribute(attribute);
                }
            });
        },
        restart: function() {
            if (squiffy.ui.settings.persist && window.localStorage) {
                var keys = Object.keys(localStorage);
                $.each(keys, function (idx, key) {
                    if (squiffy.util.startsWith(key, squiffy.story.id)) {
                        localStorage.removeItem(key);
                    }
                });
            }
            else {
                squiffy.storageFallback = {};
            }
            if (squiffy.ui.settings.scroll === 'element') {
                squiffy.ui.output.html('');
                squiffy.story.begin();
            }
            else {
                location.reload();
            }
        },
        save: function() {
            squiffy.set('_output', squiffy.ui.output.html());
        },
        load: function() {
            var output = squiffy.get('_output');
            if (!output) return false;
            squiffy.ui.output.html(output);
            squiffy.ui.currentSection = $('#' + squiffy.get('_output-section'));
            squiffy.story.section = squiffy.story.sections[squiffy.get('_section')];
            var transition = squiffy.get('_transition');
            if (transition) {
                eval('(' + transition + ')()');
            }
            return true;
        },
        setSeen: function(sectionName) {
            var seenSections = squiffy.get('_seen_sections');
            if (!seenSections) seenSections = [];
            if (seenSections.indexOf(sectionName) == -1) {
                seenSections.push(sectionName);
                squiffy.set('_seen_sections', seenSections);
            }
        },
        seen: function(sectionName) {
            var seenSections = squiffy.get('_seen_sections');
            if (!seenSections) return false;
            return (seenSections.indexOf(sectionName) > -1);
        }
    };
    
    squiffy.ui = {
        sectionCount: 0,
        currentSection: null,
        screenIsClear: true,
        scrollPosition: 0,
        newSection: function() {
            if (squiffy.ui.currentSection) {
                $('.squiffy-link', squiffy.ui.currentSection).addClass('disabled');
            }
            var sectionCount = squiffy.get('_section-count') + 1;
            squiffy.set('_section-count', sectionCount);
            var id = 'squiffy-section-' + sectionCount;
            squiffy.ui.currentSection = $('<div/>', {
                id: id,
            }).appendTo(squiffy.ui.output);
            squiffy.set('_output-section', id);
        },
        write: function(text) {
            squiffy.ui.screenIsClear = false;
            squiffy.ui.scrollPosition = squiffy.ui.output.height();
            squiffy.ui.currentSection.append($('<div/>').html(squiffy.ui.processText(text)));
            squiffy.ui.scrollToEnd();
        },
        clearScreen: function() {
            squiffy.ui.output.html('');
            squiffy.ui.screenIsClear = true;
            squiffy.ui.newSection();
        },
        scrollToEnd: function() {
            var scrollTo, currentScrollTop, distance, duration;
            if (squiffy.ui.settings.scroll === 'element') {
                scrollTo = squiffy.ui.output[0].scrollHeight - squiffy.ui.output.height();
                currentScrollTop = squiffy.ui.output.scrollTop();
                if (scrollTo > currentScrollTop) {
                    distance = scrollTo - currentScrollTop;
                    duration = distance / 0.4;
                    squiffy.ui.output.stop().animate({ scrollTop: scrollTo }, duration);
                }
            }
            else {
                scrollTo = squiffy.ui.scrollPosition;
                currentScrollTop = Math.max($('body').scrollTop(), $('html').scrollTop());
                if (scrollTo > currentScrollTop) {
                    var maxScrollTop = $(document).height() - $(window).height();
                    if (scrollTo > maxScrollTop) scrollTo = maxScrollTop;
                    distance = scrollTo - currentScrollTop;
                    duration = distance / 0.5;
                    $('body,html').stop().animate({ scrollTop: scrollTo }, duration);
                }
            }
        },
        processText: function(text) {
            function process(text, data) {
                var containsUnprocessedSection = false;
                var open = text.indexOf('{');
                var close;
                
                if (open > -1) {
                    var nestCount = 1;
                    var searchStart = open + 1;
                    var finished = false;
                 
                    while (!finished) {
                        var nextOpen = text.indexOf('{', searchStart);
                        var nextClose = text.indexOf('}', searchStart);
             
                        if (nextClose > -1) {
                            if (nextOpen > -1 && nextOpen < nextClose) {
                                nestCount++;
                                searchStart = nextOpen + 1;
                            }
                            else {
                                nestCount--;
                                searchStart = nextClose + 1;
                                if (nestCount === 0) {
                                    close = nextClose;
                                    containsUnprocessedSection = true;
                                    finished = true;
                                }
                            }
                        }
                        else {
                            finished = true;
                        }
                    }
                }
                
                if (containsUnprocessedSection) {
                    var section = text.substring(open + 1, close);
                    var value = processTextCommand(section, data);
                    text = text.substring(0, open) + value + process(text.substring(close + 1), data);
                }
                
                return (text);
            }

            function processTextCommand(text, data) {
                if (squiffy.util.startsWith(text, 'if ')) {
                    return processTextCommand_If(text, data);
                }
                else if (squiffy.util.startsWith(text, 'else:')) {
                    return processTextCommand_Else(text, data);
                }
                else if (squiffy.util.startsWith(text, 'label:')) {
                    return processTextCommand_Label(text, data);
                }
                else if (/^rotate[: ]/.test(text)) {
                    return processTextCommand_Rotate('rotate', text, data);
                }
                else if (/^sequence[: ]/.test(text)) {
                    return processTextCommand_Rotate('sequence', text, data);   
                }
                else if (text in squiffy.story.section.passages) {
                    return process(squiffy.story.section.passages[text].text, data);
                }
                else if (text in squiffy.story.sections) {
                    return process(squiffy.story.sections[text].text, data);
                }
                return squiffy.get(text);
            }

            function processTextCommand_If(section, data) {
                var command = section.substring(3);
                var colon = command.indexOf(':');
                if (colon == -1) {
                    return ('{if ' + command + '}');
                }

                var text = command.substring(colon + 1);
                var condition = command.substring(0, colon);

                var operatorRegex = /([\w ]*)(=|&lt;=|&gt;=|&lt;&gt;|&lt;|&gt;)(.*)/;
                var match = operatorRegex.exec(condition);

                var result = false;

                if (match) {
                    var lhs = squiffy.get(match[1]);
                    var op = match[2];
                    var rhs = match[3];

                    if (op == '=' && lhs == rhs) result = true;
                    if (op == '&lt;&gt;' && lhs != rhs) result = true;
                    if (op == '&gt;' && lhs > rhs) result = true;
                    if (op == '&lt;' && lhs < rhs) result = true;
                    if (op == '&gt;=' && lhs >= rhs) result = true;
                    if (op == '&lt;=' && lhs <= rhs) result = true;
                }
                else {
                    var checkValue = true;
                    if (squiffy.util.startsWith(condition, 'not ')) {
                        condition = condition.substring(4);
                        checkValue = false;
                    }

                    if (squiffy.util.startsWith(condition, 'seen ')) {
                        result = (squiffy.story.seen(condition.substring(5)) == checkValue);
                    }
                    else {
                        var value = squiffy.get(condition);
                        if (value === null) value = false;
                        result = (value == checkValue);
                    }
                }

                var textResult = result ? process(text, data) : '';

                data.lastIf = result;
                return textResult;
            }

            function processTextCommand_Else(section, data) {
                if (!('lastIf' in data) || data.lastIf) return '';
                var text = section.substring(5);
                return process(text, data);
            }

            function processTextCommand_Label(section, data) {
                var command = section.substring(6);
                var eq = command.indexOf('=');
                if (eq == -1) {
                    return ('{label:' + command + '}');
                }

                var text = command.substring(eq + 1);
                var label = command.substring(0, eq);

                return '<span class="squiffy-label-' + label + '">' + process(text, data) + '</span>';
            }

            function processTextCommand_Rotate(type, section, data) {
                var options;
                var attribute = '';
                if (section.substring(type.length, type.length + 1) == ' ') {
                    var colon = section.indexOf(':');
                    if (colon == -1) {
                        return '{' + section + '}';
                    }
                    options = section.substring(colon + 1);
                    attribute = section.substring(type.length + 1, colon);
                }
                else {
                    options = section.substring(type.length + 1);
                }
                var rotate = squiffy.util.rotate(options.replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
                if (attribute) {
                    squiffy.set(attribute, rotate[0]);
                }
                return '<a class="squiffy-link" data-' + type + '="' + rotate[1] + '" data-attribute="' + attribute + '">' + rotate[0] + '</a>';
            }

            var data = {
                fulltext: text
            };
            return process(text, data);
        },
        transition: function(f) {
            squiffy.set('_transition', f.toString());
            f();
        },
    };

    squiffy.storageFallback = {};

    squiffy.set = function(attribute, value) {
        if (typeof value === 'undefined') value = true;
        if (squiffy.ui.settings.persist && window.localStorage) {
            localStorage[squiffy.story.id + '-' + attribute] = JSON.stringify(value);
        }
        else {
            squiffy.storageFallback[attribute] = JSON.stringify(value);
        }
    };

    squiffy.get = function(attribute) {
        var result;
        if (squiffy.ui.settings.persist && window.localStorage) {
            result = localStorage[squiffy.story.id + '-' + attribute];
        }
        else {
            result = squiffy.storageFallback[attribute];
        }
        if (!result) return null;
        return JSON.parse(result);
    };

    squiffy.util = {
        startsWith: function(string, prefix) {
            return string.substring(0, prefix.length) === prefix;
        },
        rotate: function(options, current) {
            var colon = options.indexOf(':');
            if (colon == -1) {
                return [options, current];
            }
            var next = options.substring(0, colon);
            var remaining = options.substring(colon + 1);
            if (current) remaining += ':' + current;
            return [next, remaining];
        }
    };

    var methods = {
        init: function (options) {
            var settings = $.extend({
                scroll: 'body',
                persist: true,
                restartPrompt: true,
            }, options);

            squiffy.ui.output = this;
            squiffy.ui.restart = $(settings.restart);
            squiffy.ui.settings = settings;

            if (settings.scroll === 'element') {
                squiffy.ui.output.css('overflow-y', 'auto');
            }

            squiffy.story.begin();
            
            return this;
        },
        restart: function () {
            if (!squiffy.ui.settings.restartPrompt || confirm('Are you sure you want to restart?')) {
                squiffy.story.restart();
            }
        }
    };

    $.fn.javascript = function (methodOrOptions) {
        if (methods[methodOrOptions]) {
            return methods[methodOrOptions]
                .apply(this, Array.prototype.slice.call(arguments, 1));
        }
        else if (typeof methodOrOptions === 'object' || ! methodOrOptions) {
            return methods.init.apply(this, arguments);
        } else {
            $.error('Method ' +  methodOrOptions + ' does not exist');
        }
    };
})();

squiffy.story.start = '_default';
squiffy.story.id = 'e96a654bae';
squiffy.story.sections = {
	'_default': {
		'text': "<p>Clicking this <a class=\"squiffy-link\" data-passage=\"link\">link</a> will show an alert.</p>",
		'passages': {
			'link': {
				'text': "<p>Text for the passage.</p>",
				'js': function() {
					alert ("Hello!");
					
				},
			},
		},
	},
}
})();