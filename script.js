/**
 * Multi-Document Teachable Machine Classification Script
 * Document Types: Aadhaar Card, PAN Card, Passport & Voter ID
 */

// STAGE 1: Document Type Validation Threshold (Option B Fallback & Minimum Confidence)
const MIN_TYPE_CONFIDENCE = 0.70;

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

// Application State
let currentDocType = "aadhaar";
const loadedModels = {}; // Cache map for all loaded models { aadhaar, pancard, passport, voterid }
let doctypeClassifierModel = null; // Option A model if available (./model-doctype)
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

// Stage 1 DOM Elements
const doctypeWarningCard = document.getElementById("doctype-warning-card");
const doctypeWarningIcon = document.getElementById("doctype-warning-icon");
const doctypeWarningTitle = document.getElementById("doctype-warning-title");
const doctypeWarningDesc = document.getElementById("doctype-warning-desc");
const doctypeWarningAction = document.getElementById("doctype-warning-action");
const doctypeSwitchBtn = document.getElementById("doctype-switch-btn");
const doctypeSwitchBtnLabel = document.getElementById("doctype-switch-btn-label");
const detectedTypePill = document.getElementById("detected-type-pill");
const detectedTypeText = document.getElementById("detected-type-text");
const breakdownSection = document.getElementById("breakdown-section");

const verdictCard = document.getElementById("verdict-card");
const verdictIcon = document.getElementById("verdict-icon");
const verdictTitle = document.getElementById("verdict-title");
const verdictDesc = document.getElementById("verdict-desc");
const verdictTopScore = document.getElementById("verdict-top-score");

const userDisplayName = document.getElementById("user-display-name");

// Initialization
document.addEventListener("DOMContentLoaded", () => {
    // Populate User Name
    const currentUser = sessionStorage.getItem("currentUser") || "User";
    if (userDisplayName) {
        userDisplayName.textContent = currentUser;
    }

    renderDocTypeTabs();
    preloadAllModels();
    setupDropZone();
    setupFileInput();
});

/**
 * Dynamically renders document selector tabs from DOC_TYPES registry
 */
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

// Logout Session Function
function logout() {
    sessionStorage.removeItem("isLoggedIn");
    sessionStorage.removeItem("currentUser");
    sessionStorage.removeItem("currentUserEmail");
    window.location.href = "login.html";
}

/* ==========================================================================
   1. Reusable Model Loader & Cache Manager
   ========================================================================== */
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

        // Try preloading Option A model if present (./model-doctype)
        try {
            doctypeClassifierModel = await tmImage.load("./model-doctype/model.json", "./model-doctype/metadata.json");
            console.log("Stage 1: Custom document type classifier model (Option A) loaded successfully.");
        } catch (_) {
            doctypeClassifierModel = null;
            console.log("Stage 1: Standalone ./model-doctype not found. Using Option B multi-model validation.");
        }

        // Preload models for all registered document types concurrently (cached in loadedModels)
        await Promise.all(Object.keys(DOC_TYPES).map(id => loadModelForDocType(id)));

        updateModelStatus("ready", `Models Loaded (${Object.keys(DOC_TYPES).length} Types Ready)`);
        console.log("All document models preloaded and cached successfully:", Object.keys(loadedModels));
    } catch (err) {
        console.error("Error preloading models:", err);
        updateModelStatus("error", "Model Load Failed");
        showError(
            `Failed to load document models. ` +
            `If viewing directly via <code>file://</code>, please run a local web server (e.g. <code>python -m http.server 5000</code>).`
        );
    }
}

function updateModelStatus(state, text) {
    modelStatusPill.className = `model-status-badge status-${state}`;
    modelStatusText.textContent = text;
}

/* ==========================================================================
   2. Document Type Selection & Auto Re-classification
   ========================================================================== */
function selectDocumentType(docTypeId) {
    if (!DOC_TYPES[docTypeId]) return;
    currentDocType = docTypeId;

    // Update tab highlight
    document.querySelectorAll(".doc-btn").forEach(btn => btn.classList.remove("active"));
    const activeBtn = document.getElementById(`doc-${docTypeId}-btn`);
    if (activeBtn) activeBtn.classList.add("active");

    // Update Result Banner & Folder Metadata
    const docConfig = DOC_TYPES[docTypeId];
    docResultIcon.className = `fa-solid ${docConfig.icon}`;
    docResultTitle.textContent = docConfig.resultTitle;
    if (activeModelFolder) activeModelFolder.textContent = docConfig.modelPath;

    // Auto re-classify active preview image if already present
    if (previewImage.src && previewCard.style.display !== 'none') {
        classifyActiveImage();
    }
}

