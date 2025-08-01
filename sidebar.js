// sidebar.js - Logic for the sidebar UI

const selectedTextEl = document.getElementById('selected-text');
const closeBtn = document.getElementById('close-btn');
const simpleBtn = document.getElementById('style-simple');
const technicalBtn = document.getElementById('style-technical');
const loaderEl = document.getElementById('loader');
const resultEl = document.getElementById('explanation-result');
const errorEl = document.getElementById('error-message');

let currentStyle = 'Simple';
let currentSelectedText = '';

// --- EVENT LISTENERS ---

window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    if (event.data.type === 'fetchExplanation') {
        currentSelectedText = event.data.selectedText;
        selectedTextEl.textContent = `"${currentSelectedText}"`;
        fetchExplanation();
    }
});

closeBtn.addEventListener('click', () => {
    // Send a message to the content script to close the sidebar.
    window.parent.postMessage({ type: 'closeSidebar' }, '*');
});

simpleBtn.addEventListener('click', () => setStyle('Simple'));
technicalBtn.addEventListener('click', () => setStyle('Technical'));

// --- FUNCTIONS ---

function setStyle(style) {
    if (currentStyle === style) return;
    currentStyle = style;
    simpleBtn.classList.toggle('active', style === 'Simple');
    technicalBtn.classList.toggle('active', style === 'Technical');
    if (currentSelectedText) {
        fetchExplanation();
    }
}

async function fetchExplanation() {
    if (!currentSelectedText) return;

    loaderEl.style.display = 'flex';
    resultEl.style.display = 'none';
    errorEl.style.display = 'none';

    try {
        const response = await chrome.runtime.sendMessage({
            type: 'getExplanation',
            payload: {
                selectedText: currentSelectedText,
                style: currentStyle
            }
        });

        if (response && response.status === 'success') {
            displayResult(response.data);
        } else {
            // Handle known errors that are successfully sent back from the background script.
            const errorMessage = response ? response.message : 'An unknown error occurred.';
            throw new Error(errorMessage);
        }

    } catch (error) {
        // **THE NEW, MORE ROBUST FIX IS HERE:**
        // A promise rejection from `sendMessage` almost always means the connection
        // to the background script failed (e.g., context invalidated).
        // We will now catch ANY such communication error and provide clear advice.
        console.error("Communication with background script failed:", error);
        displayError("Connection to the background process failed. This can happen if the extension was idle. Please close and reopen the sidebar to try again.");
    } finally {
        loaderEl.style.display = 'none';
    }
}

function displayResult(text) {
    resultEl.textContent = text;
    resultEl.style.display = 'block';
    errorEl.style.display = 'none';
}

function displayError(message) {
    errorEl.textContent = `Error: ${message}`;
    errorEl.style.display = 'block';
    resultEl.style.display = 'none';
}
