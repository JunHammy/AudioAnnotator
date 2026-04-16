"""Add missing indexes on FK and filter columns

Revision ID: 011
Revises: 010_add_locked_emotion
Create Date: 2026-03-30
"""

from alembic import op

revision = "011"
down_revision = "010_add_locked_emotion"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("assignments") as batch_op:
        batch_op.create_index("ix_assignments_audio_file_id", ["audio_file_id"])
        batch_op.create_index("ix_assignments_annotator_id", ["annotator_id"])
        batch_op.create_index("ix_assignments_status", ["status"])

    with op.batch_alter_table("speaker_segments") as batch_op:
        batch_op.create_index("ix_speaker_segments_audio_file_id", ["audio_file_id"])
        batch_op.create_index("ix_speaker_segments_annotator_id", ["annotator_id"])
        batch_op.create_index("ix_speaker_segments_source", ["source"])
        # Composite index for the common (audio_file_id, source) filter pattern
        batch_op.create_index("ix_speaker_segments_file_source", ["audio_file_id", "source"])

    with op.batch_alter_table("transcription_segments") as batch_op:
        batch_op.create_index("ix_transcription_segments_audio_file_id", ["audio_file_id"])

    with op.batch_alter_table("segment_edit_history") as batch_op:
        batch_op.create_index("ix_segment_edit_history_edited_by", ["edited_by"])
        # Composite index for the common (segment_type, segment_id) lookup pattern
        batch_op.create_index("ix_segment_edit_history_type_id", ["segment_type", "segment_id"])

    with op.batch_alter_table("audit_logs") as batch_op:
        batch_op.create_index("ix_audit_logs_created_at", ["created_at"])

    with op.batch_alter_table("final_annotations") as batch_op:
        batch_op.create_index("ix_final_annotations_audio_file_id", ["audio_file_id"])

    with op.batch_alter_table("original_json_store") as batch_op:
        batch_op.create_index("ix_original_json_store_audio_file_id", ["audio_file_id"])


def downgrade():
    with op.batch_alter_table("assignments") as batch_op:
        batch_op.drop_index("ix_assignments_audio_file_id")
        batch_op.drop_index("ix_assignments_annotator_id")
        batch_op.drop_index("ix_assignments_status")

    with op.batch_alter_table("speaker_segments") as batch_op:
        batch_op.drop_index("ix_speaker_segments_audio_file_id")
        batch_op.drop_index("ix_speaker_segments_annotator_id")
        batch_op.drop_index("ix_speaker_segments_source")
        batch_op.drop_index("ix_speaker_segments_file_source")

    with op.batch_alter_table("transcription_segments") as batch_op:
        batch_op.drop_index("ix_transcription_segments_audio_file_id")

    with op.batch_alter_table("segment_edit_history") as batch_op:
        batch_op.drop_index("ix_segment_edit_history_edited_by")
        batch_op.drop_index("ix_segment_edit_history_type_id")

    with op.batch_alter_table("audit_logs") as batch_op:
        batch_op.drop_index("ix_audit_logs_created_at")

    with op.batch_alter_table("final_annotations") as batch_op:
        batch_op.drop_index("ix_final_annotations_audio_file_id")

    with op.batch_alter_table("original_json_store") as batch_op:
        batch_op.drop_index("ix_original_json_store_audio_file_id")
