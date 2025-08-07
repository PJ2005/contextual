# Contributing to Contextual

Thank you for your interest in contributing! Contextual is an AI-powered Chrome extension that provides instant, context-aware explanations for highlighted text using OpenRouter models.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [How to Set Up Locally](#how-to-set-up-locally)
- [Development Workflow](#development-workflow)
- [Coding Guidelines](#coding-guidelines)
- [Testing](#testing)
- [Submitting Issues](#submitting-issues)
- [Submitting Pull Requests](#submitting-pull-requests)
- [Code of Conduct](#code-of-conduct)

---

## Project Overview

Contextual consists of several components:

- **content.js**: Injected into every page, manages selection detection and UI triggers.
- **background.js**: Service worker, handles API calls, caching, and communication.
- **explanation.js / explanation.html**: Sidebar UI for explanations.
- **popup.js / popup.html**: Extension settings/configuration popup.
- **styles.css, explanation.css, popup.css**: UI styling.
- **showdown.min.js**: Markdown rendering for explanations.

---

## Architecture

- **Chrome Extension (Manifest v3)**
- Uses [OpenRouter](https://openrouter.ai/) for AI explanations.
- Communication between content scripts, background, and UI via Chrome messaging and postMessage.
- Caching and rate-limiting for API calls.
- Privacy: API keys stored locally, never sent to third parties.

---

## How to Set Up Locally

1. **Clone the repository**
   ```bash
   git clone https://github.com/PJ2005/contextual.git
   cd contextual
   ```

2. **Load into Chrome**
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `contextual` folder

3. **Configure**
   - Click the extension icon in Chrome
   - Enter your OpenRouter API key and preferred model

---

## Development Workflow

- Make changes in the appropriate JS/HTML/CSS files.
- Reload the extension in Chrome after each change.
- Use the browser console (`F12`) for debugging.
- For API-related changes, check the [OpenRouter API docs](https://openrouter.ai/docs).

---

## Coding Guidelines

- **Use ES6+ syntax** (let/const, arrow functions, async/await).
- **Keep UI responsive**: Use debouncing for event handlers.
- **Error handling**: Always handle errors gracefully and provide user feedback.
- **No tracking**: Do not add analytics or tracking code.
- **Respect privacy**: Never transmit API keys or user data externally.
- **Linting**: Use consistent formatting (2 or 4 spaces, no trailing whitespace).

---

## Testing

- Manual testing: Select text on various web pages and verify explanations.
- Test both "Simple" and "Technical" modes.
- Check error handling (invalid API key, no content, long selections).
- Use Chrome console for logs and debugging.

---

## Submitting Issues

- Use [GitHub Issues](https://github.com/PJ2005/contextual/issues).
- Include clear steps to reproduce, screenshots, and error messages.
- Tag issues as `bug`, `feature`, or `question`.

---

## Submitting Pull Requests

1. Fork the repository and create a new branch.
2. Make your changes with clear commit messages.
3. Test your changes locally.
4. Submit a PR with a description of what you changed and why.
5. Reference related issues if applicable.

---

## Code of Conduct

Be respectful, constructive, and inclusive. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) if available.

---

## Questions?

Open an issue or contact the maintainer via GitHub.

---
