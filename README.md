# PriceWatch 🛒

**PriceWatch** is a professional shopping companion designed to help users make informed purchasing decisions through data-driven insights. It integrates real-time price tracking, cross site product comparison, and AI-powered sentiment analysis into a seamless browser experience, providing a unified interface for smarter online shopping across supported e-commerce platforms.

---

## ✨ Key Features

- **Intelligent Price Monitoring**: Select any product and set your target price. The system monitors the product in the background across supported e-commerce sites.
- **Automated Notifications**: Periodically checks prices and instantly notifies you when the price reaches or falls below your specified target.
- **Cross-Site Price Comparison**: View prices from different platforms in a single interface to ensure you're getting the best possible value.
- **AI-Based Review Summarization**: Advanced analysis of customer feedback that presents key advantages, disadvantages, and overall sentiment at a glance.
- **Enhanced Shopping Experience**: Reduces manual effort by automating the search and comparison process, making online shopping more efficient.

---

## 🏗️ Architecture & Tech Stack

The system is composed of three specialized services working in harmony:

### 1. Chrome Extension (`/extension`)
- **Framework**: React 19 + Vite 7
- **Styling**: Premium Vanilla CSS (custom design system)
- **Logic**: Content Scripts for scraping, Background Service Workers for monitoring.

### 2. Backend API (`/backend`)
- **Runtime**: Node.js (Express.js)
- **Functions**: User authentication, product data persistence, and alert management.

### 3. AI Service (`/ai-service`)
- **Runtime**: Python 3.9+
- **Functions**: Natural Language Processing (NLP) for review sentiment analysis.

---

## 📁 Project Structure

```text
PriceWatch/
├── extension/          # Browser logic and Popup UI
│   ├── public/         # Manifest, Content Scripts, Background Workers
│   ├── src/            # React Source (Popup Interface)
│   └── dist/           # Compiled extension (ready for Chrome)
├── backend/            # Express REST API
├── ai-service/         # Python Analytics scripts
└── README.md           # The ultimate source of truth
```

---

## 🚀 Installation & Setup

### 1. Backend Setup
```bash
cd backend
npm install
# Ensure you have your .env configured
npm start
```

### 2. AI Service Setup
```bash

```

### 3. Extension Setup & Build
```bash
cd extension
npm install
npm run build 
```

---

## 🛠️ Development Workflow

### Building and Watching
The extension includes a custom Vite pipeline that handles the complex task of bundling React while syncing extension-specific files.

- **One-Time Build**: `npm run build`
- **Watch Mode (Best for Dev)**: `npm run watch` (Auto-rebuilds and syncs files on every save).

### Loading into Chrome
1. Navigate to `chrome://extensions/`
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `extension/dist` folder.

### File Editing Guide
| To change the... | Edit files in... |
| :--- | :--- |
| **Popup Interface** | `extension/src/` |
| **Scraping Logic** | `extension/public/content.js` |
| **Background Tasks** | `extension/public/bg.js` |
| **Server Logic** | `backend/` |
| **AI/Sentiment** | `ai-service/` |

---

