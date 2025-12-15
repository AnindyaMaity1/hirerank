# HireRank – AI Resume Ranker (SaaS Free Tier)

HireRank is an AI‑powered resume screening web app. Recruiters paste a job description, upload multiple resumes, and HireRank scores and ranks candidates using Google Gemini, surfacing strengths, gaps, and a clear recommendation per resume.

The app is built as a small SaaS product: users can analyze up to **10 resumes for free per browser**. After that, the analyze button is locked and a paywall / upgrade prompt is shown.

---

## 🚀 Live Demo

**Live URL:** https://your-vercel-project-url.vercel.app  
_(Replace this with your actual Vercel deployment URL.)_

---

## ✨ Features

- **AI‑powered resume ranking**
  - Uses Google Gemini (via `google-generativeai`) to analyze resumes against a job description.
  - Produces a structured JSON response with:
    - `overallScore` (0–100)
    - Detailed `breakdown`: skillsMatch, experience, education, atsScore, careerFit
    - Bullet list of strengths
    - Bullet list of gaps
    - Short recommendation sentence

- **Multi‑format resume parsing**
  - Accepts **PDF, DOCX, and TXT** files.
  - Uses:
    - `PyPDF2` for PDFs
    - `python-docx` for DOCX
    - UTF‑8 decoding for TXT

- **SaaS‑style free tier**
  - Anonymous usage tracking via browser cookie (`hr_token`) on the backend.
  - Free tier: **10 resumes total per token**.
  - Backend hard‑enforces the limit:
    - Requests over the remaining quota return `402` with an explanatory error.
  - Frontend mirrors usage using `localStorage` for a smooth UX:
    - Shows `Free: X / 10 resumes analyzed`.
    - Disables the analyze button and shows a paywall panel when limit is hit.
  - Reset button only clears the current JD and files, **not** the usage history.

