var squiffy = {
	story: {
		begin: function () {
			$(document).on("click", "a.squiffy-link", function (event) {
				if ($(this).hasClass("disabled")) return;
				squiffy.ui.currentSection.append("<hr/>");
				var passage = $(this).data("passage");
				if (passage) {
					$(this).addClass("disabled");
					squiffy.set("_turncount", squiffy.getInt("_turncount") + 1);
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
			squiffy.set("_turncount", 0);
			squiffy.ui.write(squiffy.story.section.text, true);
			squiffy.story.save();
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
			var sectionCount = squiffy.getInt("_section-count") + 1;
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
			squiffy.ui.currentSection.append($("<div/>").html(text));
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
		}
	},
	set: function(attribute, value) {
		if (!squiffy.util.isStorageSupported()) return;
		localStorage[attribute] = value;
	},
	get: function(attribute) {
		if (!squiffy.util.isStorageSupported()) return null;
		return localStorage[attribute];
	},
	getInt: function(attribute) {
		var result = squiffy.get(attribute);
		if (!result) return 0;
		return parseInt(result);
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