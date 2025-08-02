// content.js - Injected into every page

let triggerIcon = null;
let popupIframe = null;
let lastSelection = null;
let isPopupOpen = false;
let selectionObserver = null;

// --- SETTINGS CACHE ---
// Cache settings locally to avoid async calls in event handlers
let settings = {
    autoOpenSidebar: false
};

// --- UTILITY FUNCTIONS ---

// Debounce helper to prevent rapid firing of events
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Check if element is visible in the viewport
function isInViewport(element) {
    try {
        // Check if element exists and is a valid DOM element
        if (!element || !(element instanceof Element) || !document.body.contains(element)) {
            return false;
        }

        // Safely get the bounding rectangle
        const rect = element.getBoundingClientRect();
        if (!rect) return false;

        // Get viewport dimensions safely
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

        // Check if the element is within the viewport
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= viewportHeight &&
            rect.right <= viewportWidth
        );
    } catch (error) {
        console.error('Error in isInViewport:', error);
        return false;
    }
}

// --- UI CREATION & MANAGEMENT ---

function createTriggerIcon() {
    // Remove existing icon if any
    const existingIcon = document.getElementById('contextual-trigger-icon');
    if (existingIcon) {
        existingIcon.remove();
    }

    const icon = document.createElement('div');
    icon.id = 'contextual-trigger-icon';
    icon.innerHTML = '<?xml version="1.0" encoding="UTF-8"?><svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20ZM12 7C9.24 7 7 9.24 7 12C7 14.76 9.24 17 12 17C14.76 17 17 14.76 17 12C17 9.24 14.76 7 12 7Z" fill="currentColor"/></svg>';
    icon.style.display = 'none';
    icon.setAttribute('aria-label', 'Explain selected text');
    icon.setAttribute('role', 'button');
    icon.tabIndex = 0;

    // Add keyboard support
    icon.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            togglePopup(true);
            icon.style.display = 'none';
        } else if (e.key === 'Escape') {
            icon.style.display = 'none';
        }
    });

    // Add click handler
    icon.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePopup(true);
        icon.style.display = 'none';
    });

    document.body.appendChild(icon);
    return icon;
}

function createPopup() {
    // First check if we're in a context where Chrome APIs are available
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) {
        console.error('Chrome extension APIs are not available in this context');
        return null;
    }

    const iframe = document.createElement('iframe');
    iframe.id = 'contextual-popup-iframe';

    try {
        const explanationUrl = chrome.runtime.getURL('explanation.html');
        if (!explanationUrl) {
            throw new Error('Could not get explanation URL');
        }
        iframe.src = explanationUrl;
        iframe.className = 'hidden';

        // **THE FIX IS HERE (Part 1):**
        // We add an `onload` handler to the iframe. This function will only run
        // when the sidebar's HTML and CSS are fully loaded and ready.
        iframe.onload = () => {
            // Set a flag indicating the iframe is ready to receive messages.
            iframe.isLoaded = true;
            // If a message was waiting to be sent, send it now.
            if (iframe.pendingMessage) {
                iframe.contentWindow.postMessage(iframe.pendingMessage, '*');
                iframe.pendingMessage = null; // Clear the waiting message
            }
        };

        document.body.appendChild(iframe);
        return iframe;
    } catch (error) {
        console.error('Error creating popup:', error);
        return null;
    }
}

function togglePopup(show) {
    if (show === isPopupOpen) return;

    if (!popupIframe) {
        popupIframe = createPopup();
    }

    if (show) {
        isPopupOpen = true;
        document.body.classList.add('contextual-popup-open');
        popupIframe.classList.remove('hidden');

        // Set focus to the popup for better keyboard navigation
        popupIframe.focus();

        // Send the message to the iframe
        const message = {
            type: 'fetchExplanation',
            selectedText: lastSelection,
            timestamp: Date.now()
        };

        const sendMessage = () => {
            try {
                popupIframe.contentWindow.postMessage(message, '*');
            } catch (error) {
                console.error('Failed to send message to popup:', error);
                // Retry after a short delay
                setTimeout(sendMessage, 100);
            }
        };

        if (popupIframe.isLoaded) {
            sendMessage();
        } else {
            popupIframe.pendingMessage = message;
        }

        // Add escape key handler
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                togglePopup(false);
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Clean up event listener when popup is closed
        popupIframe.escapeHandler = handleEscape;
    } else {
        isPopupOpen = false;
        document.body.classList.remove('contextual-popup-open');

        if (popupIframe) {
            popupIframe.classList.add('hidden');
            if (popupIframe.escapeHandler) {
                document.removeEventListener('keydown', popupIframe.escapeHandler);
                delete popupIframe.escapeHandler;
            }
        }
    }
}

// --- SELECTION HANDLING ---

function getSelectedText() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return '';
    return selection.toString().trim();
}

