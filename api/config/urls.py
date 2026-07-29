from django.urls import path

from apps.core.views import farm_snapshot, farms, health

urlpatterns = [
    path("health", health),
    path("api/health", health),  # nginx 단일 진입점(/api → api) 경유용
    path("api/farms", farms),
    path("api/farms/<str:farm_id>/snapshot", farm_snapshot),
]
