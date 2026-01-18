# AR Social Practice Companion

A mobile augmented reality (AR) application that allows users to safely practice real-world social interactions with a realistic AI avatar placed in their physical environment.

---

## Problem

For people with social anxiety or neurodivergence, social interaction can be stressful, unpredictable, and difficult to practice safely.

Existing solutions such as role-play, scripted videos, or traditional chatbots often:
- Feel artificial or disconnected from real life
- Lack emotional realism
- Do not allow practice in real-world contexts

However, exposure and rehearsal are proven methods for building confidence and social competence.

---

## Solution

Our app uses augmented reality and conversational AI to create a safe, realistic environment where users can rehearse social interactions without real-world consequences.

Users can:
- Place a realistic AI avatar into their surroundings using AR
- Speak naturally to the avatar using voice input
- Receive realistic spoken responses
- Get post-conversation feedback and coaching

The goal is to make social practice feel human, contextual, and repeatable.

---

## Demo Scope

This repository demonstrates a **single, controlled interaction flow** designed to showcase the core concept:

1. User places an AR avatar into their environment  
2. User initiates a short social interaction (e.g., networking scenario)  
3. Avatar responds with natural speech  
4. User receives structured feedback on the interaction  

The demo is intentionally scoped to one scenario to prioritize clarity, polish, and emotional realism.

---

## Tech Stack

- Unity (Mobile AR)
- AR Foundation
- Gemini API (conversation logic & coaching feedback)
- ElevenLabs (speech-to-text and text-to-speech)
- TwelveLabs (planned session recap and highlights)

---

## Architecture Overview

Voice input is captured from the user and transcribed.
The transcription is sent to a conversational model to generate a response.
The response is converted into natural speech and played through the AR avatar.
Post-interaction analysis generates coaching feedback for the user.

---

## Why AR?

Unlike traditional chat interfaces, AR allows users to:
- Practice in realistic physical spaces
- Maintain spatial presence and eye-line
- Reduce the gap between rehearsal and real-world interaction

This makes practice more transferable to real-life situations.

---

## Future Work

- Multiple social scenarios (interviews, small talk, presentations)
- Personalized difficulty and feedback based on user progress
- Real-time emotion and tone analysis
- Full session summaries and highlight reels
- Accessibility features for neurodivergent users

---

## Hackathon Note

This project was built during a hackathon and focuses on demonstrating a strong core concept and interaction flow rather than full production readiness.

The demo prioritizes user experience, clarity, and realism over breadth.

---

## Team

Built by a team of students exploring the intersection of augmented reality, AI, and mental health.
