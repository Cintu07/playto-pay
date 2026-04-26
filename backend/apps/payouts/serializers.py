from rest_framework import serializers

from .models import BankAccount, LedgerEntry, Merchant, Payout


class MerchantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Merchant
        fields = ["id", "name", "slug", "email"]


class BankAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = BankAccount
        fields = ["id", "label", "bank_name", "account_number", "ifsc_code"]


class LedgerEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = LedgerEntry
        fields = [
            "id",
            "entry_type",
            "available_delta_paise",
            "held_delta_paise",
            "reference",
            "description",
            "created_at",
        ]


class PayoutSerializer(serializers.ModelSerializer):
    bank_account = BankAccountSerializer(read_only=True)

    class Meta:
        model = Payout
        fields = [
            "id",
            "amount_paise",
            "idempotency_key",
            "status",
            "attempt_count",
            "failure_reason",
            "processing_started_at",
            "next_retry_at",
            "created_at",
            "updated_at",
            "bank_account",
        ]


class CreatePayoutSerializer(serializers.Serializer):
    amount_paise = serializers.IntegerField(min_value=1)
    bank_account_id = serializers.UUIDField()


class DashboardSerializer(serializers.Serializer):
    merchant = MerchantSerializer()
    balances = serializers.DictField(child=serializers.IntegerField())
    bank_accounts = BankAccountSerializer(many=True)
    recent_ledger_entries = LedgerEntrySerializer(many=True)
    payouts = PayoutSerializer(many=True)