"""add soft delete to audio_files

Revision ID: 008
Revises: 007
Create Date: 2026-03-19
"""
from alembic import op
import sqlalchemy as sa

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("audio_files") as batch_op:
        batch_op.add_column(sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="0"))


def downgrade():
    with op.batch_alter_table("audio_files") as batch_op:
        batch_op.drop_column("is_deleted")
