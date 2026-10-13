# Portable workflow v1

`testflow.workflow.v1` 是可跨安装传播的 DAG 配置，与实际执行快照分别保存。权威类型为 OpenAPI 的 `WorkflowDocument`、`WorkflowImport`、`WorkflowPreview`。

| 请求 | 作用 |
| --- | --- |
| `POST /api/v1/pipelines/export` | 导出草稿，验证引用与参数，不创建版本 |
| `GET /api/v1/pipelines/{id}/export?version=N` | 导出指定不可变版本 |
| `POST /api/v1/pipelines/import/preview` | 解析依赖、选项和错误，不保存、不执行 |
| `POST /api/v1/pipelines/import` | 重新校验后创建新流程，要求 `Idempotency-Key` |

导入请求为 `{document, bindings?, name?}`。`bindings` 将依赖 key 映射到目标环境的 `{id, version}`；凭据 version 省略或为 null。重复成功请求返回同一流程，同一幂等 key 的不同输入返回 409。

文件保存有序 Schema、位置、连线、组装映射、转换方向、有效 Pod runtime、参数及超时。节点以 `module_key`、`repository_key` 和凭据需求 key 引用依赖：

- 模块固定 manifest `id + version + package_digest`，允许匹配旧不可变版本，摘要不符不按名称回退。
- 仓库固定 `url + commit`，只匹配已同步且可见的仓库版本。重复同步同一 commit 选择该资源最新符合版本，多个符合资源须显式选择。
- 凭据只保存需求 key、名称及 module/registry 类别。正文和来源 credential_id 不导出，目标环境总是显式选择。参数槽位为 null，绑定路径必须指向 Schema 声明的 `x-testflow-credential` 字段，支持嵌套、数组和本地 `$ref`。
- 不导出安装模块/仓库 ID、磁盘路径、执行输入或产物。文件不能安装模块、同步仓库、创建凭据或下载镜像，导入不自动执行。

预览返回 `resolved`、`missing`、`selection_required`、匹配选项及图/参数错误，全部通过才 `valid=true`。提交时重新验证，旧预览不能绕过失效或隐藏依赖。导入后仍须按既有规则验证 Pod 和实际 imageID。

示例见 [repository-helpdesk](../../examples/repository-helpdesk/README.md)。HTML 原型的模拟流程快照不包含包摘要，不能当作 v1 文件；正式前端导出统一使用本契约。
