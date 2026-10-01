import os
import sys
import re
import json
import time
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

app = Flask(__name__)
CORS(app)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB payload limit

PORT = int(os.getenv("PORT", 5001))
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Attempt to load key from .env file
for env_candidate in [".env", "server/.env", "../server/.env"]:
    if os.path.exists(env_candidate):
        with open(env_candidate, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip().startswith("GEMINI_API_KEY="):
                    candidate_key = line.strip().split("=", 1)[1].strip().strip('"').strip("'")
                    if candidate_key and candidate_key != "YOUR_GEMINI_API_KEY_HERE":
                        GEMINI_API_KEY = candidate_key
                        print(f"🔑 Loaded GEMINI_API_KEY from {env_candidate}")
                        break

SYSTEM_INSTRUCTION = (
    "You are a document verification assistant. You explain, in simple and professional language, "
    "common visual and structural signs that make identity documents (such as Aadhaar cards, PAN cards, "
    "or Passports) look fake, based only on the document type and classification confidence provided. "
    "Never claim to have examined specific pixels or details you were not given. Stay strictly on-topic: "
    "document authenticity, security features (e.g. laminate/photo page integrity, MRZ checksums, watermarks, "
    "font alignment), and verification tips. If asked something unrelated, politely redirect to the topic "
    "of document verification."
)

GENERATION_CONFIG = {
    "temperature": 0.3,
    "topP": 0.8,
    "topK": 20,
    "maxOutputTokens": 800
}

CANNED_FALLBACK = (
    "When a computer vision classification model flags an identity document as fake with high confidence, "
    "it generally indicates visual or structural anomalies.\n\n"
    "Common red flags to check:\n"
    "• Font Misalignment & Typography: Inconsistent font styles, blurred text, or irregular character spacing.\n"
    "• Photo & Edge Tampering: Visible cut lines around the photo, inconsistent lighting, or laminate layer disruption.\n"
    "• Layout & Format Discrepancies: Misaligned text fields, unreadable QR codes, or MRZ (Machine-Readable Zone) syntax errors.\n"
    "• Missing Security Features: Absent micro-printing, missing hologram reflections, or corrupted background watermarks."
)

def call_gemini(contents):
    if not GEMINI_API_KEY or GEMINI_API_KEY == "YOUR_GEMINI_API_KEY_HERE":
        raise ValueError("Gemini API key is not configured.")
    
    models = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-flash-latest", "gemini-3.8-flash"]
    last_error = None

    for model_name in models:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={GEMINI_API_KEY}"
            payload = {
                "contents": contents,
                "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
                "generationConfig": GENERATION_CONFIG
            }
            res = requests.post(url, json=payload, timeout=20)
            data = res.json()
            if res.status_code == 200 and "candidates" in data and len(data["candidates"]) > 0:
                parts = data["candidates"][0].get("content", {}).get("parts", [])
                return "\n".join([p.get("text", "") for p in parts])
        except Exception as e:
            last_error = e
    
    raise last_error or RuntimeError("Failed to query Gemini API.")

def call_gemini_vision(base64_data, mime_type="image/jpeg"):
    if not GEMINI_API_KEY or GEMINI_API_KEY == "YOUR_GEMINI_API_KEY_HERE":
        raise ValueError("Gemini API key is not configured.")
    
    clean_base64 = re.sub(r"^data:image/[a-zA-Z+]+;base64,", "", base64_data)
    prompt = (
        "Identify this Indian document. Reply only with JSON:\n"
        "{\n"
        '  "type": "aadhaar" | "pan" | "passport" | "voter" | "other",\n'
        '  "confidence": 0.0 - 1.0,\n'
        '  "reason": "short explanation",\n'
        '  "fake_signals": ["visual anomalies or tampering traces"]\n'
        "}\n"
    )
    
    models = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-flash-latest"]
    for model_name in models:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={GEMINI_API_KEY}"
            payload = {
                "contents": [{
                    "role": "user",
                    "parts": [
                        {"inlineData": {"mimeType": mime_type, "data": clean_base64}},
                        {"text": prompt}
                    ]
                }],
                "generationConfig": {"temperature": 0.1, "maxOutputTokens": 600}
            }
            res = requests.post(url, json=payload, timeout=25)
            data = res.json()
            if res.status_code == 200 and "candidates" in data and len(data["candidates"]) > 0:
                raw_text = "\n".join([p.get("text", "") for p in data["candidates"][0]["content"]["parts"]])
                match = re.search(r"\{[\s\S]*\}", raw_text)
                if match:
                    parsed = json.loads(match.group(0))
                    return {
                        "type": str(parsed.get("type", "other")).lower().strip(),
                        "confidence": float(parsed.get("confidence", 0.85)),
                        "reason": parsed.get("reason", "Analyzed via Gemini Vision."),
                        "fake_signals": parsed.get("fake_signals", [])
                    }
        except Exception:
            continue
    
    raise RuntimeError("Failed to inspect image with Gemini Vision.")

LOCAL_USERS = [
    {"name": "Demo Admin", "email": "admin@example.com", "password": "password123"}
]

@app.route('/', methods=['GET'])
@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        "status": "online",
        "service": "AI Document Screening Backend Server",
        "colab": False,
        "configured": bool(GEMINI_API_KEY and GEMINI_API_KEY != "YOUR_GEMINI_API_KEY_HERE" and len(GEMINI_API_KEY.strip()) > 10)
    })

