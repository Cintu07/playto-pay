# EXPLAINER

## 1. The Ledger

Balance query:

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

Why this model:

- I wanted one append-only ledger instead of a mutable balance column.
- `credit` entries increase available balance.
- `hold` moves money from available to held without changing total balance.
- `release` reverses a failed hold.
- `debit` reduces held balance when the payout is finally settled.
- This makes the invariant easy to inspect: `sum(available_delta_paise + held_delta_paise)` equals credits minus debits at all times.

## 2. The Lock

Exact code:

```python
with transaction.atomic():
    merchant = Merchant.objects.select_for_update().get(pk=merchant.pk)
    balances = get_balance_snapshot(merchant)
    if balances["available_balance_paise"] < amount_paise:
        ...
    payout = Payout.objects.create(...)
    LedgerEntry.objects.create(
        merchant=merchant,
        payout=payout,
        entry_type=LedgerEntry.EntryType.HOLD,
        available_delta_paise=-amount_paise,
        held_delta_paise=amount_paise,
        ...
    )
```

What primitive it relies on:

- `select_for_update()` acquires a row-level lock on the merchant row inside a database transaction.
- On PostgreSQL, the second concurrent payout request for the same merchant waits until the first one commits or rolls back.
- That removes the classic check-then-deduct race. Only one request can compute available balance and create the hold at a time.

## 3. The Idempotency

How the system knows it has seen a key before:

- There is an `IdempotencyKey` table with a unique constraint on `(merchant, key)`.
- The request body is hashed and stored as `request_hash`.
- The first request stores both the response body and status code.

What happens if the first request is in flight when the second arrives:

- The second request hits the same `(merchant, key)` unique constraint.
- After the first request commits, the second request reads the stored response and returns it unchanged.
- If the same key is reused with a different payload, the API returns `409 idempotency_conflict`.

## 4. The State Machine

The check that blocks failed-to-completed:

```python
def transition_to(self, next_status: str) -> None:
    if next_status not in self.ALLOWED_TRANSITIONS[self.status]:
        raise ValidationError(f"Illegal payout transition: {self.status} -> {next_status}")
    self.status = next_status
```

And the allowed transitions are:

```python
ALLOWED_TRANSITIONS = {
    Status.PENDING: {Status.PROCESSING},
    Status.PROCESSING: {Status.COMPLETED, Status.FAILED},
    Status.COMPLETED: set(),
    Status.FAILED: set(),
}
```

So `failed -> completed`, `completed -> pending`, and every other backward move raise immediately before the payout is saved.

## 5. The AI Audit

One wrong draft I caught:

```python
if payout.status == Payout.Status.PENDING:
    payout.transition_to(Payout.Status.PROCESSING)
elif payout.status != Payout.Status.PROCESSING:
    return payout

payout.attempt_count += 1
```

Why it was wrong:

- That code let duplicate worker tasks re-process a payout that was already in `processing`.
- If Celery queued the same payout twice, the second worker could increment attempts immediately instead of waiting for the retry timeout.
- That is a subtle race condition and it distorts retry behavior.

What I replaced it with:

```python
if payout.status == Payout.Status.PENDING:
    payout.transition_to(Payout.Status.PROCESSING)
elif payout.status != Payout.Status.PROCESSING:
    return payout
elif not payout.next_retry_at or payout.next_retry_at > now:
    return payout

payout.attempt_count += 1
payout.processing_started_at = now
payout.next_retry_at = None
```

Why the replacement is correct:

- Fresh payouts can move into `processing` once.
- Already-processing payouts only run again when the retry timestamp is actually due.
- Duplicate tasks become harmless no-ops instead of creating fake retry attempts.