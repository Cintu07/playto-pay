from django.core.management.base import BaseCommand
from django.db import transaction

from apps.payouts.models import IdempotencyKey, LedgerEntry, Payout


SEED_PAYOUT_KEY_PREFIX = "seed-"
SEED_LEDGER_REFERENCE_PREFIXES = (
    "seed-credit-",
    "seed-hold-",
    "seed-debit-",
)


class Command(BaseCommand):
    help = "Remove non-seed demo payouts, runtime ledger entries, and idempotency records"

    @transaction.atomic
    def handle(self, *args, **options):
        runtime_payouts = Payout.objects.exclude(idempotency_key__startswith=SEED_PAYOUT_KEY_PREFIX)
        runtime_payout_ids = list(runtime_payouts.values_list("id", flat=True))

        deleted_runtime_ledger_count, _ = LedgerEntry.objects.exclude(
            reference__startswith=SEED_LEDGER_REFERENCE_PREFIXES[0]
        ).exclude(
            reference__startswith=SEED_LEDGER_REFERENCE_PREFIXES[1]
        ).exclude(
            reference__startswith=SEED_LEDGER_REFERENCE_PREFIXES[2]
        ).delete()

        deleted_runtime_payout_count, _ = runtime_payouts.delete()
        deleted_idempotency_count, _ = IdempotencyKey.objects.exclude(key__startswith=SEED_PAYOUT_KEY_PREFIX).delete()

        self.stdout.write(
            self.style.SUCCESS(
                "Removed runtime demo data: "
                f"{deleted_runtime_payout_count} payouts, "
                f"{deleted_runtime_ledger_count} ledger rows, "
                f"{deleted_idempotency_count} idempotency records"
            )
        )
        if runtime_payout_ids:
            self.stdout.write("Removed payout ids: " + ", ".join(str(payout_id) for payout_id in runtime_payout_ids))