/* ==========================================================================
   3. Tab Switching Logic (Upload vs Webcam)
   ========================================================================== */
function switchTab(tabName) {
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    document.getElementById(`tab-${tabName}-btn`).classList.add("active");

    document.querySelectorAll(".tab-content").forEach(content => content.classList.remove("active"));
    document.getElementById(`${tabName}-tab`).classList.add("active");

    if (tabName !== "webcam" && webcamStream) {
        stopWebcam();
    }
}

/* ==========================================================================
   4. File Upload & Drag-and-Drop
   ========================================================================== */
function setupDropZone() {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files && files.length > 0) {
            handleSelectedFile(files[0]);
        }
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
        showError("Invalid file type. Please select a valid image file (JPG, PNG, WEBP).");
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        previewImage.src = e.target.result;
        imageInfoName.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        previewCard.style.display = 'block';

        previewImage.onload = () => {
            classifyActiveImage();
        };
    };
    reader.readAsDataURL(file);
}

function clearSelectedImage() {
    previewImage.src = '';
    previewCard.style.display = 'none';
    fileInput.value = '';
    resetResultsUI();
}

/* ==========================================================================
   5. Webcam Controls
   ========================================================================== */
async function startWebcam() {
    clearError();
    try {
        const constraints = {
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: "user"
            }
        };

        webcamStream = await navigator.mediaDevices.getUserMedia(constraints);
        webcamVideo.srcObject = webcamStream;
        webcamOverlay.style.display = 'none';

        startWebcamBtn.disabled = true;
        stopWebcamBtn.disabled = false;
        captureWebcamBtn.disabled = false;
        livePredictBtn.disabled = false;

    } catch (err) {
        console.error("Webcam access error:", err);
        showError("Unable to access camera. Please allow camera permissions in your browser settings.");
    }
}

function stopWebcam() {
    if (isLivePredicting) {
        toggleLivePredict();
    }

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
    
    const dataUrl = hiddenCanvas.toDataURL("image/jpeg");
    previewImage.src = dataUrl;
    imageInfoName.textContent = "Webcam Snapshot (" + new Date().toLocaleTimeString() + ")";
    previewCard.style.display = 'block';

    previewImage.onload = () => {
        classifyActiveImage();
    };
}

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

let isLivePredictBusy = false;

async function runLivePredictionLoop() {
    if (!isLivePredicting || !webcamVideo) return;

    if (webcamVideo.readyState === 4 && !isLivePredictBusy) {
        isLivePredictBusy = true;
        try {
            await executeTwoStagePipeline(webcamVideo, true);
        } catch (e) {
            console.error("Live prediction error:", e);
        } finally {
            isLivePredictBusy = false;
        }
    }
    
    if (isLivePredicting) {
        livePredictAnimationFrame = requestAnimationFrame(runLivePredictionLoop);
    }
}

/* ==========================================================================
   6. Two-Stage Classification Pipeline
   ========================================================================== */

/**
 * Normalizes labels (e.g., "ORIGINAL VOTEID" -> "ORIGINAL", "FAKE VOTEID" -> "FAKE")
 */
function normalizeClassName(rawLabel) {
    if (!rawLabel) return "UNKNOWN";
    const clean = rawLabel.trim().toUpperCase();
    if (clean.includes("ORIGINAL")) return "ORIGINAL";
    if (clean.includes("FAKE")) return "FAKE";
    return clean;
}

/**
 * STAGE 1: Document Type Validation
 * Predicts the document type from the image and compares with selected type.
 * - Option A: Standalone document type classifier (./model-doctype)
 * - Option B: Highest ORIGINAL confidence across all 4 models, with MIN_TYPE_CONFIDENCE threshold
 */
