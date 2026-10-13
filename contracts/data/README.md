# 素材包与测试集交换契约

平台内使用资源 ID 和不可变修订；分享文件使用可移植键与摘要。导入先预览、再提交，不启动任务。模板见 [repository-helpdesk](../../examples/repository-helpdesk/README.md)。

## 素材池 ZIP：`testflow.assets.v1`

ZIP 根目录包含 `manifest.json`；文件直接放在 `files/`，音频可附带 `originals/` 原始文件。清单为 `format + assets[]`。每项包含唯一 `key`、名称、类型、格式、`file {path, sha256, size}`、可选 `original`、标签、分类、参考、确认状态、来源及附加标注 metadata。

文字统一为 UTF-8 `.txt`；图片须真实解码成功；执行音频须为非空 WAV、16kHz、Mono、PCM16，并验证声明帧数。原始音频保留实际字节并验证可以解码。尺寸、编码、时长重新从文件解析；源环境的 `execution_id`、`runtime_id` 不作为目标环境的关联。描述、截断标识等其余 metadata 保留。素材标注不会自动作为测试集标准答案。

服务校验全部文件后才创建数据库资源。拒绝路径越界、符号链接、重复 ZIP 名、额外或缺失文件、错误摘要/大小、无效媒体和未知格式。压缩及解压总量均受上传上限限制（默认 100 MiB），清单最多 4 MiB、素材最多 1000 项。不会将 ZIP 解压到用户给定路径。

完全相同的可见固定修订可复用，包括旧修订；只相同文件但不同名称、标签、参考或来源会形成独立素材。隐藏条目不能满足新的导入依赖，历史媒体仍能读取。不同导入 key 之间也按修订身份加数据库锁去重。

| API | 行为 |
| --- | --- |
| `POST /api/v1/assets/export` | 显式选择 `{assets:[{id,version}]}`，下载包含这些固定修订的 ZIP |
| `POST /api/v1/assets/import/preview` | multipart `file`；只校验，逐项展示创建/复用 |
| `POST /api/v1/assets/import` | multipart `file` + `Idempotency-Key`；整体保存并返回本地 ID/版本、创建和复用数 |

## 测试集 JSON：`testflow.dataset.v1`

JSON 为 `format + assets[] + dataset`。dataset 仅保存名称、说明、有序输入 Schema 和输入组。每组有文件内唯一 `key`、名称和输入；输入为 `{value:...}` 或 `{asset_key:...}`。不接受 `output_schema`、案例 `reference`、`reference_assets` 或参考确认字段。

依赖清单只包含实际输入素材。导入后映射为本环境素材 ID，日常输入跟随全局素材最新修订，任务创建时冻结实际版本。流程负责实际输出结构，平台评测模型根据输入与实际输出判定。素材标注仍随素材包迁移，但不会生成测试集预期答案。

assets 声明每个被引用素材的唯一 `key`、名称、类型、格式、内容 SHA-256 和 `revision_digest`。后者对素材名称、类型、格式、文件及原始文件摘要/大小、标签、分类、附加标注、参考与来源做 canonical JSON SHA-256；文件路径和 ZIP 内 key 不参与身份。相同字节但不同参考不能代替固定修订。

导入按摘要匹配本环境可见修订，唯一候选自动绑定；有多个候选时显式选择 `{bindings:{key:{id,version}}}`。显式错误绑定不能回退到其他候选。无版本的显式选择只检查当前修订。导入重新产生本地案例 ID，保留成员顺序和所有业务值；验证名称、类型、格式、输入完整性和文字/JSON 字面量。缺少素材时提示先导入配套 ZIP。

| API | 行为 |
| --- | --- |
| `GET /api/v1/datasets/{id}/export?version=N` | 导出指定输入专用结构/成员版本；固定素材绑定按声明读取，未固定引用在导出时解析，移除本环境 ID |
| `GET /api/v1/datasets/{id}/export` | 导出当前测试集并解析最新素材修订；正式界面默认使用此入口，配套素材导出同样选择当前修订 |
| `POST /api/v1/datasets/import/preview` | `{document,bindings?,name?}`；只校验并返回候选、固定绑定和错误 |
| `POST /api/v1/datasets/import` | 同预览请求 + `Idempotency-Key`；保存新的测试集版本 1 |

全部成功写响应在事务提交后发出；提交失败返回错误。重复 key 和相同请求返回同一个结果，改变请求复用 key 返回 409。前端测试集导入草稿和 key 可跨关闭、页面导航及刷新恢复；素材 ZIP 的 File 在当前页面关闭/重开时保留，刷新或离开页面后需重新选择，数据库摘要去重防止重复创建。

导出的是用户显式选择的测试材料，可能包含素材内容与参考；不包含凭据正文、数据库连接、PVC 路径或任务执行历史。workflow 使用 [独立契约](../workflow/README.md)，任务在目标环境重新显式配对和提交。

旧的包含输出或参考的测试集修订不能作为当前交换格式导出；升级时迁移会追加当前输入专用版本，历史执行快照不改写。
