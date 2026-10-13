# TestFlow 验证

正式业务、原型逻辑、浏览器交互和视觉比较分别验收。原型内的模拟运行不计入真实执行或评分证据。完整状态与证据索引见 [实施记录](../docs/voice-test-platform/16-完整实施记录.md)。

## 发布自动化验收

GitHub Actions 的 PR 仅按改动范围运行快速检查，合并门禁统一为 `PR checks`。全量测试只在推送 `v*` 版本标签或手动指定已有标签时运行；触发和范围规则见 [开发说明](../docs/development.md#github-actions)。

发布工作流执行全部当前后端测试（SQLite 和 PostgreSQL 18）、Python 工具测试、前端构建、原型/Trace 测试及生成接口一致性；随后在 AMD64 和 ARM64 两套独立 kind 集群执行 `scripts/ci_release.py`：

| 集成入口 | 验收内容 |
| --- | --- |
| `container-smoke.py` | 非 root、只读运行、健康、代理与静态资源 |
| `kubernetes/acceptance.py` | 空安装、固定 Git commit、三语言模块 Pod、任务、规则/模型评分、重跑与旧报告 |
| `live_media.py`、`go_protocol.py`、`code_mount.py` | 流式音频/图片、EOS、取消与协议错误、固定代码只读挂载及回收 |
| `transaction_and_media.py` | 提交可见性、真实 FFmpeg、音频字节与 Range |
| `boundaries.py`、`reliability.py` | 执行边界、终态、数据库中断、重启、取消与独立收尾 |
| `backup_restore.py` | 独立安装的数据库/PVC 恢复、历史、媒体和加密凭据调用 |
| `input_only.py` | 当前输入组、素材只读预览、模型表单、评分成功/失败、交换与删除的真实浏览器场景 |
| `beta_installation.py` | 候选镜像的一次目录 apply、初始化/迁移等待、重复 apply 保留密钥、节点配置与真实 Pod 浏览器场景 |

AI 使用集群内的确定性评分协议夹具，不需要 GitHub Secret；证据明确标为 `contract_fixture`。真实 Kimi 和公开 GitHub 业务示例仍保留单独验收入口，需要外部服务与凭据，不属于这套自包含 CI 的自动调用范围。安装测试使用当前标签构建的候选镜像；已发布 Docker Hub 镜像的验收继续使用 `beta_installation.py` 默认入口。

当前浏览器发布范围采用第 23、24 篇的桌面、中英文和深浅主题契约。下文旧原型控件、标准答案、恢复/回收站和像素对照是历史专项记录，不能直接作为当前全量浏览器入口；未重新适配的历史脚本不在发布工作流中冒充通过。测试结果保存在 `.data/ci-evidence/release-result.json`，公开白名单证据上传为 Actions artifact；失败同样清理测试 namespace、卷与端口转发。

2026-10-13 在独立 ARM64 kind 集群中完成上述 11 组集成套件；输入组浏览器 18 个场景/48 组布局、安装 15 项检查及节点配置 14 个场景/12 组布局通过。四个 namespace、卷、端口转发和整个集群均已回收，正常部署保留。快速检查也已在 GitHub 实跑通过，详见 [CI 与 kind 验证记录](../docs/voice-test-platform/15-工程结构与部署.md#2026-10-13-ci-策略与独立-kind-验证)。

## 类型、构建与业务测试

```sh
pnpm typecheck
pnpm build
uv run --directory server pytest -q
node --test tests/*.test.cjs
pnpm check:k8s
```

当前 71 项后端测试覆盖会话、持久版本与幂等、素材、ZIP、模块运行配置修订与声明约束、示例安装的默认配置保存和重复运行、图契约、流序号/EOS、终态、评测绑定、CER、JSON null/有限数、统计和 Trace 脱敏。默认使用测试 SQLite；设置 `TESTFLOW_TEST_DATABASE_URL` 后使用独立 PostgreSQL 18 测试库。测试会重建业务表，禁止指向正式工作库。此前两种数据库均有通过记录；第 22 篇本轮 65 项 pytest 使用 SQLite，PostgreSQL 18 通过独立 Kubernetes 部署的实际接口与浏览器联调验证。

19 项原型及清单测试通过 `demo-test-helpers.cjs` 加载真实 demo 逻辑，不操作浏览器。覆盖 Pod-only 边界、挂载、快照、九页/六页签、排队输入冻结、参考、重跑、旧报告、CER、任意输出字段、媒体、转换、错误、取消、当前尝试和具名控件归属。AI 分数与合格线使用 0–1，CER 保留原始错误率。

`sanitize-browser-trace.test.cjs` 另验证凭据请求正文、fill 日志、密码输入 DOM 快照和两种请求体文件引用的脱敏，保留普通输入与二进制媒体。当前 `pnpm test:demo` 合计 20 项通过。

`tests/container-smoke.py` 验证开发镜像代理、SPA 刷新、静态资源 404、健康、非 root、只读运行和可写数据目录。该验证不替代 Kubernetes。

## Docker Hub 镜像安装验收

`tests/kubernetes/beta_installation.py` 默认复制静态 `deploy/k8s/beta` 目录到全新测试 namespace，并执行一次 `kubectl apply -f <目录>`，不提前创建 namespace 或 Secret。平台及 initContainer 使用 `imagePullPolicy: Always`，从 Docker Hub 拉取公开镜像。

```sh
uv run --project server python scripts/export-kubernetes.py --check
uv run --project server pytest -q tests/test_kubernetes_bootstrap.py
uv run --project server python tests/kubernetes/beta_installation.py
```

检查自动密钥生成、数据库/迁移/前后端就绪、依赖门禁、初始登录和空工作区；重复 apply 与重新创建初始化 Job 后，数据库密码与加密密钥保持不变。后续执行 14 项节点运行配置浏览器场景，包含真实文本模块 Pod、业务参数、任务评分、异常重试及 12 组双语主题布局。文本示例包与三语言镜像按 [开发说明](../docs/development.md#开发镜像构建与部署) 准备，专项默认使用 Docker Desktop。

`--image-renderer` 保留此前镜像内生成清单的验证模式，`--local-platform-images` 用于本地候选镜像。私有访问文件均为 `0600`，截图、结果及脱敏 Trace 保存到 `.data/acceptance/<namespace>/`；结束回收 namespace、PVC/PV 与端口转发，核对正常部署未变化。

2026-10-13 静态目录验证在 `testflow-e2e-apply-dir-20261013-01` 通过：自动启动与重复 apply、初始化 Job 重试及现有密钥保留，14 个浏览器场景和 12 组桌面布局，无脚本错误。临时资源已回收。初始化测试覆盖 `testflow` 固定 namespace 与测试 namespace 的首次创建、不同安装随机值、部分失败恢复、并发冲突、恢复缺少的 Secret 和不一致配置拒绝。

固定 `testflow` 默认名称后的六项初始化测试及公开镜像内运行检查通过。`testflow-e2e-namespace-20261013-01` 的单次 apply 验证通过 15 项安装检查、14 个浏览器场景和 12 组布局，临时资源已回收；更换镜像标签后默认 namespace 保持 `testflow`。详情见 [固定用户 namespace 验证](../docs/voice-test-platform/15-工程结构与部署.md#固定用户-namespace-验证)。

此前发布前后镜像生成模式的 `testflow-e2e-beta-local-20261013-02` 与 `testflow-e2e-beta-hub-20261013-01` 各完成 14 个浏览器场景、12 组桌面布局，记录见 [发布记录](../docs/voice-test-platform/15-工程结构与部署.md#2026-10-13-docker-hub-发布与验收)。

## 真实 Kubernetes

使用 Docker Desktop 内置 Kubernetes 的 `docker-desktop` 上下文。先部署全新 `testflow-e2e-<run-id>` namespace，等待迁移、后端与前端 rollout，然后启动 localhost port-forward。集群连接信息来自该 namespace 的私有 `access.json`；全部脚本显式指定 context 和 kubeconfig，不依赖当前全局上下文。不得在同一 namespace 的 rollout 期间运行验收。

```sh
uv run --project server python scripts/deploy-kubernetes.py --namespace testflow-e2e-<run-id> --port 18775 --load-images
python3 scripts/port-forward.py --namespace testflow-e2e-<run-id> --port 18775
uv run --project server python tests/kubernetes/acceptance.py --namespace testflow-e2e-<run-id>
```

验收要求默认安装为空。随后真实同步固定 Git commit、导入/验证 ZIP、执行 Python/Node.js/Go Pod、检查音频/图片/文字和 Range、Trace、规则、真实 Kimi、重跑、旧报告及资源收尾。真实密钥从本地加密凭据引用读取；不在脚本、日志或公共证据中保存正文。

其他脚本分别覆盖：

- `boundaries.py`：15 项实际 Pod 执行边界与重启恢复。
- `reliability.py`：7 项终态、数据库中断、取消、身份变化、准备与收尾检查。
- `live_media.py`：4 项合成实时音频/图片的 EOS、断连和产物完整性。
- `go_protocol.py`：4 项真实 Go 调用幂等、协议错误和取消停止检查。
- `code_mount.py`：4 项容器读取固定 commit、只读挂载、快照和回收检查。
- `backup_restore.py`：6 项数据库/PVC 恢复、历史、媒体和真实加密凭据调用检查。
- `browser_fixtures.py`：为实际浏览器创建合成错误、取消、JSON null/资产形状 JSON 案例。
- `draft_change.py`、`browser_control.py`：仅对测试拥有的 namespace 制造版本、会话与数据库故障。

保存证据后使用 `scripts/cleanup-acceptance.py --namespace ...` 回收本次测试资源；该脚本核验 namespace 标签，只停止对应 port-forward。正常 `testflow-dev` 和 Docker Desktop 集群保留。

## 正式浏览器

使用标准 Playwright 1.64 和对应的官方 Chromium 浏览器，在独立 Kubernetes 测试 namespace 实际执行。`platform.spec.mjs` 复用已有 CUA/Playwright 交互函数；`platform-controls.spec.mjs` 分业务记录每个控件的正常及失败/边界路径，包含预期、实际结果、可执行断言和截图。测试通过公开表单、选择、拖拽、键盘和下载交互，不向页面注入应用状态。业务故障在测试拥有的接口、版本或网络请求上构造。

先运行 Kubernetes 完整验收，创建合成文件并安装浏览器：

```sh
python3 tests/create-demo-fixtures.py
pnpm exec playwright install chromium
TESTFLOW_E2E_NAMESPACE=testflow-e2e-<run-id> TESTFLOW_BROWSER_RUN_ID=<run-id> pnpm test:e2e
```

完整入口包括四个项目，使用单 worker 串行执行；`controls` 依赖 `workflow`，`states` 依赖 `controls`。不得并行启动多个业务浏览器测试进程。每次结果使用独立目录，防止删除其他运行的截图和 Trace。调试单个项目时可使用 `--project=<name> --no-deps`；详情状态检查要求先有完整通过的控件报告。

| 项目 | 验收内容 | 证据 |
| --- | --- | --- |
| workflow | 十组真实业务回归、八项历史/返回/版本检查及 108 个主页面布局组合 | `.data/browser-results/<run-id>/.../workflow.json`、脱敏 Trace |
| controls | 84 项桌面非录音操作，163 条正常、失败或边界用例；登录、凭据、会话恢复额外覆盖 | `.data/acceptance/<namespace>/browser-controls.json` 指向逐项结果、截图和脱敏 Trace |
| states | 34 类详情、画布、弹窗、抽屉状态 × 三种桌面宽度 × 两种语言 × 两种主题，共 408 个组合 | `state-matrix.json`、逐状态截图 |
| visual | 九个主页面与原型的严格 PNG 比较 | `screens.json`、`result.json`、差异图 |

录音相关三个控件按用户要求保留未验收；测试使用合成 WAV/PNG，不申请麦克风权限。移动菜单排除。上述 88 项是历史版本清单；当前 `action-manifest.json` 增加节点库和流程设置，共 90 项，保存已验证操作的具体正常和失败/边界用例 ID。最新调整单独验收，见文末；清单静态测试只校验归属，真实覆盖门槛由运行时 `ControlLedger` 检查。

登录先完成再开启 Trace，凭据表单验收在 Trace 结束后进行。原始网络 Trace 保存在 0600 私有文件；`sanitize-browser-trace.py` 剔除 Cookie、授权头、密码、密钥、凭据正文及对应二进制资源后生成可查看的 `trace.zip`。脱敏器另有四项独立测试：

```sh
uv run --project server pytest -q tests/test_trace_sanitize.py
```

## 视觉与布局

`visual-fixtures.cjs` 从真实 demo 状态生成相同数据的只读接口与基准 HTML；仅固定时间/随机 ID、媒体 URL并关闭原型入场动画。夹具不进入正常安装，也不计入真实执行或评分证据。

标准 Playwright 的 `visual` 项目自动启动只读服务器，使用同一 Chromium、系统字体栈、DPR 1 和 1440×1000 视口，等待字体、图片和两帧渲染完成，保存原始 PNG。`visual-compare.py` 按 RGB 最大通道差异 >16 比较，门槛保持 0.5%；仅允许显式遮罩动态 ID、时间和耗时，不遮罩布局、文本、按钮、状态或错误。先前版本九页差异为 0.209%–0.484%，没有遮罩；本次页头、评测卡片和画布调整后的 36 组布局检查不代表重新通过严格像素比较。失败保留非零退出码及差异图。

```sh
pnpm build
TESTFLOW_BROWSER_RUN_ID=<visual-run-id> pnpm exec playwright test --project=visual --no-deps
```

`states` 在真实 Kubernetes 界面等待数据请求和有限时长入场动画完成后截图，检查页面横向溢出、可见控件位置、滚动容器、字号、完整模块名称和弹窗结构。408 个状态截图用于视觉复核，不等同于 408 次原型像素比较；严格像素比例只针对九个主页面。表格宽度不足时使用独立滚动。

CUA 的人工截图及 DOM/AX 观察单独保存，补充检查执行评分、画布、弹窗和抽屉；它们不冒充标准 Playwright 网络 Trace。最终结果与限制见 [实施记录](../docs/voice-test-platform/16-完整实施记录.md)。

## 极小模型实际场景与扩大对照

新增 [GitHub 仓库代码与 workflow 示例](../examples/repository-helpdesk/README.md)：`tests/kubernetes/repository_workflows.py` 同步当前公开仓库的固定 commit，下载校验五个 ZIP 和四份 workflow，证明每个 Pod 实际导入挂载仓库中的业务函数。覆盖离线检索、文字/语音/图片问答、真实 Kimi 评测、重跑、旧报告及第二套 Kubernetes 安装中的导出/导入/执行。发布前 artifacts 明确标记 `unpublished_http_fixture`；发布后 `--artifact-ref` 切换为真实 GitHub 下载。

`tests/repository-workflow-ui.e2e.mjs` 覆盖正式前端新增控件：无效文件、缺少依赖、凭据重绑定、取消保留、预览和导出失败重试、重复提交保护、导出再导入、真实快速执行，以及十二种语言/主题/桌面宽度组合。这些扩展不计入旧 HTML 原型 88 项清单。结果和截图保存到独立目录，原始 Trace 为 0600，分享前用既有脱敏工具处理。

`tests/kubernetes/tiny_scenario.py` 在独立 namespace 同步虚拟项目并执行 BM25、PocketSphinx、Tesseract、Kimi SSE 和 eSpeak 五个实际模块，覆盖文字/语音/图片三条链路、规则、真实 AI、重跑和固定报告。`tests/tiny-scenario-ui.e2e.mjs` 查看真实报告、播放产物、检查六个页签、Kimi 评分及新建流程输入输出选项。步骤与体积见 [实验说明](../examples/scenarios/tiny-helpdesk/README.md)。

`tests/platform-detail-visual.e2e.mjs` 对十三个弹窗、详情、画布和报告状态保存实际原型差异。它是诊断入口；不把有差异的状态标为通过，也不把缺少依赖/截图等基础错误当作视觉差异。当前十三状态未达到 0.5% 门槛，具体结果见 [第 18 篇](../docs/voice-test-platform/18-极小模型场景与界面对照.md)。

## 素材包、测试集与正常工作区示例

新控件由 `tests/data-transfer-ui.e2e.mjs` 验证实际文件选择、预览、提交保护、关闭/草稿恢复、服务失败重试、提交后响应丢失的幂等恢复、固定旧素材的配套导出和中英文/深浅主题布局。使用 `TESTFLOW_E2E_NAMESPACE=testflow-e2e-<run-id> node tests/data-transfer-ui.e2e.mjs`，前置为 `uv run --project server python tests/kubernetes/data_transfer.py --namespace testflow-e2e-<run-id>`。

`tests/kubernetes/transaction_and_media.py` 补验连续登录后立即读会话、创建后立即读素材，以及容器内真实 FFmpeg、原始音频字节、Range 和隐藏后历史读取。`server/tests/test_data_transfer.py` 验证包/摘要/格式/路径、原子拒绝、修订、案例和幂等，`test_transaction_responses.py` 验证成功响应等待提交及提交失败不能报成功。E2E 只写临时 namespace，正常工作区使用用户授权的 [安装脚本](../examples/repository-helpdesk/install.py)。

## 界面密度与画布交互增量验收

已构建平台镜像后，在 Docker Desktop Kubernetes 中运行：

```sh
uv run --project server python tests/kubernetes/interface_redesign.py --load-web-image
```

入口创建全新 `testflow-e2e-interface-<run-id>` namespace，部署数据库、迁移和平台，运行 `tests/interface-redesign.e2e.mjs`，最后回收 namespace、卷及端口转发。拒绝复用已存在的 namespace。浏览器结果、截图和脱敏 Trace 保存到 `.data/acceptance/<namespace>/interface-redesign/`，部署及清理结果位于同 namespace 的 `result.json`。

28 项检查覆盖紧凑下拉、评测卡片/详情/编辑、503 重试、409 冲突、按需节点库、拖动与节点抽屉、开始与共享结束字段、独立设置弹窗、保存及重载、真实快速执行、七类资源删除/取消/恢复和九页页头。另检查三个受影响页面的 36 种语言、主题与桌面宽度组合。测试创建真实流程版本并执行案例，不调用 AI 服务或麦克风；本轮未重新执行完整旧控件套件，也未重做 0.5% 像素验收。正常部署和验收证据见 [第 21 篇记录](../docs/voice-test-platform/21-界面密度和画布交互调整.md)。

## 全局素材与多模态列表增量验收

`tests/asset-experience.e2e.mjs` 使用真实 Kubernetes 安装，创建文字/音频/图片素材、带显式参考来源的测试集和规则，实际执行修改前后两次任务。覆盖共用编辑、标签、失败重试、媒体/表格/维度、日常引用与历史冻结以及 72 个布局组合。

```sh
uv run --project server python tests/kubernetes/asset_experience.py --load-images
```

入口只创建全新测试 namespace，使用固定连接信息，最后清理 namespace、卷和端口转发。证据、截图和脱敏 Trace 保留在 `.data/acceptance/<namespace>/asset-experience/`。`server/tests/test_asset_references.py` 补验文件摘要、MIME、版本冲突、排队快照及不含正文的资源变更事件。最终 21 项检查和 72 个布局组合通过，详情见 [第 22 篇记录](../docs/voice-test-platform/22-全局素材和多模态列表完善.md)。原控件套件的素材编辑检查已改用 Enter 标签；本轮不把旧套件或旧像素比较声明为重新通过。

## 输入专用测试集与简化工作区

```sh
uv run --project server python tests/kubernetes/input_only.py --load-images
```

入口创建全新 namespace，部署 PostgreSQL、迁移及平台，另部署确定性的评分协议夹具；不调用外部模型。`tests/input-only.e2e.mjs` 验证每组独立边框、组内多字段行列表、只读媒体/大图、点击素材名称新标签页定位、没有独立素材跳转按钮、输入/输出编号、默认工作区移除、模型表单凭证、保存失败重试、模型返回通过和失败、输入专用交换，以及删除后无恢复 API。布局覆盖 1200/1440/1920、中英文、深浅主题。结束清理整个测试 namespace、卷、夹具及端口转发。证据和新边界见 [第 23 篇](../docs/voice-test-platform/23-输入组与简化工作区.md)。此前测试集参考、全局搜索/刷新/回收站及跨页面直接编辑素材的旧控件用例属于历史范围，不作为当前入口。

## 模块运行配置与节点业务参数

```sh
uv run --project server python tests/kubernetes/interface_redesign.py \
  --namespace testflow-e2e-node-config-<run_id> --load-images \
  --browser-script tests/node-configuration.e2e.mjs \
  --evidence-directory node-configuration
```

此专项验证 ZIP 的运行默认值、模块保存与冲突、实际 Pod 身份、节点名称/描述/业务参数、声明业务凭据的配置入口、Schema 错误、流程设置取消、真实流式文本参数影响输出、悬停删除边/节点、workflow 交换和中英文深浅主题。还实际运行仓库示例安装脚本两次，确认模块先保存固定仓库挂载默认值并验证真实 Pod，workflow 绑定保存的修订，重复安装不新增修订或重复业务资源。`--load-images` 同时加载三语言文本等测试镜像及五个仓库示例镜像，须提前构建。

配套 `server/tests/test_module_configuration.py` 检查运行默认值修订、不可变包及历史、固定 commit、声明限制、描述交换和重复安装保留当前配置。最终 14 个场景、12 个布局组合通过，证据见 [第 24 篇](../docs/voice-test-platform/24-能力运行配置与节点业务参数.md)。专项只执行本地 Node.js 文本能力，仓库示例安装只验证服务就绪和契约，不调用外部模型或麦克风；完整 namespace 在保存证据后回收。
