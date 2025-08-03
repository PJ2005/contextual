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
    try {
        // Get main content containers first to avoid extracting navigation, ads, etc.
        const contentSelectors = [
            'main', 'article', '[role="main"]', '.content', '.post-content',
            '.entry-content', '.article-body', '.story-body', '#content',
            '.markdown-body', '.prose'
        ];

        let contentContainer = null;
        for (const selector of contentSelectors) {
            try {
                contentContainer = document.querySelector(selector);
                if (contentContainer) break;
            } catch (e) {
                // Continue to next selector if this one fails
                continue;
            }
        }

        // Fallback to body if no content container found
        const targetElement = contentContainer || document.body;

        if (!targetElement) {
            return 'No content available on this page.';
        }

        const walker = document.createTreeWalker(
            targetElement,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    try {
                        const parent = node.parentNode;
                        if (!parent) return NodeFilter.FILTER_REJECT;

                        // Reject specific unwanted elements
                        if (parent.nodeName === 'SCRIPT' ||
                            parent.nodeName === 'STYLE' ||
                            parent.nodeName === 'NOSCRIPT' ||
                            parent.nodeName === 'NAV' ||
                            parent.closest?.('nav') ||
                            parent.closest?.('header') ||
                            parent.closest?.('footer') ||
                            parent.closest?.('[role="navigation"]') ||
                            parent.closest?.('.sidebar') ||
                            parent.closest?.('.menu') ||
                            parent.closest?.('.ads') ||
                            parent.closest?.('.advertisement') ||
                            parent.isContentEditable) {
                            return NodeFilter.FILTER_REJECT;
                        }

                        // Only accept text nodes with meaningful content
                        const text = node.textContent?.trim() || '';
                        return (text && text.length > 2) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                    } catch (e) {
                        // If there's any error, reject this node
                        return NodeFilter.FILTER_REJECT;
                    }
                }
            },
            false
        );

        const textParts = [];
        let node;
        let totalLength = 0;
        const maxLength = 2000; // Drastically reduced from 8000 to 2000

        try {
            while ((node = walker.nextNode()) && totalLength < maxLength) {
                const text = node.textContent?.trim() || '';
                if (text) {
                    textParts.push(text);
                    totalLength += text.length;
                }
            }
        } catch (e) {
            // If walker fails, try to get basic text content
            console.warn('TreeWalker failed, falling back to basic text extraction:', e);
            const fallbackText = targetElement.textContent?.trim() || '';
            return fallbackText.substring(0, maxLength);
        }

        const result = textParts.join(' ').replace(/\s+/g, ' ').substring(0, maxLength);
        return result || 'No readable text found on this page.';
    } catch (error) {
        console.error('Error extracting text from page:', error);
        // Final fallback - try to get any text from document.body
        try {
            const fallbackText = document.body?.textContent?.trim() || '';
            return fallbackText.substring(0, 2000) || 'Unable to extract text from this page.'; // Reduced from 8000 to 2000
        } catch (e) {
            return 'Unable to extract text from this page.';
        }
    }
}

