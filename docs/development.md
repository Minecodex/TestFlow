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

默认主分支为 `main`，修改通过工作分支提交 PR。主分支保护要求经 PR 合并、解决全部审查讨论，禁止强制推送与删除，规则对管理员同样生效。当前仅有一位维护者，必需审批数为 0；仓库尚未配置 GitHub Actions，暂未设置必需状态检查。

`v0.0.1-beta` 使用既有 `feature/v0.0.1-beta` 分支交付。提交前运行后端与初始化测试、前端类型检查和构建、原型测试以及部署目录一致性检查，相关 Kubernetes 与浏览器验收结果保存在部署设计和专项文档中。
