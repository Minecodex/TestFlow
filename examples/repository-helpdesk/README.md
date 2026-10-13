# 从 GitHub 仓库运行 example

接入流程：注册当前开源 TestFlow 仓库 → 同步固定 commit → 下载并导入模块 ZIP → 导入 workflow 并绑定资源 → 导入素材包与测试集 → 验证模块 → Kubernetes Pod 执行 → 规则/AI 评测 → 报告 → 素材、测试集、workflow 导出和跨安装导入。

业务函数来自仓库的 [`processors.py`](../scenarios/tiny-helpdesk/processors.py)，知识来自 [`knowledge.json`](../scenarios/tiny-helpdesk/project/knowledge.json)。五个容器都将平台同步的仓库只读挂载到 `/workspace/repository`。镜像包含标准模块服务、薄适配层和运行依赖；适配层通过 `importlib` 加载挂载目录中的业务函数。Trace 保存函数的实际文件路径、代码 SHA-256 和只读挂载证据。

模板固定 [source.json](source.json) 中已推送的 GitHub commit `7c89f3076ab637a3467fbf3d56f2ae7fc8f09e2e`。更新业务代码时生成新 workflow 并固定新 commit；分支变化不会影响已有执行。

## 下载文件

模块 ZIP：[BM25](downloads/modules/repo-bm25.zip?raw=true) · [ASR](downloads/modules/repo-asr.zip?raw=true) · [OCR](downloads/modules/repo-ocr.zip?raw=true) · [Kimi](downloads/modules/repo-kimi.zip?raw=true) · [TTS](downloads/modules/repo-tts.zip?raw=true)。

workflow：[离线检索](workflows/retrieval.workflow.json?raw=true) · [文字问答](workflows/text.workflow.json?raw=true) · [语音问答](workflows/voice.workflow.json?raw=true) · [图片文字问答](workflows/image.workflow.json?raw=true)。格式为 `testflow.workflow.v1`，不含来源安装的模块/仓库 ID、磁盘路径、credential_id 或密钥。文件摘要见 [下载索引](downloads/index.json)。

素材包：[3 份固定合成素材 ZIP](downloads/assets/helpdesk.assets.zip?raw=true)。测试集：[离线检索](datasets/retrieval.dataset.json?raw=true) · [文字问答](datasets/text.dataset.json?raw=true) · [语音问答](datasets/voice.dataset.json?raw=true) · [图片文字问答](datasets/image.dataset.json?raw=true)。素材包包含文字、WAV、PNG、标签、分类及素材参考；测试集包含有序 Schema、案例与固定素材摘要，案例参考默认留空。无需手工重新建立案例。

