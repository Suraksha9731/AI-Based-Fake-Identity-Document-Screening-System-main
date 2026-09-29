/**
 * Multi-Document Verification Script with 3-Signal Stage 1 & Multi-Factor Stage 2
 * Architecture:
 * - STAGE 1A: Tesseract.js Client-Side OCR with Fuzzy Matching (Levenshtein <= 2) & Regex Patterns
 * - STAGE 1B: Dedicated Document Type Classifier (./model-doctype/)
 * - STAGE 1C: Gemini Vision Verification Fallback (/api/verify-doc-type)
 * - STAGE 2:  Selected Document Authenticity Model + Image Quality Checks + AI Tampering Assessment
 */

// ==========================================================================
// Thresholds & Configuration Constants
// ==========================================================================
const MIN_TYPE_CONFIDENCE = 0.75;              // Minimum combined confidence for document type decision
const AI_FALLBACK_CONFIDENCE_THRESHOLD = 0.80; // Call 1C AI vision if best confidence < 0.80 or 1A/1B disagree
const BLUR_LAPLACIAN_THRESHOLD = 70.0;         // Below this variance -> blurry image
const LOW_RES_WIDTH_THRESHOLD = 400;          // Minimum natural width in px
const LOW_RES_HEIGHT_THRESHOLD = 300;         // Minimum natural height in px
const BRIGHTNESS_MIN = 35;                    // Extreme darkness threshold
const BRIGHTNESS_MAX = 225;                   // Extreme washed-out brightness threshold
const BACKEND_VISION_URL = "http://localhost:5001/api/verify-doc-type";

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

// OCR Keyword and Pattern Map for Stage 1A
const OCR_CONFIG = {
    aadhaar: {
        id: "aadhaar",
        label: "Aadhaar Card",
        keywords: ["aadhaar", "uidai", "unique identification", "आधार", "your aadhaar no", "vid"],
        pattern: /\b\d{4}\s?\d{4}\s?\d{4}\b/
    },
    pancard: {
        id: "pancard",
        label: "PAN Card",
        keywords: ["income tax department", "permanent account number", "आयकर विभाग", "govt. of india", "pan card"],
        pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/i
    },
    passport: {
        id: "passport",
        label: "Passport",
        keywords: ["republic of india", "passport", "पासपोर्ट", "type", "nationality", "p<ind"],
        pattern: /\bP<[A-Z0-9<]+/i
    },
    voterid: {
        id: "voterid",
        label: "Voter ID Card",
        keywords: ["election commission of india", "भारत निर्वाचन आयोग", "elector", "epic", "voter"],
        pattern: /\b[A-Z]{3}[0-9]{7}\b/i
    }
};

// Application State
let currentDocType = "aadhaar";
const loadedModels = {}; // Cache map for per-type authenticity models { aadhaar, pancard, passport, voterid }
let doctypeClassifierModel = null; // Stage 1B Dedicated classifier model (./model-doctype)
let webcamStream = null;
let isLivePredicting = false;
let livePredictAnimationFrame = null;

// DOM Elements
const modelStatusPill = document.getElementById("model-status");
const modelStatusText = document.getElementById("model-status-text");

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

const userDisplayName = document.getElementById("user-display-name");

// ==========================================================================
// Initialization & Preload
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
});

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

        // 1. Try loading Stage 1B Dedicated Document Type Classifier (./model-doctype/)
        try {
            doctypeClassifierModel = await tmImage.load("./model-doctype/model.json", "./model-doctype/metadata.json");
            console.log("[STAGE 1B] Dedicated document type classifier loaded successfully.");
        } catch (_) {
            doctypeClassifierModel = null;
            console.log("[STAGE 1B] ./model-doctype not found or not yet trained. Will use OCR (1A) + AI Vision (1C).");
        }

        // 2. Preload Stage 2 Authenticity Models for all document types
        await Promise.all(Object.keys(DOC_TYPES).map(id => loadModelForDocType(id)));

        const modelCount = Object.keys(loadedModels).length + (doctypeClassifierModel ? 1 : 0);
        updateModelStatus("ready", `Models Ready (${modelCount} Loaded)`);
    } catch (err) {
        console.error("Error preloading models:", err);
        updateModelStatus("error", "Model Load Failed");
        showError("Failed to load document models. Please ensure you are serving via HTTP (e.g. python -m http.server 5000).");
    }
}

