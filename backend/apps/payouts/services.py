from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
import hashlib
import json
import random
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import BigIntegerField, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from .models import BankAccount, IdempotencyKey, LedgerEntry, Merchant, Payout


class PayoutError(Exception):
    status_code = 400
    code = "payout_error"

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message

    def as_response(self) -> dict:
        return {"error": self.code, "message": self.message}


class MerchantContextError(PayoutError):
    status_code = 400
    code = "merchant_context_invalid"


class InsufficientFundsError(PayoutError):
    status_code = 422
    code = "insufficient_funds"


class IdempotencyConflictError(PayoutError):
    status_code = 409
    code = "idempotency_conflict"


class ResourceLookupError(PayoutError):
    status_code = 404
    code = "resource_not_found"


class StateTransitionError(PayoutError):
    status_code = 409
    code = "invalid_state_transition"


@dataclass
class ServiceResult:
    status_code: int
    payload: dict


def resolve_merchant(merchant_id: str | None) -> Merchant:
    if not merchant_id:
        raise MerchantContextError("Missing X-Merchant-Id header")
    try:
        return Merchant.objects.get(id=merchant_id)
    except Merchant.DoesNotExist as exc:
        raise MerchantContextError("Unknown merchant") from exc


def validate_idempotency_key(raw_key: str | None) -> str:
    if not raw_key:
        raise MerchantContextError("Missing Idempotency-Key header")
    try:
        return str(uuid.UUID(raw_key))
    except ValueError as exc:
        raise MerchantContextError("Idempotency-Key must be a UUID") from exc


def get_balance_snapshot(merchant: Merchant) -> dict[str, int]:
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
    available_balance = int(totals["available_balance"])
    held_balance = int(totals["held_balance"])
    return {
        "available_balance_paise": available_balance,
        "held_balance_paise": held_balance,
        "total_balance_paise": available_balance + held_balance,
    }


def build_dashboard_payload(merchant: Merchant) -> dict:
    merchant = Merchant.objects.prefetch_related("bank_accounts").get(pk=merchant.pk)
    return {
        "merchant": merchant,
        "balances": get_balance_snapshot(merchant),
        "bank_accounts": merchant.bank_accounts.filter(is_active=True).order_by("label"),
        "recent_ledger_entries": merchant.ledger_entries.all()[:10],
        "payouts": merchant.payouts.select_related("bank_account").all()[:10],
    }


