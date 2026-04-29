# EXPLAINER

This note explains the decisions that matter most for the assignment. The goal was to keep the system small, but still safe for money movement.

## 1) Ledger design

The balance is derived from a single append-only ledger.

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

Reasoning:

- I avoided a mutable "current balance" field as the source of truth.
- `credit` adds to available.
- `hold` moves funds from available to held.
- `release` moves failed hold funds back to available.
- `debit` removes held funds on successful settlement.

This keeps the audit trail explicit, and the important invariant stays visible: changes in available plus held align with credits and debits over time.

## 2) Concurrency lock

Payout creation is wrapped in a transaction and locks the merchant row.

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

Why this matters:

- `select_for_update()` serializes concurrent payout creation for the same merchant on PostgreSQL.
- The second request waits for the first to commit or roll back.
- That prevents the common race where two requests both see the same pre-deduct balance.

## 3) Idempotency behavior

Idempotency is handled through a dedicated table with a unique constraint on `(merchant, key)`.

What is stored:

- key and merchant pair
- payload hash
- original response body and status code

Behavior:

- Same key and same payload returns the original response.
- Same key and different payload returns `409 idempotency_conflict`.
- If one request is still finishing, duplicate requests do not create a second payout.

This is meant to tolerate client retries without creating duplicate money movement.

## 4) Payout state machine

The payout model enforces legal transitions directly.

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

Effect:

- Illegal paths such as `failed -> completed` are blocked before save.
- The state graph is simple and predictable.
- On failure, held funds are released in the same transaction that marks the payout failed.

## 5) AI usage and correction

I used AI for speed, but reviewed logic manually.

One draft bug I corrected was in retry handling for payouts already in `processing`. The draft could increment attempts too early when duplicate worker tasks happened.

Draft pattern:

```python
if payout.status == Payout.Status.PENDING:
    payout.transition_to(Payout.Status.PROCESSING)
elif payout.status != Payout.Status.PROCESSING:
    return payout

payout.attempt_count += 1
```

Fixed pattern:

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

Why this is safer:

- New payouts move into processing once.
- Existing processing payouts are retried only when their retry time is due.
- Duplicate tasks become no-ops instead of inflating retry attempts.

## Current validation status

What I ran before writing this:

- local backend system check
- local backend tests for payouts
- local frontend production build
- hosted API smoke checks for health, merchant fetch, dashboard, payout create, idempotency replay, and conflict on changed payload

One hosting note:

- The hosted backend is healthy and processing payouts.
- The hosted frontend URL was still serving the previous UI build at the time of validation, so it needs a frontend redeploy to show the latest design commit.