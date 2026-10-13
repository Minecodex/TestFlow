# 本地开发与测试

## 开发环境

需要 Node.js >=22.12、pnpm 10.23、Python 3.13、uv 和 PostgreSQL 18；音频处理需要 FFmpeg，仓库同步需要 Git/SSH。

```sh
pnpm install --frozen-lockfile
uv sync --project server --frozen
uv run --project server python scripts/dev-config.py
```

将生成的 `.env` 中数据库地址设为可用 PostgreSQL，再执行迁移。在两个终端分别启动后端与前端：

```sh
uv run --project server alembic -c server/alembic.ini upgrade head
pnpm dev:server
```

```sh
pnpm dev
```

前端地址为 <http://127.0.0.1:5173>，API 文档为 <http://127.0.0.1:8000/docs>。初始化脚本保留已有 `.env`，初始登录为 `admin / 123456`，密码记录位于 `.data/admin-initial-password`。

真实模块执行需要 Kubernetes Pod 网络与持久卷；本地前后端进程用于界面和 API 开发。平台开发镜像构建、加载与部署步骤见 [开发镜像构建与部署](#开发镜像构建与部署)。

## 模块开发与接口

```sh
uv run --project server python scripts/module-package.py package <模块目录> --output <输出.zip>
pnpm api
```

模块开发见 [模块协议 v1](../contracts/module/README.md) 和 [ZIP 模块与动态配置](voice-test-platform/14-ZIP模块与动态配置设计.md)。ZIP 包、Schema、服务身份、镜像 imageID 与运行配置均会校验；跨安装导入 workflow 时需重新绑定目标环境资源与凭据。

## 验证

```sh
pnpm typecheck
pnpm build
pnpm test:server
pnpm test:demo
```

`TESTFLOW_TEST_DATABASE_URL` 可指向独立 PostgreSQL 测试库；测试会重建业务表，请使用专用测试库。未配置时使用测试 SQLite。

完整 E2E 使用临时 `testflow-e2e-` namespace，覆盖真实 API、模块 Pod、浏览器交互、流式数据、评分与历史，并在结束后回收资源。入口与前置条件见 [测试说明](../tests/README.md)，实际结果见 [实施记录](voice-test-platform/16-完整实施记录.md) 和 [最新输入组验收](voice-test-platform/23-输入组与简化工作区.md)。

## 工程目录

```text
web/src/                  页面、统一 UI、模块宿主、API 类型、i18n、样式
server/src/testflow/       路由、领域服务、持久化、调度器、DAG、Pod 与协议
server/migrations/        数据库迁移
contracts/                OpenAPI、模块、workflow 与测试数据契约
packages/module-ui-sdk/    动态配置组件 SDK
packages/tooling/          OpenAPI 类型生成
examples/                 模块、仓库接入与多模态场景示例
deploy/k8s/                平台、PostgreSQL、迁移 Job、PVC、RBAC 与环境模板
scripts/                  初始化、模块打包、部署和备份工具
tests/                    原型、接口、浏览器及 Kubernetes 验收
docs/                     产品设计、实施记录、原型与界面截图
```

## 开发镜像构建与部署

本地构建并加载到 Docker Desktop：

```sh
docker build -f server/Dockerfile -t testflow-server:dev .
docker build -f web/Dockerfile -t testflow-web:dev .
uv run --project server python scripts/module-package.py examples --version 1.0.2 --build
uv run --project server python scripts/deploy-kubernetes.py --namespace testflow-dev --port 18765 --load-images
```

用户直接使用 Docker Hub 镜像的安装步骤见 [项目首页](../README.md#快速部署)。

## 维护部署目录

`deploy/k8s/base` 是平台资源定义，`scripts/kubernetes_bootstrap.py` 定义集群初始化与依赖等待，共享辅助模块为 `scripts/kubernetes_installation.py`。维护工具将资源、两个脚本和公开镜像版本组合，导出用户直接 apply 的静态目录；脚本通过同一个 ConfigMap 挂载到初始化容器：

```sh
uv run --project server python scripts/export-kubernetes.py
uv run --project server python scripts/export-kubernetes.py --check
uv run --project server pytest -q tests/test_kubernetes_bootstrap.py
uv run --project server python tests/kubernetes/beta_installation.py
```

用户 namespace 默认固定为 `testflow`，更新镜像版本时保持不变。初始化/迁移 Job 随镜像版本命名，初始化保留已存在的数据库密码及加密密钥。修改 `base`、初始化代码或共享辅助模块后重新导出目录，并完成静态目录一致性与临时 Kubernetes 验证。导出工具只用于维护，用户执行 `kubectl apply -f deploy/k8s/beta` 安装。

## GitHub 分支与合并

默认主分支为 `main`，修改通过工作分支提交 PR。主分支保护要求经 PR 合并、解决全部审查讨论，禁止强制推送与删除，规则对管理员同样生效。当前仅有一位维护者，必需审批数为 0；合并前必须通过 GitHub Actions 的 `PR checks`，并保持分支与 `main` 最新状态一致。

`v0.0.1-beta` 使用既有 `feature/v0.0.1-beta` 分支交付。提交前运行后端与初始化测试、前端类型检查和构建、原型测试以及部署目录一致性检查，相关 Kubernetes 与浏览器验收结果保存在部署设计和专项文档中。

## GitHub Actions

每次创建或更新面向 `main` 的 PR，运行 [PR quick checks](../.github/workflows/pr-checks.yml)。根据完整 Git diff 选择检查，不构建镜像或启动 Kubernetes；连续推送会取消该 PR 上一轮尚未完成的检查。

| 改动范围 | PR 检查 |
| --- | --- |
| `server/` | SQLite 后端单元测试、OpenAPI 一致性、部署工具测试 |
| `web/`、`packages/` | 前端与 SDK 类型检查 |
| `contracts/` | 后端、前端及工具检查 |
| `scripts/`、`deploy/`、Python 工具测试 | 工具测试及静态部署目录一致性 |
| `docs/demo.html`、其他 `tests/` | 原型及 Trace 契约测试 |
| `examples/` | 后端、原型及工具检查 |
| Actions 或 CI 工具、新增未知源码目录 | 全部快速检查 |
| 仅 Markdown、文档图片 | 不安装应用依赖，只返回成功状态 |

依赖使用仓库锁文件与缓存。所有分支最后汇总为唯一的 `PR checks`；被范围筛选跳过的任务允许成功汇总，执行失败或取消会阻止合并。工作流本身始终响应 PR，避免文档 PR 缺少必需状态。

[Release full tests](../.github/workflows/release-tests.yml) 仅在推送 `v*` 版本标签时自动执行，也可手动指定**已经存在的版本标签**重跑。普通 PR 和分支推送不触发全量测试；工作流验证 `v主版本.次版本.补丁版本[-预发布标识]`。发布镜像或创建 GitHub Release 前，应确认对应标签的全量检查通过；该工作流负责验证，不自动发布镜像或 Release。

发布检查包括 SQLite/PostgreSQL 18 全部后端测试、工具测试、前端生产构建、原型与生成接口一致性，以及 Linux AMD64/ARM64 候选镜像、独立 kind 集群中的真实模块 Pod、流式媒体、执行边界、故障恢复、备份恢复、最新桌面浏览器和单次 apply 安装验收。具体有效范围见 [发布自动化验收](../tests/README.md#发布自动化验收)。

CI 的 AI 评分使用确定性 HTTP 协议夹具，实际经过凭据加密、后端评分和恢复调用链，不消耗外部模型额度。真实 Kimi 服务质量与公开仓库完整业务示例仍按专项文档单独验收，不将协议夹具记录为真实模型调用。

本地验证发布集成流程时，先准备候选镜像及模块包，再使用独立的 `kind-testflow-ci-<run-id>` 上下文和 kubeconfig：

```sh
uv run --project server python scripts/ci_release.py prepare
uv run --project server python scripts/ci_release.py integration \
  --context kind-testflow-ci-<run-id> --kubeconfig <测试集群配置>
```

每个测试安装使用随机的 `testflow-e2e-` 或 `testflow-restore-` namespace，并在成功或失败后清理 namespace、卷及端口转发；kind Action 最后删除整套临时集群。公开的结果、截图和脱敏 Trace 作为 Actions artifact 保留 14 天，访问文件、原始 Trace、kubeconfig 和 Secret 不上传。
