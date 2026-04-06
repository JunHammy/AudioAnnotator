"""drop trust_score and segments_reviewed from users

Revision ID: 012
Revises: 011
Create Date: 2026-04-06
"""
from alembic import op
import sqlalchemy as sa

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("trust_score")
        batch_op.drop_column("segments_reviewed")


def downgrade():
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("trust_score", sa.Float(), nullable=False, server_default="0.5"))
        batch_op.add_column(sa.Column("segments_reviewed", sa.Integer(), nullable=False, server_default="0"))
