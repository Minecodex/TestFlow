# 接口契约

权威 OpenAPI 为 `contracts/openapi.json`，由 FastAPI 路由与 Pydantic 契约生成。`pnpm api` 更新契约及 `web/src/shared/api/generated/` 中拆分后的请求、路径和操作类型，避免生成文件超过 2000 行。

所有管理 API 位于 `/api/v1`，唯一 admin 使用服务端会话与 HttpOnly Cookie。错误包含 code、message、fields、request_id；响应带 X-Request-ID。版本写入使用 expected_version，冲突保留前端草稿。

任务、快速执行、重跑、复评、仓库同步、模块导入及验证使用 Idempotency-Key；重复 key 返回原操作，内容变化返回冲突。事件通过 `/live?cursor=...` 回补，不会自动提交运行操作。

模块的独立 HTTP/WebSocket 服务契约见 `module/README.md`。模块 token 只访问指定执行的资源，不能访问 admin 管理接口。

可迁移 DAG 格式、依赖预览和幂等导入见 [workflow v1](workflow/README.md)，导出不携带来源安装的资源或凭据 ID。

素材 ZIP 与测试集 JSON 的摘要身份、依赖预览和幂等导入见 [data v1](data/README.md)。管理接口的数据库事务在成功响应发送前完成提交；提交失败返回错误，避免登录或写入后立即读取的竞争。
