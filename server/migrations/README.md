# 数据库迁移

预留 PostgreSQL / SQLAlchemy / Alembic 迁移目录。当前没有业务表或自动建表行为。首次实现模型时增加 Alembic 配置和版本迁移，并采用单次迁移 Job；不在每个 API 请求或应用副本启动时并发迁移。
