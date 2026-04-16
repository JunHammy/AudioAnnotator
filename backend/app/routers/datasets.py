from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user, require_admin
from app.database import get_db
from app.models.models import AudioFile, Dataset, User
from app.schemas.schemas import DatasetCreate, DatasetFilesUpdate, DatasetResponse, DatasetUpdate

router = APIRouter()


@router.get("", response_model=list[DatasetResponse])
async def list_datasets(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.audio_files))
        .order_by(Dataset.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=DatasetResponse, status_code=status.HTTP_201_CREATED)
async def create_dataset(
    body: DatasetCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    existing = await db.execute(select(Dataset).where(Dataset.name == body.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Dataset '{body.name}' already exists.")

    ds = Dataset(name=body.name, description=body.description, created_by=admin.id)
    db.add(ds)
    await db.flush()
    await db.refresh(ds)

    result = await db.execute(
        select(Dataset).options(selectinload(Dataset.audio_files)).where(Dataset.id == ds.id)
    )
    return result.scalar_one()


@router.patch("/{dataset_id}", response_model=DatasetResponse)
async def update_dataset(
    dataset_id: int,
    body: DatasetUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    result = await db.execute(
        select(Dataset).options(selectinload(Dataset.audio_files)).where(Dataset.id == dataset_id)
    )
    ds = result.scalar_one_or_none()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if body.name is not None:
        name_check = await db.execute(
            select(Dataset).where(Dataset.name == body.name, Dataset.id != dataset_id)
        )
        if name_check.scalar_one_or_none():
            raise HTTPException(status_code=400, detail=f"Dataset '{body.name}' already exists.")
        ds.name = body.name

    if body.description is not None:
        ds.description = body.description

    await db.flush()
    await db.refresh(ds)
    result2 = await db.execute(
        select(Dataset).options(selectinload(Dataset.audio_files)).where(Dataset.id == dataset_id)
    )
    return result2.scalar_one()


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dataset(
    dataset_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    ds = result.scalar_one_or_none()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Detach all audio files (set dataset_id to NULL)
    files_result = await db.execute(select(AudioFile).where(AudioFile.dataset_id == dataset_id))
    for af in files_result.scalars().all():
        af.dataset_id = None

    await db.delete(ds)
    await db.flush()


@router.patch("/{dataset_id}/files", response_model=DatasetResponse)
async def assign_files_to_dataset(
    dataset_id: int,
    body: DatasetFilesUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Replace the set of audio files assigned to this dataset."""
    result = await db.execute(
        select(Dataset).options(selectinload(Dataset.audio_files)).where(Dataset.id == dataset_id)
    )
    ds = result.scalar_one_or_none()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Detach files that are currently in this dataset but not in the new list
    current_ids = {af.id for af in ds.audio_files}
    new_ids = set(body.audio_file_ids)

    # Remove dataset from files no longer in the set
    for af in ds.audio_files:
        if af.id not in new_ids:
            af.dataset_id = None

    # Assign dataset to new files
    to_add = new_ids - current_ids
    if to_add:
        add_result = await db.execute(select(AudioFile).where(AudioFile.id.in_(to_add)))
        for af in add_result.scalars().all():
            af.dataset_id = dataset_id

    await db.flush()
    result2 = await db.execute(
        select(Dataset).options(selectinload(Dataset.audio_files)).where(Dataset.id == dataset_id)
    )
    return result2.scalar_one()
