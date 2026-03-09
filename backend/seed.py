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
        existing = (await session.execute(select(User).where(User.username == "admin"))).scalar_one_or_none()
        if existing:
            print("Admin user already exists — skipping.")
        else:
            admin = User(
                username="admin",
                password_hash=hash_password("admin123"),
                role="admin",
            )
            session.add(admin)
            await session.commit()
            print("Created admin user: admin / admin123")

    await engine.dispose()

asyncio.run(main())
