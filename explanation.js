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
    const resizeHandle = document.getElementById('resize-handle');

    let currentStyle = 'Simple';
    let currentSelectedText = '';

    // --- EVENT LISTENERS ---

    window.addEventListener('message', (event) => {
        // Ensure the message is from the parent window (content script)
        if (event.source !== window.parent) return;

        const { type, selectedText } = event.data;
        if (type === 'fetchExplanation') {
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
                const errorMessage = response ? response.message : 'An unknown error occurred.';
                throw new Error(errorMessage);
            }

        } catch (error) {
            console.error("Communication with background script failed:", error);
            displayError("Connection to the background process failed. This can happen if the extension was idle. Please close and reopen the popup to try again.");
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
            // After content is set, request an auto-resize
            requestAnimationFrame(() => {
                // Add a small delay to allow images/elements to render
                setTimeout(autoResize, 50);
            });
        } else {
            explanationResultEl.innerHTML = `<pre>${text}</pre>`;
        }
    }

    function displayError(message) {
        explanationResultEl.innerHTML = `<p class="error">${message}</p>`;
        autoResize();
    }

    function autoResize() {
        const PADDING = 20; // Extra space
        const newHeight = Math.min(document.body.scrollHeight + PADDING, window.screen.availHeight * 0.9);
        window.parent.postMessage({ type: 'autoResizePopup', height: newHeight }, '*');
    }

    // --- DRAG AND RESIZE LOGIC (OPTIMIZED) ---

    function createThrottledHandler(onMove) {
        let isTicking = false;
        let lastEvent = null;

        const update = () => {
            isTicking = false;
            if (lastEvent) {
                onMove(lastEvent);
            }
        };

        return (e) => {
            lastEvent = e;
            if (!isTicking) {
                window.requestAnimationFrame(update);
                isTicking = true;
            }
        };
    }

    // Dragging
    header.addEventListener('mousedown', (e) => {
        e.preventDefault();
        popupContainer.classList.add('dragging');
        let lastX = e.clientX;
        let lastY = e.clientY;

        const onMouseMove = createThrottledHandler((moveEvent) => {
            const dx = moveEvent.clientX - lastX;
            const dy = moveEvent.clientY - lastY;
            lastX = moveEvent.clientX;
            lastY = moveEvent.clientY;
            window.parent.postMessage({ type: 'dragPopup', dx, dy }, '*');
        });

        function onMouseUp() {
            popupContainer.classList.remove('dragging');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // Resizing
    resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        popupContainer.classList.add('resizing');
        let lastX = e.clientX;
        let lastY = e.clientY;

        const onMouseMove = createThrottledHandler((moveEvent) => {
            const dx = moveEvent.clientX - lastX;
            const dy = moveEvent.clientY - lastY;
            lastX = moveEvent.clientX;
            lastY = moveEvent.clientY;
            window.parent.postMessage({ type: 'resizePopup', dx, dy }, '*');
        });

        function onMouseUp() {
            popupContainer.classList.remove('resizing');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
});
