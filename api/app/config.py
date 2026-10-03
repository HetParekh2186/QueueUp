from functools import cached_property

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://queueup:queueup@localhost:5433/queueup"
    redis_url: str = "redis://localhost:6380/0"

    # Two separate secrets: one for session JWTs, one for ticket QR codes. Rotating
    # the session secret logs everyone out but must never invalidate printed tickets.
    secret_key: str = "dev-secret-change-me"
    qr_secret: str = "dev-qr-secret-change-me"

    access_token_minutes: int = 15
    refresh_token_days: int = 7

    hold_seconds: int = 600
    max_tickets_per_order: int = 10
    max_active_tickets_per_type: int = 10

    rate_limit_enabled: bool = True
    cors_origins: str = "http://localhost:3000"

    db_pool_size: int = 10
    db_max_overflow: int = 20

    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    email_from: str = "QueueUp <no-reply@queueup.local>"

    log_level: str = "INFO"
    environment: str = "development"

    def check_production_secrets(self) -> None:
        """Refuse to boot a production deployment with dev or short secrets."""
        if self.environment != "production":
            return
        for name in ("secret_key", "qr_secret"):
            value = getattr(self, name)
            if value.startswith("dev-") or len(value) < 32:
                raise RuntimeError(f"{name.upper()} must be set to a random value of 32+ bytes in production")

    @cached_property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
