import os
import sys
import re
from collections import OrderedDict
import json
import markdown

def process(input_filename, source_path):
    input_file = open(input_filename)
    output_path = os.path.abspath(os.path.dirname(input_filename))
    input_data = input_file.read()
    input_lines = input_data.splitlines()
    c = 0

    section_regex = re.compile(r"^\[\[(.*)\]\]:$")
    passage_regex = re.compile(r"^\[(.*)\]:$")
    title_regex = re.compile(r"@title (.*)")
    js_regex = re.compile(r"^(\t| {4})(.*)")

    story = Story()
    section = None
    passage = None
    text_started = False

    for line in input_lines:
        stripline = line.strip()
        c += 1
        section_match = section_regex.match(stripline)
        passage_match = passage_regex.match(stripline)
        title_match = title_regex.match(stripline)
        js_match = js_regex.match(line)
        if section_match:
            section = story.addSection(section_match.group(1))
            passage = None
            text_started = False
        elif passage_match:
            passage = section.addPassage(passage_match.group(1))
            text_started = False
        elif title_match:
            story.title = title_match.group(1)
        elif not text_started and js_match:
            if passage is None:
                section.addJS(js_match.group(2))
            else:
                passage.addJS(js_match.group(2))
        else:
            if not text_started and len(stripline) == 0:
                continue
            if passage is None:
                if section is None:
                    section = story.addSection("_default")
                section.addText(line)
                text_started = True
            else:
                passage.addText(line)
                text_started = True

    js_template_file = open(os.path.join(source_path, "squiffy.template.js"))
    js_data = js_template_file.read()
    output_js_file = open(os.path.join(output_path, "story.js"), 'w')
    output_js_file.write(js_data)
    output_js_file.write("\n\n")
    output_js_file.write("squiffy.story.start = \"" + list(story.sections.keys())[0] + "\";\n")
    output_js_file.write("squiffy.story.sections = {\n")

    for section_name in story.sections:
        section = story.sections[section_name]

        output_js_file.write("\t\"{0}\": {{\n".format(section_name))
        output_js_file.write("\t\t\"text\": {0},\n".format(json.dumps(process_text("\n".join(section.text)))))
        if len(section.js) > 0:
            write_js(output_js_file, 2, section.js)

        if len(section.passages) > 0:
            output_js_file.write("\t\t\"passages\": {{\n".format(json.dumps(process_text("\n".join(section.text)))))
            for passage_name in section.passages:
                passage = section.passages[passage_name]

                output_js_file.write("\t\t\t\"{0}\": {{\n".format(passage_name))
                output_js_file.write("\t\t\t\t\"text\": {0},\n".format(json.dumps(process_text("\n".join(passage.text)))))
                if len(passage.js) > 0:
                    write_js(output_js_file, 4, passage.js)
                output_js_file.write("\t\t\t},\n")

            output_js_file.write("\t\t},\n")

        output_js_file.write("\t},\n")

    output_js_file.write("}\n")

    html_template_file = open(os.path.join(source_path, "index.template.html"))
    html_data = html_template_file.read()
    html_data = html_data.replace("<title></title>", "<title>" + story.title + "</title>")
    output_html_file = open(os.path.join(output_path, "index.html"), 'w')
    output_html_file.write(html_data)

    css_template_file = open(os.path.join(source_path, "style.template.css"))
    css_data = css_template_file.read()
    output_css_file = open(os.path.join(output_path, "style.css"), 'w')
    output_css_file.write(css_data)

    print("Done.")

def process_text(input):
    # named_section_link_regex matches:
    #   open [[
    #   any text - the link text
    #   closing ]]
    #   open bracket
    #   any text - the name of the section
    #   closing bracket
    named_section_link_regex = re.compile(r"\[\[(.*?)\]\]\((.*?)\)")
    input = named_section_link_regex.sub(r"<a class='squiffy-link' data-section='\2'>\1</a>", input)

    # named_passage_link_regex matches:
    #   open [
    #   any text - the link text
    #   closing ]
    #   open bracket, but not http(s):// after it
    #   any text - the name of the passage
    #   closing bracket
    named_passage_link_regex = re.compile(r"\[(.*?)\]\(((?!https?://).*?)\)")
    input = named_passage_link_regex.sub(r"<a class='squiffy-link' data-passage='\2'>\1</a>", input)

    # unnamed_section_link_regex matches:
    #   open [[
    #   any text - the link text
    #   closing ]]
    unnamed_section_link_regex = re.compile(r"\[\[(.*?)\]\]")
    input = unnamed_section_link_regex.sub(r"<a class='squiffy-link' data-section='\1'>\1</a>", input)

    # unnamed_passage_link_regex matches:
    #   open [
    #   any text - the link text
    #   closing ]
    #   no bracket after
    unnamed_passage_link_regex = re.compile(r"\[(.*?)\]([^\(])")
    input = unnamed_passage_link_regex.sub(r"<a class='squiffy-link' data-passage='\1'>\1</a>\2", input)

    return markdown.markdown(input)

def write_js(output_js_file, tab_count, js):
    tabs = "\t" * tab_count
    output_js_file.write("{0}\"js\": function() {{\n".format(tabs))
    for js_line in js:
        output_js_file.write("{0}\t{1}\n".format(tabs, js_line))
    output_js_file.write("{0}}},\n".format(tabs))

class Story:
    def __init__(self):
        self.sections = OrderedDict()
        self.title = ""

    def addSection(self, name):
        section = Section()
        self.sections[name] = section
        return section

class Section:
    def __init__(self):
        self.text = []
        self.passages = OrderedDict()
        self.js = []

    def addPassage(self, name):
        passage = Passage()
        self.passages[name] = passage
        return passage

    def addText(self, text):
        self.text.append(text)

    def addJS(self, text):
        self.js.append(text)

class Passage:
    def __init__(self):
        self.text = []
        self.js = []

    def addText(self, text):
        self.text.append(text)

    def addJS(self, text):
        self.js.append(text)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Syntax: input.squiffy")
    else:
        process(sys.argv[1], os.path.abspath(os.path.dirname(sys.argv[0])))