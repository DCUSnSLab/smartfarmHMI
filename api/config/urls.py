from django.urls import path

from apps.core.views import health

urlpatterns = [
    path("health", health),
    path("api/health", health),  # nginx 단일 진입점(/api → api) 경유용
]
