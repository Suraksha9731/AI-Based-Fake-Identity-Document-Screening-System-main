# AI-Based Fake Identity Document Screening System

A modern, privacy-focused, real-time web application for screening and detecting fake identity documents (such as **Aadhaar Cards** and **PAN Cards**) using computer vision and machine learning models powered by **TensorFlow.js**, **Teachable Machine**, and **Google Gemini AI**.

---

## 🌟 Key Features

- 🤖 **AI Security Assistant (Google Gemini AI)**:
  - **Activated ONLY for FAKE classification results**.
  - Provides instant AI-generated explanations of visual red flags and verification checks for fake documents.
  - Interactive chat bubble UI allowing follow-up security queries with full context history.
  - **Secure Backend Proxy Architecture**: API key is stored safely in `/server/.env` and never exposed to client-side code.

- 📄 **Multi-Document Verification Engine**:
  - Support for **Aadhaar Card** verification model (`/model-aadhaar`).
  - Support for **PAN Card** verification model (`/model-pancard`).
  - Modular architecture making it easy to add future document types.

- ⚡ **Real-Time Client-Side Inference**:
  - Zero server-side image processing for classification — models run directly in the browser via WebGL/TensorFlow.js for maximum performance and privacy.
  - Model caching in memory so switching document types incurs no reload latency.

- 📸 **Flexible Input Modes**:
  - **Drag & Drop / File Browser**: Supports JPG, PNG, WEBP.
  - **Live Webcam Integration**: Start camera, capture instant snapshots, or run real-time live classification loops.

- 🔐 **Authentication & Session Protection**:
  - Modern, responsive **Login & Registration UI** (`login.html`).
  - Local authentication & session guard (`sessionStorage` & `localStorage`).
  - Pre-seeded demo credentials for instant testing (`admin@example.com` / `password123`).

---

## 📁 Repository Structure

```
├── server/                    # Node.js + Express Backend Proxy Server
│   ├── server.js              # Express API endpoint /api/explain-fake & Gemini integration
│   ├── package.json           # Backend dependencies (express, cors, dotenv)
│   ├── .env                   # Environment variables (GEMINI_API_KEY) [git-ignored]
│   └── .env.example           # Environment template
├── model-aadhaar/             # Teachable Machine model for Aadhaar Card classification
│   ├── model.json
│   ├── weights.bin
│   └── metadata.json
├── model-pancard/             # Teachable Machine model for PAN Card classification
│   ├── model.json
│   ├── weights.bin
│   └── metadata.json
├── index.html                 # Main verification portal dashboard
├── script.js                  # Model loading, prediction pipeline & webcam handlers
├── chatbot.js                 # AI chatbot UI state & Gemini backend communication
├── style.css                  # Shared glassmorphic responsive stylesheet
├── login.html                 # Authentication entry point
├── login.js                   # Authentication logic & session guards
└── README.md                  # Project documentation
```

---

## 🚀 Quick Start Guide

### Step 1: Start the Backend Proxy Server (Gemini AI API)

```bash
cd server
npm install
npm start
```
*The backend proxy server will start on `http://localhost:5001`.*

> [!NOTE]
> Make sure your Gemini API key is configured inside `server/.env`:
> ```env
> GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE
> PORT=5001
> ```

### Step 2: Serve the Frontend Web Application

Open a new terminal window in the root directory:

```bash
python -m http.server 5000
```
Then open **[http://localhost:5000/login.html](http://localhost:5000/login.html)** in your web browser.

---

## 🔑 Demo Credentials

- **Email**: `admin@example.com`
- **Password**: `password123`

---

## 🛠️ Built With

- **HTML5 / CSS3 / JavaScript (ES6+)**
- **Node.js / Express** (Backend Proxy)
- **Google Gemini 2.5/3.6 AI** (Document Explanation Engine)
- **[TensorFlow.js](https://www.tensorflow.org/js)** (CDN)
- **[@teachablemachine/image](https://github.com/googlecreativelab/teachablemachine-community)** (CDN)
- **FontAwesome 6** & **Inter Font**
