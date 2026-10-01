/**
 * Multi-Document Verification Script (Two-Stage Pipeline)
 * 
 * STAGE 1: Document Type Detection (Strict Priority Order)
 * - Rule 1: Definitive OCR Strong Identifier (eng+hin+kan, upscaled 2x, exact/fuzzy <= 1)
 * - Rule 2: Multiple Strong OCR Identifiers (Highest Score, Low Certainty)
 * - Rule 3: Dedicated Doctype Classifier (./model-doctype, letterboxed, rotations 0/90/180/270)
 * - Rule 4: Gemini Vision LLM Visual Inspection (/api/verify-doc-type)
 * - Rule 5: Unrecognized Document Fallback
 * 
 * STAGE 2: Authenticity Verification (Selected Model + Image Quality + AI Tampering)
 */

// ==========================================================================
// 1. Thresholds & Configuration Constants
// ==========================================================================
const MIN_TYPE_CONFIDENCE = 0.75;              // Minimum confidence threshold to accept type
const MODEL_DOCTYPE_HIGH_CONF = 0.85;          // Model top-class threshold for Rule 3
const MODEL_DOCTYPE_LOW_RIVAL = 0.30;          // Model rival-class upper limit for Rule 3
const BLUR_LAPLACIAN_THRESHOLD = 70.0;         // Laplacian variance threshold for blur
const LOW_RES_WIDTH_THRESHOLD = 400;          // Min width in px
const LOW_RES_HEIGHT_THRESHOLD = 300;         // Min height in px
const BRIGHTNESS_MIN = 35;                    // Extreme darkness threshold
const BRIGHTNESS_MAX = 225;                   // Extreme brightness threshold

function getBackendUrl() {
    let url = localStorage.getItem("backend_api_url") || "http://localhost:5001";
    return url.trim().replace(/\/+$/, "");
}
function getBackendVisionUrl() {
    return `${getBackendUrl()}/api/verify-doc-type`;
}
function getBackendStatusUrl() {
    return `${getBackendUrl()}/api/vision-status`;
}

// Debug mode toggle (?debug=1 in query string)
const urlParams = new URLSearchParams(window.location.search);
let isDebugMode = urlParams.get("debug") === "1";

// SESSION GUARD: Protect route if user is not authenticated
(function checkSession() {
    if (sessionStorage.getItem("isLoggedIn") !== "true") {
        window.location.href = "login.html";
    }
})();

// Data-Driven Document Registry Configuration
const DOC_TYPES = {
    aadhaar: {
        id: "aadhaar",
        label: "Aadhaar Card",
        icon: "fa-address-card",
        modelPath: "./model-aadhaar/",
        resultTitle: "Aadhaar Card Check Result"
    },
    pancard: {
        id: "pancard",
        label: "PAN Card",
        icon: "fa-id-card",
        modelPath: "./model-pancard/",
        resultTitle: "PAN Card Check Result"
    },
    passport: {
        id: "passport",
        label: "Passport",
        icon: "fa-passport",
        modelPath: "./model-passport/",
        resultTitle: "Passport Check Result"
    },
    voterid: {
        id: "voterid",
        label: "Voter ID Card",
        icon: "fa-check-to-slot",
        modelPath: "./model-voterid/",
        resultTitle: "Voter ID Check Result"
    }
};

// ==========================================================================
// OCR Rule Definitions (Strong Identifiers vs Weak Support)
// ==========================================================================
const OCR_RULES = {
    aadhaar: {
        id: "aadhaar",
        label: "Aadhaar Card",
        strongKeywords: ["uidai", "unique identification authority", "aadhaar", "आधार", "ಆಧಾರ್"],
        strongPatterns: [/\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/],
        weakKeywords: ["government of india", "भारत सरकार", "date of birth", "dob", "male", "female", "year of birth"]
    },
    pancard: {
        id: "pancard",
        label: "PAN Card",
        strongKeywords: ["income tax department", "permanent account number"],
        strongPatterns: [/\b[A-Z]{5}\d{4}[A-Z]\b/],
        weakKeywords: ["govt. of india", "father's name", "date of birth", "dob", "signature"]
    },
    passport: {
        id: "passport",
        label: "Passport",
        strongKeywords: ["passport no"],
        strongCompound: [["date of expiry", "nationality"]],
        strongPatterns: [/\bP<IND/i, /\bP<[A-Z0-9<]{10,}/i],
        weakKeywords: ["republic of india", "given name", "surname", "place of birth", "place of issue"]
    },
    voterid: {
        id: "voterid",
        label: "Voter ID Card",
        strongKeywords: ["election commission of india", "भारत निर्वाचन आयोग", "elector photo identity"],
        strongPatterns: [/\b[A-Z]{3}\d{7}\b/],
        weakKeywords: ["elector's name", "elector", "epic", "father's name", "gender", "age"]
    }
};

// Application State
let currentDocType = "aadhaar";
const loadedModels = {}; // Cache map for STAGE 2 authenticity models { aadhaar, pancard, passport, voterid }
let doctypeClassifierModel = null; // STAGE 1B Dedicated classifier model (./model-doctype)
let webcamStream = null;
let isLivePredicting = false;
let livePredictAnimationFrame = null;

// DOM Elements
const modelStatusPill = document.getElementById("model-status");
const modelStatusText = document.getElementById("model-status-text");
const doctypeMissingBanner = document.getElementById("doctype-missing-banner");
const stage2SignalsPanel = document.getElementById("stage2-signals-panel");

let visionApiStatus = "checking"; // "online", "optional_not_configured", "offline"

const docResultBanner = document.getElementById("doc-result-banner");
const docResultIcon = document.getElementById("doc-result-icon");
const docResultTitle = document.getElementById("doc-result-title");
const activeModelFolder = document.getElementById("active-model-folder");

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");

const webcamVideo = document.getElementById("webcam-video");
const webcamOverlay = document.getElementById("webcam-overlay");
const startWebcamBtn = document.getElementById("start-webcam-btn");
const stopWebcamBtn = document.getElementById("stop-webcam-btn");
const captureWebcamBtn = document.getElementById("capture-webcam-btn");
const livePredictBtn = document.getElementById("live-predict-btn");
const livePredictText = document.getElementById("live-predict-text");

const previewCard = document.getElementById("preview-card");
const previewImage = document.getElementById("preview-image");
const imageInfoName = document.getElementById("image-info-name");
const classifyBtn = document.getElementById("classify-btn");

const resultsEmpty = document.getElementById("results-empty");
const resultsLoading = document.getElementById("results-loading");
const resultsContent = document.getElementById("results-content");
const errorBanner = document.getElementById("error-banner");
const errorMessage = document.getElementById("error-message");
const inferenceTimeBadge = document.getElementById("inference-time-badge");

// Stage 1 Warning Card Elements
const doctypeWarningCard = document.getElementById("doctype-warning-card");
const doctypeWarningIcon = document.getElementById("doctype-warning-icon");
const doctypeWarningTitle = document.getElementById("doctype-warning-title");
const doctypeWarningDesc = document.getElementById("doctype-warning-desc");
const doctypeWarningAction = document.getElementById("doctype-warning-action");
const doctypeSwitchBtn = document.getElementById("doctype-switch-btn");
const doctypeSwitchBtnLabel = document.getElementById("doctype-switch-btn-label");
const signalsAgreementBox = document.getElementById("signals-agreement-box");
const signalsAgreementText = document.getElementById("signals-agreement-text");

// Verdict Card Elements
const verdictCard = document.getElementById("verdict-card");
const verdictIcon = document.getElementById("verdict-icon");
const verdictTitle = document.getElementById("verdict-title");
const verdictDesc = document.getElementById("verdict-desc");
const verdictTopScore = document.getElementById("verdict-top-score");
const detectedTypePill = document.getElementById("detected-type-pill");
const detectedTypeText = document.getElementById("detected-type-text");

// Multi-Signal Breakdown Elements
const breakdownSection = document.getElementById("breakdown-section");
const signalOcrVal = document.getElementById("signal-ocr-val");
const signalOcrSub = document.getElementById("signal-ocr-sub");
const signalModelVal = document.getElementById("signal-model-val");
const signalModelSub = document.getElementById("signal-model-sub");
const signalVisionVal = document.getElementById("signal-vision-val");
const signalVisionSub = document.getElementById("signal-vision-sub");

