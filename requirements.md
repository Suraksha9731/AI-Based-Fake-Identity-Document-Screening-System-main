# Requirements

## System Prerequisites

| Requirement       | Minimum Version | Recommended    | Purpose                        |
|-------------------|-----------------|----------------|--------------------------------|
| **Node.js**       | v16+            | v18+ / v24 LTS | Backend proxy server           |
| **npm**           | v8+             | v10+           | Package management             |
| **Python**        | 3.7+            | 3.10+          | Frontend static file server    |
| **Web Browser**   | Chrome 80+      | Latest Chrome/Edge | WebGL support for TensorFlow.js |

---

## Backend Dependencies (Node.js)

Installed via `npm install` inside the `server/` directory.

| Package       | Version    | Purpose                                      |
|---------------|------------|----------------------------------------------|
| **express**   | ^4.19.2    | HTTP server and API routing                  |
| **cors**      | ^2.8.5     | Cross-Origin Resource Sharing middleware      |
| **dotenv**    | ^16.4.5    | Load environment variables from `.env` file   |

---

## Frontend Dependencies (CDN — No Install Required)

These are loaded automatically via CDN `<script>` tags in `index.html`:

| Library                          | Version  | CDN Source                          | Purpose                              |
|----------------------------------|----------|-------------------------------------|--------------------------------------|
| **TensorFlow.js**                | latest   | `cdn.jsdelivr.net/npm/@tensorflow/tfjs` | ML inference engine in the browser |
| **Teachable Machine (Image)**    | latest   | `cdn.jsdelivr.net/npm/@teachablemachine/image` | Image classification model loader |
| **Tesseract.js**                 | v5       | `cdn.jsdelivr.net/npm/tesseract.js@5` | Client-side OCR text extraction    |
| **Font Awesome 6**               | 6.4.0    | `cdnjs.cloudflare.com`             | UI icons                            |
| **Inter Font**                   | —        | `fonts.googleapis.com`              | Typography                           |

---

## API Keys (Optional)

| Key                  | Required? | Source                                                      | Purpose                                    |
|----------------------|-----------|-------------------------------------------------------------|--------------------------------------------|
| **GEMINI_API_KEY**   | Optional  | [Google AI Studio](https://aistudio.google.com/app/apikey)  | AI chatbot explanations for fake documents |

> **Note:** The core document screening (Aadhaar, PAN Card, Passport, Voter ID classification) works fully **without** a Gemini API key. The key is only needed for the AI Security Assistant chatbot that explains *why* a document was flagged as fake.

### Configuring the API Key

1. Navigate to `server/.env`
2. Replace the placeholder:
   ```env
   GEMINI_API_KEY=your_actual_api_key_here
   ```
3. Restart the backend server

---

## Pre-trained ML Models (Included)

These Teachable Machine models are bundled in the repository — **no download needed**:

| Model Directory     | Document Type | Files                                  |
|---------------------|---------------|----------------------------------------|
| `model-aadhaar/`    | Aadhaar Card  | `model.json`, `weights.bin`, `metadata.json` |
| `model-pancard/`    | PAN Card      | `model.json`, `weights.bin`, `metadata.json` |
| `model-passport/`   | Passport      | `model.json`, `weights.bin`, `metadata.json` |
| `model-voterid/`    | Voter ID      | `model.json`, `weights.bin`, `metadata.json` |
| `model-doctype/`    | Doc Type Classifier | `model.json`, `weights.bin`, `metadata.json` |

---

## Ports Used

| Port   | Service                     |
|--------|-----------------------------|
| `5000` | Frontend (Python HTTP server) |
| `5001` | Backend (Node.js Express API) |

Ensure these ports are free before starting the application.

---

## Quick Setup Commands

```bash
# 1. Install backend dependencies
cd server
npm install

# 2. Create .env file (copy from template)
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY (optional)

# 3. Start backend server
npm start

# 4. In a new terminal — start frontend server (from project root)
cd ..
python -m http.server 5000

# 5. Open in browser
# http://localhost:5000/login.html
```

### Demo Credentials

- **Email:** `admin@example.com`
- **Password:** `password123`
