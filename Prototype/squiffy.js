var squiffy = {
	story: {
		name: "Prototype story",
		author: "Alex Warren",
		begin: function () {
			$(document).on("click", "a.squiffy-link", function (event) {
				if ($(this).hasClass("disabled")) return;
				var passage = $(this).data("passage");
				if (passage) {
					$("#squiffy-output").append(squiffy.story.section.passages[passage].text);
					$(this).addClass("disabled");
				}
			});
			squiffy.story.go("intro");
		},
		go: function(section) {
			squiffy.story.section = squiffy.story.sections[section];
			$("#squiffy-output").append(squiffy.story.section.text);
		},
		sections: {
			intro: {
				text: "Hello world. <a class='squiffy-link' data-passage='test'>Link one</a>.",
				passages: {
					test: {
						text: "Text for the first link.",
					},
				},
			},
		},
	},
};

$(function(){
	squiffy.story.begin();
});