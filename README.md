# Playto Pay Payout Engine

This is a small payout engine for the Playto founding engineer challenge. The backend handles the ledger, payout requests, and async settlement. The frontend is just a simple dashboard to view balances, create payouts, and watch status changes.

## How it works

- The ledger is a single append-only `LedgerEntry` table with `available_delta_paise` and `held_delta_paise` stored as integers.
- Payout creation is locked per merchant with `SELECT ... FOR UPDATE`.
- Idempotency keys are stored per merchant for 24 hours and replay the first response.
- Payouts move through `pending -> processing -> completed` or `pending -> processing -> failed`.
- Stuck payouts are retried by Celery Beat with exponential backoff. After 3 attempts, the payout is marked failed and the held funds are returned.

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

## Tests

Run backend tests:

```bash
cd backend
python manage.py test apps.payouts
```

Notes:

- The idempotency test runs on SQLite and PostgreSQL.
- The concurrency test is intentionally PostgreSQL-only because SQLite does not support the row-locking semantics the challenge is grading.

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