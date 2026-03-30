from pydantic_settings import BaseSettings, SettingsConfigDict

_WEAK_SECRETS = {"changeme", "secret", "your-secret-key", ""}
_WEAK_PASSWORDS = {"admin123", "password", "password123", "admin", ""}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440

    admin_username: str = "admin"
    admin_password: str

    upload_dir: str = "/app/uploads"
    environment: str = "development"
    allowed_origins: str = "http://localhost:3000"

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]


def _validate_secrets(s: Settings) -> None:
    """Refuse to start in production with known-weak credentials."""
    if s.environment == "development":
        return
    errors = []
    if s.secret_key.lower() in _WEAK_SECRETS or len(s.secret_key) < 32:
        errors.append("SECRET_KEY is too weak or missing — generate one with: openssl rand -hex 32")
    if s.admin_password.lower() in _WEAK_PASSWORDS or len(s.admin_password) < 12:
        errors.append("ADMIN_PASSWORD is too weak — use at least 12 characters")
    if errors:
        raise RuntimeError("Unsafe configuration detected:\n" + "\n".join(f"  - {e}" for e in errors))


settings = Settings()
_validate_secrets(settings)
