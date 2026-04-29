# Explainer

I treated this challenge as a payout engine first and a dashboard second.

The risky part of this system is not the UI. It is making sure a merchant cannot overdraw balance, duplicate payouts do not happen when clients retry requests, failed payouts return funds cleanly, and the ledger always explains where the money went. So I kept the scope small and spent most of the work on the money-moving path.

What I shipped is a Django and DRF backend, a Celery worker path for payout processing and retries, a React dashboard for balances and payouts, backend tests for the money-moving paths, frontend regression tests for the final UI, and a live Render deployment with seeded merchants.

I also did a final live pass on the hosted app instead of stopping at local tests. That caught one real frontend bug. The payout form was allowing decimal INR amounts like `1.5` even though the form copy said whole-number INR only. I fixed that, added a regression test for it, redeployed, and then verified on the live app that the form blocks decimals and a real 100 paise payout still completes correctly.

## What I built

- a single ledger table with integer deltas for available and held balance
- a payout request API with merchant-scoped idempotency keys
- an async payout processor with simulated settlement outcomes, retries, and retry exhaustion handling
- a simple React dashboard with merchant switching, payout creation, payout history, and ledger movement
- a live Render deployment seeded with test data
- a non-destructive demo reset command so hosted test activity can be cleaned without wiping the seed baseline

I kept the dashboard intentionally simple. Merchant identity is simulated with the `X-Merchant-Id` header, the UI polls every 5 seconds, and I did not add auth, websockets, or anything else that would add moving parts without helping the core assignment.

## The ledger

The balance is not stored as one mutable field. It is derived from the ledger.

This is the balance query:

```python
totals = merchant.ledger_entries.aggregate(
    available_balance=Coalesce(
        Sum("available_delta_paise"),
        Value(0),
        output_field=BigIntegerField(),
    ),
    held_balance=Coalesce(
        Sum("held_delta_paise"),
        Value(0),
        output_field=BigIntegerField(),
    ),
)
```

I modeled credits and debits this way because I wanted the ledger to be the source of truth, not a mutable balance column that could drift over time.

Each row explains one money movement:

- `credit` adds to available balance when inbound funds are settled
- `hold` moves funds from available to held when a payout is requested
- `release` moves funds back from held to available when a payout fails
- `debit` removes funds from held when the payout completes

All money values are stored as `BigIntegerField` in paise. I avoided floats completely. I also did not use `DecimalField` because this system only needs exact integer paise arithmetic, and integer sums are the simplest thing to trust for this kind of invariant.

The main reason I like this model is that it is easy to audit. If someone asks why a merchant has a certain available or held balance, I can answer that by reading ledger rows instead of trusting one mutable number.

## The lock

This is the critical code path inside `create_payout_request` that prevents two concurrent payout requests from spending the same balance:

```python
with transaction.atomic():
    merchant = Merchant.objects.select_for_update().get(pk=merchant.pk)
    IdempotencyKey.objects.filter(
        merchant=merchant,
        key=idempotency_key,
        expires_at__lte=now,
    ).delete()

    try:
        with transaction.atomic():
            idempotency_record = IdempotencyKey.objects.create(
                merchant=merchant,
                key=idempotency_key,
                request_hash=request_hash,
                expires_at=now + timedelta(hours=24),
            )
    except IntegrityError:
        idempotency_record = IdempotencyKey.objects.select_for_update().get(
            merchant=merchant,
            key=idempotency_key,
        )
        if idempotency_record.request_hash != request_hash:
            raise IdempotencyConflictError("The idempotency key was already used for a different payload")
        if idempotency_record.response_status is None or idempotency_record.response_body is None:
            raise IdempotencyConflictError("The original request is still being finalized")
        return ServiceResult(
            status_code=idempotency_record.response_status,
            payload=idempotency_record.response_body,
        )

    bank_account = BankAccount.objects.select_for_update().get(
        pk=bank_account_id,
        merchant=merchant,
        is_active=True,
    )
    balances = get_balance_snapshot(merchant)
    if balances["available_balance_paise"] < amount_paise:
        payload = InsufficientFundsError(
            f"Insufficient funds: requested {amount_paise} paise, available {balances['available_balance_paise']} paise"
        ).as_response()
        idempotency_record.store_response(status=422, body=payload)
        idempotency_record.save(update_fields=["response_status", "response_body"])
        return ServiceResult(status_code=422, payload=payload)

    payout = Payout.objects.create(
        merchant=merchant,
        bank_account=bank_account,
        amount_paise=amount_paise,
        idempotency_key=idempotency_key,
    )
    LedgerEntry.objects.create(
        merchant=merchant,
        payout=payout,
        entry_type=LedgerEntry.EntryType.HOLD,
        available_delta_paise=-amount_paise,
        held_delta_paise=amount_paise,
        reference=str(payout.id),
        description="Funds moved to payout hold",
    )
```

