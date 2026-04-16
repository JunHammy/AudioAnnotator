"""Run once to create the initial admin user. Usage: python seed.py"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.config import settings
from app.models.models import User
from app.auth.jwt import hash_password

async def main():
    from sqlalchemy import select
    engine = create_async_engine(settings.database_url)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as session:
        existing = (await session.execute(select(User).where(User.username == settings.admin_username))).scalar_one_or_none()
        if existing:
            print(f"Admin user '{settings.admin_username}' already exists — skipping.")
        else:
            admin = User(
                username=settings.admin_username,
                password_hash=hash_password(settings.admin_password),
                role="admin",
            )
            session.add(admin)
            await session.commit()
            print(f"Created admin user: {settings.admin_username}")

    await engine.dispose()

asyncio.run(main())
