"""Drop subfolder column from audio_files

Revision ID: 002
Revises: 001
Create Date: 2026-03-12
"""
from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("audio_files") as batch_op:
        batch_op.drop_column("subfolder")


def downgrade() -> None:
    with op.batch_alter_table("audio_files") as batch_op:
        batch_op.add_column(sa.Column("subfolder", sa.String(255), nullable=True))