The database primitive that matters here is `SELECT ... FOR UPDATE` on the merchant row.

I used the merchant row as the serialization point for payout creation. On PostgreSQL, one request gets that lock first, computes the balance snapshot, and creates the hold. A second request for the same merchant cannot evaluate balance until the first one commits or rolls back.

That is what makes the classic race condition go away. If a merchant has 10000 paise and two 6000 paise requests arrive at the same time, exactly one request can reserve the funds. The other request sees the reduced available balance and gets rejected cleanly.

I also wrote a concurrency test for this, and I kept it PostgreSQL-only on purpose. SQLite is fine for general tests, but it is not a real proof of row-locking behavior.

## The idempotency

The system knows it has seen a key before because every merchant key is stored in the `IdempotencyKey` table, with a unique constraint on `(merchant, key)`.

For each idempotency record I store:

- the merchant
- the key
- a hash of the request payload
- the original response status
- the original response body
- an expiry time 24 hours in the future

This is the core part of the logic:

```python
try:
    with transaction.atomic():
        idempotency_record = IdempotencyKey.objects.create(
            merchant=merchant,
            key=idempotency_key,
            request_hash=request_hash,
            expires_at=now + timedelta(hours=24),
        )
except IntegrityError:
    idempotency_record = IdempotencyKey.objects.select_for_update().get(
        merchant=merchant,
        key=idempotency_key,
    )
    if idempotency_record.request_hash != request_hash:
        raise IdempotencyConflictError("The idempotency key was already used for a different payload")
    if idempotency_record.response_status is None or idempotency_record.response_body is None:
        raise IdempotencyConflictError("The original request is still being finalized")
    return ServiceResult(
        status_code=idempotency_record.response_status,
        payload=idempotency_record.response_body,
    )
```

If the same merchant sends the same key with the same payload, the API returns the exact same response as the first request. No second payout is created.

If the same key is reused with a different payload, I return an idempotency conflict.

If the first request is still in flight when the second request arrives, the unique constraint still prevents a second idempotency row from being inserted. The second request then reads the existing row under lock. If the first request has not stored the final response yet, the second request gets a conflict saying the original request is still being finalized.

At the start of payout creation I also delete expired idempotency rows for that merchant and key. That keeps the 24-hour key window working without letting old records block legitimate reuse forever.

## The state machine

The legal payout transitions are defined on the `Payout` model itself:

```python
ALLOWED_TRANSITIONS = {
    Status.PENDING: {Status.PROCESSING},
    Status.PROCESSING: {Status.COMPLETED, Status.FAILED},
    Status.COMPLETED: set(),
    Status.FAILED: set(),
}

def transition_to(self, next_status: str) -> None:
    if next_status not in self.ALLOWED_TRANSITIONS[self.status]:
        raise ValidationError(f"Illegal payout transition: {self.status} -> {next_status}")
    self.status = next_status
```

This is where `failed -> completed` is blocked. `failed` has no allowed next states, so any attempt to move it forward raises a validation error before save.

When a payout fails, the failed transition and the balance release happen in the same transaction:

```python
with transaction.atomic():
    payout = Payout.objects.select_for_update().select_related("merchant").get(pk=payout_id)
    _transition_payout(payout, Payout.Status.FAILED)
    LedgerEntry.objects.create(
        merchant=payout.merchant,
        payout=payout,
        entry_type=LedgerEntry.EntryType.RELEASE,
        available_delta_paise=payout.amount_paise,
        held_delta_paise=-payout.amount_paise,
        reference=str(payout.id),
        description="Held funds released back to merchant",
    )
    payout.failure_reason = reason
    payout.next_retry_at = None
    payout.save(update_fields=["status", "failure_reason", "next_retry_at", "updated_at"])
```

That atomicity matters. I never want a payout to become `failed` while the money is still stuck in held balance.