function updateModelStatus(state, text) {
    if (modelStatusPill) {
        modelStatusPill.className = `model-status-badge status-${state}`;
        modelStatusText.textContent = text;
    }
}

// ==========================================================================
// Document Selection & Auto Re-validation
// ==========================================================================
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
// File Upload & Webcam Handling
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
// Image Processing & Quality Utilities
// ==========================================================================
function getPreprocessedCanvas(imageElement, rotationDeg = 0, enhance = false) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const maxDim = 900;
    let w = imageElement.naturalWidth || imageElement.videoWidth || imageElement.width || 640;
    let h = imageElement.naturalHeight || imageElement.videoHeight || imageElement.height || 480;

    if (w > maxDim || h > maxDim) {
        if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
        } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
        }
    }

    if (rotationDeg === 90 || rotationDeg === 270) {
        canvas.width = h;
        canvas.height = w;
    } else {
        canvas.width = w;
        canvas.height = h;
    }

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.drawImage(imageElement, -w / 2, -h / 2, w, h);
    ctx.restore();

    if (enhance) {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
            const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const contrast = gray > 128 ? Math.min(255, (gray - 128) * 1.4 + 128) : Math.max(0, 128 - (128 - gray) * 1.4);
            d[i] = contrast;
            d[i + 1] = contrast;
            d[i + 2] = contrast;
        }
        ctx.putImageData(imgData, 0, 0);
    }

    return canvas;
}

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
        if (diffR > 40 && diffB > 40) highFreqCount++;
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

// Levenshtein distance helper (case-insensitive fuzzy match <= 2)
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

