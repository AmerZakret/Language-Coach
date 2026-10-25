# LinguaAI

LinguaAI is a modern full-stack language learning application designed to help users master English (or other languages) through interactive lessons, quizzes, progress tracking, writing/speaking practice, and an AI-powered conversational coach, featuring robust cross-platform synchronization and owner-scoped offline progress/flashcard support and bounded online mutation recovery.

## Project Overview
The project is split into four main components:
1. **lingua_ai**: Flutter mobile application (iOS/Android).
2. **lingua_ai_web**: React + Vite web frontend serving as a responsive web dashboard.
3. **lingua_ai_backend**: NestJS backend providing RESTful APIs, MongoDB database interaction, and Gemini AI integration.
4. **lingua_ai_pronunciation_service**: Python FastAPI service running Whisper for audio transcription and pronunciation analysis.

## Technologies Used
- **Mobile**: Flutter, Dart, native checksummed FileSyncStorage, SharedPreferences caches, connectivity_plus
- **Web Frontend**: React, Vite, TypeScript, CSS (Vanilla), Axios, Lucide React
- **Backend**: NestJS, TypeScript, Mongoose, JWT Passport authentication
- **Pronunciation Engine**: Python, FastAPI, faster-whisper (Whisper model)
- **Database**: MongoDB transaction-capable replica set
- **AI Engine**: Google Gemini API

## Folder Structure
```
Language-Coach/
 ├── lingua_ai/                       # Flutter mobile app source code
 ├── lingua_ai_backend/               # NestJS backend API source code
 ├── lingua_ai_web/                   # React web frontend source code
 ├── lingua_ai_pronunciation_service/ # Python FastAPI pronunciation service
 ├── PROJECT_OVERVIEW.md              # Detailed architecture and planning documentation
 ├── OFFLINE_BEHAVIOR.md              # Documentation of local caching and offline behavior
 ├── README.md                        # This documentation
 └── .gitignore                       # Root git ignore file
```

## Security Note
**API Keys & Secrets**: The Gemini API key and MongoDB connection strings MUST be kept secret. Development may use an ignored backend `.env`; production receives secrets through external configuration. The `.env` file is ignored by version control. The web and mobile frontends do not communicate directly with the database or Gemini APIs; all requests are securely proxied through the NestJS backend.

## Environment Variables
To run the backend locally, you must create a `.env` file inside the `lingua_ai_backend` directory (you can copy `.env.example`). Required variables:

- `PORT` (e.g., 3000)
- `MONGODB_URI` (Explicit MongoDB URI; transactions require a replica set)
- `JWT_SECRET` (Your JWT secret key for auth)
- `NODE_ENV` (e.g., development)
- `GEMINI_API_KEY` (Your Google Gemini API key)
- `GEMINI_MODEL` (e.g., gemini-flash-latest)

## How to Run

For complete component test commands and disposable test infrastructure, see
[Local test baseline](TESTING.md).

### 1. Run the NestJS Backend
```bash
cd lingua_ai_backend
npm ci
npm run start:dev
```
The backend will run on `http://localhost:3000`.

### 2. Run the React Web App
Make sure the backend is running first.
```bash
cd lingua_ai_web
npm ci
npm run dev
```
The web app will run on `http://localhost:5173`.

### 3. Run the Flutter Mobile App
Make sure the backend is running first.
```bash
cd lingua_ai
flutter pub get
flutter run
```

### 4. Run the Python Whisper Pronunciation Service
```bash
cd lingua_ai_pronunciation_service
python -m venv venv
# On Windows (PowerShell):
.\venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```
The pronunciation service will run on `http://localhost:8001`.
This command is development-only. Configure a separate
`PRONUNCIATION_SERVICE_TOKEN` in both backend and Python service, or explicitly
enable `PRONUNCIATION_ALLOW_INSECURE_LOCAL=true` only on a loopback development
service. Model downloads require explicit development opt-in. For production use
the [internal service deployment guide](lingua_ai_pronunciation_service/README.md).

## Production operations

Production operators: use the [deployment and recovery runbooks](PRODUCTION_RUNBOOKS.md)
with the [configuration contract](PRODUCTION_CONFIGURATION.md). The local backend
`npm run preflight:deploy` is read-only and does not prove production readiness.

## Screenshots

*(Add screenshots of the web dashboard, mobile app, and AI chat interface here)*

## Release packaging

See [Release packaging and checklist](RELEASE_PACKAGING.md) for artifact allowlists,
source-map policy, validated toolchains, build/version metadata and operator-only
identity/signing/configuration requirements.
