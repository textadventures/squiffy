var squiffy = {
	story: {
		name: "Prototype story",
		author: "Alex Warren",
		begin: function () {
			$("#squiffy-output").append(squiffy.story.sections["intro"].text);
		},
		sections: {
			intro: {
				text: "Hello world."
			},
		},
	},
};

$(function(){
	squiffy.story.begin();
});