from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import admin, auth, users, audio_files, assignments, segments, review, datasets

app = FastAPI(
    title="AudioAnnotator API",
    version="0.1.0",
    docs_url="/docs" if settings.environment == "development" else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(audio_files.router, prefix="/api/audio-files", tags=["audio-files"])
app.include_router(assignments.router, prefix="/api/assignments", tags=["assignments"])
app.include_router(segments.router, prefix="/api/segments", tags=["segments"])
app.include_router(review.router, prefix="/api/review", tags=["review"])
app.include_router(datasets.router, prefix="/api/datasets", tags=["datasets"])


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
