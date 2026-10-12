# TestFlow 验证

正式业务、原型逻辑、浏览器交互和视觉比较分别验收。原型内的模拟运行不计入真实执行或评分证据。完整状态与证据索引见 [实施记录](../docs/voice-test-platform/16-完整实施记录.md)。

## 类型、构建与业务测试

```sh
pnpm typecheck
pnpm build
uv run --directory server pytest -q
node --test tests/*.test.cjs
pnpm check:k8s
```

37 项后端测试覆盖会话、持久版本与幂等、素材、ZIP、图契约、流序号/EOS、终态、评测绑定、CER、JSON null/有限数、统计和 Trace 脱敏。默认使用测试 SQLite；设置 `TESTFLOW_TEST_DATABASE_URL` 后使用独立 PostgreSQL 18 测试库。测试会重建业务表，禁止指向正式工作库。两种数据库均已实际通过。

19 项原型及清单测试通过 `demo-test-helpers.cjs` 加载真实 demo 逻辑，不操作浏览器。覆盖 Pod-only 边界、挂载、快照、九页/六页签、排队输入冻结、参考、重跑、旧报告、CER、任意输出字段、媒体、转换、错误、取消、当前尝试和具名控件归属。AI 分数与合格线使用 0–1，CER 保留原始错误率。

`tests/container-smoke.py` 验证开发镜像代理、SPA 刷新、静态资源 404、健康、非 root、只读运行和可写数据目录。该验证不替代 Kubernetes。

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

录音相关三个控件按用户要求保留未验收；测试使用合成 WAV/PNG，不申请麦克风权限。移动菜单排除。`action-manifest.json` 共 88 项，保存已验证操作的具体正常和失败/边界用例 ID；清单静态测试只校验归属，真实覆盖门槛由运行时 `ControlLedger` 检查。

登录先完成再开启 Trace，凭据表单验收在 Trace 结束后进行。原始网络 Trace 保存在 0600 私有文件；`sanitize-browser-trace.py` 剔除 Cookie、授权头、密码、密钥、凭据正文及对应二进制资源后生成可查看的 `trace.zip`。脱敏器另有四项独立测试：

```sh
uv run --project server pytest -q tests/test_trace_sanitize.py
```

## 视觉与布局

`visual-fixtures.cjs` 从真实 demo 状态生成相同数据的只读接口与基准 HTML；仅固定时间/随机 ID、媒体 URL并关闭原型入场动画。夹具不进入正常安装，也不计入真实执行或评分证据。

标准 Playwright 的 `visual` 项目自动启动只读服务器，使用同一 Chromium、系统字体栈、DPR 1 和 1440×1000 视口，等待字体、图片和两帧渲染完成，保存原始 PNG。`visual-compare.py` 按 RGB 最大通道差异 >16 比较，门槛保持 0.5%；仅允许显式遮罩动态 ID、时间和耗时，不遮罩布局、文本、按钮、状态或错误。当前九页全部通过，差异 0.209%–0.484%，没有遮罩。失败保留非零退出码及差异图。

```sh
pnpm build
TESTFLOW_BROWSER_RUN_ID=<visual-run-id> pnpm exec playwright test --project=visual --no-deps
```

`states` 在真实 Kubernetes 界面等待数据请求和有限时长入场动画完成后截图，检查页面横向溢出、可见控件位置、滚动容器、字号、完整模块名称和弹窗结构。408 个状态截图用于视觉复核，不等同于 408 次原型像素比较；严格像素比例只针对九个主页面。表格宽度不足时使用独立滚动。

CUA 的人工截图及 DOM/AX 观察单独保存，补充检查执行评分、画布、弹窗和抽屉；它们不冒充标准 Playwright 网络 Trace。最终结果与限制见 [实施记录](../docs/voice-test-platform/16-完整实施记录.md)。

## 极小模型实际场景与扩大对照

`tests/kubernetes/tiny_scenario.py` 在独立 namespace 同步虚拟项目并执行 BM25、PocketSphinx、Tesseract、Kimi SSE 和 eSpeak 五个实际模块，覆盖文字/语音/图片三条链路、规则、真实 AI、重跑和固定报告。`tests/tiny-scenario-ui.e2e.mjs` 查看真实报告、播放产物、检查六个页签、Kimi 评分及新建流程输入输出选项。步骤与体积见 [实验说明](../examples/scenarios/tiny-helpdesk/README.md)。

`tests/platform-detail-visual.e2e.mjs` 对十三个弹窗、详情、画布和报告状态保存实际原型差异。它是诊断入口；不把有差异的状态标为通过，也不把缺少依赖/截图等基础错误当作视觉差异。当前十三状态未达到 0.5% 门槛，具体结果见 [第 18 篇](../docs/voice-test-platform/18-极小模型场景与界面对照.md)。
