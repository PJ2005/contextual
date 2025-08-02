// popup.js - Logic for the settings popup

const apiKeyInput = document.getElementById('api-key');
const modelNameInput = document.getElementById('model-name');
const saveBtn = document.getElementById('save-btn');
const statusMsg = document.getElementById('status-msg');

// Load the saved API key and model when the popup opens
document.addEventListener('DOMContentLoaded', () => {
    chrome.runtime.sendMessage({ type: 'getStorage', key: 'apiKey' }, (response) => {
        if (response && response.value) {
            apiKeyInput.value = response.value;
        }
    });

    chrome.runtime.sendMessage({ type: 'getStorage', key: 'modelName' }, (response) => {
        if (response && response.value) {
            modelNameInput.value = response.value;
        } else {
            // Set default model if none saved
            modelNameInput.value = 'deepseek/deepseek-chat-v3-0324';
        }
    });
});

// Save the API key and model when the button is clicked
saveBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const modelName = modelNameInput.value.trim();

    // Clear previous status
    statusMsg.textContent = '';
    statusMsg.className = 'status-message';

    if (!apiKey || !apiKey.startsWith('sk-or-')) {
        showStatus('Please enter a valid OpenRouter API key (starting with "sk-or-").', 'error');
        return;
    }

    if (!modelName) {
        showStatus('Please enter a model name.', 'error');
        return;
    }

    // Save both values
    chrome.runtime.sendMessage({ type: 'setStorage', key: 'apiKey', value: apiKey }, (response) => {
        if (response && response.success) {
            chrome.runtime.sendMessage({ type: 'setStorage', key: 'modelName', value: modelName }, (modelResponse) => {
                if (modelResponse && modelResponse.success) {
                    showStatus('✓ Configuration saved successfully!', 'success');
                    setTimeout(() => {
                        window.close();
                    }, 1500);
                } else {
                    showStatus('Failed to save model name.', 'error');
                }
            });
        } else {
            showStatus('Failed to save API key.', 'error');
        }
    });
});

function showStatus(message, type) {
    statusMsg.textContent = message;
    statusMsg.className = `status-message ${type}`;
}
