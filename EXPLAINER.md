# Explainer

This file answers the exact questions from the challenge.

## The Ledger

Balance is derived from one append-only ledger table.

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

I modeled it this way because I did not want one mutable balance field to become the source of truth.

Each ledger row explains one money movement:

- `credit` adds money to available balance.
- `hold` moves money from available to held when a payout is requested.
- `release` moves money back from held to available when a payout fails.
- `debit` removes money from held when a payout settles.

That gives me a clear audit trail and keeps the invariant simple. Available plus held always comes from summing ledger entries in the database.

## The Lock

This is the code that stops two concurrent payouts from spending the same money:

```python
with transaction.atomic():
    merchant = Merchant.objects.select_for_update().get(pk=merchant.pk)
    IdempotencyKey.objects.filter(
        merchant=merchant,
        key=idempotency_key,
        expires_at__lte=now,
    ).delete()

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

The database primitive here is `SELECT ... FOR UPDATE` on the merchant row.

On PostgreSQL, that row lock serializes payout creation for the same merchant inside the transaction. If two 6000 paise requests arrive against a 10000 paise balance, one request gets the lock first, creates the hold, and commits. The second request only checks balance after that, so it sees the reduced available balance and is rejected cleanly.

## The Idempotency

The system knows it has seen a key before because it stores every key in the `IdempotencyKey` table, scoped by merchant, with a unique constraint on `(merchant, key)`.

For each key I store:

- the merchant
- the idempotency key
- a hash of the request payload
- the original response status
- the original response body
- an expiry time 24 hours in the future

The important part of the request path is this:

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

If the same merchant sends the same key with the same payload, the API returns the original response. No second payout is created.

If the same key is reused with a different payload, it returns a conflict.

If the first request is still in flight when the second arrives, the unique constraint prevents a second idempotency row from being created. The second request then loads the existing row under lock. If the first request has not stored its final response yet, the second request gets a conflict saying the original request is still being finalized.

## The State Machine

The transition rules live on the `Payout` model:

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

That is where `failed -> completed` is blocked. `failed` has an empty set of allowed next states, so any attempt to move it to `completed` raises a validation error before save.

When a payout fails, the failed transition and the fund release happen in the same transaction:

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
        description="Held funds released after payout failure",
    )
```

So the system cannot mark a payout as failed without also returning the held funds.

## The AI Audit

One place where AI gave me subtly wrong code was payout retry handling.

The first draft treated any payout already in `processing` as ready to keep going, which meant duplicate worker tasks could increment `attempt_count` too early.

This was the bad draft shape:

```python
if payout.status == Payout.Status.PENDING:
    _transition_payout(payout, Payout.Status.PROCESSING)
elif payout.status != Payout.Status.PROCESSING:
    return payout

payout.attempt_count += 1
```

What I replaced it with:

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

The fix matters because a payout in `processing` should only be retried when its retry time is due. Without that guard, duplicate jobs could burn retry budget and distort state even if the payout was not actually ready for another attempt.