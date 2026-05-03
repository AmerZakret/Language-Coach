# LinguaAI Backend API

A clean NestJS backend for the LinguaAI English learning application.

## Getting Started

1.  **Install dependencies**:
    ```bash
    npm install
    ```
2.  **Configure environment**:
    Copy `.env.example` to `.env` and update your `MONGODB_URI`.
3.  **Start development server**:
    ```bash
    npm run start:dev
    ```

## API Endpoints

### 1. Health & System
*   **GET `/health`**: Returns system status and timestamp.

### 2. Authentication
*   **POST `/auth/register`**: Register a new user.
    *   Body: `{ "name": "John Doe", "email": "john@example.com", "password": "securepassword" }`
*   **POST `/auth/login`**: Login and receive a token.
    *   Body: `{ "email": "john@example.com", "password": "securepassword" }`

### 3. Lessons
*   **GET `/lessons`**: Get a list of all 8 beginner lessons.
*   **GET `/lessons/:id`**: Get full lesson details including questions.

### 4. User Progress
*   **GET `/progress/:userId`**: Get XP, streak, and completed lessons for a user.
*   **POST `/progress/:userId/complete-lesson`**: Mark a lesson as finished.
    *   Body: `{ "lessonId": "1", "score": 100 }`

### 5. AI Coach
*   **POST `/ai-coach/chat`**: Send a message to the AI Coach.
    *   Body: `{ "userId": "uuid", "message": "How are you?" }`
    *   Note: Currently returns a placeholder response; real AI integration coming soon.

## Tech Stack
*   **Framework**: NestJS
*   **Language**: TypeScript
*   **Database**: MongoDB (Mongoose)
*   **Validation**: class-validator
