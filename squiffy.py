import os
import sys
import re
from collections import OrderedDict
import json
import glob
import markdown
import uuid
import hashlib
import shutil

squiffy_version = "1.0"

def process(input_filename, source_path, options):
    output_path = os.path.abspath(os.path.dirname(input_filename))
    
    story = Story()
    story.set_id(os.path.abspath(input_filename))
    success = process_file(story, os.path.abspath(input_filename), True)

    if not success:
        print ("Failed.")
        return

    print ("Writing story.js")

    js_template_file = open(os.path.join(source_path, "squiffy.template.js"))
    js_data = "// Created with Squiffy {0}\n// https://github.com/textadventures/squiffy\n\n".format(squiffy_version) + js_template_file.read()
    output_js_file = open(os.path.join(output_path, "story.js"), 'w')
    output_js_file.write(js_data)
    output_js_file.write("\n\n")
    if len(story.start) == 0:
        story.start = list(story.sections.keys())[0]
    output_js_file.write("squiffy.story.start = \"" + story.start + "\";\n")
    output_js_file.write("squiffy.story.id = \"{0}\";\n".format(story.id))
    output_js_file.write("squiffy.story.sections = {\n")

    for section_name in story.sections:
        section = story.sections[section_name]

        output_js_file.write("\t\"{0}\": {{\n".format(section_name))
        if section.clear:
            output_js_file.write("\t\t\"clear\": true,\n")
        output_js_file.write("\t\t\"text\": {0},\n".format(json.dumps(process_text("\n".join(section.text), story, section, None))))
        if len(section.attributes) > 0:
            output_js_file.write("\t\t\"attributes\": {0},\n".format(json.dumps(section.attributes)))
        if len(section.js) > 0:
            write_js(output_js_file, 2, section.js)

        output_js_file.write("\t\t\"passages\": {\n")
        for passage_name in section.passages:
            passage = section.passages[passage_name]

            output_js_file.write("\t\t\t\"{0}\": {{\n".format(passage_name))
            if passage.clear:
                output_js_file.write("\t\t\t\t\"clear\": true,\n")
            output_js_file.write("\t\t\t\t\"text\": {0},\n".format(json.dumps(process_text("\n".join(passage.text), story, section, passage))))
            if len(passage.attributes) > 0:
                output_js_file.write("\t\t\t\t\"attributes\": {0},\n".format(json.dumps(passage.attributes)))
            if len(passage.js) > 0:
                write_js(output_js_file, 4, passage.js)
            output_js_file.write("\t\t\t},\n")

        output_js_file.write("\t\t},\n")
        output_js_file.write("\t},\n")

    output_js_file.write("}\n")

    print ("Writing index.html")

    html_template_file = open(find_file("index.template.html", output_path, source_path))
    html_data = html_template_file.read()
    html_data = html_data.replace("<!-- INFO -->", "<!--\n\nCreated with Squiffy {0}\n\n\nhttps://github.com/textadventures/squiffy\n\n-->".format(squiffy_version))
    html_data = html_data.replace("<!-- TITLE -->", story.title)
    jquery_js = "jquery.min.js"
    jqueryui_js = "jquery-ui.min.js"
    
    if options.use_cdn:
        jquery_js = "http://ajax.aspnetcdn.com/ajax/jquery/jquery-1.10.2.min.js"
        jqueryui_js = "http://ajax.aspnetcdn.com/ajax/jquery.ui/1.10.3/jquery-ui.min.js"
    else:
        shutil.copy2(os.path.join(source_path, "jquery.min.js"), output_path)
        shutil.copy2(os.path.join(source_path, "jquery-ui.min.js"), output_path)
    
    html_data = html_data.replace("<!-- JQUERY -->", jquery_js)
    html_data = html_data.replace("<!-- JQUERYUI -->", jqueryui_js)

    script_data = "\n".join(map(lambda script: "<script src=\"{0}\"></script>".format(script), story.scripts))
    html_data = html_data.replace("<!-- SCRIPTS -->", script_data)
    output_html_file = open(os.path.join(output_path, "index.html"), 'w')
    output_html_file.write(html_data)

    print ("Writing style.css")

    css_template_file = open(find_file("style.template.css", output_path, source_path))
    css_data = css_template_file.read()
    output_css_file = open(os.path.join(output_path, "style.css"), 'w')
    output_css_file.write(css_data)

    print("Done.")

