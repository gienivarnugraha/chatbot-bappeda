#pip install -U pymupdf4llm

import os
import pymupdf4llm
import sys
import subprocess

try:
    import pymupdf4llm
except ImportError:
    print("pymupdf4llm not found. Installing now...")
    try:
        # Use subprocess to run the pip install command
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pymupdf4llm"])
        import pymupdf4llm
        print("pymupdf4llm installed successfully.")
    except Exception as e:
        print(f"Failed to install pymupdf4llm: {e}")
        sys.exit(1)

def clean_markdown_text(md_text, dir_name):
    """
    Removes common duplicate lines and unnecessary blank lines.
    """
    remove_double_lines = md_text.replace('\n\n','\n')

    dir_name_new = dir_name.split("/")[-1]

    lines = remove_double_lines.split('\n')
    
    processed_lines = []
    
    # We will only keep the first occurrence of similar lines
    if not lines:
        return ""

    print(f"Cleaning... '{len(lines)} strings'.")
    # Iterate through the rest of the lines
    for i in range(1, len(lines)):
        current_line = lines[i].strip()

        # If the line is empty
        if not current_line:
            continue

        # If the line has exact duplicate
        elif current_line in processed_lines:
            continue

        # If the line has image path
        elif re.search(r'!\[(.*?)\]', current_line):
            processed_lines.append(current_line.replace(dir_name, f"./{dir_name_new}"))

        # add to list
        else:
            processed_lines.append(current_line)
    
    # Join all lines and collapse multiple empty lines into a single one
    temp_text = '\n'.join(processed_lines)
    final_text = re.sub(r'\n\s*\n+', '\n\n', temp_text).strip()
    
    return final_text

def convert_to_markdown(filename):
    dir_name = os.path.splitext(filename)[0]

    markdown_path = os.path.join(dir_name, f"{dir_name}.md")

    print(f"Creating '{dir_name}'...")
    
    if os.path.exists(markdown_path):
        print(f"Skipping '{filename}' - Markdown file already exists.")
        return

    print(f"Converting '{filename}'...")
    try:
        # Pass the relative path to pymupdf4llm.to_markdown()
        md_text = pymupdf4llm.to_markdown(filename, write_images=True, show_progress=True, image_path=dir_name)

        print(f"Successfully converting pfd to markdown '{filename}'.")

        print(f"Cleaning '{filename}'.")
        cleaned_md_text = clean_markdown_text(md_text, dir_name)
        
        # Write to the file in the new sub-directory
        with open(markdown_path, 'w', encoding='utf-8') as md_file:
            md_file.write(cleaned_md_text)
        print(f"Successfully created '{markdown_path}'.")
    except Exception as e:
        print(f"Failed to convert '{filename}': {e}")


def convert_pdfs(path):
    """
    Converts all PDF files from a source directory, saving the output
    to a structured output directory. It skips files if their Markdown
    counterpart already exists.
    """

    if not os.path.exists(path):
        print(f"Error: The path '{path}' does not exist.")
        
    elif os.path.isfile(path):
        print(f"The path '{path}' is a file.")
        convert_to_markdown(path)
        
    elif os.path.isdir(path):
        print(f"The path '{path}' is a directory.")
        list_path = os.listdir(path).join(",")
        # Add your directory-specific logic here, e.g., listing its contents.
        print(f"Contents: {list_path}")
        for filename in os.listdir(path):
            if filename.lower().endswith('.pdf'):
                convert_to_markdown(filename)
    else:
        print(f"The path '{path}' is an unknown type.")