function positionTriggerIcon(selection) {
    if (!triggerIcon || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Calculate position with boundary checks
    const iconWidth = 32; // icon width in pixels
    const iconHeight = 32; // icon height in pixels
    const padding = 8; // padding from selection

    let left = window.scrollX + rect.right + padding;
    let top = window.scrollY + rect.top - (iconHeight - rect.height) / 2;

    // Ensure icon stays within viewport
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    if (left + iconWidth > viewportWidth + window.scrollX) {
        // If icon would go off right edge, position to the left of selection
        left = window.scrollX + rect.left - iconWidth - padding;
    }

    if (top < window.scrollY) {
        // If icon would go above viewport, align with top
        top = window.scrollY + padding;
    } else if (top + iconHeight > viewportHeight + window.scrollY) {
        // If icon would go below viewport, align with bottom
        top = window.scrollY + viewportHeight - iconHeight - padding;
    }

    triggerIcon.style.left = `${Math.max(window.scrollX + padding, left)}px`;
    triggerIcon.style.top = `${top}px`;
    triggerIcon.style.display = 'flex';

    // Add a small animation
    triggerIcon.style.opacity = '0';
    triggerIcon.style.transform = 'translateY(10px)';
    triggerIcon.style.transition = 'opacity 0.2s ease, transform 0.2s ease';

    // Trigger reflow
    void triggerIcon.offsetWidth;

    triggerIcon.style.opacity = '1';
    triggerIcon.style.transform = 'translateY(0)';
}

// --- EVENT HANDLERS ---

// Helper function to safely get storage items via background script
function getStorageItem(key, callback) {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
        // If context is invalid, don't even try to send a message.
        return;
    }

    try {
        chrome.runtime.sendMessage({ type: 'getStorage', key: key }, response => {
            try {
                if (chrome.runtime.lastError) {
                    // Don't log the context invalidated error as it's expected on navigation.
                    if (chrome.runtime.lastError.message.includes('context invalidated')) {
                        // Suppress logging for this specific, common error.
                    } else {
                        console.error(`Error getting storage item '${key}':`, chrome.runtime.lastError.message);
                    }
                    if (typeof callback === 'function') {
                        callback(null);
                    }
                    return;
                }

                if (typeof callback === 'function') {
                    callback(response);
                }
            } catch (error) {
                // This catch block will handle the 'Extension context invalidated' error
                // that occurs if the context is destroyed before the callback completes.
                if (error.message.includes('context invalidated')) {
                    // Suppress logging for this specific, common error.
                } else {
                    console.error('Error in sendMessage callback:', error);
                }
            }
        });
    } catch (error) {
        if (error.message.includes('Extension context invalidated')) {
            console.warn('Could not send message: Extension context invalidated.');
        } else {
            console.error('Error sending message to background script:', error);
        }
        callback(null);
    }
}

const handleSelectionChange = debounce(() => {
    // Check if we're in a context where we can run
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
        return;
    }

    const selectedText = getSelectedText();

    if (selectedText.length > 0 && selectedText.length < 1000) {
        lastSelection = selectedText;
        positionTriggerIcon(window.getSelection());
        // Only show the icon; popup will open on icon click
    } else if (triggerIcon) {
        triggerIcon.style.display = 'none';
    }
}, 500);

function handleClickOutside(event) {
    if (!triggerIcon || !popupIframe) return;

    const isClickOnIcon = triggerIcon.contains(event.target);
    const isClickInPopup = popupIframe.contains(event.target);

    if (!isClickOnIcon && !isClickInPopup) {
        // Hide the trigger icon if clicking outside
        if (triggerIcon.style.display !== 'none') {
            triggerIcon.style.opacity = '0';
            triggerIcon.style.transform = 'translateY(10px)';
            setTimeout(() => {
                if (triggerIcon) {
                    triggerIcon.style.display = 'none';
                }
            }, 200);
        }
    }
}

function handleScroll() {
    if (triggerIcon && triggerIcon.style.display !== 'none') {
        triggerIcon.style.display = 'none';
    }
}

function handleResize() {
    if (triggerIcon && triggerIcon.style.display !== 'none') {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
            positionTriggerIcon(selection);
        } else {
            triggerIcon.style.display = 'none';
        }
    }
}

// Setup event listeners with proper cleanup tracking
function setupEventListeners() {
    // Store references to the bound functions for proper cleanup
    const boundHandleSelectionChange = () => handleSelectionChange();
    const boundHandleClickOutside = (e) => handleClickOutside(e);
    const boundHandleScroll = debounce(handleScroll, 100);
    const boundHandleResize = debounce(handleResize, 200);

    // Add event listeners
    document.addEventListener('selectionchange', boundHandleSelectionChange);
    document.addEventListener('mousedown', boundHandleClickOutside);
    document.addEventListener('scroll', boundHandleScroll, { passive: true });
    window.addEventListener('resize', boundHandleResize);

    // Store cleanup function
    return () => {
        document.removeEventListener('selectionchange', boundHandleSelectionChange);
        document.removeEventListener('mousedown', boundHandleClickOutside);
        document.removeEventListener('scroll', boundHandleScroll);
        window.removeEventListener('resize', boundHandleResize);
    };
}

