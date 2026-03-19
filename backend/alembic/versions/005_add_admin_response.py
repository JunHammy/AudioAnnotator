"""Add admin_response column to audio_files

Revision ID: 005
Revises: 004
Create Date: 2026-03-19
"""
revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    with op.batch_alter_table('audio_files') as batch_op:
        batch_op.add_column(sa.Column('admin_response', sa.Text(), nullable=True))


def downgrade():
    with op.batch_alter_table('audio_files') as batch_op:
        batch_op.drop_column('admin_response')
