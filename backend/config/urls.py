from django.contrib import admin
from django.urls import include, path
from django.http import JsonResponse


def healthcheck(_request):
    return JsonResponse({"status": "ok"})

urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", healthcheck),
    path("api/v1/", include("apps.payouts.urls")),
]