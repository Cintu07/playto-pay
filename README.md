# Playto Pay Payout Engine

This is a small payout engine for the Playto founding engineer challenge. The backend handles the ledger, payout requests, and async settlement. The frontend is just a simple dashboard to view balances, create payouts, and watch status changes.

## How it works

- The ledger is a single append-only `LedgerEntry` table with `available_delta_paise` and `held_delta_paise` stored as integers.
- Payout creation is locked per merchant with `SELECT ... FOR UPDATE`.
- Idempotency keys are stored per merchant for 24 hours and replay the first response.
- Payouts move through `pending -> processing -> completed` or `pending -> processing -> failed`.
- Stuck payouts are retried by Celery Beat with exponential backoff. After 3 attempts, the payout is marked failed and the held funds are returned.
- API reads and payout writes are throttled with DRF scoped throttles.

## Local setup

### Option 1: Docker Compose

1. Copy `.env.example` to `.env` if you want to change defaults.
2. Run `docker compose up --build`.
3. Open `http://localhost:5173` for the dashboard and `http://localhost:8000/api/v1/merchants` for the API.

### Option 2: Local virtualenv and npm

1. Create a PostgreSQL database.
2. Point `DATABASE_URL` at it and set Redis in `CELERY_BROKER_URL`.
3. Install backend deps with `pip install -r backend/requirements.txt`.
4. Install frontend deps with `npm install` inside `frontend`.
5. Run `python manage.py migrate` and `python manage.py seed_demo_data` inside `backend`.
6. Start the API with `python manage.py runserver`.
7. Start the worker with `celery -A config worker -l info`.
8. Start the scheduler with `celery -A config beat -l info`.
9. Start the dashboard with `npm run dev` inside `frontend`.

## Deployment

The easiest path for this project is Render because it can run the Django API, Celery worker, Celery beat, Postgres, Redis, and the static frontend as separate services.

Files added for deployment:

- `render.yaml` for the full stack layout
- `gunicorn` for the Django web process
- `/health/` endpoint for a simple health check
- a non-destructive seed command that can be rerun safely

Important note for the frontend:

- In local dev it uses the Vite proxy and calls `/api/...`
- In deployment it reads `VITE_API_BASE_URL` so the frontend can call a separate backend URL

If you use Render, create the services from `render.yaml`, then set `VITE_API_BASE_URL` on the frontend to your API base URL like `https://your-api.onrender.com`.
Also set `CORS_ALLOWED_ORIGINS` on the backend to your frontend URL, for example `https://your-ui.onrender.com`.

For demo data in a hosted environment, run `python manage.py seed_demo_data` once after the first deploy. If you really want to wipe and reseed everything, run `python manage.py seed_demo_data --reset`.
If you only want to remove payouts created during manual testing while keeping the seed baseline intact, run `python manage.py reset_demo_runtime_data`.

## Seed data

The seed command creates 3 merchants, one bank account for each merchant, some inbound credit history, and a couple of settled payouts.

Run:

```bash
cd backend
python manage.py seed_demo_data
```

## API

Merchant identity is simulated with the `X-Merchant-Id` header. The frontend fetches merchant IDs from `GET /api/v1/merchants` and uses the selected merchant on every request.

Create payout:

```bash
curl -X POST http://localhost:8000/api/v1/payouts \
  -H "Content-Type: application/json" \
  -H "X-Merchant-Id: <merchant-uuid>" \
  -H "Idempotency-Key: <uuid>" \
  -d '{"amount_paise": 6000, "bank_account_id": "<bank-account-uuid>"}'
```

Useful endpoints:

- `GET /api/v1/merchants`
- `GET /api/v1/dashboard`
- `GET /api/v1/payouts`
- `POST /api/v1/payouts`

List scaling options:

- `GET /api/v1/dashboard?payout_limit=10&ledger_limit=10` (both bounded to 1..50)
- `GET /api/v1/payouts?limit=20&offset=0` (limit bounded to 1..100)

## Tests

Run backend tests:

```bash
cd backend
python manage.py test apps.payouts
```

Notes:

- The idempotency test runs on SQLite and PostgreSQL.
- The concurrency test is intentionally PostgreSQL-only because SQLite does not support the row-locking semantics the challenge is grading.
- Before submission, run the concurrency test once against PostgreSQL, not SQLite.

## Frontend

The UI is intentionally simple.

- Merchant selector drives the simulated authenticated context.
- Dashboard polls every 5 seconds.
- Payout form creates a fresh UUID idempotency key for each manual submission.
- Balance cards show available, held, and total derived values from the backend ledger.

## What I left out

- Real auth and user management.
- Real bank integrations.
- WebSockets. Polling is enough here and keeps the moving pieces small.

See `EXPLAINER.md` for the engineering notes asked for in the submission.