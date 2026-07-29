"""개발 시드 계정 — 역할 3종 (admin/manager/viewer, OPN-07 잠정 체계). 멱등."""

import os

from django.core.management.base import BaseCommand

from apps.accounts.models import User

SEED = [
    ("admin@smartfarm.local", "관리자", User.Role.ADMIN),
    ("manager@smartfarm.local", "최대농", User.Role.MANAGER),  # 디자인 전달본의 페르소나
    ("viewer@smartfarm.local", "참관자", User.Role.VIEWER),
]


class Command(BaseCommand):
    help = "개발용 시드 계정 3종 생성 (멱등)"

    def handle(self, *args, **options):
        password = os.environ.get("SEED_USER_PASSWORD", "smartfarm123!")
        for email, name, role in SEED:
            user, created = User.objects.get_or_create(
                email=email, defaults={"name": name, "role": role}
            )
            if created:
                user.set_password(password)
                user.is_staff = role == User.Role.ADMIN
                user.save()
            self.stdout.write(f"{'+' if created else '='} {email} ({role})")
        self.stdout.write(self.style.SUCCESS("✓ seed_users 완료"))