// Retry logic for API calls with enhanced validation
async function withRetry(fn, maxRetries = 3, baseDelay = 1000, originalParams = null) {
    let lastError;
    let contextReductionFactor = 1; // Start with full context
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Adjust context length for retries
            const modifiedFn = async () => {
                const result = await fn();
                if (attempt > 1 && typeof result === 'string') {
                    if (result.length < 50) {
                        throw new Error("Response too short");
                    }
                    if (result.includes("...") && !result.endsWith("...")) {
                        throw new Error("Response contains mid-sentence ellipsis");
                    }
                }
                return result;
            };
            return await modifiedFn();
        } catch (error) {
            lastError = error;
            if (error.message.includes('Token limit exceeded') && originalParams && originalParams.fullText) {
                contextReductionFactor *= 0.2; // Even more aggressive reduction from 0.3 to 0.2
                const reducedFullText = originalParams.fullText.substring(0, Math.floor(500 * contextReductionFactor)); // Reduced base from 2000 to 500
                fn = () => callGeminiAPIInternal({
                    ...originalParams,
                    fullText: reducedFullText
                });
            }
            if (attempt === maxRetries) break;
            const delay = baseDelay * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

// Validate response completeness and style
function validateResponse(text, style) {
    // Ensure we have valid inputs
    if (!text || typeof text !== 'string') {
        throw new Error("Invalid response text");
    }
    if (!style || typeof style !== 'string') {
        throw new Error("Invalid style parameter");
    }

    const trimmedText = text.trim();
    if (trimmedText.length === 0) {
        throw new Error("Response is empty");
    }

    // Check for completeness - be very lenient since OpenRouter responses are generally complete
    const hasProperEnding = /[.!?)\]"'`*]\s*$/.test(trimmedText) || trimmedText.endsWith(')*') || trimmedText.endsWith('.)');
    const wordCount = trimmedText.split(/\s+/).length;
    const meetsLengthRequirement = style === 'Simple'
        ? wordCount >= 15 && wordCount <= 150
        : wordCount >= 30;

    // Check for abrupt cuts (very specific - only if it ends with incomplete ellipsis)
    const hasAbruptCut = trimmedText.endsWith('..') && !trimmedText.endsWith('...');

    // Only validate if the response is obviously incomplete
    if (!meetsLengthRequirement || hasAbruptCut) {
        console.log('Validation details:', { hasProperEnding, meetsLengthRequirement, hasAbruptCut, wordCount, text: trimmedText.substring(0, 100) + '...' });
        throw new Error("Response appears incomplete");
    }

    // Debug log for validation details
    console.log('Validating response:', {
        text: text.substring(0, 100) + '...',
        hasProperEnding,
        meetsLengthRequirement,
        hasAbruptCut,
        wordCount
    });

    return trimmedText;
}

// Rate limiting state
const rateLimit = {
    lastRequestTime: 0,
    minRequestInterval: 1000, // 1 second between requests
    queue: [],
    processing: false,
};

// Process API request queue
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
        processQueue();
    }
}

// Queue API call for rate limiting
async function callGeminiAPI(params) {
    return new Promise((resolve, reject) => {
        rateLimit.queue.push({ resolve, reject, params });
        processQueue();
    });
}

// Make actual API call to Gemini
function estimateTokens(text) {
    if (!text || typeof text !== 'string') {
        return 0;
    }
    return Math.ceil(text.length / 4); // Rough estimate: 1 token ≈ 4 characters
}

function getRelevantContext(fullText, selectedText) {
    // Ensure fullText and selectedText are strings
    if (!fullText || typeof fullText !== 'string') {
        return '';
    }
    if (!selectedText || typeof selectedText !== 'string') {
        return fullText.substring(0, 800); // Increased fallback limit
    }

    // Find the selected text and get 3 sentences before and after (increased from 2)
    const sentences = fullText.match(/[^.!?]+[.!?]+/g) || [fullText];
    let selectedSentenceIdx = -1;
    for (let i = 0; i < sentences.length; i++) {
        if (sentences[i].toLowerCase().includes(selectedText.toLowerCase())) {
            selectedSentenceIdx = i;
            break;
        }
    }
    if (selectedSentenceIdx === -1) {
        // fallback to char window with more context
        const index = fullText.toLowerCase().indexOf(selectedText.toLowerCase());
        if (index === -1) return fullText.substring(0, 800);
        const start = Math.max(0, index - 600); // Increased from 500
        const end = Math.min(fullText.length, index + selectedText.length + 600); // Increased from 500
        return fullText.substring(start, end);
    }
    // Get 3 sentences before and after (increased from 2)
    const startIdx = Math.max(0, selectedSentenceIdx - 3);
    const endIdx = Math.min(sentences.length, selectedSentenceIdx + 4);
    return sentences.slice(startIdx, endIdx).join(' ').trim();
}

