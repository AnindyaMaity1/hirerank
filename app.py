import os
import re
import io
import logging
import json
import secrets

from dotenv import load_dotenv
from flask import Flask, request, render_template, jsonify, make_response
import google.generativeai as genai
import PyPDF2
from docx import Document
from werkzeug.utils import secure_filename

# -----------------------------
# Logging
# -----------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# -----------------------------
# Env + Flask
# -----------------------------
load_dotenv()

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50MB

API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    raise RuntimeError("❌ GEMINI_API_KEY not found in environment")

genai.configure(api_key=API_KEY)

# -----------------------------
# SaaS usage tracking (demo)
# -----------------------------
# NOTE: This in-memory counter resets when the Vercel function is reloaded.
# For production, persist this in a DB keyed by user ID or auth token.
FREE_LIMIT = 10  # total resumes allowed per token in free tier
USAGE_COUNTER = {}  # token -> int (resumes analyzed)

def get_client_token():
    """
    Get or create an anonymous token to track usage per browser.
    In production you should use authenticated user IDs + a DB.
    """
    token = request.cookies.get("hr_token")
    if not token:
        token = secrets.token_hex(16)
    return token

def get_used_count(token: str) -> int:
    return int(USAGE_COUNTER.get(token, 0))

def increment_usage(token: str, count: int) -> None:
    current = get_used_count(token)
    USAGE_COUNTER[token] = current + count

# -----------------------------
# 🔥 Auto-detect usable model
# -----------------------------
def get_available_model():
    """
    Find a Gemini model that supports generateContent.
    Prefer newer flash models, but fall back safely.
    """
    try:
        models = genai.list_models()
        preferred_names = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]

        # Prefer specific flash models if available
        for name in preferred_names:
            for m in models:
                if (
                    m.name == f"models/{name}"
                    and "generateContent" in getattr(m, "supported_generation_methods", [])
                ):
                    return m.name

        # Fallback: any model that supports generateContent
        for m in models:
            if "generateContent" in getattr(m, "supported_generation_methods", []):
                return m.name
    except Exception as e:
        logger.warning(f"Could not list models, using default: {e}")

    # Last resort default (works on most current keys)
    return "models/gemini-2.0-flash"

MODEL_NAME = get_available_model()
model = genai.GenerativeModel(MODEL_NAME)
print("🔍 Using model:", MODEL_NAME)

# -----------------------------
# File parsing helpers
# -----------------------------
ALLOWED_EXTENSIONS = {"pdf", "docx", "txt"}

def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_text_from_pdf(file_storage) -> str:
    """Extract text from PDF."""
    try:
        bytes_data = file_storage.read()
        pdf_reader = PyPDF2.PdfReader(io.BytesIO(bytes_data))
        text = ""
        for page in pdf_reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
        return text.strip()
    except Exception as e:
        logger.error(f"PDF extraction error: {e}")
        return ""

def extract_text_from_docx(file_storage) -> str:
    """Extract text from DOCX."""
    try:
        bytes_data = file_storage.read()
        doc = Document(io.BytesIO(bytes_data))
        lines = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n".join(lines).strip()
    except Exception as e:
        logger.error(f"DOCX extraction error: {e}")
        return ""

def extract_text_from_txt(file_storage) -> str:
    """Extract text from TXT."""
    try:
        bytes_data = file_storage.read()
        return bytes_data.decode("utf-8", errors="ignore").strip()
    except Exception as e:
        logger.error(f"TXT extraction error: {e}")
        return ""

def parse_resume(filename: str, file_storage) -> str:
    """Dispatch to correct parser based on extension."""
    ext = filename.rsplit(".", 1)[1].lower()
    if ext == "pdf":
        return extract_text_from_pdf(file_storage)
    if ext == "docx":
        return extract_text_from_docx(file_storage)
    if ext == "txt":
        return extract_text_from_txt(file_storage)
    return ""

# -----------------------------
# Gemini analysis for resumes
# -----------------------------
def analyze_resume_with_gemini(job_desc: str, resume_text: str, filename: str) -> dict:
    """
    Advanced multi-metric analysis.
    Returns a dict matching your frontend expectations.
    """
    prompt = f"""
You are an expert HR AI analyst.

Return output as VALID JSON ONLY.
No explanations, no markdown, no backticks.

JOB DESCRIPTION:
{job_desc}

RESUME:
Filename: {filename}
Content: {resume_text[:4000]}...

Output JSON must match exactly:

{{
  "overallScore": 0-100,
  "breakdown": {{
    "skillsMatch": 0-100,
    "experience": 0-100,
    "education": 0-100,
    "atsScore": 0-100,
    "careerFit": 0-100
  }},
  "strengths": ["..."],
  "gaps": ["..."],
  "recommendation": "..."
}}

Use the real match quality to choose scores. Be strict but fair.
"""
    try:
        response = model.generate_content(prompt)
        content = (response.text or "").strip()
        logger.info(f"Gemini raw for {filename}: {content[:200]}")

        # Try direct JSON first
        try:
            result = json.loads(content)
        except Exception:
            # Fallback: largest { ... } block
            json_match = re.search(r"\{[\s\S]*\}", content)
            if not json_match:
                raise ValueError("No JSON found in Gemini response")
            result = json.loads(json_match.group())

        # Ensure breakdown present
        result.setdefault("breakdown", {})
        for key in ["skillsMatch", "experience", "education", "atsScore", "careerFit"]:
            val = int(result["breakdown"].get(key, 0))
            result["breakdown"][key] = max(0, min(100, val))

        # Weighted overall
        weights = {
            "skillsMatch": 0.30,
            "experience": 0.25,
            "education": 0.15,
            "atsScore": 0.20,
            "careerFit": 0.10,
        }
        calculated_score = sum(result["breakdown"][k] * w for k, w in weights.items())
        result["overallScore"] = round(max(0, min(100, calculated_score)))

        # Normalize other fields
        result["strengths"] = list(result.get("strengths", []))
        result["gaps"] = list(result.get("gaps", []))
        result["recommendation"] = str(
            result.get("recommendation", "Review Manually")
        )

        return result

    except Exception as e:
        logger.error(f"Gemini analysis error for {filename}: {e}")
        # Fallback neutral scores so UI still works
        return {
            "overallScore": 50,
            "breakdown": {
                "skillsMatch": 50,
                "experience": 50,
                "education": 50,
                "atsScore": 50,
                "careerFit": 50,
            },
            "strengths": ["Analysis unavailable"],
            "gaps": ["Please check resume format or try again later"],
            "recommendation": "Review Manually",
        }

