"""add collaborative_locked_emotion to audio_files

Revision ID: 010_add_locked_emotion
Revises: 009_emotion_multi_tag
Create Date: 2026-03-24
"""
from alembic import op
import sqlalchemy as sa

revision = "010_add_locked_emotion"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("audio_files") as batch_op:
        batch_op.add_column(
            sa.Column(
                "collaborative_locked_emotion",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )


def downgrade():
    with op.batch_alter_table("audio_files") as batch_op:
        batch_op.drop_column("collaborative_locked_emotion")