async function validateDocumentType(imageElement) {
    // 1. Option A: Standalone document type classifier model (./model-doctype)
    if (doctypeClassifierModel) {
        try {
            const predictions = await doctypeClassifierModel.predict(imageElement);
            const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
            const top = sorted[0];
            const normLabel = top ? top.className.trim().toLowerCase() : "";

            let matchedId = null;
            if (normLabel.includes("aadhaar")) matchedId = "aadhaar";
            else if (normLabel.includes("pan")) matchedId = "pancard";
            else if (normLabel.includes("passport")) matchedId = "passport";
            else if (normLabel.includes("voter")) matchedId = "voterid";

            if (matchedId && top.probability >= MIN_TYPE_CONFIDENCE) {
                return {
                    isValidDoc: true,
                    detectedId: matchedId,
                    label: DOC_TYPES[matchedId].label,
                    confidence: top.probability,
                    stage1Predictions: null
                };
            } else {
                return {
                    isValidDoc: false,
                    detectedId: null,
                    label: "Unrecognized",
                    confidence: top ? top.probability : 0,
                    stage1Predictions: null
                };
            }
        } catch (e) {
            console.warn("Option A prediction failed, falling back to Option B:", e);
        }
    }

    // 2. Option B: Run image through all loaded models and detect highest ORIGINAL confidence
    const candidateTypes = Object.keys(DOC_TYPES);
    const results = [];

    for (const typeId of candidateTypes) {
        const model = await loadModelForDocType(typeId);
        const preds = await model.predict(imageElement);

        let origScore = 0;
        preds.forEach(p => {
            if (normalizeClassName(p.className) === "ORIGINAL") {
                origScore += p.probability;
            }
        });

        results.push({
            id: typeId,
            label: DOC_TYPES[typeId].label,
            confidence: origScore,
            predictions: preds
        });
    }

    // Sort by ORIGINAL confidence descending
    results.sort((a, b) => b.confidence - a.confidence);
    const topMatch = results[0];

    // Fallback: If max confidence for every type is below MIN_TYPE_CONFIDENCE (0.70)
    if (!topMatch || topMatch.confidence < MIN_TYPE_CONFIDENCE) {
        return {
            isValidDoc: false,
            detectedId: null,
            label: "Unrecognized",
            confidence: topMatch ? topMatch.confidence : 0,
            stage1Predictions: null
        };
    }

    return {
        isValidDoc: true,
        detectedId: topMatch.id,
        label: topMatch.label,
        confidence: topMatch.confidence,
        stage1Predictions: topMatch.predictions
    };
}

/**
 * Orchestrates the full Two-Stage Pipeline:
 * Stage 1 (Validation) -> Stage 2 (Authenticity Check if matched)
 */
