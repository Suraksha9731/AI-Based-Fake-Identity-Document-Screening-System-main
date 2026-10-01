from fpdf import FPDF
import os

class RequirementsPDF(FPDF):
    def header(self):
        self.set_font('Helvetica', 'B', 10)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, 'AI-Based Fake Identity Document Screening System', align='R')
        self.ln(4)
        self.set_draw_color(59, 130, 246)
        self.set_line_width(0.3)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(6)

    def footer(self):
        self.set_y(-15)
        self.set_font('Helvetica', 'I', 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f'Page {self.page_no()}/{{nb}}', align='C')

    def section_title(self, title):
        self.ln(4)
        self.set_font('Helvetica', 'B', 14)
        self.set_text_color(30, 64, 175)
        self.cell(0, 10, title)
        self.ln(8)
        self.set_draw_color(226, 232, 240)
        self.set_line_width(0.4)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(4)

    def sub_title(self, title):
        self.ln(2)
        self.set_font('Helvetica', 'B', 11)
        self.set_text_color(51, 65, 85)
        self.cell(0, 8, title)
        self.ln(7)

    def body_text(self, text):
        self.set_font('Helvetica', '', 10)
        self.set_text_color(30, 41, 59)
        self.multi_cell(0, 5.5, text)
        self.ln(2)

    def note_box(self, text):
        self.set_fill_color(239, 246, 255)
        self.set_draw_color(59, 130, 246)
        x = self.get_x()
        y = self.get_y()
        self.set_font('Helvetica', 'B', 9)
        self.set_text_color(30, 64, 175)
        self.set_x(x + 4)
        # Draw background rect
        self.rect(x, y, 190, 20, 'F')
        self.line(x, y, x, y + 20)  # left border
        self.set_xy(x + 5, y + 2)
        self.cell(0, 5, 'Note:')
        self.set_font('Helvetica', '', 9)
        self.set_text_color(30, 58, 95)
        self.set_xy(x + 5, y + 8)
        self.multi_cell(180, 4.5, text)
        self.set_y(y + 22)

    def add_table(self, headers, data, col_widths=None):
        if col_widths is None:
            col_widths = [190 / len(headers)] * len(headers)

        # Header row
        self.set_font('Helvetica', 'B', 9)
        self.set_fill_color(30, 64, 175)
        self.set_text_color(255, 255, 255)
        for i, h in enumerate(headers):
            self.cell(col_widths[i], 8, h, border=1, fill=True, align='C')
        self.ln()

        # Data rows
        self.set_font('Helvetica', '', 9)
        fill = False
        for row in data:
            self.set_text_color(30, 41, 59)
            if fill:
                self.set_fill_color(248, 250, 252)
            else:
                self.set_fill_color(255, 255, 255)

            max_h = 7
            for i, cell in enumerate(row):
                self.cell(col_widths[i], max_h, cell, border=1, fill=True)
            self.ln()
            fill = not fill
        self.ln(3)


pdf = RequirementsPDF()
pdf.alias_nb_pages()
pdf.set_auto_page_break(auto=True, margin=20)
pdf.add_page()

# Title
pdf.set_font('Helvetica', 'B', 24)
pdf.set_text_color(15, 23, 42)
pdf.cell(0, 14, 'Requirements', align='L')
pdf.ln(10)
pdf.set_font('Helvetica', '', 11)
pdf.set_text_color(100, 116, 139)
pdf.cell(0, 8, 'AI-Based Fake Identity Document Screening System')
pdf.ln(10)

# System Prerequisites
pdf.section_title('System Prerequisites')
pdf.add_table(
    ['Requirement', 'Minimum Version', 'Recommended', 'Purpose'],
    [
        ['Node.js', 'v16+', 'v18+ / v24 LTS', 'Backend proxy server'],
        ['npm', 'v8+', 'v10+', 'Package management'],
        ['Python', '3.7+', '3.10+', 'Frontend static file server'],
        ['Web Browser', 'Chrome 80+', 'Latest Chrome/Edge', 'WebGL for TensorFlow.js'],
    ],
    [38, 35, 45, 72]
)

# Backend Dependencies
pdf.section_title('Backend Dependencies (Node.js)')
pdf.body_text('Installed via "npm install" inside the server/ directory.')
pdf.add_table(
    ['Package', 'Version', 'Purpose'],
    [
        ['express', '^4.19.2', 'HTTP server and API routing'],
        ['cors', '^2.8.5', 'Cross-Origin Resource Sharing middleware'],
        ['dotenv', '^16.4.5', 'Load environment variables from .env file'],
    ],
    [40, 40, 110]
)

