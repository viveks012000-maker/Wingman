# WINGMAN API OPERATIONAL REFERENCE MANUAL

This document serves as the complete operational guide for all 4 core AI features exposed by the Wingman API server running on `http://localhost:3000`.

---

## Global Backend Gateway Configuration
- **Base Server URL:** `http://localhost:3000` (Local)
- **Primary AI Gateway:** `https://aicredits.in/v1` (AICREDITS)
- **Data Protection Standard:** DPDP Act 2023 compliant, 0-byte persistent storage policy.

---

## 1. Screenshot Analyzer (`POST /api/analyze`)

Analyzes uploaded chat screenshots and extracts interpersonal context using vision AI, then generates 10 distinct high-status response options.

- **Endpoint:** `http://localhost:3000/api/analyze`
- **Method:** `POST`
- **Credit Cost:** 10 Credits
- **Headers:** `Content-Type: application/json`

### Request Body:
```json
{
  "tone": "Witty",
  "images": [
    "data:image/jpeg;base64,...",
    "data:image/jpeg;base64,..."
  ],
  "image": "data:image/jpeg;base64,...",
  "shorthandOption": true,
  "emojiOption": 1
}
```

### Parameters:
- `tone` (string): Strategy tone — `"Witty"`, `"Flirty"`, `"Casual"`, `"Bold"`, or `"closer"`.
- `images` (array of strings, 1-5 max): Base64 data URLs of chat screenshots.
- `image` (string, optional fallback): Single base64 data URL string.
- `shorthandOption` (boolean): `true` for all-lowercase formatting; `false` for standard casing.
- `emojiOption` (number): `0` = zero emojis, `1` = 1 emoji at end, `2` = expressive emojis.

### Pipeline Execution:
1. **Step A (Vision Extraction):** Model `qwen3.5-flash-02-23` (`temperature: 0.2`, `max_tokens: 120`). Transcribes chat bubbles per image into structured context (`--- SCREENSHOT N OF M ---`).
2. **Step B (Text Generation):** Model `qwen3-235b-a22b-2507` (`temperature: 0.78`, `max_tokens: 650`). Generates **EXACTLY 10 OPTIONS**.

### Response Body:
```json
{
  "success": true,
  "text": "option 1 😏\noption 2 😉\n...\noption 10 👀"
}
```

---

## 2. Icebreaker Generator (`POST /api/icebreaker`)

Generates 10 high-converting conversation opening lines based on dating profile details or bios.

- **Endpoint:** `http://localhost:3000/api/icebreaker`
- **Method:** `POST`
- **Credit Cost:** 10 Credits
- **Headers:** `Content-Type: application/json`

### Request Body:
```json
{
  "vibe": "Direct",
  "bioText": "Loves hiking, coffee enthusiast, dog mom",
  "shorthandOption": true,
  "emojiOption": 1
}
```

### Parameters:
- `vibe` (string): Strategy vibe — `"Direct"`, `"Intriguing"`, `"Humorous"`, `"Compliment"`, or `"debate"`.
- `bioText` (string): Profile bio or details string (minimum 5 characters).

### Pipeline Execution:
- Model: `qwen3-235b-a22b-2507` (`temperature: 0.8`, `max_tokens: 650`). Generates **EXACTLY 10 OPENERS**.

---

## 3. Profile Bio Optimizer (`POST /api/optimize` & `POST /api/bio-optimizer`)

Transforms raw user details into 10 multi-line, 1st-person high-converting dating profile bios.

- **Endpoint:** `http://localhost:3000/api/optimize` & `/api/bio-optimizer`
- **Method:** `POST`
- **Credit Cost:** 10 Credits
- **Headers:** `Content-Type: application/json`

### Request Body:
```json
{
  "style": "Punchy",
  "bioText": "Software engineer, loves fitness, horror movies, looking for someone fun",
  "shorthandOption": true,
  "emojiOption": 1
}
```

### Pipeline Execution (3-Layer Sanitation Engine):
- **Layer 1:** Input sanitization stripping cringe intros and noise.
- **Layer 2:** `qwen3-235b-a22b-2507` locked at `temperature: 0.25` and `top_p: 0.85`.
- **Layer 3:** Programmatic blacklist safety filter removing gothic/Wattpad hallucinations.
- Generates **EXACTLY 10 BIOS** formatted with clean line breaks (`\n`).

---

## 4. Practice Partner & Conversation Coach Maeve (`POST /api/chat` & `POST /api/simulator/chat`)

Realistic Gen Z AI practice partner and conversation coach controller.

- **Endpoints:** `http://localhost:3000/api/chat` & `http://localhost:3000/api/simulator/chat`
- **Method:** `POST`
- **Credit Cost:** 2 Credits per turn
- **Headers:** `Content-Type: application/json`

### Modes:
1. **Coach Hotline / Ask Anything (`mode === 'hotline'`):** Free-form dating advice advisor (`max_tokens: 1500`).
2. **Roleplay Drill Scenarios (`mode === 'roleplay'`):** Interactive scenario drills (`Flirting & Teasing`, `First Date Setup`, `Deep Connection`, `Awkward Recovery`). Uses `getScenarioDirective` to dynamically inject active scenario goals into system prompts (`temperature: 0.6`, `max_tokens: 120`).

---

## 5. User Audit & Credit Management Endpoints

### Get Credit Balance (`GET /api/credits`)
- **Endpoint:** `http://localhost:3000/api/credits`
- **Method:** `GET`
- **Response:** `{ "success": true, "credits": 3000 }`

### Delete Account & Purge Data (`POST /api/user/delete-account`)
- **Endpoint:** `http://localhost:3000/api/user/delete-account`
- **Method:** `POST`
- **Response:** `{ "success": true, "message": "Account data purged." }`
