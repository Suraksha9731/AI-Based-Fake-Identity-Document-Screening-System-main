import subprocess
import os

edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
html_path = os.path.abspath("project_documentation.html")
pdf_path = os.path.abspath("AI_Document_Screening_System_Full_Project_Documentation.pdf")

url = "file:///" + html_path.replace("\\", "/")

cmd = [
    edge_path,
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    f"--print-to-pdf={pdf_path}",
    url
]

print("Executing Microsoft Edge headless PDF export...")
res = subprocess.run(cmd, capture_output=True, text=True)
print("Return code:", res.returncode)
if os.path.exists(pdf_path):
    size_kb = os.path.getsize(pdf_path) / 1024
    print(f"SUCCESS: PDF generated at: {pdf_path}")
    print(f"File size: {size_kb:.2f} KB")
else:
    print("Failed to generate PDF.")
    print("Stderr:", res.stderr)
