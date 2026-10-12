# TestFlow

测试平台，完成仓库接入、模块导入、素材与测试集、有序字段组 DAG、真实执行、规则/AI 评测与报告追溯。正式桌面前端以 `docs/demo.html` 为原型基准，支持中文/英文和浅色/深色。

平台为 Python 3.13 + FastAPI 单体，PostgreSQL 18、SQLAlchemy async、Alembic；前端使用 React 19、TypeScript、Vite、HeroUI、TanStack Query、React Router、Zustand 和 React Flow 12.12.0。全部模块由 Kubernetes Pod 启动，镜像启动命令由模块自身定义，编程语言不限。

## 目录

```text
web/src/                  页面、统一 UI、模块宿主、API 类型、i18n、Tokens
server/src/testflow/       路由、业务服务、持久化、调度器、DAG、Pod 与协议
server/migrations/        不可变数据库迁移
contracts/                OpenAPI 与模块 v1 契约
packages/module-ui-sdk/    动态配置组件 SDK
packages/tooling/          OpenAPI 类型生成
examples/modules/         Python 音频、Node.js 流式文本、Go 图片真实示例
deploy/k8s/                平台、PostgreSQL、迁移 Job、PVC、RBAC 与环境模板
scripts/                  初始化、模块打包、部署和备份工具
tests/                    原型、浏览器及 Kubernetes 验收
```

## 开发

需要 Node >=22.12、pnpm 10.23、uv 和 PostgreSQL 18；音频处理需要 FFmpeg，仓库同步需要 Git/SSH。

```sh
pnpm install --frozen-lockfile
uv sync --project server
uv run --project server python scripts/dev-config.py
uv run --project server alembic -c server/alembic.ini upgrade head
pnpm dev:server
pnpm dev
```

`dev-config.py` 生成本地 `.env`、初始 admin 密码和凭据加密密钥，均为私有文件；数据库地址需指向可用 PostgreSQL。开发前端 `http://127.0.0.1:5173`，API 文档 `http://127.0.0.1:8000/docs`。生成的 admin 密码位于 `.data/admin-initial-password`，不要提交或复制到日志。

真实模块执行需要平台运行在 Kubernetes 中，以便访问 Pod 网络与 RWO 数据卷；本地进程用于 API/前端开发。平台不提供本地模块启动模式。

## Kubernetes

安装与可重复部署步骤见 [Kubernetes 说明](deploy/k8s/README.md)。本地使用 Docker Desktop 内置 Kubernetes（`docker-desktop` 上下文），每次验收使用独立 namespace。

```sh
docker build -f server/Dockerfile -t testflow-server:dev .
docker build -f web/Dockerfile -t testflow-web:dev .
uv run --project server python scripts/module-package.py examples --version 1.0.2 --build
uv run --project server python scripts/deploy-kubernetes.py --namespace testflow-dev --port 18765 --load-images
```

等待迁移/rollout 后 port-forward 前端。初始密码和加密密钥只写入 `.data/kubernetes/testflow-dev/access.json`（0600），实际 Secret 不提交。默认安装不生成虚构执行或评分。

## 模块与接口

模块开发与打包见 [模块协议 v1](contracts/module/README.md)、[ZIP 设计](docs/voice-test-platform/14-ZIP模块与动态配置设计.md)。模块可调用第三方接口，也可从固定仓库挂载读取代码；平台只管理容器、契约和运行配置。Python、Node.js、Go 示例执行真实处理。

```sh
uv run --project server python scripts/module-package.py package <模块目录> --output <输出.zip>
pnpm api
```

ZIP/参数/有序 Schema、实际服务身份、镜像 imageID、版本与幂等都进行校验。仓库、素材、测试集、流程、模块和评测配置保存不可变版本；创建任务冻结排队项，隐藏不会破坏历史。重跑新增执行，复评新增评测，旧报告固定选用 ID。

## 验证

```sh
pnpm typecheck
pnpm build
pnpm test:server
pnpm test:demo
```

`TESTFLOW_TEST_DATABASE_URL` 可指向独立 PostgreSQL 测试库；测试会重建该库中的业务表，不能指向正常工作库。未配置时使用仅测试依赖的 SQLite。

`tests/platform.e2e.mjs` 可通过 CUA/Playwright 适配器执行浏览器交互，`tests/kubernetes/acceptance.py` 执行真实集群业务闭环。API 测试不替代浏览器、严格视觉和恢复验收。真实 AI 通过已有加密凭据引用配置，不将密钥放入测试代码或报告。

完成标准与实际证据见 [完整实施记录](docs/voice-test-platform/16-完整实施记录.md)、[88 项控件对应表](docs/voice-test-platform/17-原型控件对应表.md)。未实测的关卡不标记完成；实际麦克风按用户要求暂缓。

## 设计与范围

[文档索引](docs/README.md) · [完整设计](docs/voice-test-platform/README.md) · [工程结构](docs/voice-test-platform/15-工程结构与部署.md)

高级缓冲/慢消费者策略 Q56 及 ai、robot-voice-agent 专用适配独立于本次交付。正常流序号、EOS、取消、超时、终态裁决与历史完整性属于当前实现。
