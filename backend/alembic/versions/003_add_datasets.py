"""Add datasets table and dataset_id to audio_files

Revision ID: 003
Revises: 002
Create Date: 2026-03-12
"""
from alembic import op
import sqlalchemy as sa

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "datasets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    with op.batch_alter_table("audio_files") as batch_op:
        batch_op.add_column(sa.Column("dataset_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("audio_files") as batch_op:
        batch_op.drop_column("dataset_id")

    op.drop_table("datasets")