# -----------------------------
# Routes
# -----------------------------
@app.route("/")
def index():
    # ensure client has a token cookie
    token = get_client_token()
    resp = make_response(render_template("index.html"))
    if not request.cookies.get("hr_token"):
        resp.set_cookie("hr_token", token, httponly=True, samesite="Lax")
    return resp

@app.route("/usage")
def usage():
    """Optional helper for frontend: current usage vs free limit."""
    token = get_client_token()
    used = get_used_count(token)
    remaining = max(0, FREE_LIMIT - used)
    return jsonify(
        {
            "used": used,
            "limit": FREE_LIMIT,
            "remaining": remaining,
        }
    )

@app.route("/list_models")
def list_models():
    """Optional helper to see what models your key can use."""
    try:
        models = genai.list_models()
        names = [m.name for m in models]
        return jsonify({"models": names})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/rank", methods=["POST"])
def rank_resumes():
    try:
        token = get_client_token()
        used = get_used_count(token)

        # Free tier hard limit check
        if used >= FREE_LIMIT:
            logger.info(f"Token {token} exceeded free limit ({used}/{FREE_LIMIT})")
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "Free limit reached. Upgrade to analyze more resumes.",
                        "used": used,
                        "limit": FREE_LIMIT,
                    }
                ),
                402,  # Payment Required (semantically fits)
            )

        job_desc = request.form.get("job_description", "").strip()
        if not job_desc:
            return (
                jsonify(
                    {"success": False, "error": "Job description is empty or missing"}
                ),
                400,
            )

        files = request.files.getlist("resumes")
        if not files:
            return (
                jsonify(
                    {"success": False, "error": "No resumes uploaded in 'resumes'"}
                ),
                400,
            )

        valid_files = [
            f for f in files if f and f.filename and allowed_file(f.filename)
        ]
        if not valid_files:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "No valid resume files (allowed: PDF, DOCX, TXT)",
                    }
                ),
                400,
            )

        # Enforce per-request not to exceed remaining quota
        remaining = max(0, FREE_LIMIT - used)
        if len(valid_files) > remaining:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Free tier remaining: {remaining} resume(s). Reduce selection or upgrade.",
                        "used": used,
                        "limit": FREE_LIMIT,
                        "remaining": remaining,
                    }
                ),
                402,
            )

        results = []
        for file in valid_files:
            filename = secure_filename(file.filename)
            logger.info(f"Processing {filename}")

            file.seek(0)
            resume_text = parse_resume(filename, file)

            if resume_text:
                analysis = analyze_resume_with_gemini(job_desc, resume_text, filename)
                analysis["filename"] = filename
                results.append(analysis)
            else:
                results.append(
                    {
                        "filename": filename,
                        "overallScore": 0,
                        "breakdown": {
                            "skillsMatch": 0,
                            "experience": 0,
                            "education": 0,
                            "atsScore": 0,
                            "careerFit": 0,
                        },
                        "strengths": [],
                        "gaps": ["Could not parse resume content"],
                        "recommendation": "Parsing Failed - Check Format",
                    }
                )

        # Update usage counter (increment by number of resumes just processed)
        increment_usage(token, len(valid_files))
        used_after = get_used_count(token)
        logger.info(f"Token {token}: used {used_after}/{FREE_LIMIT} resumes total")

        logger.info(f"Ranked {len(results)} resumes successfully")
        resp = jsonify(
            {
                "success": True,
                "results": results,
                "used": used_after,
                "limit": FREE_LIMIT,
                "remaining": max(0, FREE_LIMIT - used_after),
            }
        )

        # Ensure token cookie is set on this response as well
        flask_resp = make_response(resp)
        if not request.cookies.get("hr_token"):
            flask_resp.set_cookie("hr_token", token, httponly=True, samesite="Lax")
        return flask_resp

    except Exception as e:
        logger.error(f"Ranking error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

# For Vercel, you do NOT need app.run(); Vercel imports `app` as the handler.
if __name__ == "__main__":
    # Local dev only
    app.run(debug=True, host="0.0.0.0", port=5000)
