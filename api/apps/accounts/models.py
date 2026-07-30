"""계정 — db-schema.md §4 `app.user`.

이메일 로그인(AIBootcamp members 패턴). 역할 체계는 OPN-07 확정 시 개편.
"""

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email: str, password: str | None = None, **extra):
        if not email:
            raise ValueError("email 은 필수입니다")
        user = self.model(email=self.normalize_email(email), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email: str, password: str, **extra):
        extra.setdefault("role", User.Role.ADMIN)
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    class Role(models.TextChoices):
        ADMIN = "admin", "관리자"
        MANAGER = "manager", "농장 관리자"
        VIEWER = "viewer", "조회자"

    email = models.EmailField(unique=True)
    name = models.CharField(max_length=100)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.VIEWER)
    otp_enabled = models.BooleanField(default=False)  # 2단계 인증 (FR-31)
    remote_access_enabled = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    class Meta:
        db_table = "user"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(role__in=["admin", "manager", "viewer"]),
                name="user_role_check",
            )
        ]

    def __str__(self) -> str:
        return self.email
