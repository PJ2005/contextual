// popup.js - Logic for the settings popup

const apiKeyInput = document.getElementById('api-key');
const saveBtn = document.getElementById('save-btn');
const statusMsg = document.getElementById('status-msg');

// Load the saved API key when the popup opens
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get(['apiKey'], (result) => {
        if (result.apiKey) {
            apiKeyInput.value = result.apiKey;
        }
    });
});

// Save the API key when the button is clicked
saveBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
        chrome.storage.sync.set({ apiKey: apiKey }, () => {
            statusMsg.textContent = 'API Key saved successfully!';
            statusMsg.style.color = 'green';
            setTimeout(() => {
                statusMsg.textContent = '';
                window.close(); // Close popup after saving
            }, 1500);
        });
    } else {
        statusMsg.textContent = 'Please enter a valid API key.';
        statusMsg.style.color = 'red';
    }
});
