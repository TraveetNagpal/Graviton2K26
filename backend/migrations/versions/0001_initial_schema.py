"""Create core PostGIS records for TerraMind."""
from alembic import op
import sqlalchemy as sa
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.create_table("users", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("email", sa.String(320), nullable=False, unique=True), sa.Column("password_hash", sa.String(256), nullable=False), sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_table("saved_regions", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False), sa.Column("name", sa.String(200), nullable=False), sa.Column("geometry", Geometry("MULTIPOLYGON", srid=4326, spatial_index=True), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_index("ix_saved_regions_owner_id", "saved_regions", ["owner_id"])
    op.create_table("satellite_observations", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("dataset", sa.String(40), nullable=False), sa.Column("asset_id", sa.String(500), nullable=False, unique=True), sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False), sa.Column("cloud_cover_percent", sa.Float()), sa.Column("metadata_json", postgresql.JSONB(), nullable=False, server_default="{}"))
    op.create_index("ix_satellite_observations_dataset", "satellite_observations", ["dataset"])
    op.create_index("ix_satellite_observations_observed_at", "satellite_observations", ["observed_at"])
    op.create_table("analysis_jobs", sa.Column("id", sa.String(36), primary_key=True), sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")), sa.Column("analysis_type", sa.String(40), nullable=False), sa.Column("status", sa.String(20), nullable=False), sa.Column("request_json", postgresql.JSONB(), nullable=False), sa.Column("error_json", postgresql.JSONB()), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()), sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    for col in ("owner_id", "analysis_type", "status"):
        op.create_index(f"ix_analysis_jobs_{col}", "analysis_jobs", [col])
    op.create_index("ix_analysis_owner_created", "analysis_jobs", ["owner_id", "created_at"])
    op.create_table("analysis_results", sa.Column("analysis_id", sa.String(36), sa.ForeignKey("analysis_jobs.id", ondelete="CASCADE"), primary_key=True), sa.Column("result_json", postgresql.JSONB(), nullable=False), sa.Column("raster_asset_uris", postgresql.JSONB(), nullable=False, server_default="[]"), sa.Column("completed_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_table("monitoring_configurations", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False), sa.Column("region_id", sa.Integer(), sa.ForeignKey("saved_regions.id", ondelete="CASCADE"), nullable=False), sa.Column("name", sa.String(200), nullable=False), sa.Column("analysis_type", sa.String(40), nullable=False), sa.Column("schedule", sa.String(80), nullable=False), sa.Column("parameters", postgresql.JSONB(), nullable=False, server_default="{}"), sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_index("ix_monitoring_configurations_owner_id", "monitoring_configurations", ["owner_id"])
    op.create_index("ix_monitoring_configurations_region_id", "monitoring_configurations", ["region_id"])
    op.create_table("alerts", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False), sa.Column("monitoring_id", sa.Integer(), sa.ForeignKey("monitoring_configurations.id", ondelete="SET NULL")), sa.Column("analysis_id", sa.String(36), sa.ForeignKey("analysis_jobs.id", ondelete="SET NULL")), sa.Column("message", sa.Text(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()), sa.Column("read", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index("ix_alerts_owner_id", "alerts", ["owner_id"])
    op.create_table("reports", sa.Column("id", sa.String(36), primary_key=True), sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")), sa.Column("analysis_id", sa.String(36), sa.ForeignKey("analysis_jobs.id", ondelete="CASCADE"), nullable=False), sa.Column("title", sa.String(250), nullable=False), sa.Column("status", sa.String(20), nullable=False), sa.Column("artifact_uri", sa.Text()), sa.Column("geojson_available", sa.Boolean(), nullable=False, server_default=sa.false()), sa.Column("metadata_json", postgresql.JSONB(), nullable=False, server_default="{}"), sa.Column("error", sa.Text()), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    for col in ("owner_id", "analysis_id", "status"):
        op.create_index(f"ix_reports_{col}", "reports", [col])

def downgrade():
    for table in ("reports", "alerts", "monitoring_configurations", "analysis_results", "analysis_jobs", "satellite_observations", "saved_regions", "users"):
        op.drop_table(table)
