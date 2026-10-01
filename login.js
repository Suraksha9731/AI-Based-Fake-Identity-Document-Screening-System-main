/**
 * Authentication Logic & Session Management
 * Supports both Google Colab / Remote Flask Backend and Local/Demo Fallback
 */

// Global state for backend connectivity
let isBackendOnline = false;

function getBackendUrl() {
    let url = localStorage.getItem("backend_api_url") || "http://localhost:5001";
    return url.trim().replace(/\/+$/, "");
}

function setBackendUrl(url) {
    let cleaned = (url || "").trim().replace(/\/+$/, "");
    if (!cleaned) cleaned = "http://localhost:5001";
    localStorage.setItem("backend_api_url", cleaned);
    return cleaned;
}

// Initialize Demo User in LocalStorage & verify backend on load
document.addEventListener("DOMContentLoaded", () => {
    // Session Guard: If already logged in, redirect directly to main app
    if (sessionStorage.getItem("isLoggedIn") === "true") {
        window.location.href = "index.html";
        return;
    }

    // Seed initial demo account if empty
    if (!localStorage.getItem("app_users")) {
        const initialUsers = [
            {
                name: "Demo Admin",
                email: "admin@example.com",
                password: "password123" // Note: Plaintext demo for local prototype.
            }
        ];
        localStorage.setItem("app_users", JSON.stringify(initialUsers));
    }

    // Populate backend URL input field
    const serverInput = document.getElementById("server-url-input");
    if (serverInput) {
        serverInput.value = getBackendUrl();
    }

    // Run background check to verify Colab / Local server
    checkBackendHealth(false);
});

/* ==========================================================================
   1. UI Tab Switching & Visibility Handlers
   ========================================================================== */
function switchAuthTab(tab) {
    hideAlert();
    const loginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");
    const loginBtn = document.getElementById("tab-login-btn");
    const registerBtn = document.getElementById("tab-register-btn");

    if (tab === "login") {
        loginForm.classList.add("active");
        registerForm.classList.remove("active");
        loginBtn.classList.add("active");
        registerBtn.classList.remove("active");
    } else {
        registerForm.classList.add("active");
        loginForm.classList.remove("active");
        registerBtn.classList.add("active");
        loginBtn.classList.remove("active");
    }
}

function togglePasswordVisibility(inputId, btnEl) {
    const input = document.getElementById(inputId);
    const icon = btnEl.querySelector("i");

    if (input.type === "password") {
        input.type = "text";
        icon.className = "fa-solid fa-eye-slash";
    } else {
        input.type = "password";
        icon.className = "fa-solid fa-eye";
    }
}

/* ==========================================================================
   2. Login Handler (Colab Backend with Local Fallback)
   ========================================================================== */
async function handleLogin(e) {
    e.preventDefault();
    hideAlert();

    const emailInput = document.getElementById("login-email").value.trim();
    const passwordInput = document.getElementById("login-password").value.trim();

    // Basic Validation
    if (!emailInput || !passwordInput) {
        showAlert("error", "Please fill in all required fields.");
        return;
    }

    const backendUrl = getBackendUrl();
    let backendAttemptFailed = false;

    // 1. ATTEMPT COLAB / FLASK BACKEND AUTHENTICATION
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const response = await fetch(`${backendUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailInput, password: passwordInput }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await response.json();

        if (response.ok && data.success) {
            sessionStorage.setItem("authToken", data.token || "colab_session_token");
            sessionStorage.setItem("isLoggedIn", "true");
            sessionStorage.setItem("currentUser", data.user?.name || emailInput);
            sessionStorage.setItem("currentUserEmail", data.user?.email || emailInput);

            const isColab = backendUrl.includes("trycloudflare.com") || backendUrl.includes("ngrok");
            const serverTag = isColab ? "Colab Server" : "Backend Server";
            showAlert("success", `Login successful via ${serverTag}! Redirecting...`);

            setTimeout(() => {
                window.location.href = "index.html";
            }, 600);
            return;
        } else if (response.status === 401) {
            showAlert("error", data.message || "Invalid credentials provided.");
            return;
        }
    } catch (err) {
        console.warn("Backend auth call unavailable, switching to local demo mode:", err);
        backendAttemptFailed = true;
    }

    // 2. LOCAL STORAGE / DEMO FALLBACK (Guarantees user is never locked out)
    const users = JSON.parse(localStorage.getItem("app_users") || "[]");
    const matchedUser = users.find(
        user => (user.email.toLowerCase() === emailInput.toLowerCase() || user.name.toLowerCase() === emailInput.toLowerCase()) &&
                user.password === passwordInput
    );

    if (matchedUser) {
        sessionStorage.setItem("isLoggedIn", "true");
        sessionStorage.setItem("currentUser", matchedUser.name || matchedUser.email);
        sessionStorage.setItem("currentUserEmail", matchedUser.email);

        const msg = backendAttemptFailed
            ? "Login successful (Demo Mode - Backend Offline). Redirecting..."
            : "Login successful! Redirecting to verification portal...";
        showAlert("success", msg);

        setTimeout(() => {
            window.location.href = "index.html";
        }, 600);
    } else {
        showAlert("error", "Invalid email/username or password. Please try again.");
    }
}

/* ==========================================================================
   3. Registration Handler
   ========================================================================== */
async function handleRegister(e) {
    e.preventDefault();
    hideAlert();

    const name = document.getElementById("reg-name").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value.trim();
    const confirmPassword = document.getElementById("reg-confirm-password").value.trim();

    // Validation
    if (!name || !email || !password || !confirmPassword) {
        showAlert("error", "Please fill in all registration fields.");
        return;
    }

    if (!isValidEmail(email)) {
        showAlert("error", "Please enter a valid email address.");
        return;
    }

    if (password.length < 6) {
        showAlert("error", "Password must be at least 6 characters long.");
        return;
    }

    if (password !== confirmPassword) {
        showAlert("error", "Passwords do not match.");
        return;
    }

    const backendUrl = getBackendUrl();

    // 1. ATTEMPT COLAB / BACKEND REGISTRATION
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const response = await fetch(`${backendUrl}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await response.json();
        if (response.ok && data.success) {
            // Also store locally for offline access
            const users = JSON.parse(localStorage.getItem("app_users") || "[]");
            if (!users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
                users.push({ name, email, password });
                localStorage.setItem("app_users", JSON.stringify(users));
            }

            sessionStorage.setItem("isLoggedIn", "true");
            sessionStorage.setItem("currentUser", name);
            sessionStorage.setItem("currentUserEmail", email);
            showAlert("success", "Account created on Backend! Auto-logging you in...");

            setTimeout(() => {
                window.location.href = "index.html";
            }, 800);
            return;
        } else if (response.status === 409) {
            showAlert("error", data.message || "An account with this email address already exists.");
            return;
        }
    } catch (err) {
        console.warn("Backend registration endpoint unavailable, using local storage:", err);
    }

    // 2. LOCAL STORAGE REGISTRATION FALLBACK
    const users = JSON.parse(localStorage.getItem("app_users") || "[]");
    
    // Check if email already registered
    const existingUser = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existingUser) {
        showAlert("error", "An account with this email address already exists.");
        return;
    }

    // Save new user
    users.push({ name, email, password });
    localStorage.setItem("app_users", JSON.stringify(users));

    showAlert("success", "Account created locally! Auto-logging you in...");

    // Auto log in newly registered user
    sessionStorage.setItem("isLoggedIn", "true");
    sessionStorage.setItem("currentUser", name);
    sessionStorage.setItem("currentUserEmail", email);

    setTimeout(() => {
        window.location.href = "index.html";
    }, 1000);
}

