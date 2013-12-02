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
				text: "This is section 2. <a class='squiffy-link' data-section='longsection'>Now for a long section</a>."
			},
			longsection: {
				text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus id tortor vel neque convallis facilisis. Donec volutpat et dolor vel accumsan. Aenean ligula est, posuere ut enim vel, ultrices imperdiet tortor. Suspendisse nibh tortor, cursus non dui et, luctus varius eros. Quisque aliquet tincidunt urna a interdum. Pellentesque tristique eros dui, non scelerisque urna tempor ut. Aliquam sed dignissim massa. Proin non pharetra tortor. Ut sit amet vehicula odio, a tempor mauris. Fusce rhoncus neque non enim fringilla, ac ullamcorper massa commodo. Proin placerat id eros eget ornare. Ut accumsan lorem et dolor varius, sed fermentum leo pellentesque. Nulla facilisi. Aenean nisi dui, dignissim quis tempus id, hendrerit quis mi. Praesent tincidunt non tortor in pulvinar. Integer ultrices dolor quam, at pharetra nulla feugiat sed.<br/><br/>Vivamus turpis mauris, porta a consequat eu, tempor nec lacus. Maecenas sit amet augue aliquet, tempor arcu sed, auctor neque. Duis malesuada urna ullamcorper aliquam mattis. Aliquam congue tortor ut sollicitudin adipiscing. Etiam malesuada at lorem ut facilisis. Sed sagittis mauris velit, tincidunt interdum ante rhoncus ac. Fusce congue placerat fermentum. Nam auctor eget erat vitae congue. Donec quis nibh quis nunc condimentum tincidunt. Maecenas est lectus, tincidunt tincidunt luctus blandit, gravida sed nunc. Nullam ipsum odio, pulvinar nec lacus vel, iaculis feugiat sapien. Mauris mattis dolor at quam convallis ultricies.<br/><br/>Donec placerat leo lacus, in tincidunt risus fringilla ac. Donec libero lacus, convallis ac suscipit ut, pharetra nec leo. Phasellus ac molestie lorem, vel varius lorem. Pellentesque consectetur feugiat iaculis. Sed rutrum, lacus id hendrerit feugiat, eros enim aliquet dolor, sed vulputate mauris tortor quis arcu. Duis pellentesque suscipit augue, eget luctus quam ultricies condimentum. Suspendisse vitae bibendum magna. Nullam euismod turpis sem, ut commodo orci aliquam faucibus. Sed blandit, diam in dapibus blandit, felis dui iaculis mi, nec ullamcorper felis nisl in tortor.<br/><br/>Cras commodo, tortor et elementum commodo, felis eros convallis nulla, vel sodales magna erat vitae justo. Morbi pharetra risus mollis, bibendum tellus a, aliquam tortor. Sed et libero dapibus, dictum augue nec, posuere neque. Fusce tempus diam purus, ac auctor diam dignissim at. Sed varius erat a dolor placerat, a euismod turpis facilisis. In in nulla quis sapien dignissim laoreet. Donec lobortis cursus elit, at dignissim dui rutrum non. Cras auctor congue erat, rutrum facilisis libero bibendum et. Donec fringilla faucibus elit, eu lacinia turpis laoreet sit amet. Aliquam sit amet hendrerit odio.<br/><br/>Integer porta augue et est luctus, non facilisis felis mollis. Pellentesque pellentesque purus massa, non ultrices ipsum tincidunt at. Mauris vitae imperdiet purus, in faucibus sapien. Praesent sem augue, tincidunt in neque in, tempus pharetra metus. Maecenas eu dui vulputate ligula luctus pulvinar quis vitae ligula. Aenean sed justo ullamcorper, commodo lacus et, ultricies eros. Sed convallis luctus eros, nec adipiscing nisl. Aenean sed consequat leo. Donec dui ipsum, pellentesque vitae sollicitudin sit amet, porta sed enim. Maecenas eu ornare quam, quis scelerisque nulla. Praesent ac nibh vel odio viverra blandit.<br/><br/><a class='squiffy-link' data-section='longsection2'>Another one</a>."
			},
			longsection2: {
				text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Aliquam ac posuere ante. Sed ut lobortis lectus, ac commodo magna. Sed at tincidunt nunc, rhoncus ornare ligula. Quisque molestie augue vel arcu sollicitudin tincidunt. Proin pulvinar at urna id imperdiet. Vivamus molestie sem sed venenatis auctor. Duis volutpat est nisi, a lacinia mi molestie et.<br/><br/>Vestibulum vitae ornare eros. Nam vulputate justo non ligula rhoncus viverra. Suspendisse tincidunt lacinia consectetur. Sed pharetra eget ligula vitae varius. Vivamus pharetra elit dui, id ornare lacus consequat in. Interdum et malesuada fames ac ante ipsum primis in faucibus. Maecenas vitae blandit magna. Suspendisse pulvinar semper augue et sodales. Sed luctus eros lacus, nec rutrum nunc aliquam id. Sed euismod velit a nisl mollis, id dictum sapien interdum. Sed sed elit urna. Pellentesque nunc dolor, semper sed metus at, venenatis malesuada diam. Praesent non tempus elit. Nullam malesuada nisl in tortor aliquam sodales. Vestibulum et egestas arcu.<br/><br/>Aliquam pellentesque, justo vitae tincidunt dignissim, elit turpis rutrum mauris, nec pulvinar risus leo tempor tellus. Aenean vulputate interdum nisl sed porta. Sed ligula ante, dictum vel libero a, dapibus pulvinar sem. Mauris sollicitudin est sit amet nibh blandit, sit amet pulvinar ipsum ultricies. Proin pharetra, est nec ullamcorper porttitor, arcu sapien venenatis est, auctor tempus augue diam non mauris. Mauris egestas ac lacus quis malesuada. Suspendisse vehicula eleifend fringilla. Praesent a ullamcorper dui. Praesent nec ipsum mauris. In volutpat augue augue, sit amet posuere metus mattis sit amet. Integer consectetur sollicitudin neque ut iaculis. Nam luctus scelerisque rutrum.<br/><br/>Aliquam a mattis urna. Proin in ante tortor. Quisque at nisi augue. Nulla ut consectetur leo. Aliquam vestibulum facilisis ultricies. Nunc id fermentum quam, et sollicitudin risus. Nunc eget convallis dolor. Cras id dictum velit, iaculis placerat est.<br/><br/>Nulla facilisi. Nulla facilisis erat at dictum iaculis. Donec faucibus ante non dapibus pellentesque. Sed non massa dui. Aliquam eleifend leo eu est tristique suscipit. Donec sed suscipit nisi. Aenean est odio, varius vestibulum rhoncus ac, pretium non ligula. Ut condimentum nisl ut est iaculis egestas. Pellentesque et nisi non enim adipiscing auctor. Phasellus et libero a sem tincidunt scelerisque. Quisque at est eget felis auctor feugiat."
			}
		},
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