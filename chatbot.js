/**
 * AI Security Chatbot Assistant (Powered by Google Gemini via Backend Proxy)
 * Activated ONLY when a document is classified as "FAKE"
 */

function getBackendApiUrl() {
    const base = localStorage.getItem("backend_api_url") || "http://localhost:5001";
    return base.trim().replace(/\/+$/, "") + "/api/explain-fake";
}

// Chat State
let activeDocType = "Identity Document";
let activeConfidenceScore = "90%";
let chatHistory = [];
let isWaitingForAI = false;

// DOM Elements
const chatbotPanel = document.getElementById("chatbot-panel");
const chatMessagesContainer = document.getElementById("chat-messages");
const chatUserInput = document.getElementById("chat-user-input");
const chatSendBtn = document.getElementById("chat-send-btn");
const explainTriggerBtn = document.getElementById("explain-trigger-btn");

/**
 * Called by script.js when a classification result is produced.
 * Shows panel if FAKE, hides if ORIGINAL.
 */
function handleChatbotVisibility(verdictClass, docTypeLabel, confidencePercent) {
    if (verdictClass === "FAKE") {
        activeDocType = docTypeLabel || "Identity Document";
        activeConfidenceScore = confidencePercent || "90%";
        showChatbotPanel();
    } else {
        hideChatbotPanel();
    }
}

function showChatbotPanel() {
    if (!chatbotPanel) return;
    
    // Reset state
    chatHistory = [];
    chatMessagesContainer.innerHTML = `
        <div class="chat-bubble bot-bubble hint-bubble" id="chat-hint">
            <i class="fa-solid fa-circle-info"></i> Click <strong>"Why was this flagged as fake?"</strong> above to generate an AI explanation of potential red flags.
        </div>
    `;
    
    if (explainTriggerBtn) {
        explainTriggerBtn.disabled = false;
        explainTriggerBtn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Why was this flagged as fake?`;
    }

    chatbotPanel.style.display = "block";
    chatbotPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideChatbotPanel() {
    if (chatbotPanel) {
        chatbotPanel.style.display = "none";
    }
    chatHistory = [];
}

/**
 * Trigger initial AI explanation call
 */
async function requestFakeExplanation() {
    if (isWaitingForAI) return;
    
    // Hide hint
    const hintEl = document.getElementById("chat-hint");
    if (hintEl) hintEl.remove();

    if (explainTriggerBtn) {
        explainTriggerBtn.disabled = true;
        explainTriggerBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Analyzing Red Flags...`;
    }

    // Append loading bubble
    const loadingId = appendLoadingBubble();
    isWaitingForAI = true;

    try {
        const targetUrl = getBackendApiUrl();
        const response = await fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                docType: activeDocType,
                confidenceScore: activeConfidenceScore,
                chatHistory: []
            })
        });

        const data = await response.json();
        removeLoadingBubble(loadingId);

        if (response.ok && data.success) {
            const aiText = data.explanation;
            appendMessage("bot", aiText);
            
            // Add to history
            chatHistory.push({ sender: "bot", text: aiText });

            if (explainTriggerBtn) {
                explainTriggerBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Explanation Generated`;
            }
        } else {
            const errMsg = data.message || "Unable to retrieve explanation from Gemini API.";
            appendErrorMessage(errMsg);
            if (explainTriggerBtn) explainTriggerBtn.disabled = false;
        }
    } catch (err) {
        console.error("Chatbot Fetch Error:", err);
        removeLoadingBubble(loadingId);
        const targetUrl = getBackendApiUrl();
        appendErrorMessage(
            `Unable to connect to the backend server at <code>${targetUrl}</code>. ` +
            `Please ensure your Colab notebook or local server is running and accessible.`
        );
        if (explainTriggerBtn) explainTriggerBtn.disabled = false;
    } finally {
        isWaitingForAI = false;
    }
}

/**
 * Handle user sending follow-up message in chat
 */
async function sendUserChatMessage() {
    if (isWaitingForAI) return;

    const messageText = chatUserInput.value.trim();
    if (!messageText) return;

    // Clear input
    chatUserInput.value = "";

    // Append user message bubble
    appendMessage("user", messageText);
    chatHistory.push({ sender: "user", text: messageText });

    // Append loading bubble for AI
    const loadingId = appendLoadingBubble();
    isWaitingForAI = true;

    try {
        const targetUrl = getBackendApiUrl();
        const response = await fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                docType: activeDocType,
                confidenceScore: activeConfidenceScore,
                chatHistory: chatHistory,
                userMessage: messageText
            })
        });

        const data = await response.json();
        removeLoadingBubble(loadingId);

        if (response.ok && data.success) {
            const aiText = data.explanation;
            appendMessage("bot", aiText);
            chatHistory.push({ sender: "bot", text: aiText });
        } else {
            appendErrorMessage(data.message || "Failed to process follow-up query.");
        }
    } catch (err) {
        console.error("Chatbot Fetch Error:", err);
        removeLoadingBubble(loadingId);
        appendErrorMessage("Network error connecting to AI server. Check backend connection.");
    } finally {
        isWaitingForAI = false;
    }
}

function handleChatKeyPress(e) {
    if (e.key === "Enter") {
        sendUserChatMessage();
    }
}

/* ==========================================================================
   Chat Bubble DOM Helpers
   ========================================================================== */
function appendMessage(sender, text) {
    const bubbleWrapper = document.createElement("div");
    bubbleWrapper.className = `chat-bubble ${sender}-bubble`;

    const avatar = document.createElement("div");
    avatar.className = "chat-avatar";
    avatar.innerHTML = sender === "bot" 
        ? `<i class="fa-solid fa-robot"></i>`
        : `<i class="fa-solid fa-user"></i>`;

    const content = document.createElement("div");
    content.className = "chat-text";
    content.innerHTML = formatMarkdownResponse(text);

    bubbleWrapper.appendChild(avatar);
    bubbleWrapper.appendChild(content);

    chatMessagesContainer.appendChild(bubbleWrapper);
    scrollToBottom();
}

function appendLoadingBubble() {
    const id = "loading-" + Date.now();
    const bubbleWrapper = document.createElement("div");
    bubbleWrapper.className = "chat-bubble bot-bubble loading-bubble";
    bubbleWrapper.id = id;

    bubbleWrapper.innerHTML = `
        <div class="chat-avatar"><i class="fa-solid fa-robot"></i></div>
        <div class="chat-text">
            <div class="chat-typing-dots">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;

    chatMessagesContainer.appendChild(bubbleWrapper);
    scrollToBottom();
    return id;
}

function removeLoadingBubble(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function appendErrorMessage(msg) {
    const bubbleWrapper = document.createElement("div");
    bubbleWrapper.className = "chat-bubble bot-bubble error-bubble";

    bubbleWrapper.innerHTML = `
        <div class="chat-avatar"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div class="chat-text">${msg}</div>
    `;

    chatMessagesContainer.appendChild(bubbleWrapper);
    scrollToBottom();
}

function scrollToBottom() {
    if (chatMessagesContainer) {
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }
}

/**
 * Simple Markdown formatting helper for AI text responses
 */
function formatMarkdownResponse(text) {
    if (!text) return "";

    let formatted = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Bold **text**
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Bullet points * item or - item
    formatted = formatted.replace(/^[\*\-] (.*$)/gim, '<li>$1</li>');
    formatted = formatted.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

    // Newlines to <br> if not inside ul
    formatted = formatted.replace(/\n/g, '<br>');

    return formatted;
}
