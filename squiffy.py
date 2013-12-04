import sys
import re
from collections import OrderedDict
import markdown

def process(input_filename, output_filename):
    input_file = open(input_filename)
    input_data = input_file.read()
    input_lines = input_data.splitlines()
    c = 0

    section_regex = re.compile(r"^\[\[(.*)\]\]:$")
    passage_regex = re.compile(r"^\[(.*)\]:$")

    story = Story()
    section = None
    passage = None

    for line in input_lines:
        c += 1
        section_match = section_regex.match(line)
        passage_match = passage_regex.match(line)
        if section_match:
            section = story.addSection(section_match.group(1))
            passage = None
        elif passage_match:
            passage = section.addPassage(passage_match.group(1))
        else:
            if passage is None:
                section.addText(line)
            else:
                passage.addText(line)

    output_data = []

    for section_name in story.sections:
        section = story.sections[section_name]
        output_data.append("<h2>Section: " + section_name + "</h2>\n")
        output_data.append(process_text("\n".join(section.text)))

        for passage_name in section.passages:
            passage = section.passages[passage_name]
            output_data.append("<h3>Passage: " + passage_name + "</h2>\n")
            output_data.append(process_text("\n".join(passage.text)))

    output_file = open(output_filename, 'w')
    output_file.write("\n".join(output_data))
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
    if len(sys.argv) < 3:
        print("Syntax: input.squiffy output.html")
    else:
        process(sys.argv[1], sys.argv[2])