const chipBlur = document.getElementById("chip-blur");
const chipBlurText = document.getElementById("chip-blur-text");
const chipRes = document.getElementById("chip-res");
const chipResText = document.getElementById("chip-res-text");
const chipLight = document.getElementById("chip-light");
const chipLightText = document.getElementById("chip-light-text");
const chipMoire = document.getElementById("chip-moire");
const chipMoireText = document.getElementById("chip-moire-text");

const whyResultDetails = document.getElementById("why-result-details");
const whyResultContent = document.getElementById("why-result-content");

// Debug Panel Elements
const stage1DebugPanel = document.getElementById("stage1-debug-panel");
const debugPanelBody = document.getElementById("debug-panel-body");

const userDisplayName = document.getElementById("user-display-name");

// ==========================================================================
// 2. Initialization & Preloading
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    const currentUser = sessionStorage.getItem("currentUser") || "User";
    if (userDisplayName) {
        userDisplayName.textContent = currentUser;
    }

    renderDocTypeTabs();
    preloadAllModels();
    setupDropZone();
    setupFileInput();
    initDebugPanel();
});

function initDebugPanel() {
    if (stage1DebugPanel) {
        stage1DebugPanel.style.display = isDebugMode ? "block" : "none";
    }
}

function toggleDebugPanel() {
    isDebugMode = !isDebugMode;
    if (stage1DebugPanel) {
        stage1DebugPanel.style.display = isDebugMode ? "block" : "none";
    }
}

function renderDocTypeTabs() {
    const container = document.getElementById("doc-tabs-container");
    if (!container) return;

    container.innerHTML = Object.values(DOC_TYPES).map(doc => `
        <button class="doc-btn ${doc.id === currentDocType ? 'active' : ''}" 
                id="doc-${doc.id}-btn" 
                onclick="selectDocumentType('${doc.id}')">
            <i class="fa-solid ${doc.icon}"></i> ${doc.label}
        </button>
    `).join('');
}

function logout() {
    sessionStorage.removeItem("isLoggedIn");
    sessionStorage.removeItem("currentUser");
    sessionStorage.removeItem("currentUserEmail");
    window.location.href = "login.html";
}

async function loadModelForDocType(docTypeId) {
    if (loadedModels[docTypeId]) {
        return loadedModels[docTypeId];
    }
    const docConfig = DOC_TYPES[docTypeId];
    if (!docConfig) throw new Error(`Unknown document type: ${docTypeId}`);

    const modelURL = docConfig.modelPath + "model.json";
    const metadataURL = docConfig.modelPath + "metadata.json";

    const model = await tmImage.load(modelURL, metadataURL);
    loadedModels[docTypeId] = model;
    return model;
}

async function preloadAllModels() {
    updateModelStatus("loading", "Loading Models...");
    try {
        if (typeof tmImage === "undefined") {
            throw new Error("Teachable Machine library not loaded. Check CDN script tags.");
        }

        // Check backend vision health / configuration
        checkBackendVisionStatus();

        // Try preloading Stage 1B Dedicated Document Type Classifier (./model-doctype/)
        try {
            doctypeClassifierModel = await tmImage.load("./model-doctype/model.json", "./model-doctype/metadata.json");
            console.log("[STAGE 1B] Dedicated document type classifier loaded successfully.");
            if (doctypeMissingBanner) doctypeMissingBanner.style.display = "none";
        } catch (_) {
            doctypeClassifierModel = null;
            console.log("[STAGE 1B] ./model-doctype not found or not yet trained. Will use OCR (1A) + AI Vision (1C).");
            if (doctypeMissingBanner) doctypeMissingBanner.style.display = "flex";
        }

        // Preload Stage 2 Authenticity Models (for Stage 2 execution only)
        await Promise.all(Object.keys(DOC_TYPES).map(id => loadModelForDocType(id)));

        const modelCount = Object.keys(loadedModels).length + (doctypeClassifierModel ? 1 : 0);
        updateModelStatus("ready", `Models Ready (${modelCount} Loaded)`);
    } catch (err) {
        console.error("Error preloading models:", err);
        updateModelStatus("error", "Model Load Failed");
        showError("Failed to load document models. Please ensure you are serving via HTTP (e.g. python -m http.server 5000).");
    }
}

async function checkBackendVisionStatus() {
    try {
        const resp = await fetch(getBackendStatusUrl());
        if (resp.ok) {
            const data = await resp.json();
            visionApiStatus = data.status; // "online" or "optional_not_configured"
            updateBackendStatusBadge(true, data.colab);
        } else {
            visionApiStatus = "offline";
            updateBackendStatusBadge(false);
        }
    } catch (_) {
        visionApiStatus = "offline";
        updateBackendStatusBadge(false);
    }
    updateSignal1CVisionStatusPill();
}

function updateBackendStatusBadge(isOnline, isColab) {
    const badge = document.getElementById("backend-status-badge");
    const text = document.getElementById("backend-status-text");
    const dot = document.getElementById("header-backend-dot");
    if (!badge || !text) return;

    const url = getBackendUrl();
    const isColabUrl = isColab || url.includes("trycloudflare.com") || url.includes("ngrok");

    if (isOnline) {
        badge.className = "model-status-badge status-ready";
        if (dot) dot.style.backgroundColor = "#10b981";
        text.textContent = isColabUrl ? "Colab Server (Online)" : "Local Server (5001)";
    } else {
        badge.className = "model-status-badge status-error";
        if (dot) dot.style.backgroundColor = "#ef4444";
        text.textContent = "Backend Offline";
    }
}

function promptBackendUrl() {
    const current = getBackendUrl();
    const newUrl = prompt("Enter your Google Colab Backend URL (e.g. https://...trycloudflare.com) or Local Server URL:", current);
    if (newUrl !== null && newUrl.trim() !== "") {
        localStorage.setItem("backend_api_url", newUrl.trim().replace(/\/+$/, ""));
        checkBackendVisionStatus();
    }
}

function updateSignal1CVisionStatusPill() {
    if (!signalVisionVal) return;
    if (visionApiStatus === "optional_not_configured") {
        signalVisionVal.textContent = "Optional - Not Configured";
        signalVisionSub.textContent = "Add GEMINI_API_KEY in server/.env";
    } else if (visionApiStatus === "online") {
        signalVisionVal.textContent = "Standing by (Online)";
        signalVisionSub.textContent = "Gemini Vision LLM";
    } else if (visionApiStatus === "offline") {
        signalVisionVal.textContent = "Offline";
        signalVisionSub.textContent = "Server uncontactable";
    }
}

function updateModelStatus(state, text) {
    if (modelStatusPill) {
        modelStatusPill.className = `model-status-badge status-${state}`;
        modelStatusText.textContent = text;
    }
}

function selectDocumentType(docTypeId) {
    if (!DOC_TYPES[docTypeId]) return;
    currentDocType = docTypeId;

    document.querySelectorAll(".doc-btn").forEach(btn => btn.classList.remove("active"));
    const activeBtn = document.getElementById(`doc-${docTypeId}-btn`);
    if (activeBtn) activeBtn.classList.add("active");

    const docConfig = DOC_TYPES[docTypeId];
    if (docResultIcon) docResultIcon.className = `fa-solid ${docConfig.icon}`;
    if (docResultTitle) docResultTitle.textContent = docConfig.resultTitle;
    if (activeModelFolder) activeModelFolder.textContent = docConfig.modelPath;

    // Auto re-validate and classify image when document type is switched
    if (previewImage.src && previewCard.style.display !== 'none') {
        classifyActiveImage();
    }
}

function switchTab(tabName) {
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    document.getElementById(`tab-${tabName}-btn`).classList.add("active");

    document.querySelectorAll(".tab-content").forEach(content => content.classList.remove("active"));
    document.getElementById(`${tabName}-tab`).classList.add("active");

    if (tabName !== "webcam" && webcamStream) {
        stopWebcam();
    }
}

// ==========================================================================
// 3. File Upload & Webcam Handling
// ==========================================================================
function setupDropZone() {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(name => {
        dropZone.addEventListener(name, e => { e.preventDefault(); e.stopPropagation(); }, false);
    });
    ['dragenter', 'dragover'].forEach(name => {
        dropZone.addEventListener(name, () => dropZone.classList.add('dragover'), false);
    });
    ['dragleave', 'drop'].forEach(name => {
        dropZone.addEventListener(name, () => dropZone.classList.remove('dragover'), false);
    });
    dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0) handleSelectedFile(files[0]);
    });
    dropZone.addEventListener('click', (e) => {
        if (e.target !== fileInput && !e.target.classList.contains('btn')) {
            fileInput.click();
        }
    });
}

