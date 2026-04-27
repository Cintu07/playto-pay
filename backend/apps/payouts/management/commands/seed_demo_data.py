from django.core.management.base import BaseCommand
from django.db import transaction

from apps.payouts.models import BankAccount, LedgerEntry, Merchant, Payout


class Command(BaseCommand):
    help = "Seed demo merchants, bank accounts, ledger history, and payouts"

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete existing payout demo data before seeding",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if options["reset"]:
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
            merchant, _ = Merchant.objects.update_or_create(
                slug=merchant_seed["slug"],
                defaults={
                    "name": merchant_seed["name"],
                    "email": merchant_seed["email"],
                },
            )
            bank_account, _ = BankAccount.objects.update_or_create(
                merchant=merchant,
                label=merchant_seed["bank"]["label"],
                defaults=merchant_seed["bank"],
            )
            for index, amount in enumerate(merchant_seed["credits"], start=1):
                LedgerEntry.objects.update_or_create(
                    merchant=merchant,
                    reference=f"seed-credit-{index}",
                    defaults={
                        "entry_type": LedgerEntry.EntryType.CREDIT,
                        "available_delta_paise": amount,
                        "held_delta_paise": 0,
                        "description": "Simulated inbound USD collection",
                    },
                )

            completed_amount = merchant_seed["completed_payout"]
            if completed_amount:
                payout, _ = Payout.objects.update_or_create(
                    merchant=merchant,
                    idempotency_key=f"seed-{merchant.slug}",
                    defaults={
                        "bank_account": bank_account,
                        "amount_paise": completed_amount,
                        "status": Payout.Status.COMPLETED,
                        "attempt_count": 1,
                    },
                )
                LedgerEntry.objects.update_or_create(
                    merchant=merchant,
                    reference=f"seed-hold-{merchant.slug}",
                    defaults={
                        "payout": payout,
                        "entry_type": LedgerEntry.EntryType.HOLD,
                        "available_delta_paise": -completed_amount,
                        "held_delta_paise": completed_amount,
                        "description": "Seed payout hold",
                    },
                )
                LedgerEntry.objects.update_or_create(
                    merchant=merchant,
                    reference=f"seed-debit-{merchant.slug}",
                    defaults={
                        "payout": payout,
                        "entry_type": LedgerEntry.EntryType.DEBIT,
                        "available_delta_paise": 0,
                        "held_delta_paise": -completed_amount,
                        "description": "Seed payout completion",
                    },
                )

        self.stdout.write(self.style.SUCCESS("Seeded demo payout data"))