from django.core.management.base import BaseCommand
from django.db import transaction

from apps.payouts.models import BankAccount, LedgerEntry, Merchant, Payout


class Command(BaseCommand):
    help = "Seed demo merchants, bank accounts, ledger history, and payouts"

    @transaction.atomic
    def handle(self, *args, **options):
        Payout.objects.all().delete()
        LedgerEntry.objects.all().delete()
        BankAccount.objects.all().delete()
        Merchant.objects.all().delete()

        merchants = [
            {
                "name": "Northwind Studio",
                "slug": "northwind-studio",
                "email": "northwind@example.com",
                "bank": {
                    "label": "Primary",
                    "bank_name": "HDFC Bank",
                    "account_number": "001122334455",
                    "ifsc_code": "HDFC0000123",
                },
                "credits": [90_000, 45_000],
                "completed_payout": 30_000,
            },
            {
                "name": "Orbit Labs",
                "slug": "orbit-labs",
                "email": "orbit@example.com",
                "bank": {
                    "label": "Operations",
                    "bank_name": "ICICI Bank",
                    "account_number": "998877665544",
                    "ifsc_code": "ICIC0000456",
                },
                "credits": [120_000],
                "completed_payout": 0,
            },
            {
                "name": "Blue Pine Creative",
                "slug": "blue-pine-creative",
                "email": "bluepine@example.com",
                "bank": {
                    "label": "Founder",
                    "bank_name": "Axis Bank",
                    "account_number": "556677889900",
                    "ifsc_code": "UTIB0000789",
                },
                "credits": [75_000, 25_000, 15_000],
                "completed_payout": 20_000,
            },
        ]

        for merchant_seed in merchants:
            merchant = Merchant.objects.create(
                name=merchant_seed["name"],
                slug=merchant_seed["slug"],
                email=merchant_seed["email"],
            )
            bank_account = BankAccount.objects.create(merchant=merchant, **merchant_seed["bank"])
            for index, amount in enumerate(merchant_seed["credits"], start=1):
                LedgerEntry.objects.create(
                    merchant=merchant,
                    entry_type=LedgerEntry.EntryType.CREDIT,
                    available_delta_paise=amount,
                    held_delta_paise=0,
                    reference=f"seed-credit-{index}",
                    description="Simulated inbound USD collection",
                )

            completed_amount = merchant_seed["completed_payout"]
            if completed_amount:
                payout = Payout.objects.create(
                    merchant=merchant,
                    bank_account=bank_account,
                    amount_paise=completed_amount,
                    idempotency_key=f"seed-{merchant.slug}",
                    status=Payout.Status.COMPLETED,
                    attempt_count=1,
                )
                LedgerEntry.objects.create(
                    merchant=merchant,
                    payout=payout,
                    entry_type=LedgerEntry.EntryType.HOLD,
                    available_delta_paise=-completed_amount,
                    held_delta_paise=completed_amount,
                    reference=str(payout.id),
                    description="Seed payout hold",
                )
                LedgerEntry.objects.create(
                    merchant=merchant,
                    payout=payout,
                    entry_type=LedgerEntry.EntryType.DEBIT,
                    available_delta_paise=0,
                    held_delta_paise=-completed_amount,
                    reference=str(payout.id),
                    description="Seed payout completion",
                )

        self.stdout.write(self.style.SUCCESS("Seeded demo payout data"))