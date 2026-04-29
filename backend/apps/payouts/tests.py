from concurrent.futures import ThreadPoolExecutor
import threading
from unittest import skipUnless
import uuid

from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase

from .models import BankAccount, LedgerEntry, Merchant, Payout
from .services import create_payout_request, get_balance_snapshot


class BasePayoutTestCase(TestCase):
    def setUp(self):
        self.merchant = Merchant.objects.create(
            name="Northwind Studio",
            slug="northwind-studio",
            email="northwind@example.com",
        )
        self.bank_account = BankAccount.objects.create(
            merchant=self.merchant,
            label="Primary",
            bank_name="HDFC Bank",
            account_number="001122334455",
            ifsc_code="HDFC0000123",
        )
        LedgerEntry.objects.create(
            merchant=self.merchant,
            entry_type=LedgerEntry.EntryType.CREDIT,
            available_delta_paise=10_000,
            held_delta_paise=0,
            reference="seed-credit",
            description="Initial inbound USD settlement",
        )


class IdempotencyTests(BasePayoutTestCase):
    def test_same_idempotency_key_returns_same_payout(self):
        key = str(uuid.uuid4())
        first = create_payout_request(
            merchant=self.merchant,
            amount_paise=4_000,
            bank_account_id=str(self.bank_account.id),
            idempotency_key=key,
            enqueue_task=False,
        )
        second = create_payout_request(
            merchant=self.merchant,
            amount_paise=4_000,
            bank_account_id=str(self.bank_account.id),
            idempotency_key=key,
            enqueue_task=False,
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.payload, second.payload)
        self.assertEqual(Payout.objects.count(), 1)


class ApiSurfaceTests(BasePayoutTestCase):
    def test_payout_list_uses_paginated_shape(self):
        create_payout_request(
            merchant=self.merchant,
            amount_paise=1_000,
            bank_account_id=str(self.bank_account.id),
            idempotency_key=str(uuid.uuid4()),
            enqueue_task=False,
        )
        create_payout_request(
            merchant=self.merchant,
            amount_paise=1_000,
            bank_account_id=str(self.bank_account.id),
            idempotency_key=str(uuid.uuid4()),
            enqueue_task=False,
        )

        response = self.client.get(
            "/api/v1/payouts?limit=1",
            HTTP_X_MERCHANT_ID=str(self.merchant.id),
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("count", response.data)
        self.assertIn("results", response.data)
        self.assertEqual(len(response.data["results"]), 1)

    def test_dashboard_accepts_bounded_limits(self):
        response = self.client.get(
            "/api/v1/dashboard?payout_limit=2&ledger_limit=2",
            HTTP_X_MERCHANT_ID=str(self.merchant.id),
        )

        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(len(response.data["payouts"]), 2)
        self.assertLessEqual(len(response.data["recent_ledger_entries"]), 2)


@skipUnless(connection.vendor == "postgresql", "Concurrency locking test requires PostgreSQL")
class ConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.merchant = Merchant.objects.create(
            name="Orbit Labs",
            slug="orbit-labs",
            email="orbit@example.com",
        )
        self.bank_account = BankAccount.objects.create(
            merchant=self.merchant,
            label="Ops",
            bank_name="ICICI Bank",
            account_number="998877665544",
            ifsc_code="ICIC0000456",
        )
        LedgerEntry.objects.create(
            merchant=self.merchant,
            entry_type=LedgerEntry.EntryType.CREDIT,
            available_delta_paise=10_000,
            held_delta_paise=0,
            reference="seed-credit",
            description="Seed balance",
        )

    def test_two_simultaneous_payouts_do_not_overdraw(self):
        barrier = threading.Barrier(2)
        statuses = []

        def worker() -> None:
            close_old_connections()
            barrier.wait()
            result = create_payout_request(
                merchant=self.merchant,
                amount_paise=6_000,
                bank_account_id=str(self.bank_account.id),
                idempotency_key=str(uuid.uuid4()),
                enqueue_task=False,
            )
            statuses.append(result.status_code)
            close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(worker) for _ in range(2)]
            for future in futures:
                future.result()

        self.assertCountEqual(statuses, [201, 422])
        balances = get_balance_snapshot(self.merchant)
        self.assertEqual(balances["available_balance_paise"], 4_000)
        self.assertEqual(balances["held_balance_paise"], 6_000)
        self.assertEqual(Payout.objects.count(), 1)