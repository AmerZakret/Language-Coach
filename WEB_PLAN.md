# LinguaAI Web Application Plan

This document outlines the strategy and architecture for the new LinguaAI web frontend.

---

## 1. Technology Choice: React + Vite + TypeScript

Initially, the project considered using Flutter Web to maximize code reuse. However, the architecture has been updated to use a separate React web frontend.

**Why we changed from Flutter Web to a separate React web frontend:**
While Flutter Web is great for porting mobile apps quickly, building a dedicated React application provides several distinct advantages for web development. React offers superior performance for web-specific DOM rendering, better SEO capabilities, faster initial load times compared to Flutter's canvas-based rendering, and access to a massive ecosystem of web-native UI libraries and tools.

**Why React + Vite + TypeScript is a good choice:**
- **React:** The industry standard for building robust, scalable web interfaces with a component-based architecture.
- **Vite:** Provides extremely fast Hot Module Replacement (HMR) and optimized build times, making the developer experience much smoother than traditional bundlers like Webpack.
- **TypeScript:** Adds static typing to JavaScript, catching errors at compile time and improving code maintainability and auto-completion.

---

## 2. Architecture and Connectivity

The new architecture introduces a clear separation of concerns with a dedicated web client:

```text
Language-Coach/
 ├── lingua_ai/              # Flutter mobile app
 ├── lingua_ai_backend/      # NestJS backend
 ├── lingua_ai_web/          # NEW: React web frontend
 ├── PROJECT_OVERVIEW.md
 └── WEB_PLAN.md
```

### Backend Connection & Security
- **Connecting to the same NestJS backend:** The React web app will connect to the exact same NestJS backend APIs as the Flutter mobile app. It will use standard HTTP requests (e.g., via `axios` or native `fetch`) to interact with endpoints like `/auth`, `/lessons`, `/progress`, and `/ai-coach/chat`.
- **MongoDB Access:** The web frontend **must never** access the MongoDB Atlas database directly. All database operations will be securely handled through the backend endpoints to maintain security and business logic integrity.
- **Gemini API Security:** Just like the mobile app, the web frontend will never store or use the Google Gemini API key. The API key remains strictly in the backend `.env` file. The React app will interact with the AI solely by sending requests to the backend, which acts as a secure intermediary.

---

## 3. Web Application Features

The React web app should include the following core features, mirroring the mobile app's capabilities:
- **Login/Register:** Secure user authentication interfacing with the backend.
- **Dashboard/Home:** A central hub showing user progress, streak, and recent activity.
- **Lessons:** A categorized list of available language lessons.
- **Lesson Quiz:** Interactive quiz interface for completing lessons.
- **Progress/Profile:** User statistics, level, and settings.
- **AI Coach:** Interactive chat with the Gemini-powered language tutor.
- **English/Turkish UI switch:** Full internationalization support for switching the interface language.

---

## 4. Web-Specific UI Ideas

To take advantage of larger desktop screens, the web UI will differ from the mobile app to provide a better user experience:
- **Sidebar Navigation:** Instead of a bottom navigation bar, a permanent left-hand sidebar will provide easy access to all sections of the app.
- **Dashboard Cards:** The Home and Profile screens will use a grid layout with informative cards (e.g., stats, streak, achievements) displayed side-by-side.
- **Wide Lesson Layout:** A split-pane design where the lesson list is on one side, and the active lesson content or quiz is displayed prominently in a wider main area.
- **Chat-style AI Coach Page:** A dedicated, centered chat interface for the AI Coach, similar to popular web messaging apps (like WhatsApp Web or ChatGPT), utilizing the extra screen width comfortably without stretching text too far.

---

## 5. Proposed Folder Structure for `lingua_ai_web`

When initialized, the React project should follow a clean, feature-based directory structure:

```text
lingua_ai_web/
├── src/
│   ├── assets/          # Static files (images, icons)
│   ├── components/      # Reusable UI components (buttons, inputs, cards)
│   ├── contexts/        # React context providers (Auth, Theme, Language)
│   ├── hooks/           # Custom React hooks
│   ├── pages/           # Main page components (Login, Dashboard, Lessons, AICoach)
│   ├── services/        # API calls to NestJS backend
│   ├── types/           # TypeScript interfaces and types
│   ├── utils/           # Helper functions
│   ├── App.tsx          # Main application component and routing
│   └── main.tsx         # Entry point
├── public/              # Public web assets
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

*(Note: No web app code is being written at this stage. This document serves purely as the architectural plan for the future web frontend. The mobile app and backend code remain untouched by this plan.)*
