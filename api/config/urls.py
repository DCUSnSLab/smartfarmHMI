from django.urls import path

from apps.accounts import views as auth_views
from apps.core.views import (
    alert_ack,
    alert_rule_update,
    alert_rules,
    alerts_ack_all,
    device_control,
    farm_alerts,
    farm_commands,
    farm_snapshot,
    farm_stop_state,
    farms,
    health,
    stop_engage,
    stop_release,
)

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
    path("api/farms/<str:farm_id>/alerts", farm_alerts),
    path("api/farms/<str:farm_id>/alerts/ack-all", alerts_ack_all),
    path("api/alerts/<int:alert_id>/ack", alert_ack),
    path("api/farms/<str:farm_id>/alert-rules", alert_rules),
    path("api/alert-rules/<int:rule_id>", alert_rule_update),
    path("api/farms/<str:farm_id>/stop-state", farm_stop_state),
    path("api/stop", stop_engage),
    path("api/stop/release", stop_release),
]
