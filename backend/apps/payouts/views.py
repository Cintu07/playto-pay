from rest_framework import status
from rest_framework.response import Response
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


class MerchantListView(APIView):
    def get(self, request):
        merchants = Merchant.objects.order_by("name")
        serializer = MerchantSerializer(merchants, many=True)
        return Response(serializer.data)


class DashboardView(APIView):
    def get(self, request):
        try:
            merchant = resolve_merchant(request.headers.get("X-Merchant-Id"))
        except PayoutError as exc:
            return Response(exc.as_response(), status=exc.status_code)
        serializer = DashboardSerializer(build_dashboard_payload(merchant))
        return Response(serializer.data)


class PayoutListCreateView(APIView):
    def get(self, request):
        try:
            merchant = resolve_merchant(request.headers.get("X-Merchant-Id"))
        except PayoutError as exc:
            return Response(exc.as_response(), status=exc.status_code)
        payouts = merchant.payouts.select_related("bank_account").all()[:20]
        serializer = PayoutSerializer(payouts, many=True)
        return Response(serializer.data)

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