# Frontend Dependencies
pdf.section_title('Frontend Dependencies (CDN - No Install Required)')
pdf.body_text('Loaded automatically via CDN <script> tags in index.html:')
pdf.add_table(
    ['Library', 'Version', 'Purpose'],
    [
        ['TensorFlow.js', 'latest', 'ML inference engine in the browser'],
        ['Teachable Machine (Image)', 'latest', 'Image classification model loader'],
        ['Tesseract.js', 'v5', 'Client-side OCR text extraction'],
        ['Font Awesome 6', '6.4.0', 'UI icons'],
        ['Inter Font', '-', 'Typography'],
    ],
    [60, 30, 100]
)

# API Keys
pdf.section_title('API Keys (Optional)')
pdf.add_table(
    ['Key', 'Required?', 'Source', 'Purpose'],
    [
        ['GEMINI_API_KEY', 'Optional', 'Google AI Studio', 'AI chatbot for fake doc explanation'],
    ],
    [42, 28, 50, 70]
)
pdf.ln(2)
pdf.note_box(
    'The core document screening (Aadhaar, PAN Card, Passport, Voter ID) works fully without a Gemini API key. '
    'The key is only needed for the AI Security Assistant chatbot.'
)

pdf.sub_title('Configuring the API Key')
pdf.body_text('1. Navigate to server/.env')
pdf.body_text('2. Replace the placeholder: GEMINI_API_KEY=your_actual_api_key_here')
pdf.body_text('3. Restart the backend server')

# Pre-trained Models
pdf.section_title('Pre-trained ML Models (Included)')
pdf.body_text('These Teachable Machine models are bundled in the repository - no download needed:')
pdf.add_table(
    ['Model Directory', 'Document Type', 'Files'],
    [
        ['model-aadhaar/', 'Aadhaar Card', 'model.json, weights.bin, metadata.json'],
        ['model-pancard/', 'PAN Card', 'model.json, weights.bin, metadata.json'],
        ['model-passport/', 'Passport', 'model.json, weights.bin, metadata.json'],
        ['model-voterid/', 'Voter ID', 'model.json, weights.bin, metadata.json'],
        ['model-doctype/', 'Document Type Classifier', 'model.json, weights.bin, metadata.json'],
    ],
    [45, 55, 90]
)

# Ports
pdf.section_title('Ports Used')
pdf.add_table(
    ['Port', 'Service'],
    [
        ['5000', 'Frontend (Python HTTP server)'],
        ['5001', 'Backend (Node.js Express API)'],
    ],
    [40, 150]
)
pdf.body_text('Ensure these ports are free before starting the application.')

# Quick Setup
pdf.section_title('Quick Setup Commands')
commands = [
    '# 1. Install backend dependencies',
    'cd server',
    'npm install',
    '',
    '# 2. Create .env file (copy from template)',
    'cp .env.example .env',
    '# Edit .env and add your GEMINI_API_KEY (optional)',
    '',
    '# 3. Start backend server',
    'npm start',
    '',
    '# 4. In a new terminal - start frontend (from project root)',
    'cd ..',
    'python -m http.server 5000',
    '',
    '# 5. Open in browser',
    '# http://localhost:5000/login.html',
]

pdf.set_fill_color(30, 41, 59)
pdf.set_text_color(226, 232, 240)
pdf.set_font('Courier', '', 9)
x = pdf.get_x()
y = pdf.get_y()
block_h = len(commands) * 5 + 8
pdf.rect(x, y, 190, block_h, 'F')
pdf.set_xy(x + 6, y + 4)
for line in commands:
    if line.startswith('#'):
        pdf.set_text_color(100, 116, 139)
    else:
        pdf.set_text_color(147, 197, 253)
    pdf.cell(0, 5, line)
    pdf.ln(5)
    pdf.set_x(x + 6)
pdf.set_y(y + block_h + 6)

# Demo Credentials
pdf.set_fill_color(254, 252, 232)
pdf.set_draw_color(253, 230, 138)
pdf.set_text_color(146, 64, 14)
pdf.set_font('Helvetica', 'B', 11)
cred_y = pdf.get_y()
pdf.rect(10, cred_y, 190, 18, 'DF')
pdf.set_xy(14, cred_y + 3)
pdf.cell(0, 5, 'Demo Credentials')
pdf.set_font('Helvetica', '', 10)
pdf.set_xy(14, cred_y + 10)
pdf.cell(0, 5, 'Email: admin@example.com    |    Password: password123')
pdf.ln(12)

# Output
pdf_path = os.path.abspath('requirements.pdf')
pdf.output(pdf_path)

size_kb = os.path.getsize(pdf_path) / 1024
print(f"SUCCESS: PDF generated at: {pdf_path}")
print(f"File size: {size_kb:.2f} KB")
