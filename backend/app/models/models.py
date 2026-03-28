from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey,
    Integer, JSON, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False)  # 'admin' | 'annotator'
    trust_score = Column(Float, nullable=False, default=0.50)
    segments_reviewed = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    assignments = relationship("Assignment", back_populates="annotator", foreign_keys="Assignment.annotator_id")
    uploaded_files = relationship("AudioFile", back_populates="uploader", foreign_keys="AudioFile.uploaded_by")


class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False)
    description = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    creator = relationship("User")
    audio_files = relationship("AudioFile", back_populates="dataset")


class AudioFile(Base):
    __tablename__ = "audio_files"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(255), nullable=False)
    dataset_id = Column(Integer, ForeignKey("datasets.id"), nullable=True)
    duration = Column(Float, nullable=True)
    language = Column(String(50), nullable=True)
    num_speakers = Column(Integer, nullable=True)
    file_path = Column(String(500), nullable=False)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Per-task-type collaborative locks
    collaborative_locked_speaker = Column(Boolean, nullable=False, default=False)
    collaborative_locked_gender = Column(Boolean, nullable=False, default=False)
    collaborative_locked_transcription = Column(Boolean, nullable=False, default=False)
    collaborative_locked_emotion = Column(Boolean, nullable=False, default=False, server_default="0")
    locked_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    locked_at = Column(DateTime(timezone=True), nullable=True)
    annotator_remarks = Column(Text, nullable=True)
    admin_response = Column(Text, nullable=True)
    is_deleted = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    uploader = relationship("User", back_populates="uploaded_files", foreign_keys=[uploaded_by])
    dataset = relationship("Dataset", back_populates="audio_files")
    assignments = relationship("Assignment", back_populates="audio_file")
    speaker_segments = relationship("SpeakerSegment", back_populates="audio_file")
    transcription_segments = relationship("TranscriptionSegment", back_populates="audio_file")
    original_json_store = relationship("OriginalJSONStore", back_populates="audio_file")
    final_annotations = relationship("FinalAnnotation", back_populates="audio_file")


class Assignment(Base):
    __tablename__ = "assignments"
    __table_args__ = (
        UniqueConstraint("audio_file_id", "annotator_id", "task_type", name="uq_assignment"),
    )

    id = Column(Integer, primary_key=True, index=True)
    audio_file_id = Column(Integer, ForeignKey("audio_files.id"), nullable=False)
    annotator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    task_type = Column(String(30), nullable=False)  # emotion | gender | speaker | transcription
    status = Column(String(30), nullable=False, default="pending")  # pending | in_progress | completed
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    priority = Column(String(20), nullable=False, default="normal")
    due_date = Column(DateTime(timezone=True), nullable=True)

    audio_file = relationship("AudioFile", back_populates="assignments")
    annotator = relationship("User", back_populates="assignments", foreign_keys=[annotator_id])


class SpeakerSegment(Base):
    __tablename__ = "speaker_segments"

    id = Column(Integer, primary_key=True, index=True)
    audio_file_id = Column(Integer, ForeignKey("audio_files.id"), nullable=False)
    annotator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    speaker_label = Column(String(50), nullable=True)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    gender = Column(String(20), nullable=True)    # Male | Female | Mixed | unk
    emotion = Column(JSON, nullable=True)         # list of emotion tags, e.g. ["Happy", "Other:Excited"]
    notes = Column(Text, nullable=True)
    is_ambiguous = Column(Boolean, nullable=False, default=False)
    source = Column(String(50), nullable=True)    # original | annotator
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    audio_file = relationship("AudioFile", back_populates="speaker_segments")
    annotator = relationship("User")


class TranscriptionSegment(Base):
    __tablename__ = "transcription_segments"

    id = Column(Integer, primary_key=True, index=True)
    audio_file_id = Column(Integer, ForeignKey("audio_files.id"), nullable=False)
    annotator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    original_text = Column(Text, nullable=True)
    edited_text = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    audio_file = relationship("AudioFile", back_populates="transcription_segments")
    annotator = relationship("User")
    edit_history = relationship(
        "SegmentEditHistory",
        primaryjoin="and_(SegmentEditHistory.segment_type=='transcription', foreign(SegmentEditHistory.segment_id)==TranscriptionSegment.id)",
        viewonly=True,
    )


class OriginalJSONStore(Base):
    __tablename__ = "original_json_store"

    id = Column(Integer, primary_key=True, index=True)
    audio_file_id = Column(Integer, ForeignKey("audio_files.id"), nullable=False)
    json_type = Column(String(30), nullable=False)  # emotion_gender | speaker | transcription
    data = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    audio_file = relationship("AudioFile", back_populates="original_json_store")


class FinalAnnotation(Base):
    __tablename__ = "final_annotations"

    id = Column(Integer, primary_key=True, index=True)
    audio_file_id = Column(Integer, ForeignKey("audio_files.id"), nullable=False)
    segment_id = Column(Integer, nullable=True)
    annotation_type = Column(String(30), nullable=False)
    data = Column(JSON, nullable=False)
    decision_method = Column(String(50), nullable=True)  # unanimous | weighted | manual
    version = Column(Integer, nullable=False, default=1)
    finalized_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    finalized_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    audio_file = relationship("AudioFile", back_populates="final_annotations")


class SegmentEditHistory(Base):
    __tablename__ = "segment_edit_history"

    id = Column(Integer, primary_key=True, index=True)
    segment_type = Column(String(30), nullable=False)  # speaker | transcription
    segment_id = Column(Integer, nullable=False)
    field_changed = Column(String(100), nullable=False)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    edited_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    edited_at = Column(DateTime(timezone=True), server_default=func.now())

    editor = relationship("User")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String(100), nullable=False)
    resource_type = Column(String(50), nullable=True)
    resource_id = Column(Integer, nullable=True)
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(50), nullable=False)   # "assignment" | "admin_response"
    message = Column(Text, nullable=False)
    audio_file_id = Column(Integer, ForeignKey("audio_files.id", ondelete="SET NULL"), nullable=True)
    read = Column(Boolean, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")
