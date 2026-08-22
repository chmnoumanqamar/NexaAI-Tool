import os
import json
import base64
import zipfile
import requests
import pandas as pd
from dotenv import load_dotenv
from reportlab.pdfgen import canvas
from docx import Document
from langchain_core.tools import tool
from langchain_community.tools import DuckDuckGoSearchRun
from langchain_groq import ChatGroq
from langchain.agents import create_agent
from groq import Groq

load_dotenv()

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "secure_uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

groq_api_key = os.getenv("GROQ_API_KEY", "")
groq_client = Groq(api_key=groq_api_key) if groq_api_key else None

# ============================================================
# TOOL 1: Generate Excel (.xlsx) File
# ============================================================
@tool
def generate_excel(data_json: str, filename: str) -> str:
    """Converts structured JSON data into an Excel (.xlsx) file.
    Input data_json must be a valid JSON string containing a list of dictionaries (e.g. '[{"Name":"Ali","Role":"Developer","Age":25}]').
    filename should end with .xlsx (e.g. 'report.xlsx').
    Use this when the user asks to generate, export, or save data in Excel format."""
    try:
        fn = filename if filename.lower().endswith(".xlsx") else f"{filename}.xlsx"
        parsed = json.loads(data_json)
        df = pd.DataFrame(parsed)
        out_path = os.path.join(UPLOAD_DIR, fn)
        df.to_excel(out_path, index=False)
        return f"✅ Excel file '{fn}' successfully generated! Download link: http://localhost:8000/api/download/{fn}"
    except Exception as e:
        return f"Error generating Excel: {str(e)}"

# ============================================================
# TOOL 2: Generate CSV (.csv) File
# ============================================================
@tool
def generate_csv(data_json: str, filename: str) -> str:
    """Converts structured JSON data into a CSV (.csv) file.
    Input data_json must be a valid JSON string containing a list of dictionaries.
    filename should end with .csv (e.g. 'data.csv').
    Use this when the user asks for CSV format."""
    try:
        fn = filename if filename.lower().endswith(".csv") else f"{filename}.csv"
        parsed = json.loads(data_json)
        df = pd.DataFrame(parsed)
        out_path = os.path.join(UPLOAD_DIR, fn)
        df.to_csv(out_path, index=False)
        return f"✅ CSV file '{fn}' successfully generated! Download link: http://localhost:8000/api/download/{fn}"
    except Exception as e:
        return f"Error generating CSV: {str(e)}"

# ============================================================
# TOOL 3: Generate PDF (.pdf) File
# ============================================================
@tool
def generate_pdf(text: str, filename: str) -> str:
    """Generates a styled PDF document from given text content.
    filename should end with .pdf (e.g. 'document.pdf').
    Use this when the user asks for a document, summary, invoice, or report in PDF format."""
    try:
        fn = filename if filename.lower().endswith(".pdf") else f"{filename}.pdf"
        out_path = os.path.join(UPLOAD_DIR, fn)
        pdf = canvas.Canvas(out_path)
        y = 750
        for raw_line in text.split("\n"):
            line = raw_line
            while len(line) > 85:
                pdf.drawString(50, y, line[:85])
                y -= 18
                line = line[85:]
                if y < 50:
                    pdf.showPage()
                    y = 750
            pdf.drawString(50, y, line)
            y -= 18
            if y < 50:
                pdf.showPage()
                y = 750
        pdf.save()
        return f"✅ PDF file '{fn}' successfully generated! Download link: http://localhost:8000/api/download/{fn}"
    except Exception as e:
        return f"Error generating PDF: {str(e)}"

# ============================================================
# TOOL 4: Generate Word (.docx) Document
# ============================================================
@tool
def generate_word(text: str, filename: str) -> str:
    """Generates a Microsoft Word (.docx) document from text content.
    filename should end with .docx (e.g. 'proposal.docx').
    Use this when the user asks for a Word document or .docx format."""
    try:
        fn = filename if filename.lower().endswith(".docx") else f"{filename}.docx"
        out_path = os.path.join(UPLOAD_DIR, fn)
        doc = Document()
        for paragraph in text.split("\n\n"):
            if paragraph.strip():
                doc.add_paragraph(paragraph.strip())
        doc.save(out_path)
        return f"✅ Word document '{fn}' successfully generated! Download link: http://localhost:8000/api/download/{fn}"
    except Exception as e:
        return f"Error generating Word document: {str(e)}"

