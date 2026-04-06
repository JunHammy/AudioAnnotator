"""
Export router — admin-only endpoints for downloading finalized annotation data.

Endpoints
---------
GET /export/file/{file_id}?format=json          → single-file JSON
GET /export/file/{file_id}?format=csv           → single-file ZIP (segments + votes CSVs)
GET /export/dataset/{dataset_id}?format=json    → dataset ZIP (one JSON per file + manifest)
GET /export/dataset/{dataset_id}?format=csv     → dataset ZIP (segments.csv + votes.csv)

Security
--------
- All endpoints require admin role (require_admin dependency).
- file_id / dataset_id are integer path params; FastAPI validates type.
- Content-Disposition filenames are derived from sanitised DB values, not user input.
- Audit log written on every successful export.
- No temp files written to disk; all payloads built in memory.
"""

import json
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_admin
from app.database import get_db
from app.models.models import AudioFile, Dataset, User
from app.services.audit import write_audit_log
from app.services.export import (
    _safe_stem,
    build_file_export,
    build_zip,
    export_data_to_csv,
)

router = APIRouter()

_SAFE_HEADER_RE = re.compile(r'[^\w\-.]')


def _safe_filename(name: str) -> str:
    """Sanitise a string for use in a Content-Disposition filename parameter."""
    return _SAFE_HEADER_RE.sub("_", name)


# ---------------------------------------------------------------------------
# Single-file export
# ---------------------------------------------------------------------------

@router.get("/file/{file_id}")
async def export_file(
    file_id: int,
    format: Literal["json", "csv"] = Query(default="json"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Download finalized annotations for one audio file."""
    # Verify the file exists and is not archived
    result = await db.execute(
        select(AudioFile).where(AudioFile.id == file_id, AudioFile.is_deleted == False)  # noqa: E712
    )
    af = result.scalar_one_or_none()
    if af is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio file not found.")

    data = await build_file_export(db, file_id)
    if not data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio file not found.")

    stem = _safe_stem(af.filename)

    await write_audit_log(
        db, admin.id, "export",
        resource_type="audio_file", resource_id=file_id,
        details={"filename": af.filename, "format": format},
    )

    if format == "json":
        # Expose as { "filename.wav": { ... } } — strip internal _filename key
        fname = data["_filename"]
        output = {fname: data[fname]}
        payload = json.dumps(output, ensure_ascii=False, indent=2).encode("utf-8")
        return Response(
            content=payload,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{_safe_filename(stem)}.json"'},
        )

    # CSV → ZIP with two sheets
    segs_csv, votes_csv = export_data_to_csv([data])
    zip_bytes = build_zip({
        f"{stem}_segments.csv": segs_csv,
        f"{stem}_votes.csv": votes_csv,
    })
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{_safe_filename(stem)}_export.zip"'},
    )


# ---------------------------------------------------------------------------
# Dataset export
# ---------------------------------------------------------------------------

@router.get("/dataset/{dataset_id}")
async def export_dataset(
    dataset_id: int,
    format: Literal["json", "csv"] = Query(default="json"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Download finalized annotations for all files in a dataset."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    ds = result.scalar_one_or_none()
    if ds is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found.")

    files_result = await db.execute(
        select(AudioFile)
        .where(AudioFile.dataset_id == dataset_id, AudioFile.is_deleted == False)  # noqa: E712
        .order_by(AudioFile.filename)
    )
    files = list(files_result.scalars().all())
    if not files:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No files in this dataset.")

    # Build all exports (sequential to keep memory footprint bounded)
    all_data = []
    for af in files:
        fd = await build_file_export(db, af.id)
        if fd:
            all_data.append(fd)

    ds_stem = _safe_filename(re.sub(r'[^\w\-]', '_', ds.name))

    await write_audit_log(
        db, admin.id, "export",
        resource_type="dataset", resource_id=dataset_id,
        details={"dataset_name": ds.name, "file_count": len(all_data), "format": format},
    )

    if format == "json":
        manifest = {
            "dataset_id": ds.id,
            "dataset_name": ds.name,
            "file_count": len(all_data),
            "files": [fd["_filename"] for fd in all_data],
        }
        entries: dict[str, bytes] = {"manifest.json": json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")}
        for fd in all_data:
            fname = fd["_filename"]
            stem = _safe_stem(fname)
            entries[f"{stem}.json"] = json.dumps({fname: fd[fname]}, ensure_ascii=False, indent=2).encode("utf-8")
        zip_bytes = build_zip(entries)
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{ds_stem}_export.zip"'},
        )

    # CSV
    segs_csv, votes_csv = export_data_to_csv(all_data)
    zip_bytes = build_zip({
        f"{ds_stem}_segments.csv": segs_csv,
        f"{ds_stem}_votes.csv": votes_csv,
    })
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{ds_stem}_export.zip"'},
    )


# ---------------------------------------------------------------------------
# All-files export (no dataset filter)
# ---------------------------------------------------------------------------

@router.get("/all")
async def export_all(
    format: Literal["json", "csv"] = Query(default="json"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Download finalized annotations for every file in the system."""
    files_result = await db.execute(
        select(AudioFile)
        .where(AudioFile.is_deleted == False)  # noqa: E712
        .order_by(AudioFile.filename)
    )
    files = list(files_result.scalars().all())
    if not files:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No audio files found.")

    all_data = []
    for af in files:
        fd = await build_file_export(db, af.id)
        if fd:
            all_data.append(fd)

    await write_audit_log(
        db, admin.id, "export",
        resource_type="audio_file", resource_id=None,
        details={"scope": "all", "file_count": len(all_data), "format": format},
    )

    if format == "json":
        manifest = {
            "scope": "all",
            "file_count": len(all_data),
            "files": [fd["_filename"] for fd in all_data],
        }
        entries: dict[str, bytes] = {"manifest.json": json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")}
        for fd in all_data:
            fname = fd["_filename"]
            stem = _safe_stem(fname)
            entries[f"{stem}.json"] = json.dumps({fname: fd[fname]}, ensure_ascii=False, indent=2).encode("utf-8")
        zip_bytes = build_zip(entries)
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="all_files_export.zip"'},
        )

    segs_csv, votes_csv = export_data_to_csv(all_data)
    zip_bytes = build_zip({
        "all_segments.csv": segs_csv,
        "all_votes.csv": votes_csv,
    })
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="all_files_export.zip"'},
    )
