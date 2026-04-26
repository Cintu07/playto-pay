from django.urls import path

from .views import DashboardView, MerchantListView, PayoutListCreateView

urlpatterns = [
    path("merchants", MerchantListView.as_view(), name="merchant-list"),
    path("dashboard", DashboardView.as_view(), name="dashboard"),
    path("payouts", PayoutListCreateView.as_view(), name="payouts"),
]