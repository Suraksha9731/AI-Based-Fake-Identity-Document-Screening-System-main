const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// Enable CORS and JSON body parser
app.use(cors());
app.use(express.json());

// Strict Persona & System Instruction
const SYSTEM_INSTRUCTION = `You are a document verification assistant. You explain, in simple and professional language, common visual and structural signs that make identity documents (such as Aadhaar cards, PAN cards, or Passports) look fake, based only on the document type and classification confidence provided. Never claim to have examined specific pixels or details you were not given. Stay strictly on-topic: document authenticity, security features (e.g. laminate/photo page integrity, MRZ checksums, watermarks, font alignment), and verification tips. If asked something unrelated, politely redirect to the topic of document verification.`;

// Conservative Generation Config for High Consistency
const GENERATION_CONFIG = {
    temperature: 0.3,
    topP: 0.8,
    topK: 20,
    maxOutputTokens: 800
};

// Generic Canned Fallback Response in case API fails or returns off-topic response twice
const CANNED_FALLBACK = `When a computer vision classification model flags an identity document as fake with high confidence, it generally indicates visual or structural anomalies.

Common red flags to check:
• Font Misalignment & Typography: Inconsistent font styles, blurred text, or irregular character spacing.
• Photo & Edge Tampering: Visible cut lines around the photo, inconsistent lighting, or laminate layer disruption.
• Layout & Format Discrepancies: Misaligned text fields, unreadable QR codes, or MRZ (Machine-Readable Zone) syntax errors.
• Missing Security Features: Absent micro-printing, missing hologram reflections, or corrupted background watermarks.`;

/**
 * Helper function to call Gemini API via REST with logging & multi-model fallback
 */
async function callGemini(contents) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY_HERE") {
        throw new Error("Gemini API key is not configured in server environment (.env).");
    }

    const models = [
        "gemini-3.8-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-flash-latest"
    ];

    let lastError = null;

    // LOGGING PROMPT & CONFIG (Server Console Debugging)
    console.log("\n=================== [GEMINI REQUEST PROMPT] ===================");
    console.log("SYSTEM INSTRUCTION:\n", SYSTEM_INSTRUCTION);
    console.log("\nCONTENTS PAYLOAD:\n", JSON.stringify(contents, null, 2));
    console.log("\nGENERATION CONFIG:\n", JSON.stringify(GENERATION_CONFIG, null, 2));
    console.log("===============================================================\n");

    for (const modelName of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: contents,
                    systemInstruction: {
                        parts: [{ text: SYSTEM_INSTRUCTION }]
                    },
                    generationConfig: GENERATION_CONFIG
                })
            });

            const data = await response.json();

            if (response.ok && data.candidates && data.candidates.length > 0) {
                const rawText = data.candidates[0].content.parts.map(p => p.text).join('\n');
                
                // LOGGING RAW RESPONSE
                console.log(`\n=================== [GEMINI RESPONSE (${modelName})] ===================`);
                console.log(rawText);
                console.log("===============================================================\n");

                return rawText;
            } else if (data.error) {
                console.warn(`Model ${modelName} returned error: ${data.error.message}`);
                lastError = new Error(data.error.message || `API Error from ${modelName}`);
            }
        } catch (err) {
            console.warn(`Model ${modelName} fetch exception:`, err.message);
            lastError = err;
        }
    }

    throw lastError || new Error("Failed to generate response from Gemini API.");
}

/**
 * Validates and cleans Gemini response text
 */
function cleanAndValidateResponse(rawText, docType) {
    if (!rawText || typeof rawText !== 'string') return null;

    let cleaned = rawText.trim();

    // Strip code block wrappers if generated
    cleaned = cleaned.replace(/^```html|^```markdown|^```/i, '').replace(/```$/i, '').trim();

    if (cleaned.length < 30) return null;

    // Check relevance: Ensure response touches on document, fake, security, or verification concepts
    const lower = cleaned.toLowerCase();
    const isRelevant = lower.includes('document') || lower.includes('card') || lower.includes('passport') ||
                       lower.includes('fake') || lower.includes('verification') || lower.includes('mrz') ||
                       lower.includes('flag') || lower.includes('security') || lower.includes('watermark') ||
                       lower.includes('photo') || lower.includes('font') || lower.includes('qr') || lower.includes('aadhaar') || lower.includes('pan');

    return isRelevant ? cleaned : null;
}

/**
 * POST /api/explain-fake
 * Payload: { docType, classificationResult, confidenceScore, chatHistory, userMessage }
 */
app.post('/api/explain-fake', async (req, res) => {
    try {
        const { docType = 'Identity Document', confidenceScore = '90%', chatHistory = [], userMessage } = req.body;

        // Structured initial prompt format
        const structuredInitialPrompt = `Document type: ${docType}
Classification result: FAKE
Confidence: ${confidenceScore}

Explain in 3-5 bullet points the common visual and structural signs that could make this type of document be flagged as fake. Keep it factual, non-alarming, concise, and general (do not claim to have examined specific pixels or unprovided details of this specific image).`;

        const contents = [];

        // Always include initial document context header for chat continuity
        contents.push({
            role: 'user',
            parts: [{ text: `Context:\nDocument type: ${docType}\nClassification result: FAKE\nConfidence: ${confidenceScore}\n\nPlease maintain focus strictly on document verification for ${docType}.` }]
        });
        contents.push({
            role: 'model',
            parts: [{ text: `Understood. I will provide focused, simple, and professional verification guidance for ${docType}.` }]
        });

        // Append conversation history
        if (Array.isArray(chatHistory) && chatHistory.length > 0) {
            chatHistory.forEach(msg => {
                contents.push({
                    role: msg.sender === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.text }]
                });
            });
        }

        // Append current prompt (follow-up question OR initial structured prompt)
        if (userMessage) {
            contents.push({
                role: 'user',
                parts: [{ text: userMessage }]
            });
        } else {
            contents.push({
                role: 'user',
                parts: [{ text: structuredInitialPrompt }]
            });
        }

        let rawResponse = null;
        try {
            rawResponse = await callGemini(contents);
        } catch (geminiError) {
            console.warn("Gemini API call failed, falling back to canned response:", geminiError.message);
        }

        let validatedExplanation = cleanAndValidateResponse(rawResponse, docType);

        // RETRY LOGIC: If first response was off-topic or invalid and rawResponse existed, retry once
        if (!validatedExplanation && rawResponse) {
            console.warn("First API response failed validation/relevance check. Retrying once...");
            try {
                rawResponse = await callGemini(contents);
                validatedExplanation = cleanAndValidateResponse(rawResponse, docType);
            } catch (retryError) {
                console.warn("Retry call failed:", retryError.message);
            }
        }

        // Use cleaned response or canned fallback
        const finalExplanation = validatedExplanation || CANNED_FALLBACK;

        res.json({
            success: true,
            explanation: finalExplanation
        });

    } catch (error) {
        console.error("Express /api/explain-fake Unexpected Error:", error.message);
        res.json({
            success: true,
            explanation: CANNED_FALLBACK
        });
    }
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`Backend proxy server running on http://localhost:${PORT}`);
});
