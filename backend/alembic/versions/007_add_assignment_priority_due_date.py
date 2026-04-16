"""add assignment priority and due_date

Revision ID: 007
Revises: 006
Create Date: 2026-03-19
"""
from alembic import op
import sqlalchemy as sa

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("assignments") as batch_op:
        batch_op.add_column(sa.Column("priority", sa.String(20), nullable=False, server_default="normal"))
        batch_op.add_column(sa.Column("due_date", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    with op.batch_alter_table("assignments") as batch_op:
        batch_op.drop_column("due_date")
        batch_op.drop_column("priority")