function setupFileInput() {
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleSelectedFile(e.target.files[0]);
        }
    });
}

function handleSelectedFile(file) {
    clearError();
    if (!file.type.startsWith('image/')) {
        showError("Invalid file type. Please select a valid image (JPG, PNG, WEBP).");
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        previewImage.src = e.target.result;
        imageInfoName.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        previewCard.style.display = 'block';
        previewImage.onload = () => classifyActiveImage();
    };
    reader.readAsDataURL(file);
}

function clearSelectedImage() {
    previewImage.src = '';
    previewCard.style.display = 'none';
    fileInput.value = '';
    resetResultsUI();
}

async function startWebcam() {
    clearError();
    try {
        webcamStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }
        });
        webcamVideo.srcObject = webcamStream;
        webcamOverlay.style.display = 'none';
        startWebcamBtn.disabled = true;
        stopWebcamBtn.disabled = false;
        captureWebcamBtn.disabled = false;
        livePredictBtn.disabled = false;
    } catch (err) {
        showError("Unable to access camera. Please allow camera permissions in your browser.");
    }
}

function stopWebcam() {
    if (isLivePredicting) toggleLivePredict();
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
    }
    webcamVideo.srcObject = null;
    webcamOverlay.style.display = 'flex';
    startWebcamBtn.disabled = false;
    stopWebcamBtn.disabled = true;
    captureWebcamBtn.disabled = true;
    livePredictBtn.disabled = true;
}

function captureWebcamImage() {
    if (!webcamStream) return;
    const hiddenCanvas = document.getElementById("hidden-canvas");
    const ctx = hiddenCanvas.getContext("2d");
    hiddenCanvas.width = webcamVideo.videoWidth || 640;
    hiddenCanvas.height = webcamVideo.videoHeight || 480;
    ctx.drawImage(webcamVideo, 0, 0, hiddenCanvas.width, hiddenCanvas.height);
    previewImage.src = hiddenCanvas.toDataURL("image/jpeg");
    imageInfoName.textContent = "Webcam Snapshot (" + new Date().toLocaleTimeString() + ")";
    previewCard.style.display = 'block';
    previewImage.onload = () => classifyActiveImage();
}

let isLivePredictBusy = false;
function toggleLivePredict() {
    if (isLivePredicting) {
        isLivePredicting = false;
        cancelAnimationFrame(livePredictAnimationFrame);
        livePredictBtn.classList.remove("btn-danger");
        livePredictBtn.classList.add("btn-outline");
        livePredictText.textContent = "Live Classify";
    } else {
        if (!webcamStream) return;
        isLivePredicting = true;
        livePredictBtn.classList.remove("btn-outline");
        livePredictBtn.classList.add("btn-danger");
        livePredictText.textContent = "Stop Live";
        runLivePredictionLoop();
    }
}

async function runLivePredictionLoop() {
    if (!isLivePredicting || !webcamVideo) return;
    if (webcamVideo.readyState === 4 && !isLivePredictBusy) {
        isLivePredictBusy = true;
        try {
            await executeTwoStagePipeline(webcamVideo, true);
        } catch (e) {
            console.error("Live loop error:", e);
        } finally {
            isLivePredictBusy = false;
        }
    }
    if (isLivePredicting) {
        livePredictAnimationFrame = requestAnimationFrame(runLivePredictionLoop);
    }
}

// ==========================================================================
// 4. STEP 3: Fixed Image Preprocessing (Letterbox & Rotations)
// ==========================================================================
/**
 * Scales to fit inside targetSize x targetSize and pads with neutral gray (#808080).
 * Never stretches or center-crops, preserving full aspect ratio.
 */
function createLetterboxedCanvas(imageElement, targetSize = 224, rotationDeg = 0, padColor = "#808080") {
    const canvas = document.createElement("canvas");
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext("2d");

    // Fill with neutral gray padding
    ctx.fillStyle = padColor;
    ctx.fillRect(0, 0, targetSize, targetSize);

    // Source dimensions
    let srcW = imageElement.naturalWidth || imageElement.videoWidth || imageElement.width || targetSize;
    let srcH = imageElement.naturalHeight || imageElement.videoHeight || imageElement.height || targetSize;

    // Dimensions when rotated
    const effW = (rotationDeg === 90 || rotationDeg === 270) ? srcH : srcW;
    const effH = (rotationDeg === 90 || rotationDeg === 270) ? srcW : srcH;

    // Scale to fit targetSize
    const scale = Math.min(targetSize / effW, targetSize / effH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;

    ctx.save();
    ctx.translate(targetSize / 2, targetSize / 2);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.drawImage(imageElement, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    return canvas;
}

/**
 * Runs a model on letterboxed image variants (0°, 90°, 180°, 270°) and averages probabilities
 */
async function predictWithRotations(model, imageElement) {
    const rotations = [0, 90, 180, 270];
    let bestPreds = null;
    let maxTopProb = -1;
    let bestRotation = 0;
    const accumulated = {};

    for (const rot of rotations) {
        const letterboxCanvas = createLetterboxedCanvas(imageElement, 224, rot, "#808080");
        const preds = await model.predict(letterboxCanvas);
        
        const topProb = Math.max(...preds.map(p => p.probability));
        if (topProb > maxTopProb) {
            maxTopProb = topProb;
            bestPreds = preds;
            bestRotation = rot;
        }

        preds.forEach(p => {
            const key = p.className.trim().toLowerCase();
            accumulated[key] = (accumulated[key] || 0) + p.probability;
        });
    }

    const averagedPreds = Object.keys(accumulated).map(className => ({
        className,
        probability: accumulated[className] / rotations.length
    }));

    return {
        bestPreds,
        averagedPreds,
        bestRotation,
        maxTopProb
    };
}

/**
 * TASK 4: Prepares image for OCR
 * - Upscales small images so long edge >= 1600px
 * - Rotation support (0, 90, 180, 270 degrees)
 * - Grayscale, gamma brightening for dark/low-light photos, and contrast stretch
 */
function prepareOcrCanvas(imageElement, rotation = 0) {
    const origW = imageElement.naturalWidth || imageElement.videoWidth || imageElement.width || 640;
    const origH = imageElement.naturalHeight || imageElement.videoHeight || imageElement.height || 480;

    const longEdge = Math.max(origW, origH);
    // Upscale to >= 1600px long edge (capped at 2200px for speed and memory safety)
    let targetLong = Math.max(1600, longEdge);
    if (targetLong > 2200) targetLong = 2200;
    const scale = targetLong / longEdge;

    const w = Math.round(origW * scale);
    const h = Math.round(origH * scale);

    const canvas = document.createElement("canvas");
    if (rotation === 90 || rotation === 270) {
        canvas.width = h;
        canvas.height = w;
    } else {
        canvas.width = w;
        canvas.height = h;
    }
    const ctx = canvas.getContext("2d");

    ctx.save();
    if (rotation === 90) {
        ctx.translate(h, 0);
        ctx.rotate(Math.PI / 2);
    } else if (rotation === 180) {
        ctx.translate(w, h);
        ctx.rotate(Math.PI);
    } else if (rotation === 270) {
        ctx.translate(0, w);
        ctx.rotate((3 * Math.PI) / 2);
    }
    ctx.drawImage(imageElement, 0, 0, w, h);
    ctx.restore();

    // Grayscale, adaptive gamma brightening & contrast stretch
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;

    // Check average luminance to detect dark or underexposed photos
    let sumLum = 0;
    const pixelCount = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
        sumLum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    const avgLum = sumLum / pixelCount;
    // Gamma brightening: if dark (< 110), boost shadows
    const gamma = avgLum < 80 ? 0.55 : (avgLum < 115 ? 0.72 : 1.0);

    for (let i = 0; i < d.length; i += 4) {
        let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (gamma !== 1.0) {
            gray = 255 * Math.pow(gray / 255, gamma);
        }
        // Adaptive contrast stretch
        const enhanced = gray > 128 ? Math.min(255, (gray - 128) * 1.5 + 128) : Math.max(0, 128 - (128 - gray) * 1.5);
        d[i] = enhanced;
        d[i + 1] = enhanced;
        d[i + 2] = enhanced;
    }
    ctx.putImageData(imgData, 0, 0);

    return canvas;
}

/**
 * Analyzes basic image quality (sharpness/blur, exposure, resolution, moire)
 */
function analyzeImageQuality(imageElement) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const w = 240;
    const h = 240;
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(imageElement, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    const natW = imageElement.naturalWidth || imageElement.videoWidth || 640;
    const natH = imageElement.naturalHeight || imageElement.videoHeight || 480;
    const isLowRes = natW < LOW_RES_WIDTH_THRESHOLD || natH < LOW_RES_HEIGHT_THRESHOLD;

    let totalLuminance = 0;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        gray[i / 4] = lum;
        totalLuminance += lum;
    }
    const avgLuminance = totalLuminance / (w * h);
    const isExtremeDark = avgLuminance < BRIGHTNESS_MIN;
    const isExtremeBright = avgLuminance > BRIGHTNESS_MAX;

    // Laplacian Variance for Blur
    let lapSum = 0;
    let lapSqSum = 0;
    let count = 0;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const idx = y * w + x;
            const lapVal = (
                gray[idx - w] +
                gray[idx - 1] +
                gray[idx + 1] +
                gray[idx + w] -
                4 * gray[idx]
            );
            lapSum += lapVal;
            lapSqSum += lapVal * lapVal;
            count++;
        }
    }
    const lapMean = lapSum / count;
    const lapVariance = (lapSqSum / count) - (lapMean * lapMean);
    const isBlurry = lapVariance < BLUR_LAPLACIAN_THRESHOLD;

    // Moire / Screen Photo Hint: high frequency periodic variance in color steps
    let highFreqCount = 0;
    for (let i = 0; i < data.length - 8; i += 8) {
        const diffR = Math.abs(data[i] - data[i + 4]);
        const diffB = Math.abs(data[i + 2] - data[i + 6]);
        if (diffR > 42 && diffB > 42) highFreqCount++;
    }
    const moireRatio = highFreqCount / (w * h / 2);
    const hasScreenArtifacts = moireRatio > 0.16;

    return {
        naturalWidth: natW,
        naturalHeight: natH,
        isLowRes,
        avgLuminance: Math.round(avgLuminance),
        isExtremeDark,
        isExtremeBright,
        lapVariance: Math.round(lapVariance),
        isBlurry,
        hasScreenArtifacts
    };
}

