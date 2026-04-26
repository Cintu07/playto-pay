import uuid

from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models


class Merchant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    email = models.EmailField(unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.name


class BankAccount(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    merchant = models.ForeignKey(Merchant, on_delete=models.CASCADE, related_name="bank_accounts")
    label = models.CharField(max_length=100)
    bank_name = models.CharField(max_length=100)
    account_number = models.CharField(max_length=32)
    ifsc_code = models.CharField(max_length=16)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.bank_name} · {self.label}"


class Payout(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PROCESSING = "processing", "Processing"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    ALLOWED_TRANSITIONS = {
        Status.PENDING: {Status.PROCESSING},
        Status.PROCESSING: {Status.COMPLETED, Status.FAILED},
        Status.COMPLETED: set(),
        Status.FAILED: set(),
    }

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    merchant = models.ForeignKey(Merchant, on_delete=models.CASCADE, related_name="payouts")
    bank_account = models.ForeignKey(BankAccount, on_delete=models.PROTECT, related_name="payouts")
    amount_paise = models.BigIntegerField(validators=[MinValueValidator(1)])
    idempotency_key = models.CharField(max_length=64)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    attempt_count = models.PositiveSmallIntegerField(default=0)
    processing_started_at = models.DateTimeField(null=True, blank=True)
    next_retry_at = models.DateTimeField(null=True, blank=True)
    failure_reason = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "next_retry_at"]),
            models.Index(fields=["merchant", "created_at"]),
        ]

    def transition_to(self, next_status: str) -> None:
        if next_status not in self.ALLOWED_TRANSITIONS[self.status]:
            raise ValidationError(f"Illegal payout transition: {self.status} -> {next_status}")
        self.status = next_status


class LedgerEntry(models.Model):
    class EntryType(models.TextChoices):
        CREDIT = "credit", "Credit"
        HOLD = "hold", "Hold"
        RELEASE = "release", "Release"
        DEBIT = "debit", "Debit"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    merchant = models.ForeignKey(Merchant, on_delete=models.CASCADE, related_name="ledger_entries")
    payout = models.ForeignKey(Payout, on_delete=models.CASCADE, null=True, blank=True, related_name="ledger_entries")
    entry_type = models.CharField(max_length=20, choices=EntryType.choices)
    available_delta_paise = models.BigIntegerField(default=0)
    held_delta_paise = models.BigIntegerField(default=0)
    reference = models.CharField(max_length=128, blank=True)
    description = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["merchant", "created_at"]),
            models.Index(fields=["payout", "created_at"]),
        ]

    def clean(self) -> None:
        if self.available_delta_paise == 0 and self.held_delta_paise == 0:
            raise ValidationError("Ledger entry must change available or held balance")


class IdempotencyKey(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    merchant = models.ForeignKey(Merchant, on_delete=models.CASCADE, related_name="idempotency_keys")
    key = models.CharField(max_length=64)
    request_hash = models.CharField(max_length=64)
    response_status = models.PositiveIntegerField(null=True, blank=True)
    response_body = models.JSONField(null=True, blank=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["merchant", "key"], name="unique_merchant_idempotency_key"),
        ]
        indexes = [models.Index(fields=["merchant", "expires_at"])]

    def store_response(self, *, status: int, body: dict) -> None:
        self.response_status = status
        self.response_body = body