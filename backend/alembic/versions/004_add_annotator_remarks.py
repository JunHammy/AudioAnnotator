"""add annotator_remarks to audio_files

Revision ID: 004
Revises: 003
Create Date: 2026-03-16
"""
from alembic import op
import sqlalchemy as sa

revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('audio_files') as batch_op:
        batch_op.add_column(sa.Column('annotator_remarks', sa.Text(), nullable=True))


def downgrade():
    with op.batch_alter_table('audio_files') as batch_op:
        batch_op.drop_column('annotator_remarks')
