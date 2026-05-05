# LinguaAI Project Overview

Welcome to the **LinguaAI** project documentation. LinguaAI is a modern language learning application designed specifically for Turkish users aiming to learn and practice English. 

This document serves as the central source of truth for the project's architecture, data flows, security decisions, and roadmap.

---

## 1. System Architecture

LinguaAI is built using a modern, decoupled client-server architecture to ensure scalability, security, and a seamless user experience.

- **Flutter Mobile App (Frontend):** 
  The cross-platform mobile application providing the core user interface. It handles user interactions, local state management (via `SharedPreferences` and `ChangeNotifier`), and caching to provide offline capabilities.
  
- **NestJS Backend (API Server):** 
  A robust Node.js backend built with the NestJS framework. It serves as the secure middleman between the frontend, the database, and third-party APIs. It handles routing, validation, and business logic.
  
- **MongoDB Atlas (Database):** 
  A cloud-hosted NoSQL database used to store persistent user data, lesson content, progress tracking, and AI Coach conversation history.
  
- **Google Gemini AI API:** 
  The generative AI engine powering the "AI Coach" feature. It provides grammar corrections, conversational practice, and tailored learning tips.
  
- **Future Web App:** 
  A planned responsive web frontend (likely built with modern web frameworks) that will connect to the existing NestJS backend, allowing users to practice across multiple platforms.

---

## 2. Core Data Flows

### Login / Register Flow
1. The user enters their credentials in the Flutter app.
2. The app sends a POST request to the NestJS backend (`/auth/login` or `/auth/register`).
3. The backend validates the input, authenticates the user, and returns a JSON response (along with dummy tokens for now).
4. The Flutter app saves the session data locally in `SharedPreferences` to keep the user logged in across app restarts.

### Lesson Loading
1. The Flutter app requests the lesson catalog from the NestJS backend via a GET request (`/lessons`).
2. The backend fetches the lessons from MongoDB and returns them to the app.
3. The app caches these lessons or relies on local dummy data if the backend is unreachable.

### Lesson Completion & Progress Sync
1. When a user completes a lesson, the Flutter `ProgressService` immediately updates the UI locally.
2. The `ProgressApiService` asynchronously sends a POST request (`/progress/:userId/complete-lesson`) to the backend.
3. The backend updates the user's progress record in MongoDB (e.g., adding XP, updating streaks).
4. If the backend is offline, the app retains the progress locally until the next successful sync.

### AI Coach Message Flow
1. The user types an English sentence into the AI Coach screen in Flutter.
2. The Flutter app sends a POST request to the NestJS backend (`/ai-coach/chat`) containing the user's ID, message, and preferred UI language.
3. The backend receives the request, injects a system prompt instructing the AI to act as a supportive English teacher, and forwards the request to the Google Gemini API.
4. Gemini processes the text, generates a conversational reply, and formulates a grammar correction if necessary.
5. The backend receives Gemini's response, saves the entire interaction to MongoDB (for conversation history), and returns the parsed JSON to Flutter.
6. Flutter displays the AI's response and any grammar corrections directly in the chat UI.

---

## 3. Security: Why the AI API Key is Backend-Only

A critical architectural decision was made to **never** store the Google Gemini API key inside the Flutter application. 

If an API key is bundled into a mobile app, malicious users can extract it by reverse-engineering the APK/IPA file, leading to unauthorized usage, data breaches, and massive financial bills. 

By keeping the Gemini API key safely tucked away in the NestJS backend's `.env` file, the Flutter app simply asks the backend to communicate with the AI. The backend securely holds the keys, validates all incoming traffic, and enforces rate limits and safety rules before ever talking to Gemini.

---

## 4. Offline Fallback & Resilience

LinguaAI is designed to be forgiving of poor network conditions:

- **SharedPreferences:** Used extensively to store the user's session, selected language, and local progress.
- **Local Progress Backup:** If the backend is offline, the `ProgressService` still grants the user XP and unlocks the next lesson visually.
- **Dummy Lessons Fallback:** If the app cannot fetch live lessons from the server on startup, it seamlessly falls back to a hardcoded local list of dummy lessons so the user is never stuck on an empty screen.
- **Graceful Error Handling:** If the AI Coach cannot reach the backend, the user sees a friendly, localized "Cannot communicate right now" message rather than an app crash.

---

## 5. Language Support & Localization

LinguaAI is explicitly tailored for Turkish speakers learning English:
- **English Target:** The core curriculum and AI practice revolve around mastering the English language.
- **UI Localization (English / Turkish):** The user can seamlessly toggle the entire application's interface between English and Turkish. This is managed by the local `LanguageService`.
- **Bilingual AI Coach:** When the UI is set to Turkish, the AI Coach is instructed to provide grammar explanations and error feedback in Turkish, ensuring beginner students fully understand their mistakes.

---

## 6. Current Implemented Features

- [x] **Modular Flutter Architecture:** Clean separation of UI, Services, and Theming.
- [x] **Authentication Flow:** Login, Registration, and Guest mode support.
- [x] **Home Dashboard:** Displays current XP, streak, and daily progress goals.
- [x] **Lesson System:** Categorized vocabulary and grammar lessons with local fallback support.
- [x] **Progress Tracking:** XP accumulation and lesson completion states synced between local storage and the backend.
- [x] **Profile Management:** Displays user stats, ranks, and allows localized language switching.
- [x] **AI Coach Integration:** Full-stack integration with Google Gemini for real-time conversational practice and grammar correction.
- [x] **MongoDB Integration:** Persistent storage for users, lessons, chat history, and progress.

---

## 7. Future Roadmap

- [ ] **Web Application:** Build a responsive web client using Next.js/React to complement the mobile app.
- [ ] **Production Authentication:** Replace the current dummy tokens with real JWT-based authentication and secure password hashing (e.g., bcrypt).
- [ ] **Expanded Curriculum:** Populate the database with hundreds of structured lessons across different CEFR levels (A1 to C2).
- [ ] **Speech & Pronunciation:** Integrate speech-to-text (STT) and text-to-speech (TTS) so users can practice speaking directly to the AI Coach.
- [ ] **Admin Panel:** Create a content management dashboard for administrators to easily add, edit, or remove lessons without modifying code.