// Levenshtein distance helper
function levenshteinDistance(s1, s2) {
    if (!s1 || !s2) return (s1 || s2).length;
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();
    if (s1 === s2) return 0;
    const len1 = s1.length;
    const len2 = s2.length;
    if (Math.abs(len1 - len2) > 2) return Math.abs(len1 - len2);

    const matrix = [];
    for (let i = 0; i <= len1; i++) matrix[i] = [i];
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[len1][len2];
}

/**
 * Keyword match rule:
 * - Only fuzzy-match strings longer than 8 characters, with max distance 1.
 * - Use exact match for strings <= 8 characters.
 */
function keywordMatchesText(cleanText, keyword) {
    const kw = keyword.toLowerCase();
    if (cleanText.includes(kw)) {
        return { matched: true, method: "exact" };
    }

    if (kw.length > 8) {
        if (kw.includes(" ")) {
            const lines = cleanText.split(/[\r\n]+/);
            for (const line of lines) {
                if (Math.abs(line.length - kw.length) <= 2 && levenshteinDistance(line.trim(), kw) <= 1) {
                    return { matched: true, method: "fuzzy" };
                }
            }
        } else {
            const tokens = cleanText.split(/[\s,.:;/\-_()|'"]+/);
            for (const token of tokens) {
                if (Math.abs(token.length - kw.length) <= 1 && levenshteinDistance(token, kw) <= 1) {
                    return { matched: true, method: "fuzzy" };
                }
            }
        }
    }

    return { matched: false };
}

// ==========================================================================
// 5. STEP 4: Robust Multilingual OCR Evaluation
// ==========================================================================
function evaluateOcrTextStrict(rawText) {
    if (!rawText || typeof rawText !== "string") {
        return { strongTypes: [], scores: {}, rawText: "" };
    }

    const cleanLower = rawText.toLowerCase();
    const scores = {};
    const strongTypes = [];

    for (const [docId, config] of Object.entries(OCR_RULES)) {
        const strongHits = [];
        const patternHits = [];
        const weakHits = [];

        // 1. Check strong patterns
        if (config.strongPatterns) {
            for (const pat of config.strongPatterns) {
                if (pat.test(rawText)) {
                    patternHits.push(pat.toString());
                }
            }
        }

        // 2. Check strong keywords
        if (config.strongKeywords) {
            for (const kw of config.strongKeywords) {
                const res = keywordMatchesText(cleanLower, kw);
                if (res.matched) {
                    strongHits.push(`${kw} (${res.method})`);
                }
            }
        }

        // 3. Check compound conditions (e.g. passport: "date of expiry" + "nationality")
        if (config.strongCompound) {
            for (const pair of config.strongCompound) {
                if (pair.every(term => cleanLower.includes(term.toLowerCase()))) {
                    strongHits.push(`Compound: ${pair.join(" + ")}`);
                }
            }
        }

        // 4. Check weak keywords (support only)
        if (config.weakKeywords) {
            for (const kw of config.weakKeywords) {
                if (cleanLower.includes(kw.toLowerCase())) {
                    weakHits.push(kw);
                }
            }
        }

        const isStrong = (strongHits.length > 0 || patternHits.length > 0);
        // Score calculation: pattern = 3 pts, strong kw = 2 pts, weak kw = 0.5 pts
        const score = (patternHits.length * 3) + (strongHits.length * 2) + (weakHits.length * 0.5);

        if (isStrong) {
            strongTypes.push(docId);
        }

        scores[docId] = {
            id: docId,
            label: config.label,
            isStrong,
            score,
            strongHits,
            patternHits,
            weakHits
        };
    }

    return {
        strongTypes,
        scores,
        rawText
    };
}

async function runStage1AOcr(imageElement) {
    if (typeof Tesseract === "undefined") {
        console.warn("[STAGE 1A] Tesseract.js is not loaded.");
        return { available: false, strongTypes: [], scores: {}, reason: "OCR library not loaded", rawText: "", ocrConfidence: 0, rotationUsed: 0 };
    }

    // TASK 4: Try 0, 90, 180, 270 rotations; exit early as soon as strong hit is found
    const rotations = [0, 90, 180, 270];
    let bestEval = { strongTypes: [], scores: {}, rawText: "", ocrConfidence: 0, rotationUsed: 0 };

    for (const rot of rotations) {
        try {
            const ocrCanvas = prepareOcrCanvas(imageElement, rot);

            // Multilingual OCR: eng+hin+kan, with fallback to eng+hin then eng
            let ocrResult = null;
            try {
                ocrResult = await Tesseract.recognize(ocrCanvas, 'eng+hin+kan');
            } catch (langErr) {
                console.warn("Falling back to eng+hin OCR:", langErr.message);
                try {
                    ocrResult = await Tesseract.recognize(ocrCanvas, 'eng+hin');
                } catch (_) {
                    ocrResult = await Tesseract.recognize(ocrCanvas, 'eng');
                }
            }

            const rawText = ocrResult?.data?.text || "";
            const ocrConfidence = Math.round(ocrResult?.data?.confidence || 0);
            const evalData = evaluateOcrTextStrict(rawText);

            if (evalData.strongTypes.length > 0) {
                // Definitive hit found on rotation `rot`
                return {
                    available: true,
                    ...evalData,
                    ocrConfidence,
                    rotationUsed: rot
                };
            }

            if (rawText.length > bestEval.rawText.length) {
                bestEval = {
                    ...evalData,
                    ocrConfidence,
                    rotationUsed: rot
                };
            }
        } catch (err) {
            console.warn(`[STAGE 1A] OCR error at rotation ${rot}°:`, err);
        }
    }

    return {
        available: true,
        ...bestEval
    };
}

// ==========================================================================
// 6. STAGE 1B: Dedicated Document Type Classifier (./model-doctype)
// ==========================================================================
async function runStage1BClassifier(imageElement) {
    if (!doctypeClassifierModel) {
        return { available: false, topType: null, confidence: 0, reason: "Model not loaded" };
    }

    try {
        // Run with letterboxed 224x224 across 4 rotations
        const { averagedPreds, bestPreds } = await predictWithRotations(doctypeClassifierModel, imageElement);
        const sorted = [...averagedPreds].sort((a, b) => b.probability - a.probability);
        const top = sorted[0];
        const second = sorted[1];

        const rawClass = top ? top.className.trim().toLowerCase() : "other";
        let mappedId = "other";
        if (rawClass.includes("aadhaar")) mappedId = "aadhaar";
        else if (rawClass.includes("pan")) mappedId = "pancard";
        else if (rawClass.includes("passport")) mappedId = "passport";
        else if (rawClass.includes("voter")) mappedId = "voterid";

        return {
            available: true,
            topType: mappedId,
            topLabel: DOC_TYPES[mappedId]?.label || "Other",
            topProb: top ? top.probability : 0,
            secondProb: second ? second.probability : 0,
            predictions: averagedPreds
        };
    } catch (err) {
        console.warn("[STAGE 1B] Classifier prediction error:", err);
        return { available: false, topType: null, confidence: 0, reason: err.message };
    }
}

// ==========================================================================
// 7. STAGE 1C: Gemini Vision LLM Verification (/api/verify-doc-type)
// ==========================================================================
async function runStage1CVision(imageElement) {
    try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const maxDim = 800;
        let w = imageElement.naturalWidth || imageElement.videoWidth || 640;
        let h = imageElement.naturalHeight || imageElement.videoHeight || 480;
        if (w > maxDim || h > maxDim) {
            if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
            else { w = Math.round((w * maxDim) / h); h = maxDim; }
        }
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(imageElement, 0, 0, w, h);
        const base64Data = canvas.toDataURL("image/jpeg", 0.85);

        const response = await fetch(getBackendVisionUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: base64Data })
        });

        const data = await response.json();
        if (data.success && data.result) {
            let mappedType = (data.result.type || "other").toLowerCase().trim();
            if (mappedType.includes("pan")) mappedType = "pancard";
            if (mappedType.includes("voter")) mappedType = "voterid";
            if (mappedType.includes("aadhaar")) mappedType = "aadhaar";
            if (mappedType.includes("passport")) mappedType = "passport";

            return {
                available: true,
                topType: mappedType,
                topLabel: DOC_TYPES[mappedType]?.label || "Other",
                confidence: typeof data.result.confidence === "number" ? Math.min(0.99, data.result.confidence) : 0.88,
                reason: data.result.reason || "Vision AI verification completed",
                fake_signals: Array.isArray(data.result.fake_signals) ? data.result.fake_signals : []
            };
        } else {
            return {
                available: false,
                topType: null,
                confidence: 0,
                reason: data.error || "Vision API returned unsuccessful status",
                fake_signals: []
            };
        }
    } catch (err) {
        return {
            available: false,
            topType: null,
            confidence: 0,
            reason: "API error: " + err.message,
            fake_signals: []
        };
    }
}