- **Modern ATS‑style UI**
  - Fixed left sidebar with product branding ("HireRank"), features list, and usage meter.
  - Right‑side scrollable content area with:
    - Job description textarea
    - Drag‑and‑drop resume upload zone
    - AI analysis results: one card per candidate, stacked vertically.
  - Each result card includes:
    - Rank badge (#1 Top Choice, #2 Strong Fit, #3 Good Match, etc.)
    - Large circular overall score
    - Metric grid (Skills, Experience, Education, ATS, Career Fit)
    - Strength and gap tags
    - Recommendation box

- **Persistent UI state**
  - Stores JD text, results HTML, status text, and usage count in `localStorage`.
  - Refreshing the page does not lose previous analysis, as long as the free tier is not exceeded.

---

## 🧱 Tech Stack

- **Backend:**
  - Python 3.x
  - Flask
  - Google Generative AI (Gemini)
  - PyPDF2
  - python-docx
  - python-dotenv (for local `.env`)

- **Frontend:**
  - HTML (Jinja2 template)
  - CSS (custom, ATS‑style layout)
  - Vanilla JavaScript

- **Hosting:**
  - [Vercel](https://vercel.com) using `@vercel/python` serverless functions

---

## 📁 Project Structure

```text
.
├── app.py                 # Flask app & routes
├── requirements.txt       # Python dependencies
├── vercel.json            # Vercel deployment config
├── templates/
│   └── index.html         # Main UI template
└── static/
    ├── css/
    │   └── style.css      # Layout & visual styling
    ├── js/
    │   └── script.js      # Frontend logic, free-tier enforcement
    └── Logo.png           # App logo
```

---

## ⚙️ Backend Logic (app.py)

### 1. Environment & Initialization

- Loads environment variables from `.env` (locally) and from Vercel env in production.
- Requires `GEMINI_API_KEY`:

```python
API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    raise RuntimeError("❌ GEMINI_API_KEY not found in environment")
genai.configure(api_key=API_KEY)
```

- Auto‑detects a workable Gemini model via `genai.list_models()` and falls back to `models/gemini-2.0-flash` if needed.

### 2. SaaS Free Tier Tracking

- Constants and in‑memory store:

```python
FREE_LIMIT = 10
USAGE_COUNTER = {}  # token -> count
```

- Each browser gets an anonymous token in cookie `hr_token`:

```python
def get_client_token():
    token = request.cookies.get("hr_token")
    if not token:
        token = secrets.token_hex(16)
    return token
```

- `get_used_count(token)` and `increment_usage(token, count)` manage per‑token counts.

> Note: On Vercel this in‑memory counter resets when the function is cold‑started. For a production SaaS, this should be moved to a real database keyed by authenticated user/id.

### 3. Resume Parsing

- `parse_resume(filename, file_storage)` dispatches to:
  - `extract_text_from_pdf`
  - `extract_text_from_docx`
  - `extract_text_from_txt`

Each function reads the uploaded file in memory and returns plaintext.

### 4. AI Analysis

`analyze_resume_with_gemini(job_desc, resume_text, filename)`:

- Builds a strict JSON‑only prompt for Gemini.
- Attempts to `json.loads(response.text)`; if that fails, extracts the first `{ ... }` block via regex and parses again.
- Normalizes `breakdown` fields and calculates `overallScore` using weighted components:
  - Skills 30%, Experience 25%, Education 15%, ATS 20%, Career Fit 10%.
- Ensures `strengths`, `gaps`, and `recommendation` are always present.
- Falls back to neutral scores if the API errors.

### 5. Routes

- `GET /`  
  Renders `index.html`, ensures `hr_token` cookie exists.

- `GET /usage`  
  Returns JSON: `{ used, limit, remaining }` for the current token.

- `POST /rank`  
  Validates input, enforces quota, parses resumes, calls Gemini, and returns structured results:

  - Checks JD and file presence.
  - Filters valid file types.
  - Enforces free tier:
    - If `used >= FREE_LIMIT` → returns `402` with error message.
    - If `len(valid_files) > remaining` → returns `402` with an explanatory message.
  - For each valid file:
    - Parses resume text.
    - Calls `analyze_resume_with_gemini`.
    - Appends formatted result to the response list.
  - Calls `increment_usage(token, len(valid_files))` to update usage.

---

## 🖥 Frontend Logic (script.js)

### Core Behavior

- Manages DOM references: JD textarea, file input, drag‑drop zone, results container, usage meter, paywall panel.
- Validates files (type and size).
- On submit:
  - Checks JD and files.
  - Checks remaining free quota (`usedCount` vs `freeLimit`).
  - Blocks the request if quota exceeded or too many files are selected.
  - Sends `FormData` to `/rank` and processes the JSON response.
- Renders results as ranked cards with:
  - Rank badge and label (Top Choice, Strong Fit, etc.).
  - Score circle with color gradient based on score.
  - Metric breakdown grid.
  - Strength and gap tags.
  - Recommendation block with colored border.

### Free Tier UX

- `freeLimit = 10`
- `usedCount` backed by `localStorage` key `hirerank_usage`.
- `updateUsageUI()`:
  - Updates `🎁 Free: X / 10 resumes analyzed`.
  - Disables the analyze button and shows paywall when limit is reached.

### Reset Button

- `resetForm()`:
  - Clears JD, files, and results.
  - Resets status to "Ready to analyze".
  - **Does not** reset `usedCount` or `hirerank_usage`, so the quota behaves like a real SaaS meter.

---

## 🧪 Running Locally

1. **Clone**

   ```bash
   git clone https://github.com/your-username/your-repo.git
   cd your-repo
   ```

2. **Create venv**

   ```bash
   python -m venv .venv
   source .venv/bin/activate  # Windows: .venv\Scripts\activate
   ```

3. **Install deps**

   ```bash
   pip install -r requirements.txt
   ```

4. **Create `.env`**

   ```text
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

5. **Run**

   ```bash
   python app.py
   ```

6. Visit `http://localhost:5000`.

---

## ☁️ Deploying to Vercel

1. **Push code to GitHub.**

2. **Configure `vercel.json`** (already included):

   ```json
   {
     "version": 2,
     "builds": [
       {
         "src": "app.py",
         "use": "@vercel/python",
         "config": {
           "includeFiles": [
             "templates/**",
             "static/**"
           ]
         }
       }
     ],
     "routes": [
       { "src": "/static/(.*)", "dest": "/static/$1" },
       { "src": "/(.*)", "dest": "/app.py" }
     ]
   }
   ```

3. **Add environment variable in Vercel:**

   - `GEMINI_API_KEY = your_key`

4. **Import repo into Vercel** (New Project → Git integration) and deploy.

5. Use the generated URL as your **Live Demo** link in this README.

---

## 🧭 Roadmap / Ideas

- Proper user accounts and per‑user quota stored in a database.
- Stripe/PayPal integration to move beyond free tier into real subscriptions.
- Bulk export of ranked results (CSV/Excel).
- Support for more formats (e.g., DOC, RTF) and multi‑language JDs/resumes.
- Admin dashboard for monitoring total usage and performance.

---

## 📄 License

This project uses third‑party libraries and APIs that are subject to their own licenses and terms. Review and comply with Google's Gemini API terms and the licenses of the Python libraries used before deploying commercially.
