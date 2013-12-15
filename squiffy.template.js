var squiffy = {
	story: {
		begin: function () {
			$(document).on("click", "a.squiffy-link", function (event) {
				if ($(this).hasClass("disabled")) return;
				squiffy.ui.currentSection.append("<hr/>");
				var passage = $(this).data("passage");
				if (passage) {
					$(this).addClass("disabled");
					squiffy.set("_turncount", squiffy.get("_turncount") + 1);
					squiffy.story.passage(passage);
					var turnPassage = "@" + squiffy.get("_turncount");
					if (turnPassage in squiffy.story.section.passages) {
						squiffy.story.passage(turnPassage);
					}
				}
				else {
					var section = $(this).data("section");
					if (section) {
						$(this).addClass("disabled");
						squiffy.story.go(section);
					}
				}
			});
			$("#squiffy-restart").click(function (){
				if (confirm("Are you sure you want to restart?")) {
					squiffy.story.restart();
				}
			});
			if (!squiffy.story.load()) {
				squiffy.story.go(squiffy.story.start);
			}
		},
		go: function(section) {
			squiffy.ui.newSection();
			squiffy.story.section = squiffy.story.sections[section];
			if (!squiffy.story.section) return;
			squiffy.set("_section", section);
			if (squiffy.story.section.clear) {
				squiffy.ui.clearScreen();
			}
			if (squiffy.story.section.js) {
				squiffy.story.section.js();
			}
			// The JS might have changed which section we're in
			if (squiffy.get("_section") == section) {
				squiffy.set("_turncount", 0);
				squiffy.ui.write(squiffy.story.section.text, true);
				squiffy.story.save();
			}
		},
		passage: function(passageName) {
			var passage = squiffy.story.section.passages[passageName];
			if (!passage) return;
			if (passage.clear) {
				squiffy.ui.clearScreen();
			}
			if (passage.js) {
				passage.js();
			}
			squiffy.ui.write(passage.text);
			squiffy.story.save();
		},
		restart: function() {
			localStorage.clear();
			location.reload();
		},
		save: function() {
			squiffy.set("_output", $("#squiffy-output").html());
		},
		load: function() {
			var output = squiffy.get("_output");
			if (!output) return false;
			$("#squiffy-output").html(output);
			squiffy.ui.currentSection = $("#" + squiffy.get("_output-section"));
			squiffy.story.section = squiffy.story.sections[squiffy.get("_section")];
			return true;
		}
	},
	ui: {
		sectionCount: 0,
		currentSection: null,
		screenIsClear: true,
		scrollPosition: 0,
		newSection: function() {
			if (squiffy.ui.currentSection) {
				$(".squiffy-link", squiffy.ui.currentSection).addClass("disabled");
			}
			var sectionCount = squiffy.get("_section-count") + 1;
			squiffy.set("_section-count", sectionCount);
			var id = "squiffy-section-" + sectionCount;
			squiffy.ui.currentSection = $("<div/>", {
				id: id,
			}).appendTo("#squiffy-output");
			squiffy.set("_output-section", id);
		},
		write: function(text) {
			squiffy.ui.screenIsClear = false;
			squiffy.ui.scrollPosition = $("#squiffy-output").height();
			squiffy.ui.currentSection.append($("<div/>").html(squiffy.ui.processText(text)));
			squiffy.ui.scrollToEnd();
		},
		clearScreen: function() {
			$("#squiffy-output").html("");
			squiffy.ui.screenIsClear = true;
			squiffy.ui.newSection();
		},
		scrollToEnd: function() {
			var scrollTo = squiffy.ui.scrollPosition;
			var currentScrollTop = Math.max($("body").scrollTop(), $("html").scrollTop());
			if (scrollTo > currentScrollTop) {
				var maxScrollTop = $(document).height() - $(window).height();
				if (scrollTo > maxScrollTop) scrollTo = maxScrollTop;
				var distance = scrollTo - currentScrollTop;
				var duration = distance / 0.5;
				$("body,html").stop().animate({ scrollTop: scrollTo }, duration, "easeInOutQuad");
			}
		},
		processText: function(text) {
			function process(text, data) {
				var containsUnprocessedSection = false;
				var open = text.indexOf("{");
				var close;
				
				if (open > -1) {
			  		var nestCount = 1;
				 	var searchStart = open + 1;
				 	var finished = false;
				 
				 	while (!finished) {
						var nextOpen = text.indexOf("{", searchStart);
						var nextClose = text.indexOf("}", searchStart);
			 
						if (nextClose > -1) {
					 		if (nextOpen > -1 && nextOpen < nextClose) {
								nestCount++;
								searchStart = nextOpen + 1;
				 			}
					 		else {
								nestCount--;
								searchStart = nextClose + 1;
								if (nestCount == 0) {
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
				
				return (text)
			}

			function processTextCommand(text, data) {
				return "--(" + text + ")--";
			}

			var data = {
				fulltext: text
			};
			return process(text, data);
		},
	},
	set: function(attribute, value) {
		if (!squiffy.util.isStorageSupported()) return;
		if (typeof value === 'undefined') value = true;
		localStorage[attribute] = JSON.stringify(value);
	},
	get: function(attribute) {
		if (!squiffy.util.isStorageSupported()) return null;
		var result = localStorage[attribute];
		if (!result) return null;
		return JSON.parse(result);
	},
	util: {
		isStorageSupported: function() {
			try {
				return 'localStorage' in window && window['localStorage'] !== null;
			} catch(e) {
				return false;
			}
		}
	}
};

$(function(){
	squiffy.story.begin();
});