// ==========================================================================
// 8. STEP 5: New Decision Logic (Strict Priority Order)
// ==========================================================================
async function executeStage1Validation(imageElement) {
    updateSignalsUIInProgress();

    // 1. Run Stage 1A (OCR)
    const ocrResult = await runStage1AOcr(imageElement);
    renderSignal1AUI(ocrResult);

    let decidedType = null;
    let decidedConfidence = 0;
    let decidingRule = "";
    let isLowCertainty = false;
    let candidate1 = null;
    let candidate2 = null;

    // RULE 1: If exactly one type has a strong OCR identifier -> that is the type (skip everything else!)
    if (ocrResult.available && ocrResult.strongTypes.length === 1) {
        decidedType = ocrResult.strongTypes[0];
        decidedConfidence = 0.99; // Capped at 99%
        decidingRule = "Rule 1: Definitive OCR Strong Identifier (Match)";
    }
    // RULE 2: If several types have strong identifiers -> pick the highest score and mark low certainty
    else if (ocrResult.available && ocrResult.strongTypes.length > 1) {
        const sorted = [...ocrResult.strongTypes].sort((a, b) => ocrResult.scores[b].score - ocrResult.scores[a].score);
        decidedType = sorted[0];
        candidate1 = sorted[0];
        candidate2 = sorted[1];
        decidedConfidence = 0.82; // Below 0.85
        isLowCertainty = true;
        decidingRule = "Rule 2: Multiple Strong OCR Identifiers (Highest Score, Low Certainty)";
    }

    let modelResult = { available: false, topType: null, confidence: 0, reason: "Skipped by Rule 1" };
    // RULE 3: Otherwise check ./model-doctype prediction if top class >= 0.85 and no other class > 0.30
    if (!decidedType) {
        modelResult = await runStage1BClassifier(imageElement);
        renderSignal1BUI(modelResult);

        if (modelResult.available && modelResult.topType !== "other") {
            if (modelResult.topProb >= MODEL_DOCTYPE_HIGH_CONF && modelResult.secondProb <= MODEL_DOCTYPE_LOW_RIVAL) {
                decidedType = modelResult.topType;
                decidedConfidence = Math.min(0.99, modelResult.topProb);
                decidingRule = `Rule 3: Dedicated Doctype Classifier Model (Top Prob: ${(modelResult.topProb * 100).toFixed(1)}%)`;
            }
        }
    } else {
        renderSignal1BUI(modelResult);
    }

    let visionResult = { available: false, topType: null, confidence: 0, reason: "Skipped", fake_signals: [] };
    // RULE 4: Otherwise (optional) call the vision-LLM endpoint /api/verify-doc-type
    if (!decidedType) {
        if (signalVisionVal) signalVisionVal.textContent = "Calling AI...";
        visionResult = await runStage1CVision(imageElement);
        renderSignal1CUI(visionResult);

        if (visionResult.available && visionResult.topType !== "other" && visionResult.confidence >= MIN_TYPE_CONFIDENCE) {
            decidedType = visionResult.topType;
            decidedConfidence = Math.min(0.99, visionResult.confidence);
            decidingRule = `Rule 4: Gemini Vision LLM Visual Layout Inspection (${(visionResult.confidence * 100).toFixed(1)}%)`;
        }
    } else {
        renderSignal1CUI(visionResult);
    }

    // RULE 5: Otherwise show "Could not confidently identify the document"
    if (!decidedType || decidedType === "other") {
        decidedType = "unrecognized";
        decidedConfidence = 0;
        decidingRule = "Rule 5: Unrecognized / Insufficient Confidence";
    }

    // Format Signal Agreement String
    const agreementTokens = [];
    if (ocrResult.available && ocrResult.strongTypes.length > 0) agreementTokens.push(`OCR: ${ocrResult.strongTypes.join('/')}`);
    if (modelResult.available && modelResult.topType) agreementTokens.push(`Model: ${modelResult.topType}`);
    if (visionResult.available && visionResult.topType) agreementTokens.push(`AI: ${visionResult.topType}`);
    const signalsAgreementStr = agreementTokens.length > 0 ? agreementTokens.join(" • ") : "No strong identifiers";

    const stage1Decision = {
        finalType: decidedType,
        confidence: Math.min(0.99, decidedConfidence), // Cap at 99%
        decidingRule,
        isLowCertainty,
        candidate1,
        candidate2,
        isRecognized: (decidedType !== "unrecognized" && decidedType !== "other"),
        signalsAgreementStr,
        ocrResult,
        modelResult,
        visionResult
    };

    // Console Logging for Step 2
    console.log("[DEBUG Stage 1 Decision]", stage1Decision);
    renderDebugPanel(stage1Decision);

    return stage1Decision;
}

