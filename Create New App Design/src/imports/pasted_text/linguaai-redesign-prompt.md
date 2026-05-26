LinguaAI - UI/UX Redesign Prompt for Figma AI
Context & Goal: I am redesigning my language-learning web application, LinguaAI. I am providing screenshots of the current UI, but I want a completely fresh, premium, and modern redesign. The app is a gamified, AI-powered language tutor (similar to Duolingo but more professional and AI-integrated). The aesthetic should be modern, sleek, and highly engaging.

Below is a comprehensive breakdown of every single page, feature, and component in the application. Please use this information, along with the provided screenshots, to design a full UI kit and responsive screens for this web app.

1. Global Layout & Navigation
The application uses a standard dashboard layout with three main structural elements:

Sidebar (Left): Primary navigation containing links to Dashboard, Lessons, Writing Practice, AI Coach, Flashcards, and Profile. It should have a logo at the top and clearly show the active state.
Topbar (Top): Contains quick stats and actions. It includes a badge showing the currently learned "Target Language" (e.g., 🇩🇪 German), an XP/Streak counter (e.g., ⚡ 450 XP), a dropdown to toggle the App Interface Language, and the User Profile avatar/name.
Main Content Area: The scrollable area where the page content lives. It should have consistent padding and a max-width for readability.
2. Page-by-Page Breakdown
A. Authentication Pages (Login & Register)
Elements: App Logo, Title, Subtitle, Email/Password inputs, "Login/Register" primary CTA, "Continue as Guest" secondary button, and a link to toggle between Login and Register.
Vibe: Clean, focused, and welcoming.
B. Dashboard (Home)
The central hub for the user's daily learning.

Welcome Header: "Welcome back, [Name] 👋" with a subtitle "Keep learning [Language] today". Includes a prominent flag/badge of the target language.
Quick Add Flashcard: A small inline component to quickly add a word and its translation to the deck.
Stats Grid: 4 cards showing current stats: XP, Level, Streak (days), and Completed Lessons.
Progress Card: A visual progress bar showing how close the user is to the next level (e.g., XP: 450 / 500).
Recommended Action: A prominent "Continue Learning" card showing the next incomplete lesson with a "Start" CTA.
Lesson Categories: Grids of lesson cards grouped by difficulty (Beginner, Elementary, etc.). Each card shows Title, XP Reward, Duration, and a checkmark if completed.
C. Lessons Curriculum Page
Header: Title and current target language.
Curriculum View: Sections grouped by level (Beginner, Elementary, Pre-Intermediate).
Level Headers: Show the title, a short description ("Build core grammar"), and a progress bar of completed vs. total lessons in that tier.
Lesson Cards: Need to show difficulty badge, category, lock state (if previous levels aren't finished), completion state, title, description, time to complete, XP reward, and number of questions.
D. Lesson Quiz Interface (Active Learning)
Header: Back button, and a progress bar showing current question out of total (e.g., "Question 2 of 5").
Question Area: Question type indicator (e.g., "Translate this sentence", "Fill in the blank") and the actual question text.
Options: Multiple-choice buttons. They need distinct states: Default, Hover, Selected, Correct (Green with check icon), and Incorrect (Red with X icon).
Feedback Popup: A bottom sheet or toast that appears after an answer is selected, showing "Correct/Incorrect", the right answer if they failed, and a "Next" button.
Results Screen: Appears at the end. Shows a Trophy icon, a motivational message ("Excellent!"), the score (e.g., 4/5), XP earned, and a "Continue" button.
E. AI Coach (Chatbot)
Header: Title, "Practicing: [Language]" badge, and a "Clear Chat" button.
Empty State: If no messages exist, show an AI avatar, a welcome message, and 4 clickable "Starter Prompt" bubbles (e.g., "Let's practice ordering food", "Explain past tense").
Chat Interface: Standard chat bubbles (User vs. AI). AI messages should have a distinct avatar. Include a typing indicator animation state.
Input Area: Text input field with a "Send" icon button.
F. Flashcards (Spaced Repetition)
Header: "Daily Review" and a subtitle showing "X cards due today".
Active Card: A large, interactive flashcard. It has a front (target word) and a back (translation, example sentences, mnemonic). It should look flippable.
Swipe/Score Actions: The UI needs to account for swiping left (Forgot) and right (Got it), as well as manual scoring buttons at the bottom (0 to 5, ranging from "Forgot" to "Easy").
Empty State: "All Caught Up!" message with a CTA to return to the Dashboard.
G. Writing Practice
Header: Topic selection area.
Input: A large textarea for the user to write a paragraph in their target language. Needs a live word/character counter.
Submission: A primary "Check Writing" button.
AI Feedback State: Once submitted, the UI displays the AI's grading:
An overall score out of 100.
Stat bars/circles for Grammar, Vocabulary, and Clarity.
A "Corrected Version" text block showing the improved text.
A list of specific "Mistakes" with explanations.
H. Profile & Settings
User Info: Avatar, Name, Email.
Settings Form:
Dropdown for App Interface Language.
Dropdown for Target Learning Language.
Toggle for Sound Effects.
Danger Zone: "Reset Language Progress" button with a warning.
Logout Button.
3. Desired Aesthetic & Design System Requests
Vibe: Premium, gamified, engaging, but not overly childish. Think "High-end EdTech".
Color Palette: We are currently using a dark theme (Slate/Navy backgrounds) with vibrant neon accents (Indigo, Emerald Green, Amber, Purple gradients). You can retain the dark mode approach or propose a highly polished light/dark mode system.
Typography: Use a clean, modern sans-serif (like Inter, Plus Jakarta Sans, or Outfit). Make headings bold and expressive.
Components: Use rounded corners, soft shadows, and subtle glassmorphism (frosted glass effects) for cards and modals to create depth.
Micro-interactions (Implied): Design button states (hover, active, disabled) and card hover states to make the prototype feel alive.