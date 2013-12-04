import os
import sys
import re
from collections import OrderedDict
import json
import markdown

def process(input_filename):
    if not os.path.exists("output"):
        os.makedirs("output")

    input_file = open(input_filename)
    input_data = input_file.read()
    input_lines = input_data.splitlines()
    c = 0

    section_regex = re.compile(r"^\[\[(.*)\]\]:$")
    passage_regex = re.compile(r"^\[(.*)\]:$")
    title_regex = re.compile(r"@title (.*)")

    story = Story()
    section = None
    passage = None

    for line in input_lines:
        stripline = line.strip()
        c += 1
        section_match = section_regex.match(stripline)
        passage_match = passage_regex.match(stripline)
        title_match = title_regex.match(stripline)
        if section_match:
            section = story.addSection(section_match.group(1))
            passage = None
        elif passage_match:
            passage = section.addPassage(passage_match.group(1))
        elif title_match:
            story.title = title_match.group(1)
        else:
            if passage is None:
                if section is None:
                    continue
                section.addText(line)
            else:
                passage.addText(line)

    output_data = OrderedDict()

    for section_name in story.sections:
        section = story.sections[section_name]
        output_data[section_name] = OrderedDict()
        output_data[section_name]["text"] = process_text("\n".join(section.text))
        output_data[section_name]["passages"] = OrderedDict()

        for passage_name in section.passages:
            passage = section.passages[passage_name]
            output_data[section_name]["passages"][passage_name] = OrderedDict()
            output_data[section_name]["passages"][passage_name]["text"] = process_text("\n".join(passage.text))

    js_template_file = open("squiffy.template.js")
    js_data = js_template_file.read()
    output_js_file = open(os.path.join("output", "story.js"), 'w')
    output_js_file.write(js_data)
    output_js_file.write("\n\n")
    output_js_file.write("squiffy.story.start = \"" + list(story.sections.keys())[0] + "\";\n")
    output_js_file.write("squiffy.story.sections = ")
    output_js_file.write(json.dumps(output_data, indent=4))

    html_template_file = open("index.template.html")
    html_data = html_template_file.read()
    html_data = html_data.replace("<title></title>", "<title>" + story.title + "</title>")
    output_html_file = open(os.path.join("output", "index.html"), 'w')
    output_html_file.write(html_data)

    css_template_file = open("style.template.css")
    css_data = css_template_file.read()
    output_css_file = open(os.path.join("output", "style.css"), 'w')
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

    def addPassage(self, name):
        passage = Passage()
        self.passages[name] = passage
        return passage

    def addText(self, text):
        self.text.append(text)

class Passage:
    def __init__(self):
        self.text = []

    def addText(self, text):
        self.text.append(text)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Syntax: input.squiffy")
    else:
        process(sys.argv[1])