// ==========================================================================
// 9. STEP 6: STAGE 2 Authenticity Verification (Only Selected Type Model)
// ==========================================================================
async function executeStage2Authenticity(imageElement, currentDocTypeId, stage1Result) {
    // 1. Run ONLY the selected document type's authenticity model
    const activeModel = await loadModelForDocType(currentDocTypeId);
    
    // Run with letterboxed 224x224 and rotation averaging
    const { averagedPreds } = await predictWithRotations(activeModel, imageElement);

    // 2. Perform Client-Side Basic Image Quality Checks
    const quality = analyzeImageQuality(imageElement);

    // 3. Gather Fake Signals from Stage 1C Vision LLM
    const aiFakeSignals = stage1Result.visionResult.fake_signals || [];

    // Parse model probabilities
    let originalProb = 0;
    let fakeProb = 0;
    averagedPreds.forEach(p => {
        const norm = normalizeClassName(p.className);
        if (norm === "ORIGINAL") originalProb += p.probability;
        if (norm === "FAKE") fakeProb += p.probability;
    });

    const docConfig = DOC_TYPES[currentDocTypeId];
    let verdictState = "ORIGINAL"; // 'ORIGINAL', 'FAKE', 'SUSPICIOUS', 'LOW_CONFIDENCE'
    let verdictTitleText = "ORIGINAL";
    let verdictDescText = "";
    let confidenceScore = Math.max(originalProb, fakeProb);

    // Decision Logic for Authenticity:
    // a) Poor Image Quality with Model saying ORIGINAL -> LOW CONFIDENCE
    if (fakeProb < 0.5 && (quality.isBlurry || quality.isExtremeDark || quality.isLowRes)) {
        verdictState = "LOW_CONFIDENCE";
        verdictTitleText = "LOW CONFIDENCE";
        const issues = [];
        if (quality.isBlurry) issues.push("blur detected");
        if (quality.isExtremeDark) issues.push("low lighting");
        if (quality.isLowRes) issues.push("low resolution");
        verdictDescText = `Low confidence – please upload a clearer image (${issues.join(', ')}).`;
    }
    // b) Conflicting Signals or Moire/Screen Photo -> SUSPICIOUS
    else if (
        (fakeProb < 0.4 && aiFakeSignals.length > 0) ||
        (fakeProb >= 0.5 && stage1Result.visionResult.available && aiFakeSignals.length === 0 && stage1Result.visionResult.confidence > 0.85) ||
        quality.hasScreenArtifacts
    ) {
        verdictState = "SUSPICIOUS";
        verdictTitleText = "SUSPICIOUS";
        verdictDescText = quality.hasScreenArtifacts ?
            "Potential screen-capture/display moiré detected. Manual verification recommended." :
            "Discrepancy detected between neural model and AI visual inspection. Manual inspection recommended.";
    }
    // c) FAKE Verdict
    else if (fakeProb >= 0.5 || aiFakeSignals.length >= 2) {
        verdictState = "FAKE";
        verdictTitleText = "FAKE";
        verdictDescText = `Potential fake or manipulated ${docConfig.label} detected (${Math.min(99, Math.round(fakeProb * 100))}% confidence).`;
        confidenceScore = fakeProb;
    }
    // d) ORIGINAL Verdict
    else {
        verdictState = "ORIGINAL";
        verdictTitleText = "ORIGINAL";
        verdictDescText = `Authentic ${docConfig.label} detected with ${Math.min(99, Math.round(originalProb * 100))}% confidence.`;
        confidenceScore = originalProb;
    }

    return {
        verdictState,
        verdictTitleText,
        verdictDescText,
        confidenceScore: Math.min(0.99, confidenceScore),
        originalProb,
        fakeProb,
        predictions: averagedPreds,
        quality,
        aiFakeSignals
    };
}

// ==========================================================================
// 10. Orchestrator: Full Two-Stage Execution Pipeline
// ==========================================================================
async function executeTwoStagePipeline(imageElement, isLive = false) {
    if (!imageElement) return;

    if (!isLive) {
        clearError();
        showLoading(true);
    }

    const startTime = performance.now();

    try {
        // --- STAGE 1: DOCUMENT TYPE DETECTION (Priority Order) ---
        const stage1 = await executeStage1Validation(imageElement);

        // Case A: Unrecognized Document
        if (!stage1.isRecognized) {
            const duration = Math.round(performance.now() - startTime);
            showUnrecognizedCard(stage1, duration);
            return;
        }

        // Case B: Wrong Document Type (finalType !== currentDocType)
        if (stage1.finalType !== currentDocType) {
            const duration = Math.round(performance.now() - startTime);
            showMismatchCard(stage1, duration);
            return;
        }

        // --- STAGE 2: AUTHENTICITY VERIFICATION (Only Selected Type Model) ---
        const stage2 = await executeStage2Authenticity(imageElement, currentDocType, stage1);
        const duration = Math.round(performance.now() - startTime);

        displayStage2Results(stage1, stage2, duration);

    } catch (err) {
        console.error("Execution Pipeline Failure:", err);
        showError("Document verification failed: " + err.message);
    } finally {
        if (!isLive) {
            showLoading(false);
        }
    }
}

async function classifyActiveImage() {
    clearError();
    if (!previewImage.src || previewCard.style.display === 'none') {
        showError("Please upload or capture an image first.");
        return;
    }
    await executeTwoStagePipeline(previewImage, false);
}

// ==========================================================================
// 11. UI Rendering, Warning Cards & Debug Panel
// ==========================================================================
function normalizeClassName(rawLabel) {
    if (!rawLabel) return "UNKNOWN";
    const clean = rawLabel.trim().toUpperCase();
    if (clean.includes("ORIGINAL")) return "ORIGINAL";
    if (clean.includes("FAKE")) return "FAKE";
    return clean;
}

function updateSignalsUIInProgress() {
    if (signalOcrVal) signalOcrVal.textContent = "Scanning OCR...";
    if (signalModelVal) signalModelVal.textContent = doctypeClassifierModel ? "Predicting..." : "Not Loaded";
    if (signalVisionVal) signalVisionVal.textContent = "Standing by";
}

function renderSignal1AUI(s1A) {
    if (!signalOcrVal) return;
    if (s1A.available && s1A.strongTypes.length > 0) {
        const topType = s1A.strongTypes[0];
        signalOcrVal.textContent = `${DOC_TYPES[topType]?.label || topType} (Strong)`;
        const hits = s1A.scores[topType];
        signalOcrSub.textContent = hits.patternHits.length > 0 ? "Regex Pattern Hit" : `${hits.strongHits.length} Strong Keywords`;
        document.getElementById("signal-ocr-card")?.classList.add("hit-agree");
    } else {
        signalOcrVal.textContent = "No Strong Hits";
        signalOcrSub.textContent = s1A.reason || "0 Strong Identifiers";
        document.getElementById("signal-ocr-card")?.classList.add("hit-neutral");
    }
}

function renderSignal1BUI(s1B) {
    if (!signalModelVal) return;
    if (s1B.available && s1B.topType) {
        const pct = Math.min(99, Math.round(s1B.topProb * 100));
        signalModelVal.textContent = `${s1B.topLabel} (${pct}%)`;
        signalModelSub.textContent = `2nd: ${Math.round(s1B.secondProb * 100)}%`;
        document.getElementById("signal-model-card")?.classList.add("hit-agree");
    } else {
        signalModelVal.textContent = "Not Loaded";
        signalModelSub.textContent = "./model-doctype";
        document.getElementById("signal-model-card")?.classList.add("hit-neutral");
    }
}

function renderSignal1CUI(s1C) {
    if (!signalVisionVal) return;
    if (s1C.available && s1C.topType) {
        const pct = Math.min(99, Math.round(s1C.confidence * 100));
        signalVisionVal.textContent = `${s1C.topLabel} (${pct}%)`;
        signalVisionSub.textContent = s1C.fake_signals.length > 0 ? `${s1C.fake_signals.length} Flags` : "Clean Layout";
        document.getElementById("signal-vision-card")?.classList.add("hit-agree");
    } else {
        if (s1C.reason && s1C.reason.includes("Skipped")) {
            signalVisionVal.textContent = "Skipped (Consensus)";
            signalVisionSub.textContent = "Gemini Vision LLM";
        } else if (visionApiStatus === "optional_not_configured") {
            signalVisionVal.textContent = "Optional - Not Configured";
            signalVisionSub.textContent = "Add GEMINI_API_KEY in server/.env";
        } else {
            signalVisionVal.textContent = "Offline";
            signalVisionSub.textContent = "Server uncontactable";
        }
        document.getElementById("signal-vision-card")?.classList.add("hit-neutral");
    }
}