async function executeTwoStagePipeline(imageElement, isLive = false) {
    if (!imageElement) return;

    if (!isLive) {
        clearError();
        showLoading(true);
    }

    const startTime = performance.now();

    try {
        // --- STAGE 1: DOCUMENT TYPE VALIDATION ---
        const validation = await validateDocumentType(imageElement);

        // Fallback: Document unrecognized (< MIN_TYPE_CONFIDENCE for all types)
        if (!validation.isValidDoc) {
            const duration = Math.round(performance.now() - startTime);
            showWarningCard(null, true, duration);
            return;
        }

        // Mismatch: Detected type does not match user selected type
        if (validation.detectedId !== currentDocType) {
            const duration = Math.round(performance.now() - startTime);
            showWarningCard(validation, false, duration);
            return;
        }

        // --- STAGE 2: AUTHENTICITY CHECK (ORIGINAL vs FAKE) ---
        // Run only if detected type === selected type
        let predictions = validation.stage1Predictions;
        if (!predictions) {
            const activeModel = await loadModelForDocType(currentDocType);
            predictions = await activeModel.predict(imageElement);
        }

        const duration = Math.round(performance.now() - startTime);
        displayPredictions(predictions, duration, validation);

    } catch (err) {
        console.error("Pipeline Error:", err);
        showError("Classification failed: " + err.message);
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

/**
 * Displays Stage 1 warning card with amber/orange styling and hides authenticity results
 */
function showWarningCard(detectedInfo, isUnrecognized = false, durationMs = 0) {
    resultsEmpty.style.display = 'none';
    resultsLoading.style.display = 'none';
    resultsContent.style.display = 'block';

    verdictCard.style.display = 'none';
    if (breakdownSection) breakdownSection.style.display = 'none';
    if (typeof hideChatbotPanel === "function") hideChatbotPanel();

    if (durationMs > 0) {
        inferenceTimeBadge.textContent = `Inference: ${durationMs}ms`;
        inferenceTimeBadge.style.display = 'inline-block';
    }

    if (doctypeWarningCard) {
        doctypeWarningCard.style.display = 'flex';

        if (isUnrecognized) {
            doctypeWarningIcon.className = "fa-solid fa-circle-question";
            doctypeWarningTitle.textContent = "Unrecognized Document";
            doctypeWarningDesc.textContent = "Unrecognized document. Please upload a clear image of an Aadhaar, PAN, Passport or Voter ID.";
            doctypeWarningAction.style.display = "none";
        } else {
            const selectedLabel = DOC_TYPES[currentDocType]?.label || currentDocType;
            const detectedLabel = detectedInfo.label;
            const confPct = Math.round(detectedInfo.confidence * 100);

            doctypeWarningIcon.className = "fa-solid fa-triangle-exclamation";
            doctypeWarningTitle.textContent = "Wrong Document Type";
            doctypeWarningDesc.textContent = `⚠ Wrong document type. You selected ${selectedLabel}, but the uploaded image looks like a ${detectedLabel} (confidence ${confPct}%). Please select the correct type or upload the right document.`;
            doctypeWarningAction.style.display = "block";
            doctypeSwitchBtnLabel.textContent = `Switch to ${detectedLabel}`;
            doctypeSwitchBtn.onclick = () => selectDocumentType(detectedInfo.detectedId);
        }
    }
}

/**
 * Displays Stage 2 predictions and updates detected type badge
 */
function displayPredictions(predictions, durationMs = 0, detectedInfo = null) {
    if (!predictions || predictions.length === 0) return;

    // Show Results container & ensure warning card is hidden
    resultsEmpty.style.display = 'none';
    resultsContent.style.display = 'block';

    if (doctypeWarningCard) {
        doctypeWarningCard.style.display = 'none';
    }
    verdictCard.style.display = 'flex';
    if (breakdownSection) {
        breakdownSection.style.display = 'block';
    }

    if (durationMs > 0) {
        inferenceTimeBadge.textContent = `Inference: ${durationMs}ms`;
        inferenceTimeBadge.style.display = 'inline-block';
    }

    // Process predictions and calculate probabilities
    const docConfig = DOC_TYPES[currentDocType];
    const topRaw = [...predictions].sort((a, b) => b.probability - a.probability)[0];
    const topNormClass = normalizeClassName(topRaw.className);
    const topScorePercent = (topRaw.probability * 100).toFixed(1) + "%";

    verdictTopScore.textContent = topScorePercent;

    // Update Verdict Card styling according to ORIGINAL vs FAKE
    if (topNormClass === "ORIGINAL") {
        verdictCard.className = "verdict-card verdict-original";
        verdictIcon.className = "fa-solid fa-circle-check";
        verdictTitle.textContent = "ORIGINAL";
        verdictDesc.textContent = `Authentic ${docConfig.label} detected with ${topScorePercent} confidence.`;
    } else if (topNormClass === "FAKE") {
        verdictCard.className = "verdict-card verdict-fake";
        verdictIcon.className = "fa-solid fa-triangle-exclamation";
        verdictTitle.textContent = "FAKE";
        verdictDesc.textContent = `Potential fake or manipulated ${docConfig.label} detected (${topScorePercent} confidence).`;
    } else {
        verdictCard.className = "verdict-card";
        verdictIcon.className = "fa-solid fa-circle-info";
        verdictTitle.textContent = topRaw.className.trim();
        verdictDesc.textContent = `Predicted class: ${topRaw.className.trim()} (${topScorePercent}).`;
    }

    // Show detected type and confidence in the result card (e.g. "Detected: Passport 96%")
    if (detectedTypePill && detectedTypeText) {
        if (detectedInfo) {
            const detectedPct = Math.round(detectedInfo.confidence * 100);
            detectedTypeText.textContent = `Detected: ${detectedInfo.label} ${detectedPct}%`;
            detectedTypePill.style.display = 'inline-flex';
        } else {
            detectedTypePill.style.display = 'none';
        }
    }

    // Update progress bars for ORIGINAL and FAKE
    let originalProb = 0;
    let fakeProb = 0;

    predictions.forEach(pred => {
        const norm = normalizeClassName(pred.className);
        if (norm === "ORIGINAL") originalProb += pred.probability;
        if (norm === "FAKE") fakeProb += pred.probability;
    });

    const origScoreEl = document.getElementById("score-ORIGINAL");
    const origBarEl = document.getElementById("bar-ORIGINAL");
    const fakeScoreEl = document.getElementById("score-FAKE");
    const fakeBarEl = document.getElementById("bar-FAKE");

    if (origScoreEl && origBarEl) {
        const origPct = (originalProb * 100).toFixed(1);
        origScoreEl.textContent = `${origPct}%`;
        origBarEl.style.width = `${origPct}%`;
    }

    if (fakeScoreEl && fakeBarEl) {
        const fakePct = (fakeProb * 100).toFixed(1);
        fakeScoreEl.textContent = `${fakePct}%`;
        fakeBarEl.style.width = `${fakePct}%`;
    }

    // Trigger AI Chatbot panel activation (ONLY if FAKE)
    if (typeof handleChatbotVisibility === "function") {
        handleChatbotVisibility(topNormClass, docConfig.label, topScorePercent);
    }
}

/* ==========================================================================
   7. UI Helper Functions
   ========================================================================== */
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
    if (doctypeWarningCard) {
        doctypeWarningCard.style.display = 'none';
    }
    if (detectedTypePill) {
        detectedTypePill.style.display = 'none';
    }
    if (typeof hideChatbotPanel === "function") {
        hideChatbotPanel();
    }
    clearError();
}
