import os
import sys
import re
from collections import OrderedDict
import json
import markdown

def process(input_filename, source_path):
    output_path = os.path.abspath(os.path.dirname(input_filename))
    
    story = Story()
    success = process_file(story, os.path.abspath(input_filename), True)

    if not success:
        print ("Failed.")
        return

    js_template_file = open(os.path.join(source_path, "squiffy.template.js"))
    js_data = js_template_file.read()
    print ("Writing story.js")
    output_js_file = open(os.path.join(output_path, "story.js"), 'w')
    output_js_file.write(js_data)
    output_js_file.write("\n\n")
    output_js_file.write("squiffy.story.start = \"" + list(story.sections.keys())[0] + "\";\n")
    output_js_file.write("squiffy.story.sections = {\n")

    for section_name in story.sections:
        section = story.sections[section_name]

        output_js_file.write("\t\"{0}\": {{\n".format(section_name))
        if section.clear:
            output_js_file.write("\t\t\"clear\": true,\n".format(section_name))
        output_js_file.write("\t\t\"text\": {0},\n".format(json.dumps(process_text("\n".join(section.text), story, section, None))))
        if len(section.js) > 0:
            write_js(output_js_file, 2, section.js)

        if len(section.passages) > 0:
            output_js_file.write("\t\t\"passages\": {\n")
            for passage_name in section.passages:
                passage = section.passages[passage_name]

                output_js_file.write("\t\t\t\"{0}\": {{\n".format(passage_name))
                if passage.clear:
                    output_js_file.write("\t\t\t\t\"clear\": true,\n".format(section_name))
                output_js_file.write("\t\t\t\t\"text\": {0},\n".format(json.dumps(process_text("\n".join(passage.text), story, section, passage))))
                if len(passage.js) > 0:
                    write_js(output_js_file, 4, passage.js)
                output_js_file.write("\t\t\t},\n")

            output_js_file.write("\t\t},\n")

        output_js_file.write("\t},\n")

    output_js_file.write("}\n")

    html_template_file = open(os.path.join(source_path, "index.template.html"))
    html_data = html_template_file.read()
    html_data = html_data.replace("<!-- TITLE -->", story.title)
    script_data = "\n".join(map(lambda script: "<script src=\"{0}\"></script>".format(script), story.scripts))
    html_data = html_data.replace("<!-- SCRIPTS -->", script_data)
    print ("Writing index.html")
    output_html_file = open(os.path.join(output_path, "index.html"), 'w')
    output_html_file.write(html_data)

    css_template_file = open(os.path.join(source_path, "style.template.css"))
    css_data = css_template_file.read()
    print ("Writing style.css")
    output_css_file = open(os.path.join(output_path, "style.css"), 'w')
    output_css_file.write(css_data)

    print("Done.")

def process_file(story, input_filename, is_first):
    print ("Loading " + input_filename)
    input_file = open(input_filename)
    line_count = 0

    section_regex = re.compile(r"^\[\[(.*)\]\]:$")
    passage_regex = re.compile(r"^\[(.*)\]:$")
    title_regex = re.compile(r"@title (.*)")
    import_regex = re.compile(r"@import (.*)")
    js_regex = re.compile(r"^(\t| {4})(.*)")

    section = None
    passage = None
    text_started = False

    input_data = input_file.read()
    input_lines = input_data.splitlines()

    for line in input_lines:
        stripline = line.strip()
        line_count += 1
        section_match = section_regex.match(stripline)
        passage_match = passage_regex.match(stripline)
        js_match = js_regex.match(line)
        if section_match:
            section = story.addSection(section_match.group(1), input_filename, line_count)
            passage = None
            text_started = False
        elif passage_match:
            if section is None:
                print("ERROR: {0} line {1}: Can't add passage '{2}' as no section has been created.".format(
                    input_filename, line_count, passage_match.group(1)))
                return False
            passage = section.addPassage(passage_match.group(1), line_count)
            text_started = False
        elif stripline.startswith("@"):
            title_match = title_regex.match(stripline)
            import_match = import_regex.match(stripline)
            if stripline == "@clear":
                if passage is None:
                    if section is None and is_first:
                        section = story.addSection("_default", input_filename, line_count)
                    section.clear = True
                else:
                    passage.clear = True
            elif title_match:
                story.title = title_match.group(1)
            if import_match:
                import_filename = import_match.group(1)
                if import_filename.endswith(".squiffy"):
                    base_path = os.path.abspath(os.path.dirname(input_filename))
                    new_filename = os.path.join(base_path, import_filename)
                    success = process_file(story, new_filename, False)
                    if not success:
                        return False
                elif import_filename.endswith(".js"):
                    story.scripts.append(import_filename)
                
        elif not text_started and js_match:
            if passage is None:
                section.addJS(js_match.group(2))
            else:
                passage.addJS(js_match.group(2))
        else:
            if not text_started and len(stripline) == 0:
                continue
            if passage is None:
                if section is None and is_first:
                        section = story.addSection("_default", input_filename, line_count)
                if not section is None:
                    section.addText(line)
                    text_started = True
            else:
                passage.addText(line)
                text_started = True

    return True

