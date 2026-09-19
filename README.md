# Job Hunting Pipeline
Local dashboard for finding, reviewing, and tracking Canada-focused Co-op / New Grad software roles.
Jobs live in a local SQLite database. You browse a **Queue**, mark roles as **Applied** or **Not interested**, and optionally run an **AI search** that writes new listings into the catalog.
## Features
- **Queue** — unapplied roles with filters (posted date, role type, location, source, salary, big-tech, dedupe)
- **Applications** — applied roles, filterable by date, expandable JD / link
- **已申请** — move a Queue item into Applications
- **不感兴趣** — remove from Queue and keep it out of future refreshes / AI merges
- **刷新未投岗位** — merge catalog roles that are not yet applied or dismissed
- **AI 搜岗** — run a Cursor local agent against your knowledge base (uses Cursor API token)
## Stack
| Piece | Role |
|---|---|
| `dashboard/server.py` | Static UI + JSON API on `127.0.0.1:8765` |
| `dashboard/jobs.db` | SQLite: `catalog`, `queue`, `applications`, `dismissed` |
| `dashboard/index.html` + `app.js` | Frontend |
| `dashboard/data.js` | Seed / AI-writable job source |
| `dashboard/ai_search.py` | Cursor Agent job-search runner |
| `knowledge.md` | Personal job-search rules (gitignored) |
## Setup
Requires **Python 3.10+** and **Node.js** (used once to parse `data.js` on import).
```bash
cd job_hungting_pipeline
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```
For AI search only, copy the env example and add a Cursor API key:
```bash
cp .env.example .env
# edit .env → CURSOR_API_KEY=...
```
See [Cursor Integrations](https://cursor.com/dashboard/integrations) for the key. Optional: `CURSOR_MODEL` (default `composer-2.5`).
## Run
```bash
cd dashboard
../.venv/bin/python server.py
```
Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/).
Do **not** use a plain `python -m http.server` for the UI — apply / dismiss / refresh need the API + SQLite.
## Typical workflow
1. Start the server and open the dashboard.
2. Use filters on **Queue**, or click **刷新未投岗位** to pull unapplied catalog roles.
3. For each card:
   - **已申请** → moves to Applications
   - **不感兴趣** → drops from Queue and is remembered in `dismissed`
4. On **Applications**, expand a card for URL / JD, or **移回 Queue** if clicked by mistake.
5. Optional: **AI 搜岗** (needs `.env`) — agent searches lightly, appends to `data.js`, then the server refreshes the Queue.
Chat-based search also works: ask an agent to find roles using `knowledge.md`, write them into `data.js`, then hit **刷新未投岗位**.
## Data model
### `data.js` job fields
| Field | Meaning |
|---|---|
| `id` | e.g. `q-001` |
| `company` / `title` / `url` | Identity |
| `location` / `salary` / `notes` | Display + filters |
| `addedAt` | Date added to Queue |
| `postedAt` | Posting date (optional; UI falls back to `addedAt`) |
| `roleType` | `new_grad` \| `intern` \| `full_time` |
| `bigTech` | Preferential flag |
| `source` | e.g. Indeed, LinkedIn |
Deduping uses a normalized URL when present, otherwise `company + title`.
### SQLite tables
- **catalog** — full known job library (imported from `data.js`)
- **queue** — currently visible unapplied jobs
- **applications** — applied history
- **dismissed** — not-interested keys so refresh / AI merge skip them
`jobs.db` is local and gitignored.
## API (local)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness + DB path |
| GET | `/api/state` | Queue + applications + dismissed |
| POST | `/api/apply` | `{ "id": "q-…" }` |
| POST | `/api/unapply` | `{ "id": "a-…" }` |
| POST | `/api/dismiss` | `{ "id": "q-…" }` |
| POST | `/api/refresh-queue` | Re-import catalog + merge unapplied |
| POST | `/api/ai-search` | Start AI search |
| GET | `/api/ai-search` | Poll AI search status |
## Project layout
```
job_hungting_pipeline/
├── README.md
├── requirements.txt
├── .env.example
├── knowledge.md          # personal; not committed
└── dashboard/
    ├── server.py
    ├── ai_search.py
    ├── index.html
    ├── app.js
    ├── data.js
    ├── seed.json         # optional cache from data.js parse
    └── jobs.db           # created at runtime
```
## Privacy
- Keep `.env` and `knowledge.md` out of git (already ignored).
- Do not commit `jobs.db` or personal contact details from the knowledge base.
