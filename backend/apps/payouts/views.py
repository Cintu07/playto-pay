from rest_framework import status
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import Merchant
from .serializers import CreatePayoutSerializer, DashboardSerializer, MerchantSerializer, PayoutSerializer
from .services import (
    PayoutError,
    build_dashboard_payload,
    create_payout_request,
    resolve_merchant,
    validate_idempotency_key,
)


def _bounded_query_int(raw_value: str | None, *, default: int, min_value: int, max_value: int) -> int:
    try:
        parsed = int(raw_value) if raw_value is not None else default
    except (TypeError, ValueError):
        return default
    return max(min_value, min(parsed, max_value))


class MerchantReadThrottle(ScopedRateThrottle):
    scope = "merchant_reads"


class PayoutWriteThrottle(ScopedRateThrottle):
    scope = "payout_writes"


class MerchantListView(APIView):
    throttle_classes = [MerchantReadThrottle]

    def get(self, request):
        merchants = Merchant.objects.order_by("name")
        serializer = MerchantSerializer(merchants, many=True)
        return Response(serializer.data)


class DashboardView(APIView):
    throttle_classes = [MerchantReadThrottle]

    def get(self, request):
        try:
            merchant = resolve_merchant(request.headers.get("X-Merchant-Id"))
        except PayoutError as exc:
            return Response(exc.as_response(), status=exc.status_code)
        payout_limit = _bounded_query_int(request.query_params.get("payout_limit"), default=10, min_value=1, max_value=50)
        ledger_limit = _bounded_query_int(request.query_params.get("ledger_limit"), default=10, min_value=1, max_value=50)
        serializer = DashboardSerializer(
            build_dashboard_payload(
                merchant,
                payout_limit=payout_limit,
                ledger_limit=ledger_limit,
            )
        )
        return Response(serializer.data)


class PayoutListCreateView(APIView):
    def get_throttles(self):
        if self.request.method == "POST":
            return [PayoutWriteThrottle()]
        return [MerchantReadThrottle()]

    def get(self, request):
        try:
            merchant = resolve_merchant(request.headers.get("X-Merchant-Id"))
        except PayoutError as exc:
            return Response(exc.as_response(), status=exc.status_code)
        payouts = merchant.payouts.select_related("bank_account").all()
        paginator = LimitOffsetPagination()
        paginator.default_limit = _bounded_query_int(request.query_params.get("limit"), default=20, min_value=1, max_value=100)
        paginator.max_limit = 100
        page = paginator.paginate_queryset(payouts, request, view=self)
        serializer = PayoutSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)

    def post(self, request):
        serializer = CreatePayoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            merchant = resolve_merchant(request.headers.get("X-Merchant-Id"))
            idempotency_key = validate_idempotency_key(request.headers.get("Idempotency-Key"))
            result = create_payout_request(
                merchant=merchant,
                amount_paise=serializer.validated_data["amount_paise"],
                bank_account_id=str(serializer.validated_data["bank_account_id"]),
                idempotency_key=idempotency_key,
            )
        except PayoutError as exc:
            return Response(exc.as_response(), status=exc.status_code)

        response_status = result.status_code
        if response_status == 201:
            response_status = status.HTTP_201_CREATED
        return Response(result.payload, status=response_status)