def process_text(input, story, section, passage):
    # named_section_link_regex matches:
    #   open [[
    #   any text - the link text
    #   closing ]]
    #   open bracket
    #   any text - the name of the section
    #   closing bracket
    named_section_link_regex = re.compile(r"\[\[(.*?)\]\]\((.*?)\)")

    links = map(lambda m: m.group(2), named_section_link_regex.finditer(input))
    check_section_links(story, links, section, passage)

    input = named_section_link_regex.sub(r"<a class='squiffy-link' data-section='\2'>\1</a>", input)

    # named_passage_link_regex matches:
    #   open [
    #   any text - the link text
    #   closing ]
    #   open bracket, but not http(s):// after it
    #   any text - the name of the passage
    #   closing bracket
    named_passage_link_regex = re.compile(r"\[(.*?)\]\(((?!https?://).*?)\)")

    links = map(lambda m: m.group(2), named_passage_link_regex.finditer(input))
    check_passage_links(story, links, section, passage)

    input = named_passage_link_regex.sub(r"<a class='squiffy-link' data-passage='\2'>\1</a>", input)

    # unnamed_section_link_regex matches:
    #   open [[
    #   any text - the link text
    #   closing ]]
    unnamed_section_link_regex = re.compile(r"\[\[(.*?)\]\]")

    links = map(lambda m: m.group(1), unnamed_section_link_regex.finditer(input))
    check_section_links(story, links, section, passage)

    input = unnamed_section_link_regex.sub(r"<a class='squiffy-link' data-section='\1'>\1</a>", input)

    # unnamed_passage_link_regex matches:
    #   open [
    #   any text - the link text
    #   closing ]
    #   no bracket after
    unnamed_passage_link_regex = re.compile(r"\[(.*?)\]([^\(])")

    links = map(lambda m: m.group(1), unnamed_passage_link_regex.finditer(input))
    check_passage_links(story, links, section, passage)

    input = unnamed_passage_link_regex.sub(r"<a class='squiffy-link' data-passage='\1'>\1</a>\2", input)

    return markdown.markdown(input)

def check_section_links(story, links, section, passage):
    bad_links = filter(lambda m: not m in story.sections, links)
    show_bad_links_warning(bad_links, "section", "[[", "]]", section, passage)

def check_passage_links(story, links, section, passage):
    bad_links = filter(lambda m: not m in section.passages, links)
    show_bad_links_warning(bad_links, "passage", "[", "]", section, passage)

def show_bad_links_warning(bad_links, link_to, before, after, section, passage):
    for bad_link in bad_links:
        
        if passage is None:
            warning = "{0} line {1}: In section \"{2}\"".format(section.filename, section.line, section.name)
        else:
            warning = "{0} line {1}: In section \"{2}\", passage \"{3}\"".format(
                section.filename, passage.line, section.name, passage.name)
        print("WARNING: {0} there is a link to a {1} called {2}{3}{4}, which doesn't exist".format(warning, link_to, before, bad_link, after))

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
        self.scripts = []

    def addSection(self, name, filename, line):
        section = Section(name, filename, line)
        self.sections[name] = section
        return section

class Section:
    def __init__(self, name, filename, line):
        self.name = name
        self.filename = filename
        self.line = line
        self.text = []
        self.passages = OrderedDict()
        self.js = []
        self.clear = False

    def addPassage(self, name, line):
        passage = Passage(name, line)
        self.passages[name] = passage
        return passage

    def addText(self, text):
        self.text.append(text)

    def addJS(self, text):
        self.js.append(text)

class Passage:
    def __init__(self, name, line):
        self.name = name
        self.line = line
        self.text = []
        self.js = []
        self.clear = False

    def addText(self, text):
        self.text.append(text)

    def addJS(self, text):
        self.js.append(text)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Syntax: input.squiffy")
    else:
        process(sys.argv[1], os.path.abspath(os.path.dirname(sys.argv[0])))