async function callGeminiAPIInternal({ apiKey, modelName, selectedText, fullText, style }) {
    const maxContextLength = 1500;
    // Validate inputs
    if (!fullText || typeof fullText !== 'string') {
        throw new Error('Invalid page content. Please try refreshing the page.');
    }
    if (!selectedText || typeof selectedText !== 'string') {
        throw new Error('Invalid selected text. Please make a new selection.');
    }

    // Validate API key and model name
    if (!apiKey) {
        throw new Error('No API key provided. Please configure it in the extension settings.');
    }
    if (!modelName) {
        throw new Error('No model name provided. Please configure it in the extension settings.');
    }

    // Debug log for API key and model name
    console.log('callGeminiAPIInternal: apiKey:', apiKey, 'modelName:', modelName);

    const relevantContext = getRelevantContext(fullText, selectedText);
    const truncatedFullText = relevantContext.substring(0, maxContextLength);

    // Extract article summary and try to identify the topic/domain
    let articleSummary = '';
    const summarySentences = fullText.match(/[^.!?]+[.!?]+/g) || [fullText];
    articleSummary = summarySentences.slice(0, 4).join(' ').substring(0, 400).trim();
    if (!articleSummary) articleSummary = fullText.substring(0, 400).trim();

    // Use LLM-based domain detection instead of hardcoded keywords
    let articleDomain = '';

    // Create a domain analysis prompt for the LLM
    const domainAnalysisPrompt = `Based on this article content, identify the primary technical domain/field:

Article summary: ${articleSummary}

Context around the term "${selectedText}":
${truncatedFullText}

Respond with ONLY the domain name (e.g., "gRPC/RPC technology", "web development", "machine learning/AI", "database technology", "containerization/orchestration", "networking", "cybersecurity", "data science", etc.). Be specific and accurate based on the actual content.`;

    // Log for debugging - will be determined by LLM context
    console.log('Domain detection: Using LLM-based analysis for accurate domain identification');

    const estimatedTokens = estimateTokens(truncatedFullText) + estimateTokens(selectedText) + estimateTokens(articleSummary) + 150;
    console.log('Estimated input tokens:', estimatedTokens);
    if (estimatedTokens > 1200) {
        throw new Error('Input too long. Please select a shorter phrase or try on a simpler page.');
    }

    // Compose improved prompt with LLM-based domain awareness
    const prompt = `You are an expert explainer. Here is a summary of the article for context:
"""
${articleSummary}
"""

The user has highlighted the following word or phrase: "${selectedText}".

Here is the surrounding context from the article:
"""
${truncatedFullText}
"""

INSTRUCTIONS:
1. First, analyze the article content and context to determine the specific technical domain/field this article belongs to.
2. Then explain "${selectedText}" in a ${style.toLowerCase()} way, making sure your answer is SPECIFICALLY relevant to that identified domain.

CRITICAL: Do NOT give generic definitions. Analyze the context first to understand what specific domain this article covers, then explain the term ONLY as it relates to that domain.

CONTEXT ANALYSIS: Based on the article content and surrounding text, determine what specific technology, field, or domain this term belongs to, then explain it within that exact context.

${style === 'Simple' ? `
Simple Explanation:
- First identify the article's domain from context
- Explain like to a 10-year-old using simple words
- Use a relatable analogy that fits the article's specific domain
- Keep it short (20-100 words)
- Format: Definition (specific to this article's exact context), example, why it matters in this domain
` : `
Technical Explanation:
- First identify the article's domain from context
- Provide a detailed, precise explanation specific to the article's exact domain
- Use technical terms appropriate to the specific context
- Include context from the article
- Format: Definition (domain-specific), implementation details, role in the specific system described
`}`;

    // OpenRouter API integration
    const apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
    const outputTokenSteps = [1024, 768, 512];
    let lastError;
    for (let i = 0; i < outputTokenSteps.length; i++) {
        try {
            if (!apiKey || !apiKey.startsWith('sk-or-')) {
                throw new Error('Invalid or missing OpenRouter API key. Please set a valid key in the extension settings.');
            }
            if (!modelName || typeof modelName !== 'string') {
                throw new Error('Model name not set. Please set it in the extension settings.');
            }
            const payload = {
                model: modelName,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: outputTokenSteps[i],
                temperature: style === 'Technical' ? 0.3 : 0.7
            };

            // Debug log for API request
            console.log('API Request Headers:', {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            });
            console.log('API Request Payload:', payload);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 45000);

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // Ensure response body is read only once
            const responseText = await response.text();
            console.log('API Response:', responseText);

            if (!response.ok) {
                throw new Error(`API Error: ${response.status} - ${responseText}`);
            }

            // Parse the response JSON only once
            const responseData = JSON.parse(responseText);
            return responseData;
        } catch (error) {
            lastError = error;
        }
    }
    console.error('API call failed:', lastError);
    throw lastError || new Error("The AI's response was cut short by the OpenRouter API. All output token limits failed. Try a shorter selection or simpler page.");
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Enhanced storage handling
    if (request.type === 'getStorage') {
        chrome.storage.sync.get(request.key, (result) => {
            if (chrome.runtime.lastError) {
                console.error('Error getting storage:', chrome.runtime.lastError);
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ value: result[request.key] });
            }
        });
        return true;
    }

    if (request.type === 'setStorage') {
        chrome.storage.sync.set({ [request.key]: request.value }, () => {
            if (chrome.runtime.lastError) {
                console.error('Error setting storage:', chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true });
            }
        });
        return true;
    }

    if (request.type === 'getExplanation') {
        (async () => {
            try {
                const { apiKey } = await chrome.storage.sync.get(['apiKey']);
                const { modelName } = await chrome.storage.sync.get(['modelName']);
                if (!apiKey) {
                    throw new Error('OpenRouter API Key not set. Please set it in the extension settings.');
                }
                if (!modelName) {
                    throw new Error('Model name not set. Please set it in the extension settings.');
                }

                const cacheKey = `${request.payload.selectedText}-${request.payload.style}-${modelName}`;
                const cached = explanationCache.get(cacheKey);

                if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
                    return sendResponse({ status: 'success', data: cached.data, cached: true });
                }

                const tabId = sender.tab.id;
                let results;
                try {
                    [results] = await chrome.scripting.executeScript({
                        target: { tabId },
                        func: getVisibleText,
                    });
                } catch (scriptError) {
                    console.error('Script execution failed:', scriptError);
                    throw new Error('Failed to access page content. Please refresh the page and try again.');
                }

                if (!results?.result) {
                    throw new Error('Could not extract text from the page. Please refresh and try again.');
                }

                const pageText = results.result;
                if (!pageText || typeof pageText !== 'string' || pageText.trim().length === 0) {
                    throw new Error('No readable content found on this page. Please try a different page.');
                }

                // Additional check for meaningful content
                if (pageText.includes('Unable to extract text') || pageText.includes('No content available')) {
                    throw new Error('This page does not contain readable text content. Please try a different page.');
                }

                const apiParams = {
                    apiKey,
                    modelName,
                    selectedText: request.payload.selectedText,
                    fullText: pageText.substring(0, 2000),
                    style: request.payload.style
                };

                // Directly call the API (no retry logic)
                const response = await callGeminiAPI(apiParams);

                // Extract the content from the OpenRouter API response
                const explanation = response.choices[0].message.content;

                const validatedExplanation = validateResponse(explanation, request.payload.style);

                explanationCache.set(cacheKey, {
                    data: validatedExplanation,
                    timestamp: Date.now()
                });

                sendResponse({
                    status: 'success',
                    data: validatedExplanation,
                    cached: false
                });

                return true;

            } catch (error) {
                console.error('Explanation error:', error);
                sendResponse({
                    status: 'error',
                    message: error.message || 'Unknown error',
                    details: error.stack // Include stack trace for debugging
                });

                return true;
            }
        })();

        return true;
    }
});