def _request_hash(*, amount_paise: int, bank_account_id: str) -> str:
    payload = json.dumps(
        {
            "amount_paise": amount_paise,
            "bank_account_id": bank_account_id,
        },
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _serialize_payout(payout: Payout) -> dict:
    return {
        "payout": {
            "id": str(payout.id),
            "merchant_id": str(payout.merchant_id),
            "bank_account_id": str(payout.bank_account_id),
            "amount_paise": payout.amount_paise,
            "idempotency_key": payout.idempotency_key,
            "status": payout.status,
            "attempt_count": payout.attempt_count,
            "failure_reason": payout.failure_reason,
            "processing_started_at": payout.processing_started_at.isoformat() if payout.processing_started_at else None,
            "next_retry_at": payout.next_retry_at.isoformat() if payout.next_retry_at else None,
            "created_at": payout.created_at.isoformat(),
            "updated_at": payout.updated_at.isoformat(),
        }
    }


def create_payout_request(
    *,
    merchant: Merchant,
    amount_paise: int,
    bank_account_id: str,
    idempotency_key: str,
    enqueue_task: bool = True,
) -> ServiceResult:
    now = timezone.now()
    request_hash = _request_hash(amount_paise=amount_paise, bank_account_id=bank_account_id)

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

        try:
            bank_account = BankAccount.objects.select_for_update().get(
                pk=bank_account_id,
                merchant=merchant,
                is_active=True,
            )
        except BankAccount.DoesNotExist as exc:
            raise ResourceLookupError("Bank account was not found for this merchant") from exc
        balances = get_balance_snapshot(merchant)
        if balances["available_balance_paise"] < amount_paise:
            payload = InsufficientFundsError("Available balance is lower than the requested payout").as_response()
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
        payload = _serialize_payout(payout)
        idempotency_record.store_response(status=201, body=payload)
        idempotency_record.save(update_fields=["response_status", "response_body"])

        if enqueue_task:
            from .tasks import process_pending_payout

            transaction.on_commit(lambda: process_pending_payout.delay(str(payout.id)))

    return ServiceResult(status_code=201, payload=payload)


def _transition_payout(payout: Payout, next_status: str) -> None:
    try:
        payout.transition_to(next_status)
    except ValidationError as exc:
        raise StateTransitionError(str(exc)) from exc


def mark_payout_completed(*, payout_id: str) -> Payout:
    with transaction.atomic():
        payout = Payout.objects.select_for_update().select_related("merchant").get(pk=payout_id)
        _transition_payout(payout, Payout.Status.COMPLETED)
        LedgerEntry.objects.create(
            merchant=payout.merchant,
            payout=payout,
            entry_type=LedgerEntry.EntryType.DEBIT,
            available_delta_paise=0,
            held_delta_paise=-payout.amount_paise,
            reference=str(payout.id),
            description="Payout settled successfully",
        )
        payout.failure_reason = ""
        payout.next_retry_at = None
        payout.save(update_fields=["status", "failure_reason", "next_retry_at", "updated_at"])
        return payout


def mark_payout_failed(*, payout_id: str, reason: str) -> Payout:
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
        return payout


def process_payout_attempt(*, payout_id: str) -> Payout:
    timeout_seconds = settings.PAYOUT_PROCESSING_TIMEOUT_SECONDS
    now = timezone.now()

    with transaction.atomic():
        payout = Payout.objects.select_for_update().select_related("merchant").get(pk=payout_id)
        if payout.status == Payout.Status.PENDING:
            _transition_payout(payout, Payout.Status.PROCESSING)
        elif payout.status != Payout.Status.PROCESSING:
            return payout
        elif not payout.next_retry_at or payout.next_retry_at > now:
            return payout

        payout.attempt_count += 1
        payout.processing_started_at = now
        payout.next_retry_at = None
        payout.failure_reason = ""
        payout.save(
            update_fields=[
                "status",
                "attempt_count",
                "processing_started_at",
                "next_retry_at",
                "failure_reason",
                "updated_at",
            ]
        )

    roll = random.random()
    if roll < 0.7:
        return mark_payout_completed(payout_id=payout_id)
    if roll < 0.9:
        return mark_payout_failed(payout_id=payout_id, reason="Simulated bank failure")

    backoff_seconds = timeout_seconds * (2 ** max(payout.attempt_count - 1, 0))
    with transaction.atomic():
        payout = Payout.objects.select_for_update().get(pk=payout_id)
        payout.next_retry_at = timezone.now() + timedelta(seconds=backoff_seconds)
        payout.save(update_fields=["next_retry_at", "updated_at"])
    return payout


def retry_or_fail_stuck_payouts() -> list[str]:
    now = timezone.now()
    due_ids: list[str] = []
    with transaction.atomic():
        payouts = list(
            Payout.objects.select_for_update(skip_locked=True).filter(
                status=Payout.Status.PROCESSING,
                next_retry_at__lte=now,
            )
        )
        for payout in payouts:
            if payout.attempt_count >= settings.PAYOUT_MAX_ATTEMPTS:
                _transition_payout(payout, Payout.Status.FAILED)
                LedgerEntry.objects.create(
                    merchant=payout.merchant,
                    payout=payout,
                    entry_type=LedgerEntry.EntryType.RELEASE,
                    available_delta_paise=payout.amount_paise,
                    held_delta_paise=-payout.amount_paise,
                    reference=str(payout.id),
                    description="Held funds released after retry exhaustion",
                )
                payout.failure_reason = "Retry budget exhausted"
                payout.next_retry_at = None
                payout.save(update_fields=["status", "failure_reason", "next_retry_at", "updated_at"])
                continue
            due_ids.append(str(payout.id))
    return due_ids


def get_pending_payout_ids() -> list[str]:
    return list(
        Payout.objects.filter(status=Payout.Status.PENDING).values_list("id", flat=True)
    )