模块、workflow、素材包和测试集随源码版本一同发布，下载链接对应正在查看的 Git ref。[Beta PR #1](https://github.com/Minecodex/TestFlow/pull/1) 已合并到 `main`，可从主分支或固定 commit 下载。此前发布前的测试通过临时 HTTP 地址下载工作区文件，并明确记录其来源；仓库代码仍从真实 GitHub 获取。

## 准备镜像与下载

输入样本：[文字问题](inputs/query.txt?raw=true) · [合成问题 WAV](inputs/question.wav?raw=true) · [问题 PNG](inputs/question.png?raw=true)。音频和图片是本次真实闭环使用的固定合成素材，可下载后导入素材池；不包含麦克风采集。

ZIP 包含契约和配置组件；镜像单独准备，平台导入不会编译代码。当前示例镜像尚未发布到公共 registry，从包含本目录的源码版本明确构建，再加载到 Docker Desktop Kubernetes：

```sh
git clone --branch feature/v0.0.1-beta https://github.com/Minecodex/TestFlow.git
cd TestFlow
uv sync --project server
uv run --project server python examples/repository-helpdesk/build.py --build
uv run --project server python scripts/load-module-images.py --index examples/repository-helpdesk/downloads/index.json --context docker-desktop
```

工具先将分支解析为一个 commit，再下载该 commit 中的模块、workflow、素材包和测试集全部文件，并校验 SHA-256：

```sh
python3 examples/repository-helpdesk/fetch.py --ref feature/v0.0.1-beta --output .data/downloaded-repository-example
```

其他 Kubernetes 集群需要将镜像推送到可访问的 registry，并修改 manifest、产生新模块版本、重新打包和生成 workflow。生产使用镜像 digest，同一模块版本不可覆盖。

## 界面操作

1. **代码仓库**：注册 `https://github.com/Minecodex/TestFlow.git`；分支/引用填 `source.json` 的完整 commit，同步并确认成功。
2. **能力模块**：上传五个 ZIP 并等待安装完成。点击模块卡片“编辑”，检查 ZIP 提供的镜像默认值，选择同步的固定仓库版本并只读挂载到 `/workspace/repository`，保存运行配置并“验证可用性”。配置会生成新平台修订，原 ZIP 保持不变。离线检索只需 `repo-bm25.zip`。
3. **能力业务凭据**：问答场景在 Kimi 节点的“配置能力凭据”中创建“模块”类别凭据，或在 workflow 导入绑定中配置；独立 AI 评测在模型表单填写凭证。正文加密保存，离线检索不需要凭据。
4. **流程集 → 导入流程**：选择 workflow JSON，按包版本/摘要和仓库 URL/commit 匹配资源，显式选择本环境凭据。缺少资源、摘要/commit 不符或图错误时不能提交；导入只创建流程，不自动执行。

   已选择的 JSON、名称和绑定保留为本地草稿。关闭、去其他页面补齐依赖、刷新或重新登录后可恢复；同一提交意图保留幂等 key，成功导入后清除草稿。
5. **画布**：节点侧栏编辑名称、描述及模块组件定义的能力参数，例如检索 `top_k`、语音合成 `speed`；模块未声明参数时显示空状态。挂载与镜像在能力模块页面编辑并保存，节点超时和固定能力修订在“流程设置”中调整。
6. **评测配置**：先建立“正常完成”“输出结构”等规则维度，再点击画布“快速运行”。文字输入为 `query = What is the refund policy?`；语音使用 16kHz、Mono、PCM16 WAV；图片使用印有该问题的 PNG。
7. **素材池 → 导入素材包**：上传 `helpdesk.assets.zip`，预览 3 条素材的创建/复用状态，确认后保存。现有“导入素材”仍可逐文件上传。
8. **测试集 → 导入测试集**：依次上传 4 个 `.dataset.json`，检查固定素材绑定并导入。与同名模态的 workflow 显式配对后创建测试任务，查看 EOS、仓库代码 Trace、实际声音产物、评测和报告。关闭、导航和刷新保留 JSON 导入草稿，失败可使用同一幂等 key 重试。
9. **素材池 → 导出素材包 / 测试集详情 → 导出测试集、导出配套素材**：迁移时先导入配套素材 ZIP，再导入测试集 JSON。配套导出按案例引用打包固定旧修订，也可导出已经隐藏但仍被案例引用的素材；不会改为素材最新修订。
10. **导出流程**：在另一套安装中同步同一 URL/commit、导入同一 ZIP 并重新选择凭据后导入导出文件。图布局、字段组、映射、转换、参数和超时保持，安装资源 ID 重新解析。运行前仍须准备镜像和验证模块。

离线检索输出 `query + context`，第一条命中 `returns`。问答输出 `answer + audio + evidence`，答案应包含 14 天退货政策并引用 `[returns]`。知识库是运行资料，案例不默认设置参考答案。

## 一次导入整套示例

已用本仓库部署工具创建本地 Kubernetes 工作区、准备镜像并在界面建立本环境“模块”类别凭据后，可重复运行安装脚本：

```sh
uv run --project server python examples/repository-helpdesk/install.py --namespace testflow-dev --module-credential-id <本环境模块凭据ID>
```

脚本通过正式 API 同步真实 GitHub 仓库、导入 5 个模块、4 个流程、3 份素材、4 个测试集及完成/结构评测配置。仓库挂载先保存到模块运行默认值，再使用保存的修订验证真实 Pod；workflow 显式绑定该能力修订。重复运行读取模块最新配置，保留已编辑的资源和复用设置，不被首次导入的幂等响应覆盖；固定包已有更新版本时提示使用当前包。相同配置复用资源，不同配置保留已有版本。访问地址和 admin 密码从 `.data/kubernetes/<namespace>/access.json` 私密读取。也可用 `--directory .data/downloaded-repository-example` 指定经过摘要验证的下载目录。

追加 `--run` 会显式提交四案例真实任务并调用远程 Kimi；相同计划只提交一次任务。可通过 `--credential-file <私密文件>` 创建示例模块凭据，密钥不可放入命令行或 Git。本开发环境还可复用已加密保存的 `.data/kimi-credential-reference`。单独的 AI 评测凭据/配置仍在界面建立。离线检索可仅按前述界面步骤导入 BM25、retrieval 流程/测试集和素材包，不需要模型凭据。

## 模型与范围

内置 BM25 无权重；PocketSphinx 约 6.30 MiB、限定英文语法；Tesseract 英文 OCR 约 3.92 MiB；eSpeak NG 数据约 11.09 MiB；Kimi `k3` 为远程真实 API。详情见[小模型说明](../scenarios/tiny-helpdesk/README.md)。这些体积不代表镜像大小，本例不验收自由语音、中文、通用图像语义或生成质量。音频使用合成声音，不申请麦克风权限。

## 自动验收

按[部署说明](../../deploy/k8s/README.md)准备并加载平台及 PostgreSQL 镜像，创建两套临时安装；两个 port-forward 分别在独立终端保持运行：

```sh
uv run --project server python scripts/deploy-kubernetes.py --namespace testflow-e2e-github-<run-id> --port 18782
uv run --project server python scripts/deploy-kubernetes.py --namespace testflow-e2e-github-copy-<run-id> --port 18783
python3 scripts/port-forward.py --namespace testflow-e2e-github-<run-id> --port 18782
python3 scripts/port-forward.py --namespace testflow-e2e-github-copy-<run-id> --port 18783
```

测试读取现有加密 `.data/kimi-credential-reference`，不将正文写入参数、Git 或报告：

```sh
uv run --project server python tests/kubernetes/repository_workflows.py --namespace testflow-e2e-github-<run-id> --copy-namespace testflow-e2e-github-copy-<run-id>
TESTFLOW_E2E_NAMESPACE=testflow-e2e-github-<run-id> node tests/repository-workflow-ui.e2e.mjs
python3 scripts/cleanup-acceptance.py --namespace testflow-e2e-github-<run-id>
python3 scripts/cleanup-acceptance.py --namespace testflow-e2e-github-copy-<run-id>
```

发布前省略 `--artifact-ref`，通过临时 HTTP 下载工作区文件。发布后添加 `--artifact-ref <已推送 ref>`，验证真实 GitHub ZIP/workflow 下载。结果位于 `.data/acceptance/<namespace>/repository-workflows.json`，`artifacts.kind` 区分两种来源。

## 素材和测试集自动验收

```sh
uv run --project server python tests/kubernetes/data_transfer.py --namespace testflow-e2e-<run-id>
uv run --project server python tests/kubernetes/transaction_and_media.py --namespace testflow-e2e-<run-id>
TESTFLOW_E2E_NAMESPACE=testflow-e2e-<run-id> node tests/data-transfer-ui.e2e.mjs
```

临时安装必须使用本次源码构建的前后端和示例镜像。结果分别保存为 `data-transfer.json`、`transaction-and-media.json`、`data-ui.json`，然后按部署说明回收测试 namespace。完整闭环包括合成素材包、固定案例输入、真实 Kimi/ASR/OCR/TTS 容器、规则报告、可移植导出和重复安装。契约见 [素材与测试集交换](../../contracts/data/README.md)。