def find_file(filename, output_path, source_path):
    output_path_file = os.path.join(output_path, filename)
    if os.path.exists(output_path_file):
        return output_path_file
    return os.path.join(source_path, filename)

def process_file(story, input_filename, is_first):
    if input_filename in story.files:
        return True
    story.files.append(input_filename)
    print ("Loading " + input_filename)
    input_file = open(input_filename)
    line_count = 0
    auto_section_count = 0

    section_regex = re.compile(r"^\[\[(.*)\]\]:$")
    passage_regex = re.compile(r"^\[(.*)\]:$")
    title_regex = re.compile(r"^@title (.*)$")
    import_regex = re.compile(r"^@import (.*)$")
    start_regex = re.compile(r"^@start (.*)$")
    attributes_regex = re.compile(r"^@set (.*)$")
    unset_regex = re.compile(r"^@unset (.*)$")
    inc_regex = re.compile(r"^@inc (.*)$")
    dec_regex = re.compile(r"^@dec (.*)$")
    replace_regex = re.compile(r"^@replace (.*$)")
    js_regex = re.compile(r"^(\t| {4})(.*)$")
    continue_regex = re.compile(r"^\+\+\+(.*)$")

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
        continue_match = continue_regex.match(stripline)
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
        elif continue_match:
            section = ensure_section_exists(story, section, is_first, input_filename, line_count)
            auto_section_count += 1
            auto_section_name = "_continue{0}".format(auto_section_count)
            section.addText("[[{0}]]({1})".format(continue_match.group(1), auto_section_name))
            section = story.addSection(auto_section_name, input_filename, line_count)
            passage = None
            text_started = False
        elif stripline.startswith("@"):
            title_match = title_regex.match(stripline)
            start_match = start_regex.match(stripline)
            import_match = import_regex.match(stripline)
            attributes_match = attributes_regex.match(stripline)
            unset_match = unset_regex.match(stripline)
            inc_match = inc_regex.match(stripline)
            dec_match = dec_regex.match(stripline)
            replace_match = replace_regex.match(stripline)
            if stripline == "@clear":
                if passage is None:
                    section = ensure_section_exists(story, section, is_first, input_filename, line_count)
                    section.clear = True
                else:
                    passage.clear = True
            elif title_match:
                story.title = title_match.group(1)
            elif start_match:
                story.start = start_match.group(1)
            elif import_match:
                base_path = os.path.abspath(os.path.dirname(input_filename))
                new_filenames = os.path.join(base_path, import_match.group(1))
                import_filenames = glob.glob(new_filenames)
                for import_filename in import_filenames:
                    if import_filename.endswith(".squiffy"):
                        success = process_file(story, import_filename, False)
                        if not success:
                            return False
                    elif import_filename.endswith(".js"):
                        story.scripts.append(os.path.relpath(import_filename, base_path))
            elif attributes_match:
                section = add_attribute(attributes_match.group(1), story, section, passage, is_first, input_filename, line_count)
            elif unset_match:
                section = add_attribute("not " + unset_match.group(1), story, section, passage, is_first, input_filename, line_count)
            elif inc_match:
                section = add_attribute(inc_match.group(1) + "+=1", story, section, passage, is_first, input_filename, line_count)
            elif dec_match:
                section = add_attribute(dec_match.group(1) + "-=1", story, section, passage, is_first, input_filename, line_count)
            elif replace_match:
                replace_attribute = replace_match.group(1)
                attribute_match = re.match(r"^(.*?)=(.*)$", replace_attribute)
                if attribute_match:
                    replace_attribute = attribute_match.group(1) + "=" + process_text(attribute_match.group(2), None, None, None)
                section = add_attribute("@replace " + replace_attribute, story, section, passage, is_first, input_filename, line_count)

        elif not text_started and js_match:
            if passage is None:
                section = ensure_section_exists(story, section, is_first, input_filename, line_count)
                section.addJS(js_match.group(2))
            else:
                passage.addJS(js_match.group(2))
        else:
            if not text_started and len(stripline) == 0:
                continue
            if passage is None:
                section = ensure_section_exists(story, section, is_first, input_filename, line_count)
                if not section is None:
                    section.addText(line)
                    text_started = True
            else:
                passage.addText(line)
                text_started = True

    return True

