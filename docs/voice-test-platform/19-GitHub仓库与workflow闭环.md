# GitHub 仓库、ZIP 和 workflow 闭环验收

2026-10-12 已实现可迁移 workflow 导入/导出，以及从当前开源仓库加载业务代码的完整示例。[使用步骤与下载文件](../../examples/repository-helpdesk/README.md) · [workflow v1 契约](../../contracts/workflow/README.md)。

## 实现

- `examples/repository-helpdesk/downloads/modules/` 保存五个可导入 ZIP，`workflows/` 保存离线检索、文字、语音、图片四份可导入 DAG。
- README 指导注册 `https://github.com/Minecodex/TestFlow.git`、同步固定 commit、准备镜像、导入 ZIP、绑定 workflow、验证模块并执行。另提供实际验收的合成 WAV、PNG 和文字样本。
- 容器只包含协议宿主、适配层和依赖；五个模块从只读挂载的仓库导入 `examples/scenarios/tiny-helpdesk/processors.py`。不以“读取知识数据”代替“引用仓库业务代码”验收。
- 正式前端新增导入、依赖预览、凭据选择和提交反馈。导出从草稿或固定版本生成 v1 文件，去除安装资源/凭据 ID；导入在目标环境重新绑定固定包和 commit，要求幂等 key，提交时再次校验。
- 缺少依赖、错误摘要/commit、隐藏资源、图错误、凭据类别错误、未声明的凭据路径均不能提交。凭据不按同名自动选取；手写旧 credential_id 也不能绕过重绑定。

## 真实结果

Docker Desktop Kubernetes 中的 `testflow-e2e-github-20261012-02` 和 `testflow-e2e-github-copy-20261012-02` 为两套独立平台、数据库和 PVC。源仓库通过真实 GitHub fetch 同步，固定 commit 为 `7c89f3076ab637a3467fbf3d56f2ae7fc8f09e2e`。

| 链路 | 实际结果 |
| --- | --- |
| 文字 → 仓库 BM25 → Kimi SSE → 完整文本 → TTS | 成功，正常 EOS，回答含 14 天及 `[returns]`，生成可解码 WAV |
| 合成 WAV → 仓库 ASR → 同一问答链路 | 成功，真实 PocketSphinx 识别和语音产物 |
| PNG → 仓库 OCR → 同一问答链路 | 成功，真实 Tesseract 识别和语音产物 |
| 离线检索 | 成功，命中仓库中的退货政策文档，无模型 API 调用 |
| 导出 → 第二套安装导入 → 执行 | 成功，仓库/模块 ID 改变，固定 commit 与函数实现保持 |
| Kimi 结构化 AI 评测 | 实际调用通过，评分材料为上述真实回答与检索证据 |
| 重跑与旧报告 | 新实例运行，流程快照不变；计划分母为 4，旧报告保持原选用结果 |

11 项集群检查通过。每个运行模块的 Trace 记录实际函数文件位置、代码 SHA-256、只读挂载；与从 GitHub 原始 commit 单独读取的文件摘要匹配。另检查五个实际镜像内没有仓库目录，只有使用 importlib 的薄适配层。

浏览器 14 项检查通过：实际四案例报告、空导入、无效 JSON、错误包摘要、凭据显式绑定、取消保留、跨页面/刷新恢复草稿及幂等 key、预览失败重试、提交中关闭/重复提交保护、可迁移导出、导出失败重试、导出再导入、真实快速执行和十二种导入弹窗布局（1200/1440/1920 × 中文/英文 × 浅色/深色）。这些是新增功能与布局验收，不是对所有页面的原型像素一致性结论；既有详情差异见[第 18 篇](18-极小模型场景与界面对照.md)。

后端全量 47 项测试、类型检查、生产构建、原型 19 项测试和 Trace 脱敏测试通过。正常 `testflow-dev` 已更新能力，实验业务记录仅存在临时安装。第一次集群测试因验收脚本漏传快速执行必需的评测配置而失败，保留其证据；修复后使用第二次全新安装通过。浏览器调试中的选择器/预期文字错误保留各次结果，只有最终通过记录计入验收。

## 文件与发布状态

集群证据：`.data/acceptance/testflow-e2e-github-20261012-02/repository-workflows.json`、`repository-report.json`、四个 `*-execution.json`、`rerun-execution.json`、`image-boundary.json`；第二套安装保存 `copied-workflow-execution.json`。浏览器目录由 `workflow-ui.json` 指向，包含逐项截图、十二种布局、导出 JSON、原始私有 Trace、脱敏 Trace 和泄漏审计。

GitHub 仓库代码引用已实测。新增 ZIP/workflow 尚未推送，当前 GitHub 下载索引返回 404；`publication.json` 记录为 `pending_publication`。本次通过的是待发布文件的 HTTP 下载、SHA-256 校验、导入和真实执行，`artifacts.kind=unpublished_http_fixture`。不能将其算作已完成 GitHub 文件发布。

将本次 `examples/repository-helpdesk` 文件随代码推送后，可用 `fetch.py --ref <已推送 ref>` 下载；再次运行集群脚本时传 `--artifact-ref <已推送 ref>`，专门验证真实 GitHub ZIP/workflow 下载。镜像也未发布到公共 registry，README 提供本地明确构建和加载步骤。

测试结束后按 `cleanup-acceptance.py` 回收两个临时 namespace、Pod、PVC 与端口转发，保留本地证据和正常平台。麦克风继续按用户要求未验收；示例不评判模型质量、自由语音、中文或通用图片语义。