// --- MESSAGE HANDLING ---

function handleMessage(event) {
    // Check if message is coming from our popup iframe
    if (popupIframe && event.source === popupIframe.contentWindow) {
        const { type, dx, dy, height } = event.data;
        if (type === 'closeSidebar') {
            togglePopup(false);
        } else if (type === 'dragPopup') {
            const rect = popupIframe.getBoundingClientRect();
            // Ensure the popup doesn't go off-screen
            const newLeft = Math.max(0, Math.min(window.innerWidth - rect.width, rect.left + dx));
            const newTop = Math.max(0, Math.min(window.innerHeight - rect.height, rect.top + dy));
            popupIframe.style.left = `${newLeft}px`;
            popupIframe.style.top = `${newTop}px`;
            // If we are dragging, we are no longer in the default top-right position
            popupIframe.style.right = 'auto';
            popupIframe.style.transform = 'none';
        } else if (type === 'resizePopup') {
            const rect = popupIframe.getBoundingClientRect();
            popupIframe.style.width = `${rect.width + dx}px`;
            popupIframe.style.height = `${rect.height + dy}px`;
        } else if (type === 'autoResizePopup') {
            popupIframe.style.height = `${height}px`;
        }
    }
}

// --- LIFECYCLE MANAGEMENT ---

let cleanupListeners = null;

function handleExtensionMessage(message, sender, sendResponse) {
    // Handle extension messages here
    if (message.type === 'ping') {
        sendResponse({ status: 'pong' });
        return true;
    }

    // Add more message handlers as needed
    return false;
}

function cleanup() {
    // Clean up event listeners
    if (cleanupListeners) {
        cleanupListeners();
        cleanupListeners = null;
    }

    // Remove message listeners
    window.removeEventListener('message', handleMessage);
    chrome.runtime.onMessage.removeListener(handleExtensionMessage);
    window.removeEventListener('unload', cleanup);

    // Clean up UI elements
    if (triggerIcon && triggerIcon.parentNode) {
        triggerIcon.parentNode.removeChild(triggerIcon);
        triggerIcon = null;
    }

    if (popupIframe && popupIframe.parentNode) {
        document.body.removeChild(popupIframe);
        popupIframe = null;
    }

    console.log('Contextual extension cleaned up');
}

function initializeExtension() {
    try {
        // Create UI elements
        triggerIcon = createTriggerIcon();

        // Set up event listeners and store cleanup function
        cleanupListeners = setupEventListeners();

        // Listen for messages from the sidebar
        window.addEventListener('message', handleMessage);

        // Listen for extension messages
        chrome.runtime.onMessage.addListener(handleExtensionMessage);

        // Add cleanup handlers for different page lifecycle events
        // Use pagehide for modern browsers and beforeunload as fallback
        window.addEventListener('pagehide', cleanup);
        window.addEventListener('beforeunload', cleanup);

        // Fetch and cache settings on initialization
        getStorageItem('autoOpenSidebar', (value) => {
            if (value !== null) {
                settings.autoOpenSidebar = value;
            }
        });

        // Add styles for the extension
        const style = document.createElement('style');
        style.textContent = `
            #contextual-trigger-icon {
                position: absolute;
                z-index: 2147483647;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                background-color: #4285f4;
                color: white;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
                transition: transform 0.2s, box-shadow 0.2s;
                pointer-events: auto;
            }
            
            #contextual-trigger-icon:hover {
                transform: scale(1.1);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            }
            
            #contextual-trigger-icon svg {
                width: 18px;
                height: 18px;
            }
            
            #contextual-popup-iframe {
                position: fixed;
                top: 20px;
                right: 20px;
                left: auto;
                transform: none;
                width: 420px;
                min-width: 300px;
                max-width: 90vw;
                height: auto; /* Allow height to be set by content */
                min-height: 200px;
                max-height: 90vh;
                border: none;
                z-index: 2147483647;
                border-radius: 12px;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
                background: white;
                transition: opacity 0.3s ease, transform 0.3s ease;
            }
            
            #contextual-popup-iframe.hidden {
                opacity: 0;
                transform: scale(0.95);
                pointer-events: none;
            }
            
            .contextual-popup-open {
                overflow: hidden;
            }
            
            .contextual-popup-open::before {
                content: '';
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                z-index: 2147483646;
                backdrop-filter: blur(2px);
                /* Add a class to prevent interaction while dragging */
            }

            .contextual-popup-dragging::before {
                cursor: move;
            }
        `;
        document.head.appendChild(style);

        console.log('Contextual extension initialized');
    } catch (error) {
        console.error('Failed to initialize extension:', error);
    }
}

// Initialize the extension when the DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
    // If the document is already loaded, initialize immediately
    // but use setTimeout to ensure the rest of the page has loaded
    setTimeout(initializeExtension, 0);
}
