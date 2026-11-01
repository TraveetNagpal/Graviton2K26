"""Persist generated report artifacts in PostgreSQL."""
from alembic import op
import sqlalchemy as sa

revision = "0002_report_artifacts"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("reports", sa.Column("pdf_artifact", sa.LargeBinary(), nullable=True))
    op.add_column("reports", sa.Column("csv_artifact", sa.LargeBinary(), nullable=True))


def downgrade():
    op.drop_column("reports", "csv_artifact")
    op.drop_column("reports", "pdf_artifact")
