from django.urls import path

from apps.accounts import views as auth_views
from apps.core.views import device_control, farm_commands, farm_snapshot, farms, health

urlpatterns = [
    path("health", health),
    path("api/health", health),  # nginx 단일 진입점(/api → api) 경유용
    path("api/auth/login", auth_views.login),
    path("api/auth/logout", auth_views.logout),
    path("api/auth/refresh", auth_views.refresh),
    path("api/auth/me", auth_views.me),
    path("api/farms", farms),
    path("api/farms/<str:farm_id>/snapshot", farm_snapshot),
    path("api/farms/<str:farm_id>/commands", farm_commands),
    path("api/farms/<str:farm_id>/devices/<str:device_id>/control", device_control),
]