// ==========================================================================
// STAGE 1A: Tesseract.js Client-Side OCR Keyword & Pattern Matcher
// ==========================================================================
function evaluateOcrText(rawText) {
    if (!rawText || typeof rawText !== "string") {
        return { topType: null, score: 0, confidence: 0, patternHit: false, keywordHits: [], allScores: {} };
    }
    const cleanLower = rawText.toLowerCase();
    const tokens = cleanLower.split(/[\s,.:;/\-_()|'"]+/).filter(t => t.length > 2);
    const results = {};

    for (const [docId, config] of Object.entries(OCR_CONFIG)) {
        let patternHit = false;
        if (config.pattern && config.pattern.test(rawText)) {
            patternHit = true;
        }

        const matchedKeywords = [];
        for (const kw of config.keywords) {
            const kwLower = kw.toLowerCase();
            if (kwLower.includes(" ")) {
                if (cleanLower.includes(kwLower)) {
                    matchedKeywords.push(kw);
                } else {
                    // Check sub-phrases or fuzzy match
                    const kwParts = kwLower.split(" ");
                    if (kwParts.every(part => tokens.some(t => levenshteinDistance(t, part) <= 1))) {
                        matchedKeywords.push(kw + " ~fuzzy");
                    }
                }
            } else {
                if (tokens.includes(kwLower) || tokens.some(t => levenshteinDistance(t, kwLower) <= 2)) {
                    matchedKeywords.push(kw);
                }
            }
        }

        // Score: patterns weigh 2x, each keyword weighs 1x
        const score = (patternHit ? 2 : 0) + matchedKeywords.length;
        let confidence = 0;
        if (patternHit && matchedKeywords.length > 0) confidence = 0.96;
        else if (patternHit) confidence = 0.90;
        else if (matchedKeywords.length >= 2) confidence = 0.85;
        else if (matchedKeywords.length === 1) confidence = 0.65;

        results[docId] = {
            id: docId,
            label: config.label,
            score,
            confidence,
            patternHit,
            matchedKeywords
        };
    }

    const sorted = Object.values(results).sort((a, b) => b.score - a.score);
    const top = sorted[0];

    return {
        topType: top && top.score > 0 ? top.id : null,
        topLabel: top && top.score > 0 ? top.label : null,
        score: top ? top.score : 0,
        confidence: top ? top.confidence : 0,
        patternHit: top ? top.patternHit : false,
        keywordHits: top ? top.matchedKeywords : [],
        allScores: results,
        rawText
    };
}

async function runStage1AOcr(imageElement) {
    if (typeof Tesseract === "undefined") {
        console.warn("[STAGE 1A] Tesseract.js is not loaded from CDN.");
        return { available: false, topType: null, score: 0, confidence: 0, reason: "OCR library unavailable" };
    }

    try {
        // Try original canvas first
        const canvas0 = getPreprocessedCanvas(imageElement, 0, false);
        const res0 = await Tesseract.recognize(canvas0, 'eng');
        let evaluation = evaluateOcrText(res0.data.text);

        if (evaluation.score >= 2 || evaluation.patternHit) {
            return { available: true, ...evaluation };
        }

        // Try enhanced contrast
        const canvasEnh = getPreprocessedCanvas(imageElement, 0, true);
        const resEnh = await Tesseract.recognize(canvasEnh, 'eng');
        const evalEnh = evaluateOcrText(resEnh.data.text);
        if (evalEnh.score > evaluation.score) evaluation = evalEnh;

        if (evaluation.score >= 2 || evaluation.patternHit) {
            return { available: true, ...evaluation };
        }

        // If no keywords found, try rotations: 90, 180, 270
        const rotations = [90, 180, 270];
        for (const rot of rotations) {
            const rotCanvas = getPreprocessedCanvas(imageElement, rot, false);
            const rotRes = await Tesseract.recognize(rotCanvas, 'eng');
            const rotEval = evaluateOcrText(rotRes.data.text);
            if (rotEval.score > evaluation.score) {
                evaluation = rotEval;
            }
            if (evaluation.score >= 2 || evaluation.patternHit) break;
        }

        return { available: true, ...evaluation };

    } catch (ocrErr) {
        console.warn("[STAGE 1A] OCR error:", ocrErr);
        return { available: false, topType: null, score: 0, confidence: 0, reason: ocrErr.message };
    }
}

// ==========================================================================
// STAGE 1B: Dedicated Document Type Classifier Model (./model-doctype/)
// ==========================================================================
async function runStage1BClassifier(imageElement) {
    if (!doctypeClassifierModel) {
        return { available: false, topType: null, confidence: 0, reason: "./model-doctype model not present" };
    }

    try {
        const predictions = await doctypeClassifierModel.predict(imageElement);
        const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
        const top = sorted[0];
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
            confidence: top ? top.probability : 0,
            predictions
        };
    } catch (err) {
        console.warn("[STAGE 1B] Model classification error:", err);
        return { available: false, topType: null, confidence: 0, reason: err.message };
    }
}

// ==========================================================================
// STAGE 1C: Gemini Vision LLM Verification Fallback (/api/verify-doc-type)
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

        const response = await fetch(BACKEND_VISION_URL, {
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
                confidence: typeof data.result.confidence === "number" ? data.result.confidence : 0.85,
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
        console.warn("[STAGE 1C] Vision API fetch error:", err.message);
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
// DECISION LOGIC: Multi-Signal Combination (1A + 1B + 1C)
// ==========================================================================
async function executeStage1Validation(imageElement) {
    updateSignalsUIInProgress();

    // 1. Run Stage 1A (OCR) and Stage 1B (Dedicated Classifier) concurrently
    const [signal1A, signal1B] = await Promise.all([
        runStage1AOcr(imageElement),
        runStage1BClassifier(imageElement)
    ]);

    renderSignal1AUI(signal1A);
    renderSignal1BUI(signal1B);

    // 2. Decide whether Stage 1C (AI Vision) is needed
    // Condition: Call 1C if OCR and Model disagree, OR best confidence < 0.80, OR model is missing
    const ocrType = signal1A.topType;
    const modelType = signal1B.topType;
    const bestPreConf = Math.max(signal1A.confidence || 0, signal1B.confidence || 0);

    const needsAiVision = (
        !signal1B.available ||
        !signal1A.topType ||
        (ocrType && modelType && ocrType !== modelType) ||
        bestPreConf < AI_FALLBACK_CONFIDENCE_THRESHOLD
    );

    let signal1C = { available: false, topType: null, confidence: 0, reason: "Skipped (High consensus in 1A & 1B)", fake_signals: [] };
    if (needsAiVision) {
        if (signalVisionVal) signalVisionVal.textContent = "Calling AI...";
        signal1C = await runStage1CVision(imageElement);
    }
    renderSignal1CUI(signal1C);

    // 3. Majority Voting & Weighted Decision Synthesis
    const docCandidates = ["aadhaar", "pancard", "passport", "voterid", "other"];
    const weightedVotes = { aadhaar: 0, pancard: 0, passport: 0, voterid: 0, other: 0 };
    let totalWeight = 0;

    // Weight 1A (OCR): Pattern match is given highest weight (2.2), keywords (1.4)
    if (signal1A.available && signal1A.topType) {
        const ocrWeight = signal1A.patternHit ? 2.2 : (signal1A.score >= 2 ? 1.4 : 0.8);
        weightedVotes[signal1A.topType] += (signal1A.confidence || 0.8) * ocrWeight;
        totalWeight += ocrWeight;
    }

    // Weight 1B (Model): Weight 1.5
    if (signal1B.available && signal1B.topType) {
        const modelWeight = 1.5;
        weightedVotes[signal1B.topType] += (signal1B.confidence || 0.7) * modelWeight;
        totalWeight += modelWeight;
    }

    // Weight 1C (Vision AI): Weight 1.8
    if (signal1C.available && signal1C.topType) {
        const aiWeight = 1.8;
        weightedVotes[signal1C.topType] += (signal1C.confidence || 0.85) * aiWeight;
        totalWeight += aiWeight;
    }

    let finalType = "other";
    let highestScore = -1;
    for (const [candidate, score] of Object.entries(weightedVotes)) {
        if (score > highestScore) {
            highestScore = score;
            finalType = candidate;
        }
    }

    const normalizedConfidence = totalWeight > 0 ? (highestScore / totalWeight) : 0;
    const isRecognized = (finalType !== "other" && normalizedConfidence >= MIN_TYPE_CONFIDENCE);

    // Format Signal Agreement String for Display
    const agreementTokens = [];
    if (signal1A.available && signal1A.topType) agreementTokens.push(`OCR: ${signal1A.topType}`);
    if (signal1B.available && signal1B.topType) agreementTokens.push(`Model: ${signal1B.topType}`);
    if (signal1C.available && signal1C.topType) agreementTokens.push(`AI: ${signal1C.topType}`);
    const signalsAgreementStr = agreementTokens.length > 0 ? agreementTokens.join(" • ") : "No clear signals";

    return {
        finalType: isRecognized ? finalType : "unrecognized",
        confidence: normalizedConfidence,
        isRecognized,
        signalsAgreementStr,
        signal1A,
        signal1B,
        signal1C
    };
}

// ==========================================================================
// STAGE 2: Authenticity Check (ORIGINAL vs FAKE vs SUSPICIOUS vs LOW CONFIDENCE)
// ==========================================================================
async function executeStage2Authenticity(imageElement, currentDocTypeId, stage1Result) {
    // 1. Run ONLY the selected document type's authenticity model
    const activeModel = await loadModelForDocType(currentDocTypeId);
    const predictions = await activeModel.predict(imageElement);

    // 2. Perform Client-Side Basic Image Quality Checks
    const quality = analyzeImageQuality(imageElement);

    // 3. Gather Fake Signals from Stage 1C Vision LLM
    const aiFakeSignals = stage1Result.signal1C.fake_signals || [];

    // Parse model probabilities
    let originalProb = 0;
    let fakeProb = 0;
    predictions.forEach(p => {
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
        if (quality.isExtremeDark) issues.push("dark lighting");
        if (quality.isLowRes) issues.push("low resolution");
        verdictDescText = `Image quality is degraded (${issues.join(', ')}). Please upload a clearer image.`;
    }
    // b) Conflicting Signals or Moire/Screen Photo -> SUSPICIOUS
    else if (
        (fakeProb < 0.4 && aiFakeSignals.length > 0) ||
        (fakeProb >= 0.5 && stage1Result.signal1C.available && aiFakeSignals.length === 0 && stage1Result.signal1C.confidence > 0.85) ||
        quality.hasScreenArtifacts
    ) {
        verdictState = "SUSPICIOUS";
        verdictTitleText = "SUSPICIOUS";
        verdictDescText = quality.hasScreenArtifacts ?
            "Potential screen-capture/display moiré detected. Manual verification recommended." :
            "Discrepancy detected between neural model and AI visual inspection. Document requires manual review.";
    }
    // c) FAKE Verdict
    else if (fakeProb >= 0.5 || aiFakeSignals.length >= 2) {
        verdictState = "FAKE";
        verdictTitleText = "FAKE";
        verdictDescText = `Potential fake or manipulated ${docConfig.label} detected (${(fakeProb * 100).toFixed(1)}% confidence).`;
        confidenceScore = fakeProb;
    }
    // d) ORIGINAL Verdict
    else {
        verdictState = "ORIGINAL";
        verdictTitleText = "ORIGINAL";
        verdictDescText = `Authentic ${docConfig.label} detected with ${(originalProb * 100).toFixed(1)}% confidence.`;
        confidenceScore = originalProb;
    }

    return {
        verdictState,
        verdictTitleText,
        verdictDescText,
        confidenceScore,
        originalProb,
        fakeProb,
        predictions,
        quality,
        aiFakeSignals
    };
}

// ==========================================================================
// Orchestrator: Full Two-Stage Execution Pipeline
// ==========================================================================
async function executeTwoStagePipeline(imageElement, isLive = false) {
    if (!imageElement) return;

    if (!isLive) {
        clearError();
        showLoading(true);
    }

    const startTime = performance.now();

    try {
        // --- STAGE 1: 3-SIGNAL DOCUMENT TYPE VALIDATION ---
        const stage1 = await executeStage1Validation(imageElement);

        // Case A: Unrecognized Document (< 0.75 confidence or 'other')
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

        // --- STAGE 2: AUTHENTICITY & MULTI-FACTOR AUDIT ---
        // Run ONLY when finalType === currentDocType
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
// UI Rendering & Audit Presentation
// ==========================================================================
function normalizeClassName(rawLabel) {
    if (!rawLabel) return "UNKNOWN";
    const clean = rawLabel.trim().toUpperCase();
    if (clean.includes("ORIGINAL")) return "ORIGINAL";
    if (clean.includes("FAKE")) return "FAKE";
    return clean;
}

function updateSignalsUIInProgress() {
    if (signalOcrVal) signalOcrVal.textContent = "Scanning...";
    if (signalModelVal) signalModelVal.textContent = doctypeClassifierModel ? "Predicting..." : "Not Loaded";
    if (signalVisionVal) signalVisionVal.textContent = "Standing by";
}

function renderSignal1AUI(s1A) {
    if (!signalOcrVal) return;
    if (s1A.available && s1A.topType) {
        signalOcrVal.textContent = `${DOC_TYPES[s1A.topType]?.label || s1A.topType} (${Math.round(s1A.confidence * 100)}%)`;
        signalOcrSub.textContent = s1A.patternHit ? "Regex Pattern Match" : `${s1A.keywordHits.length} Keywords`;
        document.getElementById("signal-ocr-card")?.classList.add("hit-agree");
    } else {
        signalOcrVal.textContent = "No Keywords";
        signalOcrSub.textContent = s1A.reason || "0 Hits";
        document.getElementById("signal-ocr-card")?.classList.add("hit-neutral");
    }
}

function renderSignal1BUI(s1B) {
    if (!signalModelVal) return;
    if (s1B.available && s1B.topType) {
        signalModelVal.textContent = `${s1B.topLabel} (${Math.round(s1B.confidence * 100)}%)`;
        signalModelSub.textContent = "5-Class Classifier";
        document.getElementById("signal-model-card")?.classList.add("hit-agree");
    } else {
        signalModelVal.textContent = "Unavailable";
        signalModelSub.textContent = "Train ./model-doctype";
        document.getElementById("signal-model-card")?.classList.add("hit-neutral");
    }
}

function renderSignal1CUI(s1C) {
    if (!signalVisionVal) return;
    if (s1C.available && s1C.topType) {
        signalVisionVal.textContent = `${s1C.topLabel} (${Math.round(s1C.confidence * 100)}%)`;
        signalVisionSub.textContent = s1C.fake_signals.length > 0 ? `${s1C.fake_signals.length} Flags` : "Clean Layout";
        document.getElementById("signal-vision-card")?.classList.add("hit-agree");
    } else {
        signalVisionVal.textContent = s1C.reason && s1C.reason.includes("Skipped") ? "Skipped (Consensus)" : "Offline";
        signalVisionSub.textContent = "Gemini Vision LLM";
        document.getElementById("signal-vision-card")?.classList.add("hit-neutral");
    }
}

function showMismatchCard(stage1, durationMs) {
    resultsEmpty.style.display = 'none';
    resultsLoading.style.display = 'none';
    resultsContent.style.display = 'block';

    verdictCard.style.display = 'none';
    if (breakdownSection) breakdownSection.style.display = 'block';
    if (typeof hideChatbotPanel === "function") hideChatbotPanel();

    if (durationMs > 0) {
        inferenceTimeBadge.textContent = `Inference: ${durationMs}ms`;
        inferenceTimeBadge.style.display = 'inline-block';
    }

    if (doctypeWarningCard) {
        doctypeWarningCard.style.display = 'flex';
        doctypeWarningIcon.className = "fa-solid fa-triangle-exclamation";
        doctypeWarningTitle.textContent = "Wrong Document Type";

        const selectedLabel = DOC_TYPES[currentDocType]?.label || currentDocType;
        const detectedLabel = DOC_TYPES[stage1.finalType]?.label || stage1.finalType;
        const confPct = Math.round(stage1.confidence * 100);

        doctypeWarningDesc.textContent = `⚠ Wrong document type. You selected ${selectedLabel}, but the uploaded image looks like a ${detectedLabel} (confidence ${confPct}%). Please select the correct type or upload the right document.`;

        if (signalsAgreementBox && signalsAgreementText) {
            signalsAgreementBox.style.display = 'inline-flex';
            signalsAgreementText.textContent = `Signals: ${stage1.signalsAgreementStr}`;
        }

        doctypeWarningAction.style.display = "block";
        doctypeSwitchBtnLabel.textContent = `Switch to ${detectedLabel}`;
        doctypeSwitchBtn.onclick = () => selectDocumentType(stage1.finalType);
    }

    updateWhyResultAudit(stage1, null);
}

function showUnrecognizedCard(stage1, durationMs) {
    resultsEmpty.style.display = 'none';
    resultsLoading.style.display = 'none';
    resultsContent.style.display = 'block';

    verdictCard.style.display = 'none';
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
        doctypeWarningDesc.textContent = "Unrecognized document. Please upload a clear image of an Aadhaar, PAN, Passport or Voter ID.";

        if (signalsAgreementBox && signalsAgreementText) {
            signalsAgreementBox.style.display = 'inline-flex';
            signalsAgreementText.textContent = `Signals: ${stage1.signalsAgreementStr}`;
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
    if (breakdownSection) breakdownSection.style.display = 'block';

    if (durationMs > 0) {
        inferenceTimeBadge.textContent = `Inference: ${durationMs}ms`;
        inferenceTimeBadge.style.display = 'inline-block';
    }

    // Verdict Card Classes & Icons
    verdictTopScore.textContent = `${(stage2.confidenceScore * 100).toFixed(1)}%`;
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

    // Detected Type Pill inside Verdict Card
    if (detectedTypePill && detectedTypeText) {
        const detLabel = DOC_TYPES[stage1.finalType]?.label || stage1.finalType;
        detectedTypeText.textContent = `Detected: ${detLabel} ${Math.round(stage1.confidence * 100)}%`;
        detectedTypePill.style.display = 'inline-flex';
    }

    // Progress Bars
    const origPct = (stage2.originalProb * 100).toFixed(1);
    const fakePct = (stage2.fakeProb * 100).toFixed(1);

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
        handleChatbotVisibility(stage2.verdictState === "FAKE" || stage2.verdictState === "SUSPICIOUS" ? "FAKE" : "ORIGINAL", docLabel, `${(stage2.confidenceScore * 100).toFixed(1)}%`);
    }
}

function updateQualityChips(quality) {
    if (!chipBlur) return;

    // Blur Chip
    chipBlur.className = `quality-chip ${quality.isBlurry ? 'chip-fail' : 'chip-pass'}`;
    chipBlurText.textContent = `Blur: ${quality.isBlurry ? 'Blurry' : 'Sharp'} (Var: ${quality.lapVariance})`;

    // Resolution Chip
    chipRes.className = `quality-chip ${quality.isLowRes ? 'chip-warn' : 'chip-pass'}`;
    chipResText.textContent = `Res: ${quality.naturalWidth}x${quality.naturalHeight}`;

    // Exposure Chip
    const exposurePass = !quality.isExtremeDark && !quality.isExtremeBright;
    chipLight.className = `quality-chip ${exposurePass ? 'chip-pass' : 'chip-fail'}`;
    chipLightText.textContent = `Light: ${quality.isExtremeDark ? 'Too Dark' : (quality.isExtremeBright ? 'Washed Out' : 'Balanced')} (${quality.avgLuminance}/255)`;

    // Moire Chip
    chipMoire.className = `quality-chip ${quality.hasScreenArtifacts ? 'chip-warn' : 'chip-pass'}`;
    chipMoireText.textContent = `Moiré: ${quality.hasScreenArtifacts ? 'Detected (Display Photo)' : 'None'}`;
}

function updateWhyResultAudit(stage1, stage2) {
    if (!whyResultContent) return;

    let html = `<div><strong>STAGE 1: DOCUMENT TYPE DETECTION AUDIT</strong><ul>`;
    html += `<li><strong>1A. OCR Engine:</strong> ${stage1.signal1A.available ? `${DOC_TYPES[stage1.signal1A.topType]?.label || 'None'} (Score ${stage1.signal1A.score}, Pattern match: ${stage1.signal1A.patternHit ? 'YES' : 'NO'}, Matched: [${stage1.signal1A.keywordHits.join(', ')}])` : (stage1.signal1A.reason || 'Unavailable')}</li>`;
    html += `<li><strong>1B. Dedicated Classifier (./model-doctype):</strong> ${stage1.signal1B.available ? `${stage1.signal1B.topLabel} (Confidence ${(stage1.signal1B.confidence * 100).toFixed(1)}%)` : (stage1.signal1B.reason || 'Not present')}</li>`;
    html += `<li><strong>1C. Gemini Vision AI:</strong> ${stage1.signal1C.available ? `${stage1.signal1C.topLabel} (Confidence ${(stage1.signal1C.confidence * 100).toFixed(1)}% - ${stage1.signal1C.reason})` : (stage1.signal1C.reason || 'Skipped')}</li>`;
    html += `<li><strong>Stage 1 Combined Verdict:</strong> ${stage1.isRecognized ? DOC_TYPES[stage1.finalType]?.label : 'Unrecognized'} (Synthesized Confidence ${(stage1.confidence * 100).toFixed(1)}%)</li>`;
    html += `</ul></div>`;

    if (stage2) {
        html += `<div style="margin-top: 0.75rem;"><strong>STAGE 2: AUTHENTICITY & IMAGE AUDIT</strong><ul>`;
        html += `<li><strong>Selected Authenticity Model (${DOC_TYPES[currentDocType]?.label}):</strong> ORIGINAL: ${(stage2.originalProb * 100).toFixed(1)}% | FAKE: ${(stage2.fakeProb * 100).toFixed(1)}%</li>`;
        html += `<li><strong>Image Quality Checks:</strong> Sharpness Variance: ${stage2.quality.lapVariance} (Threshold: ${BLUR_LAPLACIAN_THRESHOLD}) | Brightness: ${stage2.quality.avgLuminance}/255 | Dimensions: ${stage2.quality.naturalWidth}x${stage2.quality.naturalHeight}</li>`;
        if (stage2.aiFakeSignals.length > 0) {
            html += `<li style="color: #fca5a5;"><strong>AI Tampering Flags:</strong> ${stage2.aiFakeSignals.join("; ")}</li>`;
        } else {
            html += `<li><strong>AI Tampering Flags:</strong> No tampering or visual anomalies flagged.</li>`;
        }
        html += `<li><strong>Final System Verdict:</strong> <span style="text-decoration: underline;">${stage2.verdictTitleText}</span> (${stage2.verdictDescText})</li>`;
        html += `</ul></div>`;
    }

    whyResultContent.innerHTML = html;
}

// ==========================================================================
// UI Helpers
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
