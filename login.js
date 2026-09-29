/**
 * Authentication Logic & Session Management (Local/Demo Version)
 */

// Initialize Demo User in LocalStorage if no users exist
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
                password: "password123" // Note: Plaintext demo for local prototype. In production, password hash is used.
            }
        ];
        localStorage.setItem("app_users", JSON.stringify(initialUsers));
    }
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
   2. Login Handler
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

    /* 
     * ========================================================================
     * BACKEND INTEGRATION PLACEHOLDER:
     * To replace this local authentication check with a real backend API server:
     * 
     * try {
     *     const response = await fetch('/api/v1/auth/login', {
     *         method: 'POST',
     *         headers: { 'Content-Type': 'application/json' },
     *         body: JSON.stringify({ email: emailInput, password: passwordInput })
     *     });
     *     const data = await response.json();
     *     if (response.ok) {
     *         sessionStorage.setItem("authToken", data.token);
     *         sessionStorage.setItem("isLoggedIn", "true");
     *         window.location.href = "index.html";
     *     } else {
     *         showAlert("error", data.message || "Invalid credentials.");
     *     }
     * } catch (err) {
     *     showAlert("error", "Network error connecting to authentication server.");
     * }
     * ========================================================================
     */

    // LOCAL STORAGE DEMO AUTH CHECK
    const users = JSON.parse(localStorage.getItem("app_users") || "[]");
    const matchedUser = users.find(
        user => (user.email.toLowerCase() === emailInput.toLowerCase() || user.name.toLowerCase() === emailInput.toLowerCase()) &&
                user.password === passwordInput
    );

    if (matchedUser) {
        // Save session flag & current user info in sessionStorage
        sessionStorage.setItem("isLoggedIn", "true");
        sessionStorage.setItem("currentUser", matchedUser.name || matchedUser.email);
        sessionStorage.setItem("currentUserEmail", matchedUser.email);

        showAlert("success", "Login successful! Redirecting to verification portal...");

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

    /* 
     * ========================================================================
     * BACKEND INTEGRATION PLACEHOLDER:
     * To replace local registration with a backend API call:
     * 
     * const response = await fetch('/api/v1/auth/register', {
     *     method: 'POST',
     *     headers: { 'Content-Type': 'application/json' },
     *     body: JSON.stringify({ name, email, password })
     * });
     * ========================================================================
     */

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

    showAlert("success", "Account created successfully! Auto-logging you in...");

    // Auto log in newly registered user
    sessionStorage.setItem("isLoggedIn", "true");
    sessionStorage.setItem("currentUser", name);
    sessionStorage.setItem("currentUserEmail", email);

    setTimeout(() => {
        window.location.href = "index.html";
    }, 1000);
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