# ============================================================
# TOOL 5: Zip Multiple Files (.zip)
# ============================================================
@tool
def zip_files(filenames_json: str, zip_filename: str) -> str:
    """Bundles multiple files from secure uploads into a single ZIP archive.
    filenames_json must be a JSON list of filenames that exist in uploads, e.g. '["data.xlsx", "report.pdf"]'.
    zip_filename should end with .zip (e.g. 'project_files.zip').
    Use this when user wants to bundle or zip files together for download."""
    try:
        fn = zip_filename if zip_filename.lower().endswith(".zip") else f"{zip_filename}.zip"
        zip_path = os.path.join(UPLOAD_DIR, fn)
        filenames = json.loads(filenames_json) if isinstance(filenames_json, str) else filenames_json
        found = []
        missing = []
        with zipfile.ZipFile(zip_path, "w") as zf:
            for name in filenames:
                fp = os.path.join(UPLOAD_DIR, name)
                if os.path.exists(fp):
                    zf.write(fp, arcname=name)
                    found.append(name)
                else:
                    missing.append(name)
        msg = f"✅ ZIP archive '{fn}' created with: {', '.join(found)}."
        if missing:
            msg += f" (Missing: {', '.join(missing)})."
        msg += f" Download link: http://localhost:8000/api/download/{fn}"
        return msg
    except Exception as e:
        return f"Error creating ZIP: {str(e)}"

# ============================================================
# TOOL 6: Search the Internet
# ============================================================
@tool
def search_internet(query: str) -> str:
    """Searches the web in real-time for latest news, facts, current events, or answers.
    Use this when user asks about current information or web data."""
    try:
        return DuckDuckGoSearchRun().run(query)
    except Exception as e:
        return f"Web search error: {str(e)}"

# ============================================================
# TOOL 7: Analyze Uploaded Image (Vision)
# ============================================================
@tool
def analyze_uploaded_image(image_filename: str, question: str = "Describe this image in detail and extract all key data.") -> str:
    """Analyzes an uploaded image and answers questions about it using AI vision.
    image_filename must be a filename present in secure uploads.
    Use this when user uploads an image and asks to read, analyze, or transcribe it."""
    if not groq_client:
        return "Groq client not configured with API key."
    try:
        image_path = os.path.join(UPLOAD_DIR, image_filename)
        if not os.path.exists(image_path):
            return f"Image '{image_filename}' not found in uploads directory. Please ensure it was uploaded."
        with open(image_path, "rb") as f:
            b64_img = base64.b64encode(f.read()).decode("utf-8")
        ext = image_filename.lower().split(".")[-1]
        mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}.get(ext, "image/jpeg")

        # Try vision preview model
        res = groq_client.chat.completions.create(
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": question or "Extract all information and describe this image."},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64_img}"}}
                ]
            }],
            model="qwen/qwen3.6-27b",
        )
        return res.choices[0].message.content
    except Exception as e:
        # Fallback to compound
        try:
            res = groq_client.chat.completions.create(
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": question or "Extract information from this image."},
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64_img}"}}
                    ]
                }],
                model="meta-llama/llama-4-maverick-17b-128e-instruct",
            )
            return res.choices[0].message.content
        except Exception as e2:
            return f"Image vision error: {str(e)} | Fallback error: {str(e2)}"

# ============================================================
# Agent Setup
# ============================================================
agent_tools = [
    generate_excel,
    generate_csv,
    generate_pdf,
    generate_word,
    zip_files,
    search_internet,
    analyze_uploaded_image
]

system_prompt = (
    "You are NexaAI, an advanced intelligent AI assistant operating in a collaborative workspace. "
    "You possess specialized tools to perform real-world tasks:\n"
    "1. `generate_excel`: Convert structured data into an Excel spreadsheet (.xlsx).\n"
    "2. `generate_csv`: Convert structured data into a CSV (.csv) file.\n"
    "3. `generate_pdf`: Generate professional PDF documents (.pdf).\n"
    "4. `generate_word`: Generate Word documents (.docx).\n"
    "5. `zip_files`: Compress/bundle multiple files into a single ZIP archive (.zip).\n"
    "6. `search_internet`: Search live internet for facts, data, and updates.\n"
    "7. `analyze_uploaded_image`: Read and analyze uploaded images using vision.\n\n"
    "Guidelines:\n"
    "- When a user asks to create files (PDF, Word, Excel, CSV, ZIP), ALWAYS use your tools to generate the files and provide clear confirmation with download links.\n"
    "- If you see `[File Uploaded: filename]`, you can analyze it with `analyze_uploaded_image` or process its contents.\n"
    "- When multiple tasks are requested (e.g. create Excel and zip it), execute each tool sequentially.\n"
    "- Be friendly, concise, and helpful to all team members in the workspace."
)

llm = ChatGroq(
    temperature=0,
    model_name="openai/gpt-oss-20b",
    api_key=groq_api_key
)

agent = create_agent(llm, agent_tools, system_prompt=system_prompt)