/* ==========================================================================
   4. Backend Bridge & Tunnel Controls
   ========================================================================== */
async function checkBackendHealth(showFeedback = false) {
    const url = getBackendUrl();
    const statusDot = document.getElementById("server-status-dot");
    const statusText = document.getElementById("server-status-text");

    if (statusDot) statusDot.className = "status-dot checking";
    if (statusText) statusText.textContent = "Connecting to backend...";

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const resp = await fetch(`${url}/api/vision-status`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (resp.ok) {
            const data = await resp.json();
            isBackendOnline = true;
            if (statusDot) statusDot.className = "status-dot online";
            
            const isColab = data.colab || url.includes("trycloudflare.com") || url.includes("ngrok");
            const serverName = isColab ? "Colab Backend" : "Local Backend (5001)";
            const cleanHost = url.replace(/^https?:\/\//, '').split('/')[0];
            
            if (statusText) statusText.textContent = `${serverName} Online (${cleanHost})`;
            if (showFeedback) showAlert("success", `Connected to ${serverName}! (${url})`);
            return true;
        } else {
            throw new Error(`HTTP ${resp.status}`);
        }
    } catch (err) {
        isBackendOnline = false;
        if (statusDot) statusDot.className = "status-dot offline";
        if (statusText) statusText.textContent = "Backend Offline (Demo Mode Available)";
        if (showFeedback) showAlert("error", `Could not connect to backend at ${url}. Operating in local demo mode.`);
        return false;
    }
}

function toggleBackendSettings() {
    const body = document.getElementById("bridge-settings");
    const chevron = document.getElementById("bridge-chevron");
    if (!body) return;
    const isHidden = body.style.display === "none";
    body.style.display = isHidden ? "block" : "none";
    if (chevron) {
        chevron.className = isHidden ? "fa-solid fa-chevron-up" : "fa-solid fa-chevron-down";
    }
}

function setServerPreset(type) {
    const input = document.getElementById("server-url-input");
    if (!input) return;
    if (type === "local") {
        input.value = "http://localhost:5001";
    } else if (type === "colab") {
        const current = getBackendUrl();
        if (current.includes("localhost") || !current) {
            input.value = "";
            input.placeholder = "Paste your Colab tunnel URL (e.g. https://...trycloudflare.com)";
            input.focus();
        } else {
            input.value = current;
        }
    }
}

async function testAndSaveServerUrl() {
    const input = document.getElementById("server-url-input");
    if (!input || !input.value.trim()) {
        showAlert("error", "Please enter a valid backend URL or tunnel link.");
        return;
    }
    const newUrl = setBackendUrl(input.value.trim());
    await checkBackendHealth(true);
}

/* ==========================================================================
   4. Alert & Helper Functions
   ========================================================================== */
function showAlert(type, msg) {
    const alertBox = document.getElementById("auth-alert");
    const alertIcon = document.getElementById("alert-icon");
    const alertMessage = document.getElementById("alert-message");

    alertMessage.textContent = msg;

    if (type === "error") {
        alertBox.className = "auth-alert alert-error";
        alertIcon.className = "fa-solid fa-triangle-exclamation";
    } else {
        alertBox.className = "auth-alert alert-success";
        alertIcon.className = "fa-solid fa-circle-check";
    }

    alertBox.style.display = "flex";
}

function hideAlert() {
    const alertBox = document.getElementById("auth-alert");
    alertBox.style.display = "none";
}

function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}
