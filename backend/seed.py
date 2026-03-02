"""Run once to create the initial admin user. Usage: python seed.py"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.config import settings
from app.models.models import User
from app.auth.jwt import hash_password

async def main():
    engine = create_async_engine(settings.database_url)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as session:
        admin = User(
            username="admin",
            password_hash=hash_password("admin123"),
            role="admin",
        )
        session.add(admin)
        await session.commit()
        print(f"Created admin user: admin / admin123")

    await engine.dispose()

asyncio.run(main())
