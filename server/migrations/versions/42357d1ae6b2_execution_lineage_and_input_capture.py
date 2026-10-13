"""Persist quick-run lineage and captured live inputs."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision = '42357d1ae6b2'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('executions', sa.Column('root_id', sa.String(36), nullable=True))
    op.execute('UPDATE executions SET root_id = COALESCE(item_id, id)')
    op.alter_column('executions', 'root_id', nullable=False)
    document = sa.JSON().with_variant(postgresql.JSONB(), 'postgresql')
    op.add_column('executions', sa.Column('actual_inputs', document, nullable=False, server_default=sa.text("'{}'")))
    op.alter_column('executions', 'actual_inputs', server_default=None)
    op.create_index('ix_executions_root_id', 'executions', ['root_id'])
    op.create_unique_constraint('uq_execution_root_attempt', 'executions', ['root_id', 'attempt'])


def downgrade():
    op.drop_constraint('uq_execution_root_attempt', 'executions', type_='unique')
    op.drop_index('ix_executions_root_id', table_name='executions')
    op.drop_column('executions', 'actual_inputs')
    op.drop_column('executions', 'root_id')
