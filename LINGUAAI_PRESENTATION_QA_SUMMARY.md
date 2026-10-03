# LinguaAI Presentation Q&A Summary

This document contains 40 key questions and answers about the LinguaAI project, designed to help prepare for a graduation jury, teacher review, or project presentation.

---

### 1. What is LinguaAI?
LinguaAI is a multi-platform language learning application that helps users learn languages (like English, Turkish, German) using interactive lessons, AI coaching, spaced repetition flashcards, writing practice, and pronunciation scoring.

### 2. What problem does it solve?
It bridges the gap between structured learning (lessons, flashcards) and active communication (writing practice, pronunciation feedback, AI chat), providing real-time AI-based corrections without requiring expensive language tutors.

### 3. Who are the target users?
Language learners of all levels (Beginner to Advanced) who want a flexible, self-paced, and cost-effective mobile and web tool to practice reading, writing, and speaking.

### 4. Why did you choose React for the web app?
React is the industry standard for single-page applications. It has a rich component ecosystem, high performance via virtual DOM, and Vite allows near-instant dev-mode hot reloads.

### 5. Why did you choose Flutter for the mobile app?
Flutter allows building compiled native apps for both iOS and Android from a single codebase, drastically reducing development time while maintaining 60fps performance and access to native APIs.

### 6. Why did you choose NestJS for the backend?
NestJS is built on Node.js/Express but provides a strict, Angular-inspired modular structure. It enforces clean architecture, dependency injection, and has built-in support for guards, filters, and interceptors.

### 7. Why did you choose MongoDB over a SQL database?
NoSQL fits rapid prototyping. Language learning progress (e.g. tracking XP per language or lesson lists) is hierarchical and changes frequently; MongoDB document mapping easily adapts without migration downtime.

### 8. Why not use a SQL database?
While SQL is great for relational data, language progress datasets (like dynamic maps of XP per target language) require flat, JSON-like document models. NoSQL allows storing this data in nested maps without complex table joins.

### 9. Why did you use Gemini for the AI features?
Gemini (specifically `gemini-flash-latest`) is extremely fast, cost-effective, supports strict JSON output configuration, and handles language localization instruction prompts reliably.

### 10. What are the key AI features?
- **AI Coach**: A friendly chatbot correcting grammar and vocabulary on-the-fly.
- **Writing Practice**: An essay assessor providing granular grammatical scores and improved rewrites.
- **Pronunciation AI**: Gemini feedback explaining speech transcription errors.

### 11. How does the AI Coach work?
The backend intercepts user chat text, constructs a localized system instruction prompt, forwards it to the Gemini API requesting structured JSON, and returns the response containing conversation text and corrections.

### 12. How does the Writing Practice scoring work?
It asks Gemini to evaluate an essay based on a specific prompt topic. Gemini returns numeric scores (1-100) for grammar, vocabulary, and clarity, as well as a list of mistakes, feedback, and a polished rewrite.

### 13. How does the Pronunciation Practice work?
The user records audio, which is sent to the backend. The backend forwards it to the Python Whisper service to get a text transcription. The backend then calculates similarity score using Levenshtein distance and calls Gemini to write friendly feedback.

### 14. How does Whisper fit into your architecture?
Whisper acts as the Speech-to-Text transcriber. It runs locally as a FastAPI python service (`faster_whisper`), taking audio files and returning recognized text, which is then compared against the target lesson text.

### 15. Why not call Gemini directly from the frontend?
Calling external APIs directly from the frontend exposes private API keys to browsers. Having a NestJS backend act as a proxy keeps key secrets secure.

### 16. How is user data stored?
User profiles, password hashes, language progress mapping, community posts, and flashcards are persisted securely in MongoDB. Mobile settings are cached in native `SharedPreferences`.

### 17. How is progress stored?
Progress is logged in the `Progress` collection containing the completed `lessonId`, `userId`, `score`, and `targetLanguage` fields. Global and language-scoped XP are cached directly on the `User` schema.

### 18. How are completed lessons synchronized?
When a user completes a lesson on either client, it posts to `/progress/:userId/complete-lesson`. The backend updates the database. The next time the other client launches, it queries progress and updates its local cache.

