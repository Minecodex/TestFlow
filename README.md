# TestFlow

面向多语言适配模块的测试平台。当前已初始化可运行的前后端基础工程；完整产品交互参考 [demo](docs/demo.html)，产品规则见 [docs](docs/README.md)。

## 技术与结构

前端：React 19、TypeScript 7、Vite 8、HeroUI 3、Tailwind 4、React Router 7、TanStack Query 5、Zustand 5。后端：Python 3.13 + FastAPI 单体服务；预留 PostgreSQL、SQLAlchemy、Alembic。部署：Kubernetes + Kustomize。

```text
TestFlow/
├── web/
│   ├── src/
│   │   ├── app/                  # 路由、业务入口、偏好同步
│   │   ├── layouts/              # 统一工作区布局
│   │   ├── features/             # 按业务域组织页面与 API
│   │   ├── shared/               # API 客户端、状态、公共组件、模块宿主
│   │   ├── i18n/                 # 各业务域中文 / 英文文案
│   │   └── styles/               # Tokens、主题与业务样式
│   ├── nginx/                    # 静态资源与同源 API 代理
│   └── Dockerfile
├── server/
│   ├── src/testflow/
│   │   ├── main.py               # 单体应用与健康检查
│   │   ├── core/                 # 环境配置
│   │   ├── features/             # system 与八个业务域
│   │   ├── execution/            # 执行器、runners、transport 的预留边界
│   │   └── infrastructure/       # 数据库、数据目录
│   ├── migrations/               # 迁移预留
│   ├── tests/
│   └── Dockerfile
├── packages/module-ui-sdk/       # 动态参数组件初始类型
├── contracts/module/             # 模块契约待定项
├── examples/modules/             # 模块示例预留
├── deploy/k8s/                   # base、development / production overlays
├── tests/                        # E2E、原型逻辑与容器验证
└── docs/                         # 设计、实施边界与原型
```

## 本地启动

需要 Node.js >= 22.12、pnpm 10.23、uv；uv 使用 server/.python-version 的 Python 3.13。以下命令从仓库根目录执行：

```sh
pnpm install --frozen-lockfile
uv sync --project server --frozen
cp .env.example .env
```

分别在两个终端启动：

```sh
pnpm dev:server
pnpm dev
```

打开 [前端工作台](http://127.0.0.1:5173)，[API 文档](http://127.0.0.1:8000/docs)。开发服务器同源代理 /api 与 /health。当前可用接口：/api/v1/system/status、/health/live、/health/ready。业务页面明确显示准备中，未实现 CRUD、执行和鉴权。

## 验证与部署

```sh
pnpm typecheck
pnpm build
pnpm test:server
pnpm test:demo
pnpm exec playwright install chromium
pnpm test:e2e
pnpm check:k8s
```

浏览器测试说明见 [tests/README.md](tests/README.md)。镜像构建与 Kubernetes 部署命令见 [部署说明](deploy/k8s/README.md)。构建两镜像后，可运行 `python3 tests/container-smoke.py` 验证非 root、只读运行、API 代理及 SPA 路由，并自动清理本次创建的测试容器、卷与网络。

2026-10-11 已通过：工作区类型检查、前端生产构建、2 项后端测试、17 项原型逻辑测试、浏览器基础工程 4 组检查及断线/恢复检查、两个镜像构建和容器 smoke。Kubernetes 两套 overlay 及 Ingress 示例通过 Kustomize 渲染与 Kubernetes 1.35 Schema 严格校验。本机既有集群连接超时，尚未验证实际集群 rollout。

设计与当前实现的区别见 [工程结构与部署](docs/voice-test-platform/15-工程结构与部署.md)。平台使用 Python 不限制模块语言，模块内部调用方式仍由模块代码决定。
