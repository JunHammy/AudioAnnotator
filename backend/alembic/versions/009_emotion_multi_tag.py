"""emotion: single string → JSON list, drop emotion_other column

Revision ID: 009
Revises: 008
Create Date: 2026-03-24

Each annotator can now apply multiple emotion tags per segment.
"Other" descriptions are embedded inline as "Other:<description>".
"""
import json
from alembic import op
import sqlalchemy as sa

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade():
    # Read existing data before schema change
    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT id, emotion, emotion_other FROM speaker_segments")
    ).fetchall()

    with op.batch_alter_table("speaker_segments") as batch_op:
        batch_op.alter_column("emotion", type_=sa.JSON(), existing_nullable=True)
        batch_op.drop_column("emotion_other")

    # Migrate data: wrap string values into lists; merge emotion_other into "Other:<text>"
    for row_id, emotion, emotion_other in rows:
        if emotion is None:
            continue
        if emotion == "Other" and emotion_other:
            new_val = [f"Other:{emotion_other}"]
        else:
            new_val = [emotion]
        connection.execute(
            sa.text("UPDATE speaker_segments SET emotion = :e WHERE id = :id"),
            {"e": json.dumps(new_val), "id": row_id},
        )


def downgrade():
    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT id, emotion FROM speaker_segments WHERE emotion IS NOT NULL")
    ).fetchall()

    with op.batch_alter_table("speaker_segments") as batch_op:
        batch_op.add_column(sa.Column("emotion_other", sa.String(255), nullable=True))
        batch_op.alter_column("emotion", type_=sa.String(50), existing_nullable=True)

    for row_id, emotion_json in rows:
        if not emotion_json:
            continue
        emotions = emotion_json if isinstance(emotion_json, list) else json.loads(emotion_json)
        first = emotions[0] if emotions else None
        if not first:
            continue
        if first.startswith("Other:"):
            connection.execute(
                sa.text(
                    "UPDATE speaker_segments SET emotion = 'Other', emotion_other = :eo WHERE id = :id"
                ),
                {"eo": first[6:], "id": row_id},
            )
        else:
            connection.execute(
                sa.text("UPDATE speaker_segments SET emotion = :e WHERE id = :id"),
                {"e": first, "id": row_id},
            )