### 19. How does the app work offline?
The mobile app stores progress and flashcard lists in `SharedPreferences`. If the device is offline, users can review cached cards, view cached lessons, and record progress locally.

### 20. What happens without internet?
- **Web**: Access is blocked unless assets are cached.
- **Mobile**: Runs using local caches. AI features are disabled, and lessons can be read but writing/chat actions show connection warnings.

### 21. What happens if Gemini fails or is rate-limited?
The backend intercepts connection errors or rate-limit codes (429/503) and falls back to pre-defined friendly responses to prevent frontend crashes.

### 22. What happens if MongoDB fails?
The backend responds with `500 Database Error` codes. The mobile client falls back to reading/writing progress locally in cache until the database comes back online.

### 23. How is mobile synchronized with the web?
Both query the same REST endpoints. On login or app startup, the local cache is updated with the latest progress from the backend database (the single source of truth).

### 24. How do you prevent users from accessing other users' data?
A custom NestJS guard (`JwtAuthGuard`) validates incoming JWT bearer tokens. Endpoints check that `req.user.id` matches the query's `userId`. If not, it throws a `403 ForbiddenException`.

### 25. How are community posts stored?
In the `CommunityPost` collection. To prevent stale names if a user updates their profile, usernames are dynamically populated from the `User` collection in batches during feed queries.

### 26. How are images uploaded?
Images are uploaded as multipart form-data. The backend saves them to `./uploads/community` using Multer storage and serves them statically via Express.

### 27. How does dark mode persist?
On the web, it is saved in browser `localStorage`. On mobile, it uses native `SharedPreferences`. The theme providers read these values on initial startup.

### 28. How does localization work?
Language keys are translated using localized JSON files (English & Turkish) managed by a global context/provider (`LanguageContext` on web, `LanguageService` on mobile).

### 29. What is the difference between interfaceLanguage and targetLanguage?
- **interfaceLanguage**: The language of the UI buttons, menus, and AI explanations (e.g., Turkish).
- **targetLanguage**: The language the user is actively practicing and learning (e.g., English).

### 30. Why should progress be separate for each target language?
Learning metrics (XP, level) must represent a user's skill in that specific language. Mixing English progress with German progress would corrupt their actual vocabulary/lesson stats.

### 31. What were the biggest technical challenges?
- Implementing language-scoped progress maps in Mongoose.
- Building audio record/convert streams on mobile to match Whisper file format constraints.
- Structuring strict JSON returns from Gemini API calls.

### 32. What are the current limitations of the project?
- Offline writes (like new cards created offline) do not upload automatically when returning online.
- Image uploads are stored locally on the server instead of a cloud storage bucket.
- Single shared guest account can lead to data mixing.

### 33. What would you improve later?
- Add cloud-based asset storage (AWS S3) for uploads.
- Move local Whisper processing to external GPU-based transcription endpoints.
- Support offline writes queue sync.

### 34. How scalable is the app in its current state?
Right now, it easily supports classroom scales (1-100 users). For enterprise scale, the CPU-bound Python Whisper service and Gemini rate limits would require load balancing.

### 35. How many users can it support approximately?
- **With current CPU local setup**: ~50 concurrent users.
- **With GPU Whisper and Redis caching**: 10,000+ users.

### 36. Where can latency happen?
- Whisper audio transcribing on CPU: 2-6 seconds.
- Gemini AI response generation: 1.5-3.5 seconds.

### 37. How would you deploy it?
- **Backend/FastAPI**: Render, AWS Elastic Beanstalk, or Docker on DigitalOcean.
- **Frontend**: Vercel, Netlify, or AWS S3 + CloudFront.
- **Database**: MongoDB Atlas.

### 38. How would you test it?
- **Backend**: Jest unit tests and Supertest E2E tests.
- **Frontend**: React Testing Library and Cypress/Playwright integration tests.
- **Mobile**: Flutter widget and integration tests.

### 39. What security improvements are needed?
- Implement rate limiting (NestJS Throttler).
- Replace wildcard CORS settings with a specific domain whitelist.
- Sanitize inputs against MongoDB injection.

### 40. What makes this project useful?
It provides a highly interactive, gamified, and multi-platform language learning experience that combines standard grammar curricula with actual voice and writing AI feedback.