function showMismatchCard(stage1, durationMs) {
    resultsEmpty.style.display = 'none';
    resultsLoading.style.display = 'none';
    resultsContent.style.display = 'block';

    verdictCard.style.display = 'none';
    // TASK 2: Hide Stage 2 authenticity signals when Stage 1 fails
    if (stage2SignalsPanel) stage2SignalsPanel.style.display = 'none';
    if (breakdownSection) breakdownSection.style.display = 'block';
    if (typeof hideChatbotPanel === "function") hideChatbotPanel();

    if (durationMs > 0) {
        inferenceTimeBadge.textContent = `Inference: ${durationMs}ms`;
        inferenceTimeBadge.style.display = 'inline-block';
    }

    if (doctypeWarningCard) {
        doctypeWarningCard.style.display = 'flex';
        doctypeWarningIcon.className = "fa-solid fa-triangle-exclamation";

        const selectedLabel = DOC_TYPES[currentDocType]?.label || currentDocType;
        const detectedLabel = DOC_TYPES[stage1.finalType]?.label || stage1.finalType;
        const confPct = Math.min(99, Math.round(stage1.confidence * 100)); // Capped at 99%

        // If confidence < 0.85, show "Not sure" with top 2 candidates
        if (stage1.isLowCertainty && stage1.candidate1 && stage1.candidate2) {
            const cand1Label = DOC_TYPES[stage1.candidate1]?.label || stage1.candidate1;
            const cand2Label = DOC_TYPES[stage1.candidate2]?.label || stage1.candidate2;
            doctypeWarningTitle.textContent = "Not Sure – Please Confirm Document Type";
            doctypeWarningDesc.textContent = `The uploaded image shows signs of both ${cand1Label} and ${cand2Label}. Please select which document type you uploaded.`;
            doctypeWarningAction.innerHTML = `
                <button class="btn btn-switch" type="button" onclick="selectDocumentType('${stage1.candidate1}')" style="margin-right: 0.5rem;">
                    Confirm ${cand1Label}
                </button>
                <button class="btn btn-outline" type="button" onclick="selectDocumentType('${stage1.candidate2}')">
                    Confirm ${cand2Label}
                </button>
            `;
            doctypeWarningAction.style.display = "block";
        } else {
            doctypeWarningTitle.textContent = "Wrong Document Type";
            doctypeWarningDesc.textContent = `⚠ Wrong document type. You selected ${selectedLabel}, but the uploaded image looks like a ${detectedLabel} (confidence ${confPct}%). Please select the correct type or upload the right document.`;
            doctypeWarningAction.innerHTML = `
                <button class="btn btn-switch" id="doctype-switch-btn" type="button" onclick="selectDocumentType('${stage1.finalType}')">
                    <i class="fa-solid fa-repeat"></i> Switch to ${detectedLabel}
                </button>
            `;
            doctypeWarningAction.style.display = "block";
        }

        if (signalsAgreementBox && signalsAgreementText) {
            signalsAgreementBox.style.display = 'inline-flex';
            signalsAgreementText.textContent = `Decision: ${stage1.decidingRule}`;
        }
    }

    updateWhyResultAudit(stage1, null);
}

function showUnrecognizedCard(stage1, durationMs) {
    resultsEmpty.style.display = 'none';
    resultsLoading.style.display = 'none';
    resultsContent.style.display = 'block';

    verdictCard.style.display = 'none';
    // TASK 2: Hide Stage 2 authenticity signals when Stage 1 fails
    if (stage2SignalsPanel) stage2SignalsPanel.style.display = 'none';
    if (breakdownSection) breakdownSection.style.display = 'block';
    if (typeof hideChatbotPanel === "function") hideChatbotPanel();

    if (durationMs > 0) {
        inferenceTimeBadge.textContent = `Inference: ${durationMs}ms`;
        inferenceTimeBadge.style.display = 'inline-block';
    }

    if (doctypeWarningCard) {
        doctypeWarningCard.style.display = 'flex';
        doctypeWarningIcon.className = "fa-solid fa-circle-question";
        doctypeWarningTitle.textContent = "Unrecognized Document";
        doctypeWarningDesc.textContent = "Could not confidently identify the document. Please upload a clearer, full image of an Aadhaar, PAN, Passport or Voter ID.";

        if (signalsAgreementBox && signalsAgreementText) {
            signalsAgreementBox.style.display = 'inline-flex';
            signalsAgreementText.textContent = `Decision: ${stage1.decidingRule}`;
        }
        doctypeWarningAction.style.display = "none";
    }

    updateWhyResultAudit(stage1, null);
}

function displayStage2Results(stage1, stage2, durationMs) {
    resultsEmpty.style.display = 'none';
    resultsContent.style.display = 'block';

    if (doctypeWarningCard) doctypeWarningCard.style.display = 'none';
    verdictCard.style.display = 'flex';
    if (stage2SignalsPanel) stage2SignalsPanel.style.display = 'block';
    if (breakdownSection) breakdownSection.style.display = 'block';

    if (durationMs > 0) {
        inferenceTimeBadge.textContent = `Inference: ${durationMs}ms`;
        inferenceTimeBadge.style.display = 'inline-block';
    }

    // Verdict Top Score: Capped at 99%
    const scorePct = Math.min(99, Math.round(stage2.confidenceScore * 100));
    verdictTopScore.textContent = `${scorePct}%`;
    verdictTitle.textContent = stage2.verdictTitleText;
    verdictDesc.textContent = stage2.verdictDescText;

    if (stage2.verdictState === "ORIGINAL") {
        verdictCard.className = "verdict-card verdict-original";
        verdictIcon.className = "fa-solid fa-circle-check";
    } else if (stage2.verdictState === "FAKE") {
        verdictCard.className = "verdict-card verdict-fake";
        verdictIcon.className = "fa-solid fa-triangle-exclamation";
    } else if (stage2.verdictState === "SUSPICIOUS") {
        verdictCard.className = "verdict-card verdict-suspicious";
        verdictIcon.className = "fa-solid fa-shield-halved";
    } else if (stage2.verdictState === "LOW_CONFIDENCE") {
        verdictCard.className = "verdict-card verdict-low-confidence";
        verdictIcon.className = "fa-solid fa-eye-slash";
    }

    // Detected Type Pill inside Verdict Card (Capped at 99%)
    if (detectedTypePill && detectedTypeText) {
        const detLabel = DOC_TYPES[stage1.finalType]?.label || stage1.finalType;
        const detPct = Math.min(99, Math.round(stage1.confidence * 100));
        detectedTypeText.textContent = `Detected: ${detLabel} ${detPct}%`;
        detectedTypePill.style.display = 'inline-flex';
    }

    // Progress Bars (Capped at 99%)
    const origPct = Math.min(99, Math.round(stage2.originalProb * 100));
    const fakePct = Math.min(99, Math.round(stage2.fakeProb * 100));

    const origScoreEl = document.getElementById("score-ORIGINAL");
    const origBarEl = document.getElementById("bar-ORIGINAL");
    const fakeScoreEl = document.getElementById("score-FAKE");
    const fakeBarEl = document.getElementById("bar-FAKE");

    if (origScoreEl && origBarEl) {
        origScoreEl.textContent = `${origPct}%`;
        origBarEl.style.width = `${origPct}%`;
    }
    if (fakeScoreEl && fakeBarEl) {
        fakeScoreEl.textContent = `${fakePct}%`;
        fakeBarEl.style.width = `${fakePct}%`;
    }

    // Quality Chips Update
    updateQualityChips(stage2.quality);

    // Expandable "Why this result?" Audit
    updateWhyResultAudit(stage1, stage2);

    // AI Chatbot panel activation (Activated for FAKE or SUSPICIOUS)
    if (typeof handleChatbotVisibility === "function") {
        const docLabel = DOC_TYPES[currentDocType]?.label || "Identity Document";
        handleChatbotVisibility(stage2.verdictState === "FAKE" || stage2.verdictState === "SUSPICIOUS" ? "FAKE" : "ORIGINAL", docLabel, `${scorePct}%`);
    }
}

function updateQualityChips(quality) {
    if (!chipBlur) return;

    chipBlur.className = `quality-chip ${quality.isBlurry ? 'chip-fail' : 'chip-pass'}`;
    chipBlurText.textContent = `Blur: ${quality.isBlurry ? 'Blurry' : 'Sharp'} (Var: ${quality.lapVariance})`;

    chipRes.className = `quality-chip ${quality.isLowRes ? 'chip-warn' : 'chip-pass'}`;
    chipResText.textContent = `Res: ${quality.naturalWidth}x${quality.naturalHeight}`;

    const exposurePass = !quality.isExtremeDark && !quality.isExtremeBright;
    chipLight.className = `quality-chip ${exposurePass ? 'chip-pass' : 'chip-fail'}`;
    chipLightText.textContent = `Light: ${quality.isExtremeDark ? 'Too Dark' : (quality.isExtremeBright ? 'Washed Out' : 'Balanced')} (${quality.avgLuminance}/255)`;

    chipMoire.className = `quality-chip ${quality.hasScreenArtifacts ? 'chip-warn' : 'chip-pass'}`;
    chipMoireText.textContent = `Moiré: ${quality.hasScreenArtifacts ? 'Detected (Display Photo)' : 'None'}`;
}