## Retries and background processing

Payout processing is async. The API request only creates the payout and the hold. The worker handles the simulated settlement result.

I also made sure the worker is only queued after the request transaction commits:

```python
if enqueue_task:
    from .tasks import process_pending_payout

    transaction.on_commit(lambda: process_pending_payout.delay(str(payout.id)))
```

That matters because I do not want the worker to race ahead of the database commit.

The worker moves `pending` payouts into `processing`, then simulates bank behavior with a 70 percent success rate, 20 percent failure rate, and 10 percent hang rate. On a hang, it sets `next_retry_at` using exponential backoff.

This is the part that prevents processing payouts from being retried too early:

```python
if payout.status == Payout.Status.PENDING:
    _transition_payout(payout, Payout.Status.PROCESSING)
elif payout.status != Payout.Status.PROCESSING:
    return payout
elif not payout.next_retry_at or payout.next_retry_at > now:
    return payout

payout.attempt_count += 1
payout.processing_started_at = now
payout.next_retry_at = None
```

The timeout is 30 seconds, and the maximum attempts value is 3.

Due retries are picked up with `select_for_update(skip_locked=True)`, and once the retry budget is exhausted the payout is moved to `failed` and the held funds are released back to available balance.

## The dashboard

I kept the frontend simple on purpose.

It shows:

- available, held, and total balance
- recent payout history
- recent ledger movement
- a payout form tied to the selected merchant and bank account

The dashboard polls every 5 seconds. Merchant switching simulates authenticated context. The payout form creates a fresh UUID idempotency key for each manual submission.

I also made a deliberate layout cleanup late in the task. I replaced the more fragile panel grid with a simple stacked layout and made the payout form fill the available width. That made the page easier to scan and removed the odd whitespace behavior from the earlier layout.

The most useful frontend lesson came from live testing. The hosted UI exposed a real mismatch between the form copy and the validation logic. The form said whole-number INR only, but decimal input like `1.5` was still getting through. I fixed that by requiring digits-only input for the amount and added a regression test so it would not come back.

## How I tested it

I tried to validate this at three levels.

Backend:

- `python manage.py check`
- `python manage.py test apps.payouts`
- idempotency test
- PostgreSQL-only concurrency test for double-withdrawal protection

Frontend:

- `npm test`
- `npm run build`
- regression tests for the stacked layout
- regression tests for payout form validation, including blocking decimal INR amounts

Live deployment:

- verified merchant switching on the hosted UI
- verified decimal amounts are rejected on the hosted UI
- created a real 100 paise payout for Orbit Labs on the hosted app
- verified the completed payout row appeared in payout history
- verified the ledger showed both the hold and debit entries
- verified the merchant balance dropped from 1200 rupees to 1199 rupees

That last part mattered to me. I did not want to submit this based only on local tests when the assignment is explicitly about production-style money movement.

## The AI audit

AI was useful for speed, but one place where it gave me subtly wrong code was retry handling for payouts already in `processing`.

The bad draft effectively treated any payout already in `processing` as ready for another attempt:

```python
if payout.status == Payout.Status.PENDING:
    _transition_payout(payout, Payout.Status.PROCESSING)
elif payout.status != Payout.Status.PROCESSING:
    return payout

payout.attempt_count += 1
```

That looked harmless at first, but it was wrong. Duplicate worker tasks could burn retry budget even when the payout was not actually due for retry yet.

I replaced it with this:

```python
if payout.status == Payout.Status.PENDING:
    _transition_payout(payout, Payout.Status.PROCESSING)
elif payout.status != Payout.Status.PROCESSING:
    return payout
elif not payout.next_retry_at or payout.next_retry_at > now:
    return payout

payout.attempt_count += 1
payout.processing_started_at = now
payout.next_retry_at = None
```

The difference is small, but important. A payout in `processing` is only eligible for another attempt when its retry time is due. Anything else should be a no-op.

That is the main reason I do not trust AI code just because it looks neat. The dangerous bugs in a system like this are usually the ones that look almost correct.

## What I would improve next

If I had more time, I would focus on operational confidence rather than more features.

- run the concurrency path against a production-like PostgreSQL environment more aggressively
- add a few more tests around retry timing edges and worker duplication
- tighten observability around payout lifecycle transitions and retry exhaustion

I would not spend that time on fancy UI work. For this task, correctness and clarity matter much more.
