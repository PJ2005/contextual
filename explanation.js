// explanation.js - Logic for the explanation UI

document.addEventListener('DOMContentLoaded', () => {
    const selectedTextEl = document.getElementById('selected-text');
    const closeBtn = document.getElementById('close-btn');
    const simpleBtn = document.getElementById('simple-btn');
    const technicalBtn = document.getElementById('technical-btn');
    const resultContainer = document.getElementById('result-container');
    const explanationResultEl = document.getElementById('explanation-result');
    const popupContainer = document.getElementById('popup-container');
    const header = document.getElementById('popup-header');

    // Get all resize handles
    const resizeHandles = {
        nw: document.getElementById('resize-handle-nw'),
        ne: document.getElementById('resize-handle-ne'),
        sw: document.getElementById('resize-handle-sw'),
        se: document.getElementById('resize-handle-se'),
        n: document.getElementById('resize-handle-n'),
        s: document.getElementById('resize-handle-s'),
        w: document.getElementById('resize-handle-w'),
        e: document.getElementById('resize-handle-e')
    };

    let currentStyle = 'Simple';
    let currentSelectedText = '';

    // --- EVENT LISTENERS ---

    window.addEventListener('message', (event) => {
        // Ensure the message is from the parent window (content script)
        if (event.source !== window.parent) return;

        if (event.data.type === 'popupRect') {
            const rect = event.data.rect;
            initialWidth = rect.width;
            initialHeight = rect.height;
            initialLeft = rect.left;
            initialTop = rect.top;
        } else if (event.data.type === 'fetchExplanation') {
            const { selectedText } = event.data;
            currentSelectedText = selectedText;
            selectedTextEl.textContent = currentSelectedText;
            fetchExplanation();
        }
    });

    closeBtn.addEventListener('click', () => {
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

        showLoader();

        try {
            // Validate API key before making the request
            const { apiKey } = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: 'getStorage', key: 'apiKey' }, (response) => {
                    resolve({ apiKey: response?.value });
                });
            });

            if (!apiKey || !apiKey.startsWith('sk-or-')) {
                throw new Error('No valid API key set. Please configure a valid OpenRouter API key in the extension settings.');
            }

            // Add timeout handling
            const response = await Promise.race([
                chrome.runtime.sendMessage({
                    type: 'getExplanation',
                    payload: {
                        selectedText: currentSelectedText,
                        style: currentStyle
                    }
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Request timed out after 45 seconds')), 45000)
                )
            ]);

            // Enhanced response validation
            if (!response) {
                throw new Error('No response received from background script');
            }

            if (response.status === 'success' && response.data) {
                displayResult(response.data);
            } else if (response.status === 'error') {
                throw new Error(response.message || 'Unknown error from background script');
            } else {
                throw new Error('Invalid response format from background script');
            }

        } catch (error) {
            console.error('Communication error:', error);
            let errorMessage = 'Failed to get explanation. ';

            if (error.message.includes('timeout') || error.message.includes('Timeout')) {
                errorMessage += 'The request took too long. Please check your internet connection and try again.';
            } else if (error.message.includes('context invalidated') || error.message.includes('Extension context')) {
                errorMessage += 'Extension context was lost. Please reopen the popup.';
            } else if (error.message.includes('API key') || error.message.includes('Invalid or missing API key')) {
                errorMessage += 'Please verify your API key in the extension settings.';
            } else if (error.message.includes('Token limit exceeded')) {
                errorMessage += 'The selected text or page content is too long. Try selecting a shorter phrase or reloading the page.';
            } else if (error.message.includes('No readable content')) {
                errorMessage += 'This page doesn\'t contain readable text content. Please try a different page.';
            } else if (error.message.includes('Invalid selected text')) {
                errorMessage += 'Please make a new text selection and try again.';
            } else if (error.message.includes('Invalid page content')) {
                errorMessage += 'Please refresh the page and try again.';
            } else {
                errorMessage += error.message || 'Please try again or check your API key.';
            }

            displayError(errorMessage);
        } finally {
            hideLoader();
        }
    }

    function showLoader() {
        explanationResultEl.innerHTML = '<div class="loader"></div>';
    }

    function hideLoader() {
        const loader = explanationResultEl.querySelector('.loader');
        if (loader) {
            loader.remove();
        }
    }

    function displayResult(text) {
        // Use showdown.js to render markdown
        if (window.showdown) {
            const converter = new window.showdown.Converter({
                ghCompatibleHeaderId: true,
                simpleLineBreaks: true,
                simplifiedAutoLink: true,
                strikethrough: true,
                tables: true,
                tasklists: true,
                openLinksInNewWindow: true,
                emoji: true
            });
            explanationResultEl.innerHTML = converter.makeHtml(text);
        } else {
            // Fallback: convert basic markdown manually
            const formattedText = text
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/`(.*?)`/g, '<code>$1</code>')
                .replace(/\n\n/g, '</p><p>')
                .replace(/\n/g, '<br>');
            explanationResultEl.innerHTML = `<p>${formattedText}</p>`;
        }

        // Ensure content is fully visible
        setTimeout(() => {
            explanationResultEl.scrollTop = 0;
        }, 100);
    }

    function displayError(message) {
        // Enhanced error message handling
        if (message.includes('Token limit exceeded')) {
            message = 'The selected text or page content is too long. Try selecting a shorter phrase or reloading the page.';
        } else if (message.includes('No readable content')) {
            message = 'This page doesn\'t contain readable text content. Please try a different page.';
        } else if (message.includes('Invalid selected text')) {
            message = 'Please make a new text selection and try again.';
        } else if (message.includes('Invalid page content')) {
            message = 'Please refresh the page and try again.';
        }

        explanationResultEl.innerHTML = `<p class="error">${message}</p>`;
    }

    // --- DRAG AND RESIZE FUNCTIONALITY DISABLED ---
    // All drag and resize functionality has been removed

    console.log('Drag and resize functionality is disabled');
});