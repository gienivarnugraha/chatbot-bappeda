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

def convert_pdfs_in_directory(directory_path):
    """
    Converts all PDF files in the specified directory to Markdown,
    saving extracted images to a dedicated folder for each PDF.
    """
    if not os.path.isdir(directory_path):
        print(f"Error: The directory '{directory_path}' does not exist.")
        return

    pdf_path = os.path.join(directory_path, filename)
            markdown_folder=os.path.splitext(filename)[0]
            markdown_filename = markdown_folder + '.md'
            markdown_path = os.path.join(directory_path, markdown_folder)
            output_path = os.path.join(markdown_path, markdown_filename)

            print(markdown_filename)
            print(markdown_path)

            # Create a dedicated directory for images if it doesn't exist
            os.makedirs(markdown_path, exist_ok=True)

            print(f"Converting '{filename}' to Markdown and saving images to '{pdf_path}'...")
            try:
               md_text = pymupdf4llm.to_markdown(pdf_path, write_images=True,page_separators=True, show_progress=True, image_path=markdown_path)
               with open(output_path, 'w', encoding='utf-8') as md_file:
                    md_file.write(md_text)
               print(f"Successfully created '{markdown_filename}'.")
            except Exception as e:
                print(f"Failed to convert '{filename}': {e}")