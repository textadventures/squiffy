var squiffy = {
	story: {
		begin: function () {
			$(document).on("click", "a.squiffy-link", function (event) {
				if ($(this).hasClass("disabled")) return;
				var passage = $(this).data("passage");
				if (passage) {
					squiffy.story.passage(passage);
					$(this).addClass("disabled");
					return;
				}
				var section = $(this).data("section");
				if (section) {
					squiffy.story.go(section);
					$(this).addClass("disabled");
				}
			});
			squiffy.story.go(squiffy.story.start);
		},
		go: function(section) {
			squiffy.ui.newSection();
			squiffy.story.section = squiffy.story.sections[section];
			if (!squiffy.story.section) return;
			if (squiffy.story.section.js) {
				squiffy.story.section.js();
			}
			squiffy.ui.write(squiffy.story.section.text);
		},
		passage: function(passageName) {
			var passage = squiffy.story.section.passages[passageName];
			if (!passage) return;
			if (passage.js) {
				passage.js();
			}
			squiffy.ui.write(passage.text);
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
			var id = "squiffy-section-" + squiffy.ui.sectionCount++;
			squiffy.ui.currentSection = $("<div/>", {
		        id: id,
		    }).appendTo("#squiffy-output");
		},
		write: function(text) {
			if (!squiffy.ui.screenIsClear) {
				squiffy.ui.currentSection.append("<hr/>");
			}
			squiffy.ui.screenIsClear = false;
			squiffy.ui.scrollPosition = $("#squiffy-output").height();
			squiffy.ui.currentSection.append($("<div/>").html(text));
			squiffy.ui.scrollToEnd();
		},
		clearScreen: function() {
			$("#squiffy-output").html("");
			squiffy.ui.screenIsClear = true;
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
	}
};

$.extend($.easing,
{
	easeInOutQuad: function (x, t, b, c, d) {
		if ((t/=d/2) < 1) return c/2*t*t + b;
		return -c/2 * ((--t)*(t-2) - 1) + b;
	}
});

$(function(){
	squiffy.story.begin();
});