@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    data = request.get_json(force=True) or {}
    email = data.get("email", "").strip().lower()
    password = data.get("password", "").strip()
    
    if not email or not password:
        return jsonify({"success": False, "message": "Email and password are required"}), 400
        
    matched = next((u for u in LOCAL_USERS if (u["email"].lower() == email or u["name"].lower() == email) and u["password"] == password), None)
    if matched:
        return jsonify({
            "success": True,
            "message": "Login successful",
            "token": f"auth_token_{int(time.time())}",
            "user": {"name": matched["name"], "email": matched["email"]}
        })
    return jsonify({"success": False, "message": "Invalid email/username or password"}), 401

@app.route('/api/auth/register', methods=['POST'])
def auth_register():
    data = request.get_json(force=True) or {}
    name = data.get("name", "").strip()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "").strip()
    
    if not name or not email or not password:
        return jsonify({"success": False, "message": "All fields are required"}), 400
        
    if any(u["email"].lower() == email for u in LOCAL_USERS):
        return jsonify({"success": False, "message": "User with this email already exists"}), 409
        
    LOCAL_USERS.append({"name": name, "email": email, "password": password})
    return jsonify({
        "success": True,
        "message": "Registered successfully",
        "user": {"name": name, "email": email}
    })

@app.route('/api/vision-status', methods=['GET'])
def vision_status():
    is_active = bool(GEMINI_API_KEY and GEMINI_API_KEY != "YOUR_GEMINI_API_KEY_HERE" and len(GEMINI_API_KEY.strip()) > 10)
    return jsonify({
        "configured": is_active,
        "status": "online" if is_active else "optional_not_configured",
        "colab": False,
        "message": "Gemini Vision LLM is active" if is_active else "Gemini API key not configured (Optional)"
    })

@app.route('/api/explain-fake', methods=['POST'])
def explain_fake():
    try:
        body = request.get_json(force=True) or {}
        doc_type = body.get('docType', 'Identity Document')
        conf = body.get('confidenceScore', '90%')
        chat_history = body.get('chatHistory', [])
        user_msg = body.get('userMessage')
        
        structured_prompt = (
            f"Document type: {doc_type}\nClassification result: FAKE\nConfidence: {conf}\n\n"
            "Explain in 3-5 bullet points the common visual and structural signs that could make this type of "
            "document be flagged as fake. Keep it factual, non-alarming, concise, and general."
        )
        
        contents = [
            {"role": "user", "parts": [{"text": f"Context:\nDocument type: {doc_type}\nClassification: FAKE\nConfidence: {conf}"}]},
            {"role": "model", "parts": [{"text": f"Understood. I will provide focused verification guidance for {doc_type}."}]}
        ]
        for msg in chat_history:
            sender = "user" if msg.get("sender") == "user" else "model"
            contents.append({"role": sender, "parts": [{"text": msg.get("text", "")}]})
        
        contents.append({"role": "user", "parts": [{"text": user_msg if user_msg else structured_prompt}]})
        
        explanation = None
        try:
            explanation = call_gemini(contents)
        except Exception:
            explanation = CANNED_FALLBACK
        
        return jsonify({"success": True, "explanation": explanation or CANNED_FALLBACK})
    except Exception:
        return jsonify({"success": True, "explanation": CANNED_FALLBACK})

@app.route('/api/verify-doc-type', methods=['POST'])
def verify_doc_type():
    try:
        body = request.get_json(force=True) or {}
        image_data = body.get('image')
        mime_type = body.get('mimeType', 'image/jpeg')
        
        if not image_data:
            return jsonify({"success": False, "error": "Image base64 data required"}), 400
        
        result = call_gemini_vision(image_data, mime_type)
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
            "result": {
                "type": "other",
                "confidence": 0,
                "reason": f"Vision API unavailable or unconfigured ({e})",
                "fake_signals": []
            }
        })

if __name__ == '__main__':
    print(f"🚀 Starting Python Backend Server on http://localhost:{PORT}")
    app.run(host='0.0.0.0', port=PORT, debug=True)
