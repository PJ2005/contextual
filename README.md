# Contextual - AI-Powered Explanations

Tired of switching tabs to look up complex terms while reading online? **Contextual** is a Chrome extension that brings instant, AI-powered explanations directly to your workflow. Highlight any word or phrase on a webpage, and get a context-aware explanation from OpenRouter's AI models without ever leaving the page.

## The Idea

Imagine you're reading a technical article and encounter a complex concept. Instead of interrupting your flow to search for it, you could simply highlight the text. Contextual understands the surrounding content and provides an explanation in a convenient sidebar, tailored to your needs—whether you want a simple summary or a detailed technical breakdown. It's like having an instant, context-aware chatbot embedded in your browser.

## Features

*   **Instant Explanations:** Get immediate definitions and explanations for any text you highlight.
*   **Context-Aware:** The extension analyzes the entire page to provide explanations that are relevant to the article you're reading.
*   **Customizable Styles:** Choose between a **Simple** explanation for a quick overview or a **Technical** one for a more in-depth understanding.
*   **Seamless Workflow:** A discreet icon appears next to your selection, opening a non-intrusive sidebar that doesn't disrupt your reading.
*   **Powered by OpenRouter:** Leverages the power of OpenRouter's AI models for high-quality, intelligent responses.
*   **Privacy First:** Your API key is stored securely and locally on your browser.

## How to Use

### 1. Installation

Since this is a local development version, you can load it into Chrome as follows:

1.  Clone or download this repository to your local machine.
2.  Open Google Chrome and navigate to `chrome://extensions`.
3.  Enable the **"Developer mode"** toggle in the top-right corner.
4.  Click the **"Load unpacked"** button and select the folder where you saved the repository.

### 2. Setup

Before you can use the extension, you need to add your own OpenRouter API key and model name:

1.  Click the Contextual extension icon in your Chrome toolbar (it looks like a stylized 'C').
2.  A popup will appear. Paste your OpenRouter API key into the input field. (You can get a free key from [OpenRouter](https://openrouter.ai/)).
3.  Enter the model name you want to use (e.g., `deepseek/deepseek-chat-v3-0324`). You can find available models at [OpenRouter Models](https://openrouter.ai/models).
4.  Click **"Save"**.

### 3. Getting Explanations

1.  Navigate to any webpage and find a piece of text you want to understand better.
2.  **Highlight the text** with your mouse.
3.  A small, circular icon will appear next to your selection. **Click it**.
4.  A sidebar will open on the right with the explanation. You can switch between "Simple" and "Technical" styles at the top of the sidebar.

## How It Works

*   **Content Script (`content.js`):** Detects text selections on the page and injects the trigger icon.
*   **Sidebar (`sidebar.js`):** An iframe that displays the UI for the explanation, allowing you to switch styles.
*   **Background Service Worker (`background.js`):** Acts as the brain. It receives the selected text from the sidebar, scrapes the full page content for context, and makes the secure API call to the OpenRouter API (using your chosen model). It also includes a simple caching layer to prevent redundant API calls.

## License

This project is licensed under the terms of the LICENSE file.
