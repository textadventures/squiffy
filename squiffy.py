import sys
import markdown

def process(input_filename, output_filename):
    input_file = open(input_filename)
    output_data = markdown.markdown(input_file.read())
    output_file = open(output_filename, 'w')
    output_file.write(output_data)
    print("Done.")

if __name__ == "__main__":
    if (len(sys.argv) < 3):
        print("Syntax: input.squiffy output.html")
    else:
        process(sys.argv[1], sys.argv[2])