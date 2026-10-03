# LinguaAI — Offline Capabilities Document

This document explains the design, behavior, and capabilities of the LinguaAI Web and Mobile applications when running in offline mode.

---

## 1. Feature Classification

To ensure a high-quality user experience without active internet connection, LinguaAI categorizes its features into two main classifications:

### 🟢 Offline-Friendly (Fully Supported Offline)
These features allow reading cached data and queueing actions locally to be synchronized later.
*   **Curriculum & Lessons**: Fetch and play lessons from the local cache. Track completions and XP locally.
*   **Flashcards**: View card decks, create new cards, update, review (calculates spaced repetition scheduling locally using SM-2 algorithm), and delete cards.
*   **Progress Stats**: View XP, level, streak count, and weekly activity based on locally cached statistics.
*   **Community Feed**: Read cached posts fetched during the last active session.

### 🔴 Online-Only (Locked/Blocked Offline)
These features require real-time processing from the backend server or AI services and are blocked when offline.
*   **AI Coach Chat**: Real-time conversation with the Gemini-powered language coach.
*   **Writing Practice Assessment**: Grading and grammar corrections from the AI.
*   **Pronunciation Practice Assessment**: Speech-to-text validation and pronunciation analysis.
*   **Community Actions**: Creating new posts, editing existing posts, deleting posts, or liking posts.

---

## 2. User Experience in Offline Mode

### Web App Dashboard
*   **Sticky Global Warning Banner**: Appears immediately below the main header notifying the user that they are viewing cached data offline.
*   **Page Overlays**: Visiting the AI Coach, Writing Practice, or Pronunciation Practice screens renders a full-page "Connection Required" overlay.
*   **Disabled Actions**: The post creation form and like buttons on the Community Feed are hidden or disabled.

### Mobile App (Flutter)
*   **Top Alert Banner**: A colored banner slides in under the AppBar when connection is lost.
*   **Empty State Layouts**: The AI Coach, Writing, and Pronunciation screens display a friendly icon (`wifi_off`), title, and explanation message, blocking all form submissions.
*   **Disabled Community Operations**: The post composer card is hidden, like buttons display warning SnackBars upon tapping, and popup menus for editing/deleting posts are blocked.

---

## 3. Data Syncing & Queueing Mechanism

LinguaAI does not lose progress made offline. When offline mutations occur, they are managed chronologically in a local queue:

1.  **Queueing**: Completing lessons or managing flashcards offline instantly updates the local interface for maximum responsiveness, while the exact action is saved to the offline queue (`localStorage` on Web, `SharedPreferences` on Mobile).
2.  **Reconnection Check**: Once the app detects that internet is restored, it triggers the synchronization worker.
3.  **Conflict & ID Mapping Resolution**: 
    *   Offline-created cards use temporary IDs (e.g. `local_1717900000`).
    *   Upon syncing `create-flashcard`, the backend saves the card and returns its official MongoDB ObjectId.
    *   The sync worker maps the temporary ID to the new database ID and rewrites subsequent queued actions (updates, reviews, deletes) that reference that card, maintaining integrity.
4.  **Concurrency Lock**: Mobile execution uses an asynchronous `_isProcessing` lock to prevent multiple services from trying to drain the queue at the same time.
