"""Initial schema

Revision ID: a1b2c3d4e5f6
Revises:
Create Date: 2026-03-02 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("trust_score", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("segments_reviewed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("username"),
    )
    op.create_index("ix_users_username", "users", ["username"])

    op.create_table(
        "audio_files",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("subfolder", sa.String(255), nullable=True),
        sa.Column("duration", sa.Float(), nullable=True),
        sa.Column("language", sa.String(50), nullable=True),
        sa.Column("num_speakers", sa.Integer(), nullable=True),
        sa.Column("file_path", sa.String(500), nullable=False),
        sa.Column("uploaded_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("collaborative_locked_speaker", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("collaborative_locked_gender", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("collaborative_locked_transcription", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("locked_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("audio_file_id", sa.Integer(), sa.ForeignKey("audio_files.id"), nullable=False),
        sa.Column("annotator_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("task_type", sa.String(30), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("audio_file_id", "annotator_id", "task_type", name="uq_assignment"),
    )

    op.create_table(
        "speaker_segments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("audio_file_id", sa.Integer(), sa.ForeignKey("audio_files.id"), nullable=False),
        sa.Column("annotator_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("speaker_label", sa.String(50), nullable=True),
        sa.Column("start_time", sa.Float(), nullable=False),
        sa.Column("end_time", sa.Float(), nullable=False),
        sa.Column("gender", sa.String(20), nullable=True),
        sa.Column("emotion", sa.String(50), nullable=True),
        sa.Column("emotion_other", sa.String(255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_ambiguous", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("source", sa.String(50), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "transcription_segments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("audio_file_id", sa.Integer(), sa.ForeignKey("audio_files.id"), nullable=False),
        sa.Column("annotator_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("start_time", sa.Float(), nullable=False),
        sa.Column("end_time", sa.Float(), nullable=False),
        sa.Column("original_text", sa.Text(), nullable=True),
        sa.Column("edited_text", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "original_json_store",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("audio_file_id", sa.Integer(), sa.ForeignKey("audio_files.id"), nullable=False),
        sa.Column("json_type", sa.String(30), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "final_annotations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("audio_file_id", sa.Integer(), sa.ForeignKey("audio_files.id"), nullable=False),
        sa.Column("segment_id", sa.Integer(), nullable=True),
        sa.Column("annotation_type", sa.String(30), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("decision_method", sa.String(50), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("finalized_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "segment_edit_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("segment_type", sa.String(30), nullable=False),
        sa.Column("segment_id", sa.Integer(), nullable=False),
        sa.Column("field_changed", sa.String(100), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("edited_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=True),
        sa.Column("resource_id", sa.Integer(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("audit_logs")
    op.drop_table("segment_edit_history")
    op.drop_table("final_annotations")
    op.drop_table("original_json_store")
    op.drop_table("transcription_segments")
    op.drop_table("speaker_segments")
    op.drop_table("assignments")
    op.drop_table("audio_files")
    op.drop_table("users")
