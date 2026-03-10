import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator, model_validator

# ─── Shared validation constants ────────────────────────────────────────────

_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,50}$")
_MIN_PW_LEN  = 8
_VALID_TASK_TYPES = {"emotion", "gender", "speaker", "transcription"}
_VALID_STATUSES   = {"pending", "in_progress", "completed"}
_VALID_LOCK_TYPES = {"speaker", "gender", "transcription"}
_VALID_EMOTIONS   = {"Neutral", "Happy", "Sad", "Angry", "Surprised", "Fear", "Disgust", "Other"}
_VALID_GENDERS    = {"Male", "Female", "Mixed", "unk"}


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
    role: str

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        v = v.strip()
        if not _USERNAME_RE.match(v):
            raise ValueError("Username must be 3–50 characters, letters/numbers/underscore only.")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < _MIN_PW_LEN:
            raise ValueError(f"Password must be at least {_MIN_PW_LEN} characters.")
        return v

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in ("admin", "annotator"):
            raise ValueError("role must be 'admin' or 'annotator'.")
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
    role:      Optional[str]  = None
    password:  Optional[str]  = None

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) < _MIN_PW_LEN:
            raise ValueError(f"Password must be at least {_MIN_PW_LEN} characters.")
        return v

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("admin", "annotator"):
            raise ValueError("role must be 'admin' or 'annotator'.")
        return v


# ─── Audio Files ──────────────────────────────────────────────────────────────

class AudioFileResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    filename: str
    subfolder: Optional[str]
    duration: Optional[float]
    language: Optional[str]
    num_speakers: Optional[int]
    uploaded_by: int
    collaborative_locked_speaker: bool
    collaborative_locked_gender: bool
    collaborative_locked_transcription: bool
    locked_by: Optional[int]
    locked_at: Optional[datetime]
    created_at: datetime
    json_types: list[str] = []
    # file_path intentionally omitted — don't expose server filesystem paths to clients

    @model_validator(mode="before")
    @classmethod
    def populate_json_types(cls, data):
        if hasattr(data, "__table__"):
            # ORM object — convert to dict and extract json_types from relationship
            columns = {c.key for c in data.__table__.columns}
            obj_dict = {col: getattr(data, col, None) for col in columns}
            try:
                obj_dict["json_types"] = [j.json_type for j in data.original_json_store]
            except Exception:
                obj_dict["json_types"] = []
            return obj_dict
        return data


class AudioFileLockUpdate(BaseModel):
    task_type: str
    locked: bool

    @field_validator("task_type")
    @classmethod
    def validate_task_type(cls, v: str) -> str:
        if v not in _VALID_LOCK_TYPES:
            raise ValueError(f"task_type must be one of: {sorted(_VALID_LOCK_TYPES)}")
        return v


# ─── Assignments ─────────────────────────────────────────────────────────────

_VALID_TASK_COMBOS: set[frozenset] = {
    frozenset(["speaker"]),
    frozenset(["speaker", "gender"]),
    frozenset(["speaker", "transcription"]),
    frozenset(["speaker", "gender", "transcription"]),
    frozenset(["emotion"]),
    frozenset(["gender"]),
    frozenset(["gender", "transcription"]),
    frozenset(["transcription"]),
}


class AssignmentCreate(BaseModel):
    audio_file_id: int
    annotator_id:  int
    task_type:     str

    @field_validator("task_type")
    @classmethod
    def validate_task_type(cls, v: str) -> str:
        if v not in _VALID_TASK_TYPES:
            raise ValueError(f"task_type must be one of: {sorted(_VALID_TASK_TYPES)}")
        return v


class AssignmentBatchCreate(BaseModel):
    audio_file_id: int
    annotator_id:  int
    task_types:    list[str]

    @field_validator("task_types")
    @classmethod
    def validate_combo(cls, v: list[str]) -> list[str]:
        combo = frozenset(v)
        if not combo:
            raise ValueError("task_types cannot be empty.")
        if combo not in _VALID_TASK_COMBOS:
            raise ValueError(
                f"Invalid task combination {sorted(v)}. "
                "Emotion cannot be combined with speaker. "
                "Valid combos: speaker[+gender][+transcription] or (after speaker locked) emotion|gender|transcription[+gender]."
            )
        return list(combo)


class AssignmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    audio_file_id: int
    annotator_id:  int
    task_type:     str
    status:        str
    created_at:    datetime
    completed_at:  Optional[datetime]


class AssignmentStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in _VALID_STATUSES:
            raise ValueError(f"status must be one of: {sorted(_VALID_STATUSES)}")
        return v


# ─── Segments ────────────────────────────────────────────────────────────────

class SpeakerSegmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id:            int
    audio_file_id: int
    annotator_id:  int
    speaker_label: Optional[str]
    start_time:    float
    end_time:      float
    gender:        Optional[str]
    emotion:       Optional[str]
    emotion_other: Optional[str]
    notes:         Optional[str]
    is_ambiguous:  bool
    source:        Optional[str]
    updated_at:    datetime


class SpeakerSegmentUpdate(BaseModel):
    speaker_label: Optional[str]   = None
    gender:        Optional[str]   = None
    emotion:       Optional[str]   = None
    emotion_other: Optional[str]   = None
    notes:         Optional[str]   = None
    is_ambiguous:  Optional[bool]  = None
    start_time:    Optional[float] = None   # time editing (pre_annotated only)
    end_time:      Optional[float] = None   # time editing (pre_annotated only)
    updated_at:    datetime  # Optimistic locking: client sends last-known updated_at

    @field_validator("gender")
    @classmethod
    def validate_gender(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_GENDERS:
            raise ValueError(f"gender must be one of: {sorted(_VALID_GENDERS)}")
        return v

    @field_validator("emotion")
    @classmethod
    def validate_emotion(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_EMOTIONS:
            raise ValueError(f"emotion must be one of: {sorted(_VALID_EMOTIONS)}")
        return v


class SpeakerSegmentCreate(BaseModel):
    audio_file_id: int
    start_time:    float
    end_time:      float
    speaker_label: Optional[str] = None
    gender:        Optional[str] = None

    @field_validator("gender")
    @classmethod
    def validate_gender(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_GENDERS:
            raise ValueError(f"gender must be one of: {sorted(_VALID_GENDERS)}")
        return v


class TranscriptionSegmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id:            int
    audio_file_id: int
    annotator_id:  int
    start_time:    float
    end_time:      float
    original_text: Optional[str]
    edited_text:   Optional[str]
    notes:         Optional[str]
    updated_at:    datetime


class TranscriptionSegmentUpdate(BaseModel):
    edited_text: Optional[str] = None
    notes:       Optional[str] = None
    updated_at:  datetime  # Optimistic locking


class TranscriptionSegmentCreate(BaseModel):
    audio_file_id: int
    start_time:    float
    end_time:      float
    original_text: Optional[str] = None


# ─── Bracket Words ───────────────────────────────────────────────────────────

class BracketWordsUpdate(BaseModel):
    parentheses:    Optional[list[str]] = None
    square_brackets: Optional[list[str]] = None


# ─── Final Annotations ───────────────────────────────────────────────────────

class FinalAnnotationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id:              int
    audio_file_id:   int
    segment_id:      Optional[int]
    annotation_type: str
    data:            dict
    decision_method: Optional[str]
    version:         int
    finalized_by:    Optional[int]
    finalized_at:    Optional[datetime]
