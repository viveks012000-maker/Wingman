# WINGMAN - MASTER PROJECT SPECIFICATION & ARCHITECTURE DECREE

This document serves as the permanent, unalterable single source of truth for the **Wingman** application backend ([`server.js`](file:///c:/Users/User/Downloads/WINGMAN/server.js)), prompt definitions ([`config/promptSystem.js`](file:///c:/Users/User/Downloads/WINGMAN/config/promptSystem.js)), and frontend ([`app.html`](file:///c:/Users/User/Downloads/WINGMAN/app.html), [`app.js`](file:///c:/Users/User/Downloads/WINGMAN/app.js)).

---

## 📌 MASTER FEATURE OPERATING MATRIX

| Feature | Endpoint | AI Model | Temp | Max Tokens | Output Count | Primary Operational Laws & Post-Processing |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Screenshot Analyzer (Step A)** | `/api/analyze` | `qwen/qwen2.5-vl-72b-instruct` | 0.2 | 120 / image | Multi-Screenshot Log | Parallel multi-screenshot transcription (`Promise.all`, 1-5 images). **25s AbortController timeout (504 status)**. Horizontal X-axis alignment rules (Right = Me, Left = Them). Video reel box transcription override (`[Shared Media: Video Reel Box]`). |
| **Screenshot Analyzer (Step B)** | `/api/analyze` | `qwen3-235b-a22b-2507` | 0.78 | 650 | **10 Reply Cards** | High-status male perspective. Sender Reality Lock. **15-22 words max per card**. Max 1 confident emoji at end. **25s AbortController timeout**. |
| **Icebreaker Generator** | `/api/icebreaker` | `qwen3-235b-a22b-2507` | 0.8 | 650 | **10 Openers** | Witty, Flirting, Casual, Bold, Closer modes. Max 12 words per line. Zero poetic/creepy Wattpad clichés. **25s AbortController timeout (504 response)**. |
| **Profile Bio Optimizer** | `/api/optimize` & `/api/bio-optimizer` | `qwen3-235b-a22b-2507` | **0.25** | 650 | **10 Bios** | **Fact Anchoring Law** + **70/30 Bio-to-Question Ratio** + **Strict 2-Part Layout** (`\n\n` before CTA Question). `top_p: 0.85` lock. Casing rules + `fixGrammarAndTypoLeaks` + `enforceStructuralBatchDiversity` + `enforceUniqueQuestionAnchors` + `formatBioLineBreaks`. **25s AbortController timeout**. |
| **Coach Hotline (Ask Anything)** | `/api/chat` | `qwen3-235b-a22b-2507` | 0.7 | **1500** | 1 Advice Turn | Free-form dating advice advisor. `max_tokens: 1500` prevents mid-sentence truncations. **Strict Text-Only Media Boundary (Never ask for media/screenshots)**. |
| **Practice Partner (Roleplay Drills)** | `/api/chat` & `/api/simulator/chat` | `qwen3-235b-a22b-2507` | **0.6** | **120** | 1 Turn | **Roleplay Drill Output Length Law (15–25 words / 1-2 short lines max)**. **Dry-Input Warm Leadership Protocol** (`"milk"`, `"idk"`). **Stateless Greeting Purge** (turns > 1). **Backend Truncation & Syntax Sanitizer**. Dynamic `getScenarioDirective` injection (Awkward Recovery, First Date Setup, Deep Connection, Flirting & Teasing). |

---

## 🛠 DETAILED FEATURE OPERATING MANUALS & PROMPTS

### FEATURE 1: SCREENSHOT ANALYZER (`/api/analyze`)
- **HTTP Method:** `POST` | **Credit Cost:** 10 Credits
- **Endpoint:** `/api/analyze`
- **Payload Schema:**
  ```json
  {
    "tone": "Witty",
    "images": [ "data:image/jpeg;base64,...", "data:image/jpeg;base64,..." ],
    "shorthandOption": true,
    "emojiOption": 1
  }
  ```
- **Step A: Parallel Vision Extraction (`qwen/qwen2.5-vl-72b-instruct`)**:
  - Parameters: `temperature: 0.2`, `max_tokens: 120` per image, `timeoutMs: 25000`.
  - Executed in parallel using `Promise.all` across `images` array (up to 5 screenshots max).
  - System Prompt:
    ```text
    You are an expert Chat Interface Analyst. Parse the chat screenshots into a structured dialogue log.

    CRITICAL ALIGNMENT LAWS (DARK & LIGHT MODE):
    - Ignore background bubble colors (do not rely on pink vs white).
    - Rely STRICTLY on horizontal screen alignment (X-axis position):
      * RIGHT-ALIGNED BUBBLE = Sent by User (Me)
      * LEFT-ALIGNED BUBBLE = Sent by Other Person (Them)
    - Extract text chronologically from top to bottom.
    - If a shared reel/video box exists, DO NOT transcribe video text. Output: [Shared Media: Video Reel Box]
    ```
- **Step B: Text Generation Model (`qwen3-235b-a22b-2507`)**:
  - Parameters: `temperature: 0.78`, `max_tokens: 650`, `timeoutMs: 25000`.
  - Result Count: **EXACTLY 10 OPTIONS PER REQUEST**.
  - System Prompt:
    ```text
    You are an elite AI Wingman generating text replies from a high-status, confident male perspective based on layout data. Generate 10 distinct options.

    STRICT LAWS:
    1. SENDER REALITY LOCK: If the last message was sent by 'User (Me)', the user was left on 'Seen'. You are strictly FORBIDDEN from generating incoming greetings ("hi back", "hey there").
    2. NO TECH/MEDIA DISTRACTION: Do not mention tech topics, products, or setups unless active text bubbles explicitly discuss them.
    3. BAN INSECURE / DESPERATE TEXTS: Never complain about being ignored or apologize for double-texting (NO "i'll stop spamming", NO "i guess you're ignoring me").
    4. FORMAT: Fully lowercase text, max 15-22 words per option, max 1 confident emoji at the end (e.g., 😏, 😉, 👀).
    ```

---

### FEATURE 2: ICEBREAKER GENERATOR (`/api/icebreaker`)
- **HTTP Method:** `POST` | **Credit Cost:** 10 Credits
- **Endpoint:** `/api/icebreaker`
- **Payload Schema:**
  ```json
  {
    "vibe": "Direct",
    "bioText": "Profile bio / match details",
    "shorthandOption": true,
    "emojiOption": 1
  }
  ```
- **Model:** `qwen3-235b-a22b-2507` (`temperature: 0.8`, `max_tokens: 650`, `timeoutMs: 25000`).
- **Result Count:** **EXACTLY 10 OPTIONS PER REQUEST**.
- **System Prompt:**
  ```text
  You are an Elite Social Attraction Strategist. Analyze the provided match details (bio, interests, or profile info) and generate 10 distinct opening lines matching the requested tone (Witty, Flirting, Casual, Bold, Closer).

  STRICT ICEBREAKER LAWS:
  1. NO BORING OPENERS: Banned: "hey how are you", "how's your week", "nice profile", "what brings you here".
  2. NO CREEPY / POETIC PHRASING: Avoid romantic poetry, Wattpad villain tropes, or intense lines ("stolen glances", "destiny", "pushing boundaries").
  3. TONE EXECUTIONS:
     - Witty: Playful observational banter or light teasing based on their details.
     - Flirting: Smooth, witty charm with a subtle spark.
     - Casual: Low-pressure, easy conversation starter.
     - Bold: Confident, direct callout or playful challenge.
     - Closer: Smooth line designed to transition into planning a quick coffee/drink date.
  4. FORMAT: Fully lowercase text, max 12 words per option, zero formal punctuation, max 1 emoji per line at the very end.
  ```

---

### FEATURE 3: PROFILE BIO OPTIMIZER (`/api/optimize` & `/api/bio-optimizer`)
- **HTTP Method:** `POST` | **Credit Cost:** 10 Credits
- **Endpoint:** `/api/optimize` & `/api/bio-optimizer`
- **Payload Schema:**
  ```json
  {
    "style": "Playful",
    "bioText": "Raw user profile bio",
    "shorthandOption": true,
    "emojiOption": 1
  }
  ```
- **Engine Architecture (3-Layer Sanitation & Hyperparameter Lock):**
  - **Layer 1: Input Sanitizer (`sanitizeBioInput`)**: Strips cringe intros ("hello my name is", "playboy") and fruit noise.
  - **Layer 2: Hyperparameter Lock**: `temperature: 0.25`, `top_p: 0.85` lock via `qwen3-235b-a22b-2507`.
  - **Layer 3: Post-Generation Processing & Sanitizer Pipeline**:
    1. `fixGrammarAndTypoLeaks`: Programmatically fixes subject-verb agreement (`"i rides"` -> `"i ride my bike"` / `"riding bikes"`, `"i goes"` -> `"i go"`), strips raw greetings (`"hi my name is"`), and purges `"settle this"`.
    2. `enforceStructuralBatchDiversity`: Ensures first two words are unique across all options in the batch.
    3. `enforceUniqueQuestionAnchors`: Rotates closing question lead-ins (`real question:`, `honest debate:`, `this or that:`, `pick a side:`, `would you rather`, `yes or no:`, `tell me:`, `what's your pick:`, `where do you stand:`).
    4. `formatBioLineBreaks`: Converts em-dashes preceding question lead-ins to double line breaks (`\n\n`) and guarantees the CTA Question is SECOND on Line 3.
    5. Client-Side Rendering ([`app.js`](file:///c:/Users/User/Downloads/WINGMAN/app.js)): Uses `whitespace-pre-line` on the card body text element so multi-line paragraph breaks render cleanly.

- **4 CORE LAWS OF BIO OPTIMIZER:**
  1. **FACT ANCHORING LAW (NO HALLUCINATED HOBBIES)**: AI MUST stay strictly rooted in provided user facts. Allowed to expand on sensory vibe/atmosphere ("night rides" -> "city lights", "quiet roads", "late-night breeze"). STRICTLY BANNED: Inventing unrelated hobbies, music genres, sports, or random objects (`synthwave`, `traffic cones`, `balling`, `sunrise laps`).
  2. **THE 70/30 BIO-TO-QUESTION RATIO RULE**: Bio Body = 70% of total option length (cool 2-line lifestyle statement). Closing CTA Question = 30% of total length (short, punchy 1-liner, max 6-8 words).
  3. **STRICT 2-PART LAYOUT ORDER**:
     ```text
     [LINE 1-2]: Bio Body / Lifestyle Hook (70% length)
     \n\n
     [LINE 3]: Short CTA Question (30% length)
     ```
     NEVER place the question at the top or append lifestyle text after the question!
  4. **ABSOLUTE BAN ON "SETTLE THIS"**: The phrase "settle this" or "settle this:" is STRICTLY BANNED FOREVER.

---

### FEATURE 4: PRACTICE PARTNER & CONVERSATION COACH MAEVE (`/api/chat` & `/api/simulator/chat`)
- **HTTP Method:** `POST` | **Credit Cost:** 0.2 Credits (2 Credits display) per turn
- **Endpoint:** `/api/chat` & `/api/simulator/chat`
- **Avatar Asset:** [`maeve.jpg`](file:///c:/Users/User/Downloads/WINGMAN/maeve.jpg)
- **Persona Name & Age:** **Maeve**, 22-year-old practice partner & dating coach.

#### DUAL OPERATING MODES:

1. **MODE A: Coach Hotline / Ask Anything (`isHotline === true` or `scenario === 'Coach Hotline'`):**
   - **Role:** Free-form dating advice advisor.
   - **Parameters:** `temperature: 0.7`, `max_tokens: 1500` (prevents mid-sentence truncations).
   - **Strict Text-Only Media Boundary**: Maeve CANNOT receive or process images/videos. She is STRICTLY FORBIDDEN from ever asking or requesting users to upload or send screenshots, photos, audio, or video clips.

2. **MODE B: Roleplay Drill Scenarios (`mode === 'roleplay'`):**
   - **Parameters:** `temperature: 0.6`, `max_tokens: 120`.
   - **ROLEPLAY DRILL OUTPUT LENGTH LAW**: Maximum 1 to 2 short sentences MAX (Strict limit: 15–25 words total). Text like a real human on iMessage/WhatsApp. Never write long paragraphs or double-barreled questions.
   - **STATELESS GREETING PURGE**: NEVER say `"hey!"`, `"hi!"`, or `"hey there!"` on turns after turn 1. If conversation history is present, jump straight into the reply.
   - **DRY-INPUT WARM LEADERSHIP PROTOCOL**: When the user sends a short/dry input (`"milk"`, `"idk"`, `"no"`, `"ok"`, `"hi"`):
     - *Rule 1: Read the Room (Acknowledge)*: Lightly play with or validate the input so the user feels heard.
     - *Rule 2: Zero Ego & Non-Defensive*: Never get annoyed, sarcastic, or passive-aggressive.
     - *Rule 3: Warm Leadership (Bridge & Advance)*: Take graceful responsibility for keeping the conversation flowing into a fresh open-ended topic.
   - **BACKEND TRUNCATION & SYNTAX SANITIZER**:
     - Strips trailing dangling conjunctions/prepositions (`or`, `and`, `to`, `but`, `with`, `for`, `at`, `on`, `the`, `a`, `so`, `if`, `when`, `because`, `which`, `that`).
     - Guarantees complete sentence ending punctuation (`.`, `!`, `?`, or emoji). If truncated mid-clause without punctuation, trims back to the last complete sentence.
   - **4 SCENARIOS (`getScenarioDirective`)**:
     - **Awkward Recovery**: Locked on `'k cool'` dry text premise. Calls out dry replies, requires real storytelling skills, zero surreal hallucinations ("showtunes", "alien time").
     - **First Date Setup**: Drives towards Venue + Day + Time. Locks in day/time once venue is picked. Challenges passivity.
     - **Deep Connection**: Moves past surface talk into relatable micro-stories and intrigue questions. Topic continuity lock.
     - **Flirting & Teasing**: Builds tension, witty banter, subject consistency rule, no emoji stacking.

---

## ⚡ INFRASTRUCTURE & LEGAL COMPLIANCE
- **Active API Base URL:** `https://aicredits.in/v1` (configured in `.env` and `server.js`).
- **Express Payload Limit:** `30mb` (`app.use(express.json({ limit: '30mb' }))`).
- **Global AbortController Timeout:** **25 seconds** across all 4 feature endpoints (`timeoutMs: 25000`).
- **Local Port:** 3000.
- **Third-Party AI Provider:** **AICREDITS** (`aicredits.in`).
- **Data Fiduciary:** MyWingman (Naresh Kumar, Churu, Rajasthan, India) under DPDP Act 2023.
- **Support Contact:** `support.mywingman@gmail.com`.