def ensure_section_exists(story, section, is_first, input_filename, line_count):
    if section is None and is_first:
        section = story.addSection("_default", input_filename, line_count)
    return section

def add_attribute(attribute, story, section, passage, is_first, input_filename, line_count):
    if passage is None:
        section = ensure_section_exists(story, section, is_first, input_filename, line_count)
        section.addAttribute(attribute)
    else:
        passage.addAttribute(attribute)
    return section

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
    unnamed_passage_link_regex = re.compile(r"\[(.*?)\]([^\(]|$)")

    links = map(lambda m: m.group(1), unnamed_passage_link_regex.finditer(input))
    check_passage_links(story, links, section, passage)

    input = unnamed_passage_link_regex.sub(r"<a class='squiffy-link' data-passage='\1'>\1</a>\2", input)

    return markdown.markdown(input)

def check_section_links(story, links, section, passage):
    if story:
        bad_links = filter(lambda m: not link_destination_exists(m, story.sections), links)
        show_bad_links_warning(bad_links, "section", "[[", "]]", section, passage)

def check_passage_links(story, links, section, passage):
    if story:
        bad_links = filter(lambda m: not link_destination_exists(m, section.passages), links)
        show_bad_links_warning(bad_links, "passage", "[", "]", section, passage)

def link_destination_exists(link, keys):
    # Link destination data may look like:
    #   passageName
    #   passageName, my_attribute=2
    #   passageName, @replace 1=new text, some_attribute=5
    #   @replace 2=some words
    # We're only interested in checking if the named passage or section exists.

    link_destination = link.split(",")[0]
    if link_destination[0] == "@":
        return True
    return link_destination in keys

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
        self.files = []
        self.start = ""

    def addSection(self, name, filename, line):
        section = Section(name, filename, line)
        self.sections[name] = section
        return section

    def set_id(self, filename):
        file_id = str(uuid.getnode()) + filename
        self.id = hashlib.sha1(file_id.encode('utf-8')).hexdigest()[0:10]

class Section:
    def __init__(self, name, filename, line):
        self.name = name
        self.filename = filename
        self.line = line
        self.text = []
        self.passages = OrderedDict()
        self.js = []
        self.clear = False
        self.attributes = []

    def addPassage(self, name, line):
        passage = Passage(name, line)
        self.passages[name] = passage
        return passage

    def addText(self, text):
        self.text.append(text)

    def addJS(self, text):
        self.js.append(text)

    def addAttribute(self, text):
        self.attributes.append(text)

class Passage:
    def __init__(self, name, line):
        self.name = name
        self.line = line
        self.text = []
        self.js = []
        self.clear = False
        self.attributes = []

    def addText(self, text):
        self.text.append(text)

    def addJS(self, text):
        self.js.append(text)

    def addAttribute(self, text):
        self.attributes.append(text)

class Options:
    def __init__(self, args):
        self.use_cdn = "-c" in args

if __name__ == "__main__":
    print("Squiffy " + squiffy_version)
    if len(sys.argv) < 2:
        print("Syntax: input.squiffy [-c]")
        print("Options:")
        print("   -c     Use CDN for jQuery")
    else:
        options = Options(sys.argv[1:])
        process(sys.argv[1], os.path.abspath(os.path.dirname(sys.argv[0])), options)
