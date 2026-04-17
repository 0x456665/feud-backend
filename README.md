# Feud Frenzy — Backend API

Feud is a real-time Family Feud–style quiz game backend built with NestJS, TypeORM, and PostgreSQL. It supports:

- Survey/voting phase where players rank answers before the live game
- Admin-controlled live game board (reveal answers, track strikes, add scores)
- Real-time board updates pushed to all clients via Server-Sent Events (SSE)
- Vote deduplication via `voter_token` cookie and device fingerprinting
- Secure admin authentication via bcrypt-hashed access codes

---

## Table of contents

1. [How the game works](#how-the-game-works)
2. [Quick start](#quick-start)
3. [Environment variables](#environment-variables)
4. [Base URL and conventions](#base-url-and-conventions)
5. [Authentication](#authentication)
6. [Player identity and cookies](#player-identity-and-cookies)
7. [Rate limiting](#rate-limiting)
8. [Error response format](#error-response-format)
9. [Game state machine](#game-state-machine)
10. [Public player endpoints](#public-player-endpoints)
11. [Admin endpoints — game management](#admin-endpoints--game-management)
12. [Admin endpoints — live gameplay](#admin-endpoints--live-gameplay)
13. [Admin endpoints — question management](#admin-endpoints--question-management)
14. [Real-time events (SSE)](#real-time-events-sse)
15. [Board snapshot](#board-snapshot)
16. [Client integration guide](#client-integration-guide)
17. [Development commands](#development-commands)
18. [Changelog](#changelog)

---

## How the game works

A single game session follows this sequence:

``` text
ADMIN                                  PLAYERS

POST /admin/games          ──────────► Players receive game_code
                                       GET /games/:code/join         (sets cookie, logs session)
                                       GET /events/:code             (SSE stream)
PATCH voting → OPEN        ──────────► GET /games/:code/questions    (fetch questions + options)
                                       POST /games/:code/vote        (cast votes; cookie auto-set if absent)

PATCH voting → CLOSED      ◄── automatic: std_dev computed, options ranked

POST start                 ──────────► SSE: game_state (IN_PROGRESS)

POST next-question         ──────────► SSE: next_question
POST reveal-option         ──────────► SSE: reveal_option  (×N)
POST wrong-answer          ──────────► SSE: wrong_option   (on mistake)
POST add-score             ──────────► SSE: add_score

POST next-question  (repeat for each round)

POST end-game              ──────────► SSE: play_winner_sound
                                       SSE: end_game
```

**Key design decisions:**

- Questions are submitted inline when the game is created (or added/imported later before the game starts).
- Option text is plain strings at creation. Vote counts, ranks, and point values are computed automatically when voting closes.
- The best questions to use are selected by **lowest standard deviation** of votes (i.e. the most evenly spread survey answers). This selection happens automatically at game start.
- The `num_rounds` field caps how many questions are played even if more exist in the question bank.
- Points per option are calculated as `round(optionVotes / totalVotes × 100)`, giving the most popular answer the highest point value.

---

## Quick start

```bash
cd feud-backend
cp .env.example .env   # fill in DB credentials
pnpm install
pnpm run start:dev
```

The API is available at `http://localhost:3000/api/v1`.

Swagger UI is available at `http://localhost:3000/api`.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DB_HOST` | ✅ | — | PostgreSQL host |
| `DB_PORT` | ✅ | — | PostgreSQL port (usually `5432`) |
| `DB_USERNAME` | ✅ | — | PostgreSQL username |
| `DB_PASSWORD` | ✅ | — | PostgreSQL password |
| `DB_NAME` | ✅ | — | PostgreSQL database name |
| `ALLOWED_ORIGINS` | ❌ | `http://localhost:3001` | Comma-separated list of allowed CORS origins |
| `PORT` | ❌ | `3000` | Port the server listens on |
| `NODE_ENV` | ❌ | — | Set to `production` to enable secure (HTTPS-only) cookies |
| `TYPEORM_SYNC` | ❌ | `false` | Set to `true` to auto-sync DB schema in development |

The app exits on startup if any required variable is missing.

---

## Base URL and conventions

All routes are mounted under:

``` text
http://localhost:3000/api/v1
```

All requests with a body must include:

``` text
Content-Type: application/json
```

All player requests that depend on the `voter_token` cookie must include:

``` text
credentials: 'include'   // (fetch API)
withCredentials: true    // (axios)
```

Unknown fields in request bodies are rejected with a `400 Bad Request`.

---

## Authentication

### Admin authentication

Admin routes require the following header on every request:

``` text
X-Admin-Code: <admin_code>
```

The `admin_code` is a 16-character alphanumeric string returned **once** when the game is created. It is stored as a bcrypt hash server-side and cannot be recovered. If you lose it, you must create a new game.

> The `POST /admin/games` route (game creation) does **not** require `X-Admin-Code` because the game does not exist yet.

### Player authentication

Players are identified by a `voter_token` cookie (UUID v4) set by `GET /games/:gameCode/join`. No login or API key is required. See [Player identity and cookies](#player-identity-and-cookies).

---

## Player identity and cookies

When a player calls `GET /games/:gameCode/join`, the server sets:

``` text
Set-Cookie: voter_token=<uuid>; HttpOnly; SameSite=Lax; Max-Age=86400
```

- `HttpOnly` — not accessible from JavaScript (XSS protection)
- `SameSite=Lax` — sent on same-origin navigations; compatible with typical SPA setups
- `Secure` — applied automatically when `NODE_ENV=production` (HTTPS only)
- Max-Age is 24 hours

The `voter_token` is the canonical identity for:

- Vote deduplication (one vote per player per question)
- Session counting (`GET /games/:gameCode/players/count`)

The server also stores a device fingerprint (`SHA-256` of `IP:User-Agent`) alongside the cookie for analytics, but the **cookie is the authoritative dedup key** — fingerprints alone are not used to block votes.

**Calling `/join` is recommended but not strictly required before voting.** If a player hits `POST /games/:gameCode/vote` without a `voter_token` cookie, the server auto-generates one and returns it in the `Set-Cookie` header of the vote response. Subsequent votes will carry that cookie automatically (browser) or must echo it back (non-browser clients).

If the player reloads the page, the browser will preserve the `voter_token` cookie and the client can safely re-fetch the current voting questions. If the cookie is lost (private mode, cleared storage, etc.), the server can still create a new `voter_token` on the next vote, but previously cast votes under the lost cookie cannot be recovered.

**Your client must send `credentials: 'include'`** (fetch) or `withCredentials: true` (axios) on all requests so cookies are sent and received correctly.

---

## Rate limiting

| Scope | Limit |
|---|---|
| All endpoints (global) | 300 requests / 60 seconds per IP |
| `POST /games/:gameCode/vote` | 1 request / 10 seconds per IP (batch submissions are allowed)

Exceeding the rate limit returns `429 Too Many Requests`.

---

## Error response format

All errors follow a consistent envelope:

```json
{
  "statusCode": 400,
  "message": "Voting must be closed before starting the game",
  "error": "Bad Request",
  "path": "/api/v1/admin/games/ABC123/start",
  "timestamp": "2026-04-15T10:00:00.000Z"
}
```

Common status codes:

| Code | Meaning |
|---|---|
| `400` | Bad Request — invalid body or business rule violation |
| `403` | Forbidden — missing/invalid `X-Admin-Code` or duplicate vote attempt |
| `404` | Not Found — game, question, or option does not exist |
| `409` | Conflict — game code collision (retry) |
| `429` | Too Many Requests — rate limit exceeded |

---

## Game state machine

A game has two independent state dimensions:

### `voting_state`

Controls whether players can submit survey votes.

| Value | Meaning |
|---|---|
| `OPEN` | Players can vote. Default on game creation. |
| `PAUSED` | Voting temporarily suspended. |
| `CLOSED` | Voting ended. Triggers automatic stat computation (std_dev, ranks, points). |

### `play_state`

Controls the live game board phase.

| Value | Meaning |
|---|---|
| `LOBBY` | Waiting for admin to start. Default on game creation. |
| `IN_PROGRESS` | Live game running — rounds being played. |
| `PAUSED` | Game temporarily paused. |
| `FINISHED` | Game over. Final scores locked in. SSE stream closed. |

**Prerequisites to start the game:**

- `voting_state` must be `CLOSED`
- `play_state` must be `LOBBY`
- The number of questions with computed stats must be ≥ `num_rounds`

---

## Public player endpoints

### Join game

Sets the `voter_token` cookie and logs the player session. Recommended as the first step before fetching questions or voting, but not strictly required — the vote endpoint will auto-set the cookie on first use.

```
GET /api/v1/games/:gameCode/join
```

**Response `200 OK`**

```json
{
  "message": "Joined game successfully",
  "game_code": "ABC123"
}
```

The game code is always returned uppercased regardless of how it was passed in.

---

### Get questions for voting

Returns all questions and their options for a game. Use this to populate the voting form. **Only available while `voting_state` is `OPEN`.**

Vote counts are intentionally omitted from this response so players cannot see the running tally while voting is in progress.

```
GET /api/v1/games/:gameCode/questions
```

**Response `200 OK`**

```json
{
  "gameId": "a1b2c3d4-e5f6-7890-abcd-1234567890ef",
  "gameName": "Family Night 2026",
  "questions": [
    {
      "questionId": "11112222-3333-4444-5555-666677778888",
      "question": "Name a fruit you eat with breakfast",
      "options": [
        { "optionId": "aaaa1111-2222-3333-4444-555566667777", "text": "Banana" },
        { "optionId": "bbbb1111-2222-3333-4444-555566667777", "text": "Apple" },
        { "optionId": "cccc1111-2222-3333-4444-555566667777", "text": "Orange" },
        { "optionId": "dddd1111-2222-3333-4444-555566667777", "text": "Grapes" },
        { "optionId": "eeee1111-2222-3333-4444-555566667777", "text": "Strawberry" },
        { "optionId": "ffff1111-2222-3333-4444-555566667777", "text": "Peach" }
      ]
    }
  ]
}
```

| Field | Description |
|---|---|
| `gameId` | The UUID to pass as `gameId` in the vote request body |
| `questions[].questionId` | The UUID to pass as `questionId` in the vote request body |
| `questions[].options[].optionId` | The UUID to include in `optionIds` in the vote request body |

**Failure cases**

| Condition | Status |
|---|---|
| Game not found | `404 Not Found` |
| `voting_state` is not `OPEN` | `400 Bad Request` |

---

### Cast vote

Submit one or more question selections in a single request. Requires the `voter_token` cookie (auto-set on first vote if not already present — see [Player identity and cookies](#player-identity-and-cookies)).

```
POST /api/v1/games/:gameCode/vote
Content-Type: application/json
```

**Request body**

```json
{
  "votes": [
    {
      "gameId": "a1b2c3d4-e5f6-7890-abcd-1234567890ef",
      "questionId": "11112222-3333-4444-5555-666677778888",
      "optionIds": [
        "aaaa1111-2222-3333-4444-555566667777",
        "bbbb1111-2222-3333-4444-555566667777",
        "cccc1111-2222-3333-4444-555566667777",
        "dddd1111-2222-3333-4444-555566667777"
      ]
    },
    {
      "gameId": "a1b2c3d4-e5f6-7890-abcd-1234567890ef",
      "questionId": "99991111-2222-3333-4444-555566667777",
      "optionIds": [
        "eeee1111-2222-3333-4444-555566667777",
        "ffff1111-2222-3333-4444-555566667777",
        "00001111-2222-3333-4444-555566667777",
        "11112222-3333-4444-5555-666677778888"
      ]
    }
  ]
}
```

This endpoint is now designed to accept multiple question submissions in one request, which helps avoid the 10-second vote throttle for back-to-back questions.

| Field | Type | Constraints |
|---|---|---|
| `gameId` | UUID | Must match an existing game |
| `questionId` | UUID | Must belong to the specified game |
| `optionIds` | UUID[] | 4–6 UUIDs, all must belong to the specified question |

**Response `200 OK`**

```json
{
  "message": "Votes cast successfully"
}
```

**Failure cases**

| Condition | Status |
|---|---|
| Already voted on this question | `403 Forbidden` |
| `voting_state` is not `OPEN` | `400 Bad Request` |
| Game, question, or any option not found | `404 Not Found` |
| Fewer than 4 or more than 6 `optionIds` | `400 Bad Request` |
| Duplicate `optionIds` in the array | Silently deduplicated |

After a successful vote, a `vote_update` SSE event is broadcast to all connected clients for the game.

---

### Player count

Returns the number of distinct players that have joined.

``` text
GET /api/v1/games/:gameCode/players/count
```

**Response `200 OK`**

```json
{
  "count": 42
}
```

---

### Board snapshot

Returns the current game board state. Use this after an SSE reconnect to resync the client without replaying the full event history.

``` text
GET /api/v1/games/:gameCode/board
```

**Response `200 OK`**

```json
{
  "id": "log-uuid",
  "game_id": "a1b2c3d4-e5f6-7890-abcd-1234567890ef",
  "team_a_score": 150,
  "team_b_score": 220,
  "current_question_id": "11112222-3333-4444-5555-666677778888",
  "options_revealed": [
    "aaaa1111-2222-3333-4444-555566667777",
    "bbbb1111-2222-3333-4444-555566667777"
  ],
  "questions_completed": [
    "99991111-2222-3333-4444-555566667777"
  ],
  "current_strikes": 1,
  "state_snapshot": {
    "activeTeam": null,
    "lastScoringTeam": "TEAM_B"
  },
  "updated_at": "2026-04-15T10:05:00.000Z"
}
```

| Field | Description |
|---|---|
| `team_a_score` / `team_b_score` | Running point totals for each team |
| `current_question_id` | UUID of the question currently on the board (`null` if between rounds) |
| `options_revealed` | Array of option UUIDs revealed so far in the current round |
| `questions_completed` | Array of question UUIDs for all completed rounds |
| `current_strikes` | Wrong-answer count for the current question (resets each round) |
| `state_snapshot` | Free-form JSONB for any extra state needed by the frontend |

---

## Admin endpoints — game management

All admin endpoints require:

``` text
X-Admin-Code: <admin_code>
```

---

### Create game

Creates a new game with questions and options. Returns the raw `admin_code` **once only** — store it immediately.

``` text
POST /api/v1/admin/games
Content-Type: application/json
```

**Request body**

```json
{
  "game_name": "Family Night 2026",
  "team_a_name": "The Smiths",
  "team_b_name": "The Joneses",
  "num_rounds": 3,
  "questions": [
    {
      "question": "Name a fruit you eat with breakfast",
      "options": ["Banana", "Apple", "Orange", "Grapes", "Strawberry", "Peach"]
    },
    {
      "question": "Name something you find in a kitchen",
      "options": ["Fridge", "Oven", "Microwave", "Sink", "Toaster", "Kettle"]
    },
    {
      "question": "Name a popular holiday destination",
      "options": ["Paris", "New York", "Bali", "Dubai", "London", "Tokyo"]
    }
  ]
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `game_name` | string | ✅ | Max 100 chars |
| `team_a_name` | string | ❌ | Max 50 chars. Defaults to `"Team A"` |
| `team_b_name` | string | ❌ | Max 50 chars. Defaults to `"Team B"` |
| `num_rounds` | integer | ✅ | 1–20. Cannot exceed number of questions provided |
| `questions` | array | ✅ | At least 1 question |
| `questions[].question` | string | ✅ | Max 500 chars |
| `questions[].options` | string[] | ✅ | Plain answer strings (max 200 chars each) |

**Response `201 Created`**

```json
{
  "message": "Game created. Save the admin_code — it will not be shown again.",
  "game_code": "ABC123",
  "admin_code": "A7Bk9XmR2Pq3ZnLw",
  "game_id": "a1b2c3d4-e5f6-7890-abcd-1234567890ef",
  "team_a_name": "The Smiths",
  "team_b_name": "The Joneses",
  "num_rounds": 3
}
```

> `admin_code` is a 16-character alphanumeric string shown **once**. Save it in your admin client's state or local storage immediately.

---

### Get game details

Returns the full game record including all questions and options.

```
GET /api/v1/admin/games/:gameCode
X-Admin-Code: <admin_code>
```

**Response `200 OK`**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-1234567890ef",
  "game_name": "Family Night 2026",
  "game_code": "ABC123",
  "team_a_name": "The Smiths",
  "team_b_name": "The Joneses",
  "num_rounds": 3,
  "voting_state": "OPEN",
  "play_state": "LOBBY",
  "created_at": "2026-04-15T09:00:00.000Z",
  "questions": [
    {
      "id": "11112222-3333-4444-5555-666677778888",
      "question": "Name a fruit you eat with breakfast",
      "number_of_options": 6,
      "std_dev": null,
      "display_order": null,
      "options": [
        {
          "id": "aaaa1111-2222-3333-4444-555566667777",
          "option_text": "Banana",
          "votes": 0,
          "rank": null,
          "points": null
        }
      ]
    }
  ]
}
```

`std_dev`, `rank`, and `points` are `null` until voting closes.

---

### Get survey stats

Returns voting statistics for all questions, sorted by `std_dev` ascending (best questions first after voting closes).

```
GET /api/v1/admin/games/:gameCode/survey-stats
X-Admin-Code: <admin_code>
```

**Response `200 OK`**

```json
[
  {
    "questionId": "11112222-3333-4444-5555-666677778888",
    "question": "Name a fruit you eat with breakfast",
    "std_dev": 12.4,
    "totalVotes": 87,
    "options": [
      {
        "id": "aaaa1111-2222-3333-4444-555566667777",
        "option_text": "Banana",
        "votes": 34,
        "rank": 1,
        "points": 39
      },
      {
        "id": "bbbb1111-2222-3333-4444-555566667777",
        "option_text": "Apple",
        "votes": 20,
        "rank": 2,
        "points": 23
      }
    ]
  }
]
```

Options are sorted by votes descending within each question. `std_dev`, `rank`, and `points` are `null` before voting closes.

---

### Update voting state

Opens, pauses, or closes the survey/voting phase.

Closing voting (`CLOSED`) **automatically**:

1. Computes `std_dev` for each question based on vote distribution
2. Ranks options by vote count (rank 1 = most votes)
3. Calculates `points` for each option: `round(votes / totalVotes × 100)`
4. Broadcasts a `game_state` SSE event

```
PATCH /api/v1/admin/games/:gameCode/voting
Content-Type: application/json
X-Admin-Code: <admin_code>
```

**Request body**

```json
{
  "voting_state": "CLOSED"
}
```

Valid values: `"OPEN"` · `"PAUSED"` · `"CLOSED"`

**Response `200 OK`** — returns the updated Game object (same shape as [Get game details](#get-game-details)).

---

### Start game

Transitions the game from `LOBBY` → `IN_PROGRESS`.

Selects the top `num_rounds` questions by `std_dev` ascending and assigns them a `display_order` (1-based). Broadcasts `game_state` SSE.

```
POST /api/v1/admin/games/:gameCode/start
X-Admin-Code: <admin_code>
```

**Preconditions**

- `voting_state` must be `CLOSED`
- `play_state` must be `LOBBY`

**Response `200 OK`** — returns the updated Game object.

---

## Admin endpoints — live gameplay

All gameplay endpoints require `X-Admin-Code`.

---

### Next question

Advances the board to the next question in sequence. On the first call it loads question 1; subsequent calls load 2, 3, etc. Broadcasts `next_question` SSE.

If a question was previously active, it is recorded as completed and a `Gameplay` round entry is saved before advancing.

```
POST /api/v1/admin/games/:gameCode/next-question
X-Admin-Code: <admin_code>
```

**Response `200 OK`** — returns the updated `GameplayLog` (see [Board snapshot](#board-snapshot) for shape).

**Failure** — returns `400 Bad Request` if all questions have been played and no more are available.

---

### Reveal option

Reveals a specific answer card on the board. Validates that the option belongs to the currently active question. Broadcasts `reveal_option` SSE.

```
POST /api/v1/admin/games/:gameCode/reveal-option
Content-Type: application/json
X-Admin-Code: <admin_code>
```

**Request body**

```json
{
  "optionId": "aaaa1111-2222-3333-4444-555566667777"
}
```

**Response `204 No Content`**

**Failure cases**

- No active question → `400 Bad Request`
- Option not on the current question → `404 Not Found`
- Option already revealed → `400 Bad Request`

---

### Wrong answer (strike)

Triggers the wrong-answer buzzer for a team. Increments `current_strikes` in the log. Broadcasts `wrong_option` SSE. Strike enforcement (e.g. stealing after 3 strikes) is handled in the admin client.

```
POST /api/v1/admin/games/:gameCode/wrong-answer
Content-Type: application/json
X-Admin-Code: <admin_code>
```

**Request body**

```json
{
  "team": "TEAM_A"
}
```

Valid values for `team`: `"TEAM_A"` · `"TEAM_B"`

**Response `204 No Content`**

---

### Add score

Manually credits points to a team. Used after a round win or a steal. Broadcasts `add_score` SSE with updated totals for both teams.

```
POST /api/v1/admin/games/:gameCode/add-score
Content-Type: application/json
X-Admin-Code: <admin_code>
```

**Request body**

```json
{
  "team": "TEAM_B",
  "points": 150
}
```

| Field | Type | Constraints |
|---|---|---|
| `team` | string | `"TEAM_A"` or `"TEAM_B"` |
| `points` | integer | Minimum 1 |

**Response `200 OK`** — returns the updated `GameplayLog`.

---

### End game

Ends the game. Determines the winner (highest total score; Team A wins ties), creates a `GameWin` record, sets `play_state` to `FINISHED`, and broadcasts `play_winner_sound` then `end_game` SSE events. The SSE stream is closed for this game.

```
POST /api/v1/admin/games/:gameCode/end-game
X-Admin-Code: <admin_code>
```

**Response `200 OK`**

```json
{
  "id": "win-uuid",
  "game_id": "a1b2c3d4-e5f6-7890-abcd-1234567890ef",
  "winning_team": "TEAM_B",
  "team_a_total": 150,
  "team_b_total": 220,
  "created_at": "2026-04-15T11:00:00.000Z"
}
```

---

### Admin log snapshot

Returns the current `GameplayLog` for admin panel reconnect. Identical to the public board snapshot but protected by `AdminGuard`.

```
GET /api/v1/admin/games/:gameCode/log
X-Admin-Code: <admin_code>
```

**Response `200 OK`** — same shape as [Board snapshot](#board-snapshot).

---

## Admin endpoints — question management

All question management endpoints require `X-Admin-Code`. Questions can only be created or modified **before** the game starts (`play_state` = `LOBBY`).

---

### List questions

```
GET /api/v1/admin/games/:gameCode/questions
X-Admin-Code: <admin_code>
```

**Response `200 OK`** — array of question objects (same shape as the `questions` array in [Get game details](#get-game-details)), sorted by `std_dev` ascending after voting closes.

---

### Add a question

Adds a single question with its options to an existing game.

```
POST /api/v1/admin/games/:gameCode/questions
Content-Type: application/json
X-Admin-Code: <admin_code>
```

**Request body**

```json
{
  "question": "Name something you bring to the beach",
  "options": ["Towel", "Sunscreen", "Sunglasses", "Hat", "Water", "Music"],
  "number_of_options": 6
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `question` | string | ✅ | Max 500 chars |
| `options` | string[] | ✅ | At least 1 option, each max 200 chars |
| `number_of_options` | integer | ❌ | 2–10. Defaults to `6`. Controls how many top options appear on the board. |

**Response `201 Created`** — the created question object with its options.

---

### Bulk import questions

Imports multiple questions atomically. If any question fails validation the entire import is rolled back.

```
POST /api/v1/admin/games/:gameCode/questions/import
Content-Type: application/json
X-Admin-Code: <admin_code>
```

**Request body**

```json
{
  "questions": [
    {
      "question": "Name a pet that is easy to train",
      "options": ["Dog", "Cat", "Goldfish", "Hamster", "Rabbit", "Parrot"]
    },
    {
      "question": "Name a popular sport",
      "options": ["Football", "Basketball", "Tennis", "Cricket", "Swimming", "Golf"],
      "number_of_options": 5
    }
  ]
}
```

**Response `201 Created`**

```json
{
  "imported": 2,
  "questions": [ /* array of created question objects */ ]
}
```

---

### Add an option to a question

Adds one option to an existing question.

```
POST /api/v1/admin/games/:gameCode/questions/:questionId/options
Content-Type: application/json
X-Admin-Code: <admin_code>
```

**Request body**

```json
{
  "option_text": "Mango"
}
```

**Response `201 Created`** — the created option object.

---

## Real-time events (SSE)

### Subscribe to the event stream

```
GET /api/v1/events/:gameCode
Accept: text/event-stream
```

The connection will remain open until the game ends (`FINISHED`) or the client disconnects. A 30-second heartbeat is sent to prevent proxy timeouts.

**JavaScript (browser)**

```js
const source = new EventSource('http://localhost:3000/api/v1/events/ABC123', {
  withCredentials: true,
});

source.onmessage = (event) => {
  const { type, payload } = JSON.parse(event.data);
  handleGameEvent(type, payload);
};

source.onerror = () => {
  // Reconnect logic here — see client guide below
};
```

---

### Event envelope

Every SSE message has the same outer structure:

```json
{
  "type": "<event_type>",
  "payload": { ... }
}
```

---

### Event reference

#### `next_question`

Emitted when the admin advances to the next question.

```json
{
  "type": "next_question",
  "payload": {
    "questionId": "11112222-3333-4444-5555-666677778888",
    "questionText": "Name a fruit you eat with breakfast",
    "totalOptions": 6,
    "roundNumber": 1
  }
}
```

| Field | Description |
|---|---|
| `questionId` | UUID of the active question — use to map reveal events |
| `questionText` | The survey question to display on the board |
| `totalOptions` | How many answer slots to render (blank tiles) |
| `roundNumber` | 1-based index of this question in the game sequence |

---

#### `reveal_option`

Emitted when the admin reveals an answer card.

```json
{
  "type": "reveal_option",
  "payload": {
    "optionId": "aaaa1111-2222-3333-4444-555566667777",
    "optionText": "Banana",
    "votes": 34,
    "rank": 1,
    "points": 39
  }
}
```

| Field | Description |
|---|---|
| `optionId` | UUID of the option — use to flip the right tile |
| `optionText` | Answer text to display |
| `votes` | Total survey votes this answer received |
| `rank` | Board position (1 = most popular, shown at top) |
| `points` | Point value of this answer (`round(votes/total × 100)`) |

---

#### `wrong_option`

Emitted when the admin triggers a strike for a team.

```json
{
  "type": "wrong_option",
  "payload": {
    "team": "TEAM_A",
    "teamName": "The Smiths",
    "strikeCount": 2
  }
}
```

| Field | Description |
|---|---|
| `team` | `"TEAM_A"` or `"TEAM_B"` |
| `teamName` | Display name for the team (from game creation) |
| `strikeCount` | Total strikes so far on the current question (show as ✗ marks) |

---

#### `add_score`

Emitted after the admin adds points to a team.

```json
{
  "type": "add_score",
  "payload": {
    "team": "TEAM_B",
    "teamName": "The Joneses",
    "points": 150,
    "teamATotal": 150,
    "teamBTotal": 370,
    "teamAName": "The Smiths",
    "teamBName": "The Joneses"
  }
}
```

Re-render both scoreboards using `teamATotal` and `teamBTotal` — these are the authoritative running totals.

---

#### `play_winner_sound`

Emitted just before `end_game` — trigger the win fanfare/animation.

```json
{
  "type": "play_winner_sound",
  "payload": {
    "winningTeam": "TEAM_B",
    "teamName": "The Joneses"
  }
}
```

---

#### `end_game`

Emitted when the game ends. Show the final scoreboard.

```json
{
  "type": "end_game",
  "payload": {
    "winningTeam": "TEAM_B",
    "teamName": "The Joneses",
    "teamATotal": 150,
    "teamBTotal": 370,
    "teamAName": "The Smiths",
    "teamBName": "The Joneses"
  }
}
```

Close the SSE connection after receiving this event — the server will close it shortly after anyway.

---

#### `game_state`

Emitted when voting state or play state changes (voting opened/closed, game started).

```json
{
  "type": "game_state",
  "payload": {
    "playState": "IN_PROGRESS",
    "votingState": "CLOSED"
  }
}
```

Use this to toggle UI sections (show vote form, hide vote form, show game board).

---

#### `vote_update`

Emitted after every successful vote. Intended for the admin survey stats view.

```json
{
  "type": "vote_update",
  "payload": {
    "questionId": "11112222-3333-4444-5555-666677778888",
    "totalVotes": 88
  }
}
```

---

#### `heartbeat`

Sent every 30 seconds to keep the connection alive past proxy timeouts. **Ignore in UI logic.**

```json
{
  "type": "heartbeat",
  "payload": {}
}
```

---

## Board snapshot

Call `GET /api/v1/games/:gameCode/board` after an SSE reconnect to resync state rather than replaying all past events. This is the same data the `add_score` and `next_question` responses return.

The snapshot tells you:

- Current running scores for both teams
- Which question is currently on the board
- Which options have been revealed already
- Which questions have been played
- How many strikes are on the board

Combine this with `GET /api/v1/admin/games/:gameCode` (or a cached question list) to fully rebuild the board UI.

---

## Client integration guide

### Recommended player client flow

```
1.  GET /games/:gameCode/join          → sets voter_token cookie, logs session (recommended first step)
2.  GET /events/:gameCode              → open SSE stream (EventSource); listen for game_state events
3.  GET /games/:gameCode/board         → load initial board state (for reconnects)
4.  On SSE game_state { votingState: "OPEN" }:
       GET /games/:gameCode/questions  → fetch questions + options to render the vote form
5.  POST /games/:gameCode/vote         → submit one or more question vote selections in a single batch
       (voter_token cookie is auto-set here if /join was skipped)
6.  On SSE game_state { votingState: "CLOSED" }:
       hide vote form; show "voting closed" message
7.  On SSE next_question / reveal_option / etc. → update game board UI
8.  On SSE error → reconnect + GET /board to resync
```

### Recommended admin client flow

```
1.  POST /admin/games                  → create game, save game_code + admin_code
2.  (optional) POST /admin/games/:code/questions/import  → load question bank
3.  PATCH /admin/games/:code/voting  { voting_state: "OPEN" }  → open voting
4.  (wait for players to vote)
5.  PATCH /admin/games/:code/voting  { voting_state: "CLOSED" } → close voting
6.  POST  /admin/games/:code/start     → start live game
7.  POST  /admin/games/:code/next-question           → load round 1
8.  POST  /admin/games/:code/reveal-option           → for each answer card
9.  POST  /admin/games/:code/wrong-answer (if needed)
10. POST  /admin/games/:code/add-score               → credit winning team
11. Repeat 7–10 for each round
12. POST  /admin/games/:code/end-game                → declare winner
```

### JavaScript fetch helpers

```js
const BASE = 'http://localhost:3000/api/v1';

// ── Player ────────────────────────────────────────────────────────────────

async function joinGame(gameCode) {
  const res = await fetch(`${BASE}/games/${gameCode}/join`, {
    credentials: 'include',
  });
  return res.json();
  // → { message, game_code }
}

/**
 * Fetches questions and their options for the voting form.
 * Only succeeds while voting_state is OPEN.
 * Returns: { gameId, gameName, questions: [{ questionId, question, options: [{ optionId, text }] }] }
 */
async function getQuestionsForVoting(gameCode) {
  const res = await fetch(`${BASE}/games/${gameCode}/questions`, {
    credentials: 'include',
  });
  if (!res.ok) throw await res.json();
  return res.json();
}

function openEventStream(gameCode, onEvent, onReconnect) {
  let source = new EventSource(`${BASE}/events/${gameCode}`, {
    withCredentials: true,
  });

  source.onmessage = (e) => {
    const { type, payload } = JSON.parse(e.data);
    if (type !== 'heartbeat') onEvent(type, payload);
  };

  source.onerror = async () => {
    source.close();
    // Resync board state then reconnect
    await onReconnect();
    source = openEventStream(gameCode, onEvent, onReconnect);
  };

  return source;
}

async function getBoardSnapshot(gameCode) {
  const res = await fetch(`${BASE}/games/${gameCode}/board`, {
    credentials: 'include',
  });
  return res.json();
}

/**
 * Casts a vote. voter_token cookie will be auto-set in the response
 * if the player has not yet called joinGame().
 */
async function castVote(gameCode, { votes }) {
  const res = await fetch(`${BASE}/games/${gameCode}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ votes }),
  });
  return res.json();
  // → { message: "Votes cast successfully" }
}

// ── Admin ─────────────────────────────────────────────────────────────────

async function adminFetch(path, method = 'GET', adminCode, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Code': adminCode,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await res.json();
  return res.json();
}

async function createGame(adminCode, payload) {
  const res = await fetch(`${BASE}/admin/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
  // → { game_code, admin_code, game_id, ... }
}

const api = (adminCode) => ({
  getGame:       (code)     => adminFetch(`/admin/games/${code}`, 'GET', adminCode),
  surveyStats:   (code)     => adminFetch(`/admin/games/${code}/survey-stats`, 'GET', adminCode),
  setVoting:     (code, s)  => adminFetch(`/admin/games/${code}/voting`, 'PATCH', adminCode, { voting_state: s }),
  startGame:     (code)     => adminFetch(`/admin/games/${code}/start`, 'POST', adminCode),
  nextQuestion:  (code)     => adminFetch(`/admin/games/${code}/next-question`, 'POST', adminCode),
  revealOption:  (code, id) => adminFetch(`/admin/games/${code}/reveal-option`, 'POST', adminCode, { optionId: id }),
  wrongAnswer:   (code, t)  => adminFetch(`/admin/games/${code}/wrong-answer`, 'POST', adminCode, { team: t }),
  addScore:      (code, t, pts) => adminFetch(`/admin/games/${code}/add-score`, 'POST', adminCode, { team: t, points: pts }),
  endGame:       (code)     => adminFetch(`/admin/games/${code}/end-game`, 'POST', adminCode),
  getLog:        (code)     => adminFetch(`/admin/games/${code}/log`, 'GET', adminCode),
});
```

### SSE event handler skeleton

```js
function handleGameEvent(type, payload) {
  switch (type) {
    case 'game_state':
      // payload: { playState, votingState }
      // - votingState === "OPEN"   → show vote form; call getQuestionsForVoting() to populate it
      // - votingState === "CLOSED" → hide vote form; show "voting closed" message
      // - playState   === "IN_PROGRESS" → hide survey UI; show game board
      break;

    case 'next_question':
      // payload: { questionId, questionText, totalOptions, roundNumber }
      // Render question text, create N blank answer tiles
      break;

    case 'reveal_option':
      // payload: { optionId, optionText, votes, rank, points }
      // Flip tile at position `rank` to show optionText and points
      break;

    case 'wrong_option':
      // payload: { team, teamName, strikeCount }
      // Show X strike marker(s) on board for the team
      break;

    case 'add_score':
      // payload: { team, teamName, points, teamATotal, teamBTotal, teamAName, teamBName }
      // Update both scoreboards with teamATotal and teamBTotal
      break;

    case 'vote_update':
      // payload: { questionId, totalVotes }
      // Update admin survey stats panel vote counter
      break;

    case 'play_winner_sound':
      // payload: { winningTeam, teamName }
      // Play win fanfare, show winner banner
      break;

    case 'end_game':
      // payload: { winningTeam, teamName, teamATotal, teamBTotal, teamAName, teamBName }
      // Show final scoreboard, close EventSource connection
      break;
  }
}
```

---

## Development commands

```bash
pnpm install          # Install dependencies
pnpm run start:dev    # Start with file watching (hot reload)
pnpm run build        # Compile TypeScript to dist/
pnpm run start:prod   # Run compiled build
pnpm run test         # Run unit tests
pnpm run test:e2e     # Run end-to-end tests
pnpm run test:cov     # Run tests with coverage report
```

---

## Changelog

### April 2026 — Voting flow redesign

This section documents all breaking and additive changes made to the voting flow. Client applications must be updated to match.

---

#### New endpoint: `GET /games/:gameCode/questions`

A new **public** (no auth required) endpoint has been added to return questions and options for voting.

```
GET /api/v1/games/:gameCode/questions
```

- Returns all questions belonging to the game and all options for each question.
- **Only succeeds while `voting_state` is `OPEN`**; returns `400 Bad Request` otherwise.
- Vote counts (`votes`) are **not** included in the response — players cannot see the running tally while voting is live.
- The response includes `gameId`, `questionId`, and `optionId` values that must be forwarded verbatim in the vote request body.

**Response shape:**

```json
{
  "gameId": "<uuid>",
  "gameName": "Family Night 2026",
  "questions": [
    {
      "questionId": "<uuid>",
      "question": "Name a fruit you eat with breakfast",
      "options": [
        { "optionId": "<uuid>", "text": "Banana" },
        { "optionId": "<uuid>", "text": "Apple" }
      ]
    }
  ]
}
```

**Client action required:** Fetch this endpoint when the `game_state` SSE event arrives with `votingState: "OPEN"` (or on initial page load if voting is already open). Use the returned IDs to populate the vote form.

---

#### Changed: `POST /games/:gameCode/vote` now accepts batch submissions and sets the `voter_token` cookie

Previously, a player was required to call `GET /games/:gameCode/join` first to obtain the `voter_token` cookie before submitting a vote — a missing cookie caused a `403 Forbidden` error.

**The vote endpoint now accepts a batch of question submissions in one request and auto-generates the cookie if none is present.** The `Set-Cookie` header is included in the vote response exactly as if the player had called `/join` first.

- Calling `/join` beforehand is still **recommended** for session tracking and audience count accuracy, but it is no longer a hard prerequisite.
- If a client skips `/join` and goes straight to voting, the `voter_token` cookie will be set in the vote response and must be included in subsequent vote requests (browsers handle this automatically; non-browser clients must read and re-send the cookie).
- The `403 Forbidden — missing voter_token` error is **removed**. A `403` from the vote endpoint now means exclusively: "you have already voted on this question."

**Client action required (if applicable):** Remove any hard-coded requirement to call `/join` before rendering the vote form. The guard no longer blocks votes for players who land directly on the voting page.

The vote endpoint now accepts a batch of question submissions in one request. This lets the client submit multiple answers without waiting 10 seconds between separate POST requests.

When the page reloads, re-fetch `/games/:gameCode/questions` and preserve the browser's `voter_token` cookie. If the cookie is still present, the user will keep their vote identity and duplicate submissions are prevented. If the cookie is lost, a new voter identity will be created and previous votes under the lost cookie cannot be recovered.

---

#### Changed: `GET /games/:gameCode/join` — no longer in VotingController

The duplicate `GET /games/:gameCode/join` handler that previously existed in `VotingController` has been removed. The endpoint still exists and is unchanged — it is now served exclusively by `PlayersController`. No URL change; no response shape change.

---

#### Summary of client changes needed

| Area | Change required |
|---|---|
| Vote form data source | **New:** call `GET /games/:gameCode/questions` to get `gameId`, `questionId`, `optionId` values for the form instead of using cached admin data |
| `/join` gate | **Remove** any logic that blocks the vote UI until `/join` has been called; it is now optional |
| Vote submission format | Use the new batch request shape: `votes: [{ gameId, questionId, optionIds }]` |
| `403` handling on `/vote` | Update copy/logic: a `403` now means "already voted", never "not joined" |
| `game_state` SSE handler | When `votingState` transitions to `"OPEN"`, call `getQuestionsForVoting()` and populate the form |
| `game_state` SSE handler | When `votingState` transitions to `"CLOSED"` or `"PAUSED"`, hide/disable the vote form |