function updateWhyResultAudit(stage1, stage2) {
    if (!whyResultContent) return;

    let html = `<div><strong>STAGE 1: DOCUMENT TYPE DETECTION AUDIT</strong><ul>`;
    html += `<li><strong>Decision Rule:</strong> ${stage1.decidingRule}</li>`;
    html += `<li><strong>Detected Type:</strong> ${stage1.isRecognized ? DOC_TYPES[stage1.finalType]?.label : 'Unrecognized'} (Confidence: ${Math.min(99, Math.round(stage1.confidence * 100))}%)</li>`;

    // OCR Detail
    if (stage1.ocrResult.available) {
        const strongHitsList = [];
        for (const [id, s] of Object.entries(stage1.ocrResult.scores)) {
            if (s.isStrong) {
                strongHitsList.push(`${s.label}: [${s.patternHits.concat(s.strongHits).join(', ')}]`);
            }
        }
        html += `<li><strong>1A. OCR Engine:</strong> ${strongHitsList.length > 0 ? strongHitsList.join(' | ') : 'No strong identifiers found'}</li>`;
    } else {
        html += `<li><strong>1A. OCR Engine:</strong> ${stage1.ocrResult.reason || 'Unavailable'}</li>`;
    }

    // Model Detail
    if (stage1.modelResult.available) {
        html += `<li><strong>1B. Doctype Classifier (./model-doctype):</strong> Top: ${stage1.modelResult.topLabel} (${Math.round(stage1.modelResult.topProb * 100)}%), 2nd: ${Math.round(stage1.modelResult.secondProb * 100)}%</li>`;
    } else {
        html += `<li><strong>1B. Doctype Classifier:</strong> ${stage1.modelResult.reason}</li>`;
    }

    // Vision Detail
    if (stage1.visionResult.available) {
        html += `<li><strong>1C. Gemini Vision LLM:</strong> ${stage1.visionResult.topLabel} (${Math.round(stage1.visionResult.confidence * 100)}% - ${stage1.visionResult.reason})</li>`;
    } else {
        html += `<li><strong>1C. Gemini Vision LLM:</strong> ${stage1.visionResult.reason || 'Skipped'}</li>`;
    }
    html += `</ul></div>`;

    if (stage2) {
        html += `<div style="margin-top: 0.75rem;"><strong>STAGE 2: AUTHENTICITY & IMAGE AUDIT</strong><ul>`;
        html += `<li><strong>Selected Authenticity Model (${DOC_TYPES[currentDocType]?.label}):</strong> ORIGINAL: ${Math.min(99, Math.round(stage2.originalProb * 100))}% | FAKE: ${Math.min(99, Math.round(stage2.fakeProb * 100))}%</li>`;
        html += `<li><strong>Image Quality Metrics:</strong> Laplacian Sharpness: ${stage2.quality.lapVariance} (Threshold: ${BLUR_LAPLACIAN_THRESHOLD}) | Exposure: ${stage2.quality.avgLuminance}/255 | Dimensions: ${stage2.quality.naturalWidth}x${stage2.quality.naturalHeight}</li>`;
        if (stage2.aiFakeSignals.length > 0) {
            html += `<li style="color: #fca5a5;"><strong>AI Tampering Flags:</strong> ${stage2.aiFakeSignals.join("; ")}</li>`;
        } else {
            html += `<li><strong>AI Tampering Flags:</strong> No visual tampering anomalies detected.</li>`;
        }
        html += `<li><strong>Final System Verdict:</strong> <span style="text-decoration: underline;">${stage2.verdictTitleText}</span> (${stage2.verdictDescText})</li>`;
        html += `</ul></div>`;
    }

    whyResultContent.innerHTML = html;
}

// Render Step 2 Debug Panel Table
function renderDebugPanel(stage1) {
    if (!debugPanelBody) return;

    let html = `<div style="margin-bottom: 0.75rem;">
        <div><strong>Final Decision:</strong> <span style="color: #38bdf8;">${stage1.finalType}</span> | <strong>Confidence:</strong> <span style="color: #4ade80;">${Math.min(99, Math.round(stage1.confidence * 100))}%</span></div>
        <div><strong>Deciding Rule:</strong> <span style="color: #fbbf24;">${stage1.decidingRule}</span></div>
    </div>`;

    // OCR Raw Text block (first 300 chars)
    const rawOcrSnippet = stage1.ocrResult.rawText ? stage1.ocrResult.rawText.substring(0, 300) : "No text extracted";
    html += `<div>
        <div style="margin-bottom: 0.35rem;">
            <strong>OCR Engine:</strong> Confidence: <span style="color: #4ade80;">${stage1.ocrResult.ocrConfidence || 0}%</span> | 
            Orientation Checked: <span style="color: #38bdf8;">${stage1.ocrResult.rotationUsed || 0}°</span>
        </div>
        <strong>OCR Raw Text (first 300 chars):</strong>
        <div class="debug-raw-ocr">${rawOcrSnippet.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
    </div>`;

    // OCR Scores Table
    html += `<div style="margin-top: 0.75rem;"><strong>OCR Signal Analysis per Document Type:</strong>
        <table class="debug-table">
            <thead>
                <tr>
                    <th>Doc Type</th>
                    <th>Strong Keywords Hit</th>
                    <th>Regex Pattern Hit</th>
                    <th>Weak Keywords Hit</th>
                    <th>Score</th>
                    <th>Strong?</th>
                </tr>
            </thead>
            <tbody>`;

    for (const [id, s] of Object.entries(stage1.ocrResult.scores || {})) {
        html += `<tr>
            <td><strong>${s.label}</strong></td>
            <td>${s.strongHits.length > 0 ? s.strongHits.join(', ') : '–'}</td>
            <td>${s.patternHits.length > 0 ? s.patternHits.join(', ') : '–'}</td>
            <td>${s.weakHits.length > 0 ? s.weakHits.join(', ') : '–'}</td>
            <td>${s.score}</td>
            <td style="color: ${s.isStrong ? '#4ade80' : '#94a3b8'};">${s.isStrong ? 'YES' : 'NO'}</td>
        </tr>`;
    }
    html += `</tbody></table></div>`;

    // Model Classes Table
    html += `<div style="margin-top: 0.5rem;"><strong>Doctype Model (./model-doctype) Probabilities:</strong>`;
    if (stage1.modelResult.available && stage1.modelResult.predictions) {
        html += `<table class="debug-table"><thead><tr>`;
        stage1.modelResult.predictions.forEach(p => {
            html += `<th>${p.className}</th>`;
        });
        html += `</tr></thead><tbody><tr>`;
        stage1.modelResult.predictions.forEach(p => {
            html += `<td>${(p.probability * 100).toFixed(1)}%</td>`;
        });
        html += `</tr></tbody></table>`;
    } else {
        html += `<p style="color: #94a3b8; font-style: italic;">Model not loaded (${stage1.modelResult.reason})</p>`;
    }
    html += `</div>`;

    // Vision AI Row
    const visionDisplayStatus = stage1.visionResult.available ?
        `Identified: ${stage1.visionResult.topLabel} (Confidence ${(stage1.visionResult.confidence * 100).toFixed(1)}%) - Reason: ${stage1.visionResult.reason}` :
        (visionApiStatus === "optional_not_configured" ? "Optional - Not Configured (Add GEMINI_API_KEY to server/.env)" : `Status: ${stage1.visionResult.reason || 'Offline'}`);

    html += `<div style="margin-top: 0.5rem;"><strong>Vision AI LLM (/api/verify-doc-type):</strong>
        <div>${visionDisplayStatus}</div>
    </div>`;

    debugPanelBody.innerHTML = html;
}

// ==========================================================================
// 12. UI State Helpers
// ==========================================================================
function showLoading(isLoading) {
    if (isLoading) {
        resultsEmpty.style.display = 'none';
        resultsContent.style.display = 'none';
        resultsLoading.style.display = 'block';
    } else {
        resultsLoading.style.display = 'none';
    }
}

function showError(msg) {
    errorMessage.innerHTML = msg;
    errorBanner.style.display = 'flex';
}

function clearError() {
    errorBanner.style.display = 'none';
    errorMessage.innerHTML = '';
}

function resetResultsUI() {
    resultsEmpty.style.display = 'block';
    resultsContent.style.display = 'none';
    resultsLoading.style.display = 'none';
    inferenceTimeBadge.style.display = 'none';
    if (doctypeWarningCard) doctypeWarningCard.style.display = 'none';
    if (detectedTypePill) detectedTypePill.style.display = 'none';
    if (typeof hideChatbotPanel === "function") hideChatbotPanel();
    clearError();
}
