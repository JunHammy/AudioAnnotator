from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


# ─── Auth ────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ─── Users ───────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str
    password: str
    role: str  # admin | annotator

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in ("admin", "annotator"):
            raise ValueError("role must be 'admin' or 'annotator'")
        return v


class UserResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    username: str
    role: str
    trust_score: float
    segments_reviewed: int
    is_active: bool
    created_at: datetime


class UserUpdate(BaseModel):
    is_active: Optional[bool] = None
    role: Optional[str] = None


# ─── Audio Files ──────────────────────────────────────────────────────────────

class AudioFileResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    filename: str
    subfolder: Optional[str]
    duration: Optional[float]
    language: Optional[str]
    num_speakers: Optional[int]
    file_path: str
    uploaded_by: int
    collaborative_locked_speaker: bool
    collaborative_locked_gender: bool
    collaborative_locked_transcription: bool
    locked_by: Optional[int]
    locked_at: Optional[datetime]
    created_at: datetime


class AudioFileLockUpdate(BaseModel):
    task_type: str  # speaker | gender | transcription
    locked: bool


# ─── Assignments ─────────────────────────────────────────────────────────────

class AssignmentCreate(BaseModel):
    audio_file_id: int
    annotator_id: int
    task_type: str  # emotion | gender | speaker | transcription

    @field_validator("task_type")
    @classmethod
    def validate_task_type(cls, v: str) -> str:
        if v not in ("emotion", "gender", "speaker", "transcription"):
            raise ValueError("Invalid task_type")
        return v


class AssignmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    audio_file_id: int
    annotator_id: int
    task_type: str
    status: str
    created_at: datetime
    completed_at: Optional[datetime]


class AssignmentStatusUpdate(BaseModel):
    status: str  # pending | in_progress | completed


# ─── Segments ────────────────────────────────────────────────────────────────

class SpeakerSegmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    audio_file_id: int
    annotator_id: int
    speaker_label: Optional[str]
    start_time: float
    end_time: float
    gender: Optional[str]
    emotion: Optional[str]
    emotion_other: Optional[str]
    notes: Optional[str]
    is_ambiguous: bool
    source: Optional[str]
    updated_at: datetime


class SpeakerSegmentUpdate(BaseModel):
    speaker_label: Optional[str] = None
    gender: Optional[str] = None
    emotion: Optional[str] = None
    emotion_other: Optional[str] = None
    notes: Optional[str] = None
    is_ambiguous: Optional[bool] = None
    updated_at: datetime  # Optimistic locking: client sends last-known updated_at


class TranscriptionSegmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    audio_file_id: int
    annotator_id: int
    start_time: float
    end_time: float
    original_text: Optional[str]
    edited_text: Optional[str]
    notes: Optional[str]
    updated_at: datetime


class TranscriptionSegmentUpdate(BaseModel):
    edited_text: Optional[str] = None
    notes: Optional[str] = None
    updated_at: datetime  # Optimistic locking


# ─── Final Annotations ───────────────────────────────────────────────────────

class FinalAnnotationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    audio_file_id: int
    segment_id: Optional[int]
    annotation_type: str
    data: dict
    decision_method: Optional[str]
    version: int
    finalized_by: Optional[int]
    finalized_at: Optional[datetime]
