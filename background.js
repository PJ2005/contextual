// background.js - Service Worker (Central Controller)

// Cache for storing API responses
const explanationCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Clean up old cache entries
setInterval(() => {
    const now = Date.now();
    for (const [key, { timestamp }] of explanationCache.entries()) {
        if (now - timestamp > CACHE_TTL) {
            explanationCache.delete(key);
        }
    }
}, 60 * 60 * 1000); // Run hourly

// Helper function to extract visible text from the page
function getVisibleText() {
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                // Skip script, style, and other non-visible elements
                if (node.parentNode.nodeName === 'SCRIPT' || 
                    node.parentNode.nodeName === 'STYLE' ||
                    node.parentNode.nodeName === 'NOSCRIPT' ||
                    node.parentNode.isContentEditable) {
                    return NodeFilter.FILTER_REJECT;
                }
                // Only include nodes with actual text
                return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        },
        false
    );

    const textParts = [];
    let node;
    while (node = walker.nextNode()) {
        textParts.push(node.textContent.trim());
    }
    
    return textParts.join(' ').replace(/\s+/g, ' ');
}

// Retry logic for API calls
async function withRetry(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt === maxRetries) break;
            const delay = baseDelay * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'getStorage') {
        chrome.storage.sync.get(request.key, (result) => {
            if (chrome.runtime.lastError) {
                console.error('Error getting storage:', chrome.runtime.lastError);
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ value: result[request.key] });
            }
        });
        return true; // Indicates that the response is sent asynchronously
    }

    // This is the main entry point for any requests from the extension's UI.
    if (request.type === 'getExplanation') {
        (async () => {
            try {
                // Step 1: Get the API Key from storage.
                const { apiKey } = await chrome.storage.sync.get(['apiKey']);
                if (!apiKey) {
                    throw new Error("API Key not set. Please set it in the extension options.");
                }

                // Create a cache key based on the selected text and style
                const cacheKey = `${request.payload.selectedText}-${request.payload.style}`;
                const cached = explanationCache.get(cacheKey);
                
                // Return cached response if available and not expired
                if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
                    return sendResponse({ status: 'success', data: cached.data, cached: true });
                }

                // Step 2: Get the visible page content
                const tabId = sender.tab.id;
                const [results] = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: getVisibleText,
                });

                if (!results?.result) {
                    throw new Error("Could not extract text from the page. Please try again.");
                }
                const visibleText = results.result;

                // Step 3: Prepare the complete payload for the Gemini API
                const payloadForGemini = {
                    apiKey,
                    selectedText: request.payload.selectedText,
                    fullText: visibleText.substring(0, 15000), // Limit context length
                    style: request.payload.style,
                };

                // Step 4: Call the Gemini API with retry logic
                const explanation = await withRetry(
                    () => callGeminiAPI(payloadForGemini),
                    3, // max retries
                    1000 // initial delay
                );

                // Cache the successful response
                explanationCache.set(cacheKey, {
                    data: explanation,
                    timestamp: Date.now()
                });

                sendResponse({ 
                    status: 'success', 
                    data: explanation,
                    cached: false
                });

            } catch (error) {
                console.error('Contextual Extension Error:', error);
                
                // Provide more user-friendly error messages
                let userMessage = error.message;
                if (error.message.includes('API key')) {
                    userMessage = 'Invalid API key. Please check your API key in the extension settings.';
                } else if (error.message.includes('quota')) {
                    userMessage = 'API quota exceeded. Please try again later or check your API usage.';
                } else if (error.message.includes('network')) {
                    userMessage = 'Network error. Please check your internet connection.';
                }
                
                sendResponse({ 
                    status: 'error', 
                    message: userMessage,
                    details: process.env.NODE_ENV === 'development' ? error.message : undefined
                });
            }
        })();
        // Return true is crucial for asynchronous responses.
        return true;
    }
});

