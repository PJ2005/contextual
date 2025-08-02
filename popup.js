// popup.js - Logic for the settings popup

const apiKeyInput = document.getElementById('api-key');
const saveBtn = document.getElementById('save-btn');
const statusMsg = document.getElementById('status-msg');


// Load the saved API key when the popup opens (via background script)
document.addEventListener('DOMContentLoaded', () => {
    chrome.runtime.sendMessage({ type: 'getStorage', key: 'apiKey' }, (response) => {
        if (response && response.value) {
            apiKeyInput.value = response.value;
        }
    });
});

// Save the API key when the button is clicked (via background script)
saveBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
        chrome.runtime.sendMessage({ type: 'setStorage', key: 'apiKey', value: apiKey }, (response) => {
            if (response && response.success) {
                statusMsg.textContent = 'API Key saved successfully!';
                statusMsg.style.color = 'green';
                setTimeout(() => {
                    statusMsg.textContent = '';
                    window.close(); // Close popup after saving
                }, 1500);
            } else {
                statusMsg.textContent = 'Failed to save API key.';
                statusMsg.style.color = 'red';
            }
        });
    } else {
        statusMsg.textContent = 'Please enter a valid API key.';
        statusMsg.style.color = 'red';
    }
});
