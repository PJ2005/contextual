// content.js - Injected into every page

let triggerIcon = null;
let popupIframe = null;
let lastSelection = null;
let isPopupOpen = false;
let selectionObserver = null;
let popupInitialX = 0;
let popupInitialY = 0;
let popupInitialWidth = 420;
let popupInitialHeight = 500;

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

        // Set initial dimensions and positioning
        iframe.style.width = '420px';
        iframe.style.height = '500px';
        iframe.style.minWidth = '300px';
        iframe.style.minHeight = '400px';
        iframe.style.maxWidth = '90vw';
        iframe.style.maxHeight = '90vh';

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

let isSelectionActive = false;

const handleSelectionChange = debounce(() => {
    console.log('Selection changed: contextValid=', checkExtensionContext());
    if (!checkExtensionContext()) {
        return;
    }

    const selectedText = getSelectedText();
    console.log('Selected text:', selectedText);

    if (selectedText.length > 0 && selectedText.length < 1000) {
        isSelectionActive = true;
        lastSelection = selectedText;
        console.log('Positioning trigger icon');
        positionTriggerIcon(window.getSelection());
    } else if (triggerIcon) {
        isSelectionActive = false;
        console.log('Hiding trigger icon');
        triggerIcon.style.display = 'none';
    }
}, 500);

function cleanup() {
    if (!checkExtensionContext()) {
        extensionContextValid = false;
        try {
            if (cleanupListeners) {
                cleanupListeners();
                cleanupListeners = null;
            }
            window.removeEventListener('message', handleMessage);
            if (triggerIcon?.parentNode && !isSelectionActive) {
                triggerIcon.parentNode.removeChild(triggerIcon);
                triggerIcon = null;
            }
            if (popupIframe?.parentNode) {
                document.body.removeChild(popupIframe);
                popupIframe = null;
            }
            document.body.classList.remove('contextual-popup-open');
        } catch (e) {
            console.error('Error during minimal cleanup:', e);
        }
        return;
    }

    // Full cleanup for valid context
    try {
        if (cleanupListeners) {
            cleanupListeners();
            cleanupListeners = null;
        }
        window.removeEventListener('message', handleMessage);
        if (chrome.runtime?.id) {
            chrome.runtime.onMessage.removeListener(handleExtensionMessage);
        }
        if (triggerIcon?.parentNode && !isSelectionActive) {
            triggerIcon.parentNode.removeChild(triggerIcon);
            triggerIcon = null;
        }
        if (popupIframe?.parentNode) {
            document.body.removeChild(popupIframe);
            popupIframe = null;
        }
        document.body.classList.remove('contextual-popup-open');
    } catch (e) {
        console.error('Error cleaning up:', e);
    }
}

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
    // Add this check first
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
        return;
    }

    if (!popupIframe || event.source !== popupIframe.contentWindow) return;

    const { type, direction, dx, dy } = event.data;

    switch (type) {
        case 'closeSidebar':
            togglePopup(false);
            break;

        // Drag and resize functionality has been disabled
        case 'startDrag':
        case 'dragPopup':
        case 'startResize':
        case 'resizePopup':
            // Do nothing - functionality disabled
            break;
    }
}

// Drag and resize functions have been removed - functionality disabled

// --- LIFECYCLE MANAGEMENT ---

let cleanupListeners = null;
let extensionContextValid = true;

function handleExtensionMessage(message, sender, sendResponse) {
    if (!extensionContextValid) {
        return false;
    }

    try {
        if (message.type === 'ping') {
            sendResponse({ status: 'pong' });
            return true;
        }
        return false;
    } catch (error) {
        console.error('Message handler error:', error);
        return false;
    }
}

// Add context invalidation detection
function checkExtensionContext() {
    try {
        if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
            console.warn('Extension context check failed: chrome.runtime.id is unavailable');
            // Attempt to reconnect after a short delay
            setTimeout(() => {
                if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
                    console.log('Extension context restored');
                    initializeExtension();
                } else {
                    console.error('Extension context permanently invalidated');
                    extensionContextValid = false;
                }
            }, 1000);
            return false;
        }
        return true;
    } catch (error) {
        console.error('Error checking extension context:', error);
        return false;
    }
}

function initializeExtension() {
    if (!checkExtensionContext()) {
        return;
    }

    try {
        // Create UI elements
        triggerIcon = createTriggerIcon();
        // Initialize popupIframe only when needed (lazy loading)
        if (!popupIframe) {
            popupIframe = createPopup();
        }

        // Set up event listeners and store cleanup function
        cleanupListeners = setupEventListeners();

        // Listen for messages from the sidebar
        window.addEventListener('message', handleMessage);

        // Add message listener with error handling
        try {
            chrome.runtime.onMessage.addListener(handleExtensionMessage);
        } catch (e) {
            console.error('Failed to add message listener:', e);
            extensionContextValid = false;
            return;
        }

        // Add cleanup handlers with debouncing
        const debouncedCleanup = debounce(cleanup, 100);
        window.addEventListener('pagehide', debouncedCleanup);
        window.addEventListener('beforeunload', debouncedCleanup);

        // Add styles by linking external stylesheet
        const style = document.createElement('link');
        style.rel = 'stylesheet';
        style.href = chrome.runtime.getURL('styles.css');
        document.head.appendChild(style);

        // Observe SPA route changes with debouncing
        const debouncedReinitialize = debounce(() => {
            if (checkExtensionContext()) {
                // Only reinitialize if significant changes are detected
                cleanup();
                initializeExtension();
            }
        }, 500);

        const observer = new MutationObserver((mutations) => {
            // Filter mutations to avoid unnecessary reinitialization
            const significantChange = mutations.some(mutation => {
                // Example: Only react to changes in <head> or specific elements
                return mutation.target.tagName === 'HEAD' || mutation.target.matches('.specific-container');
            });

            if (significantChange) {
                debouncedReinitialize();
            }
        });

        observer.observe(document.documentElement, { childList: true, subtree: false }); // Narrow scope to document.documentElement

        // Combine cleanup for event listeners and observer
        const originalCleanupListeners = cleanupListeners;
        cleanupListeners = () => {
            observer.disconnect();
            originalCleanupListeners();
            document.removeEventListener('pagehide', debouncedCleanup);
            document.removeEventListener('beforeunload', debouncedCleanup);
            window.removeEventListener('message', handleMessage);
        };

        console.log('Contextual extension initialized');
    } catch (error) {
        console.error('Failed to initialize extension:', error);
        // Retry initialization after a delay
        setTimeout(() => {
            if (checkExtensionContext()) {
                initializeExtension();
            }
        }, 1000);
    }
}

// Initialize with context check
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (checkExtensionContext()) {
            initializeExtension();
        }
    });
} else {
    setTimeout(() => {
        if (checkExtensionContext()) {
            initializeExtension();
        }
    }, 0);
}

// Periodic context checking (increased interval for performance)
// Reduce context check frequency
setInterval(checkExtensionContext, 30000); // Check every 30 seconds

// Initialize with context check
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (checkExtensionContext()) {
            initializeExtension();
        }
    });
} else {
    setTimeout(() => {
        if (checkExtensionContext()) {
            initializeExtension();
        }
    }, 0);
}

// Periodic context checking
setInterval(checkExtensionContext, 5000);