// Rate limiting state
const rateLimit = {
    lastRequestTime: 0,
    minRequestInterval: 1000, // 1 second between requests
    queue: [],
    processing: false,
};

/**
 * Processes the API request queue to ensure rate limiting
 */
async function processQueue() {
    if (rateLimit.processing || rateLimit.queue.length === 0) return;
    
    rateLimit.processing = true;
    const now = Date.now();
    const timeSinceLastRequest = now - rateLimit.lastRequestTime;
    const delay = Math.max(0, rateLimit.minRequestInterval - timeSinceLastRequest);
    
    if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    const { resolve, reject, params } = rateLimit.queue.shift();
    
    try {
        const result = await callGeminiAPIInternal(params);
        rateLimit.lastRequestTime = Date.now();
        resolve(result);
    } catch (error) {
        reject(error);
    } finally {
        rateLimit.processing = false;
        processQueue(); // Process next item in queue
    }
}

/**
 * Queues an API call to respect rate limits
 */
async function callGeminiAPI(params) {
    return new Promise((resolve, reject) => {
        rateLimit.queue.push({ resolve, reject, params });
        processQueue();
    });
}

/**
 * Internal function that makes the actual API call to Gemini
 */
async function callGeminiAPIInternal({ apiKey, selectedText, fullText, style }) {
    const maxContextLength = 15000;
    const truncatedFullText = fullText.substring(0, maxContextLength);

    // Improved prompt with better instructions for the AI
    const prompt = `
        You are an expert explainer. Given the full text of an article for context, explain the following selected term or phrase.
        The explanation should be tailored to how the term is used in the article.
        
        **Explanation Style:** ${style}
        - If 'Simple', explain in plain language that a 10-year-old could understand.
        - If 'Technical', include detailed information and relevant technical context.
        
        ---
        **Full Article Context (truncated):**
        ${truncatedFullText}
        
        ---
        **Selected Text to Explain:**
        "${selectedText}"
        
        ---
        **Instructions:**
        1. Provide a clear, concise explanation of the selected text.
        2. Include 1-2 examples if helpful.
        3. Keep the response focused and relevant to the context.
        
        **Explanation:**
    `;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    try {
        const payload = {
            contents: [{ 
                parts: [{ 
                    text: prompt 
                }] 
            }],
            generationConfig: {
                temperature: style === 'Technical' ? 0.3 : 0.5,
                topK: 1,
                topP: 1,
                maxOutputTokens: 1024, // Increased for more detailed responses
                stopSequences: ["---"] // Stop generation if it starts adding sections
            },
            safetySettings: [
                {
                    category: "HARM_CATEGORY_HARASSMENT",
                    threshold: "BLOCK_NONE"
                },
                {
                    category: "HARM_CATEGORY_HATE_SPEECH",
                    threshold: "BLOCK_NONE"
                },
                {
                    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    threshold: "BLOCK_NONE"
                },
                {
                    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                    threshold: "BLOCK_NONE"
                }
            ]
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-goog-api-client': 'contextual-extension/1.0.0'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            console.error("API Error Response:", errorBody);
            
            let errorMessage = `API request failed with status ${response.status}`;
            if (errorBody.error) {
                errorMessage += `: ${errorBody.error.message || JSON.stringify(errorBody.error)}`;
            }
            
            const error = new Error(errorMessage);
            error.status = response.status;
            error.details = errorBody;
            throw error;
        }

        const result = await response.json();
        
        if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
            return result.candidates[0].content.parts[0].text.trim();
        } else if (result.promptFeedback?.blockReason) {
            throw new Error(`Content blocked: ${result.promptFeedback.blockReason}`);
        } else {
            console.error("Unexpected API response format:", result);
            throw new Error("Unexpected response format from the API");
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error("Request timed out. Please try again.");
        }
        console.error("API call failed:", error);
        throw error;
    }
        throw new Error("Could not extract explanation from API response.");
    }
