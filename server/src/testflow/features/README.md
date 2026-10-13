# 单体业务边界

每个业务域保持高内聚：`router.py` 负责 HTTP 边界，`schemas.py` 负责请求和响应，`service.py` 负责业务规则，`models.py` / `repository.py` 负责持久化。按实际实现添加文件，不生成空 CRUD。

当前只有 system 实现可调用接口。repositories、modules、assets、datasets、pipelines、evaluation、tasks、executions 已预留 Python 包；不代表业务已实现。执行器位于同一服务的 execution 包，由业务层调用。跨域逻辑通过服务接口协作，路由不直接操作其他域的数据。
