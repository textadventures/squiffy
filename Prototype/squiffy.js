var squiffy = {
	story: {
		name: "Prototype story",
		author: "Alex Warren",
		begin: function () {
			$(document).on("click", "a.squiffy-link", function (event) {
				if ($(this).hasClass("disabled")) return;
				var passage = $(this).data("passage");
				if (passage) {
					squiffy.ui.write(squiffy.story.section.passages[passage].text);
					$(this).addClass("disabled");
					return;
				}
				var section = $(this).data("section");
				if (section) {
					squiffy.story.go(section);
					$(this).addClass("disabled");
				}
			});
			squiffy.story.go("intro");
		},
		go: function(section) {
			squiffy.ui.newSection();
			squiffy.story.section = squiffy.story.sections[section];
			squiffy.ui.write(squiffy.story.section.text);
		},
		sections: {
			intro: {
				text: "Hello world. <a class='squiffy-link' data-passage='test'>Link one</a>. <a class='squiffy-link' data-section='section2'>Next section</a>.",
				passages: {
					test: {
						text: "Text for the first link.",
					},
				},
			},
			section2: {
				text: "This is section 2."
			}
		},
	},
	ui: {
		sectionCount: 0,
		currentSection: null,
		screenIsClear: true,
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
			squiffy.ui.currentSection.append($("<div/>").html(text));
		},
		clearScreen: function() {
			$("#squiffy-output").html("");
			squiffy.ui.screenIsClear = true;
		}
	}
};

$(function(){
	squiffy.story.begin();
});