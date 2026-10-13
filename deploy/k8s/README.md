# Kubernetes 部署与验收

前端 Nginx、后端 FastAPI 单体、PostgreSQL 18 和动态模块 Pod 运行在同一 namespace。后端只有一个副本、一个 Uvicorn 进程；持久队列和任务领取使用数据库锁，DAG/案例并发在该进程内完成。

## 用户部署 v0.0.1-beta

用户入口为静态 [用户部署目录](beta)，只需要 kubectl 与可访问的 Kubernetes 集群。目录引用已发布的 `kakj/testflow-server:v0.0.1-beta`、`kakj/testflow-web:v0.0.1-beta` 和 `postgres:18`；平台镜像提供 Linux AMD64 / ARM64，由集群直接拉取。

集群需配置默认 StorageClass、支持 RWO 持久卷。默认平台数据卷 2 GiB、数据库卷 4 GiB。确认 kubectl 已指向目标集群后，一次安装：

```sh
kubectl apply -f deploy/k8s/beta
```

目录内包含 namespace、ConfigMap、RBAC、初始化 Job、PVC、PostgreSQL、迁移 Job 和前后端。初始化 Job 通过独立 ServiceAccount 在当前 namespace 生成随机数据库密码、admin 哈希与凭据加密密钥，只创建缺少的 Secret，保留已存在的值。目录中没有公开固定的数据库密码、加密密钥或需要手工填充的 Secret 模板。

PostgreSQL 等待 Secret，迁移 Job 的 initContainer 等待数据库可连接，后端的 initContainer 等待 Alembic 达到当前镜像的迁移版本，前端的 initContainer 等待后端就绪。`apply` 提交全部资源后，这些依赖由集群自动协调，首次拉取镜像和创建卷需要时间。

重复 apply 同一目录不会重置数据库密码与加密密钥，也不会重复执行已经完成的 Job。初始化和迁移 Job 的名称包含镜像版本，供后续版本创建新的初始化/迁移作业。初始化失败后重试或重新创建 Job，仍复用已经生成的配置。

访问门户：

```sh
kubectl -n testflow port-forward svc/testflow-web 18765:8080 --pod-running-timeout=5m
```

打开 `http://127.0.0.1:18765`，初始登录 `admin / 123456`。查看状态和初始化日志：

```sh
kubectl -n testflow get pods,jobs,services,pvc
kubectl -n testflow logs -l app=testflow-bootstrap
```

默认 namespace 固定为 `testflow`，后续 Beta 或正式版本均保持该名称，版本由镜像标签区分。自定义部署先复制目录，统一修改各资源的 namespace 和 RoleBinding 中的 ServiceAccount namespace；修改浏览器地址时，在 `01-config.yaml` 中调整 `TESTFLOW_PUBLIC_URL`。无默认 StorageClass 时，在平台 PVC 与 PostgreSQL 的 volumeClaimTemplates 中填写 `storageClassName`。

生产环境配置 TLS、Cookie、Secret 和镜像 digest，见下文。私有配置保存在 `testflow-secrets` 和 `testflow-postgres-secret`，备份数据库和数据卷时应同时保留这两个 Secret。配置及运行结果不会保存到本地安装脚本目录。

平台镜像与模块镜像独立发布，默认安装为空工作区。导入模块 ZIP 后，按其运行声明确认目标集群可拉取对应模块镜像。示例和模块契约见 [仓库代码闭环](../../examples/repository-helpdesk/README.md) 与 [模块开发契约](../../contracts/module/README.md)。

## Docker Desktop Kubernetes

本地部署使用 Docker Desktop 内置 Kubernetes，`docker-desktop` 上下文，kind 模式、单节点。本机实测版本为 Kubernetes 1.36.1。独立 Minikube 已由此部署替代。

首次启用：Docker Desktop → Kubernetes → Create cluster → kind → 1 个节点 → Create。镜像下载失败时先用 `docker desktop kubernetes images list` 核对所需镜像并重新拉取。仅对没有需要保留数据的失败集群执行 `docker desktop kubernetes reset-cluster`。

```sh
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
docker desktop kubernetes status
kubectl --context=docker-desktop get nodes
```

Docker Desktop 管理 `$HOME/.kube/config`。部署、备份、恢复、端口转发和验收统一使用 `scripts/kubernetes_support.py`，每次命令显式指定 kubeconfig 与 context；macOS 默认选用 Docker Desktop 自带的 kubectl，避免旧 Homebrew 客户端版本偏差。其他集群通过 `--context`、`--kubeconfig` 和可选 `--kubectl` 指定，镜像需发布到该集群可访问的仓库。

## 开发与测试部署

源码开发、开发镜像构建、Docker Desktop 镜像加载及 API/前端启动见 [开发说明](../../docs/development.md)。Python 部署工具继续用于研发与验收：显式指定集群连接，只创建新的 `testflow` 或 `testflow-` 前缀 namespace，拒绝覆盖已有环境，并按数据库、迁移和前后端的顺序等待就绪。

`--server-image` 同时选择后端和迁移镜像，`--web-image` 选择前端镜像；默认仍为 `testflow-server:dev` 和 `testflow-web:dev`。`--load-images` 将所选本地平台、PostgreSQL 及 `.data/example-modules.json` 中的示例镜像导入 Docker Desktop kind 节点。私有访问文件保存于 `.data/kubernetes/<namespace>/access.json`，权限 `0600`；实际 Secret 不提交 Git。

初始化 Job、清单生成工具与 Python 部署工具共用 `scripts/kubernetes_installation.py`，统一 namespace、镜像选择、ConfigMap、数据库密码、admin 哈希与加密密钥生成。静态目录将初始化脚本及共享辅助模块一起挂载，确保已发布镜像执行与清单一致的初始化逻辑。研发工具不会改变镜像用户安装时创建的环境。

迁移 Job 执行 Alembic，后台调度器在数据库迁移就绪后启动。ConfigMap 的 PUBLIC_URL 必须匹配浏览器 origin；Nginx 同源转发 HTTP 与 WebSocket，支持媒体 Range 和 100 MiB 上传。

## 存储、身份和生产配置

`testflow-data` PVC 保存包、固定代码、素材、采集及产物，PostgreSQL 使用独立 PVC。RWO 下挂载代码的模块 Pod 固定到后端节点；代码 mountPath 为用户声明的容器绝对目录，不覆盖镜像命令。

后端 ServiceAccount 只获得当前 namespace 的 Pod 生命周期管理和镜像拉取 Secret 管理权限。模块使用无 Kubernetes token 的独立身份。镜像拉取凭据使用临时 dockerconfigjson Secret，明文不进入业务快照。

生产使用 overlay 和 TLS Ingress，设置镜像仓库及平台镜像 digest、PUBLIC_URL、COOKIE_SECURE；Secret 提供 `TESTFLOW_DATABASE_URL`、`TESTFLOW_ADMIN_PASSWORD_HASH`、`TESTFLOW_ENCRYPTION_KEY`。加密密钥必须和数据库备份一起安全保存，否则凭据无法解密。生产模块必须固定 sha256 镜像；本地验收允许不可变开发标签并核对 imageID。

依赖默认 StorageClass；无默认值时明确填写 storageClassName。平台和模块容器按非 root、只读根文件系统运行，临时文件使用 emptyDir。后端具备 Git、SSH 和 FFmpeg；不挂载 Docker socket。

## 验收与故障

```sh
uv run --project server python scripts/deploy-kubernetes.py --namespace testflow-e2e-<run-id> --port 18767 --load-images
uv run --project server python tests/kubernetes/acceptance.py --namespace testflow-e2e-<run-id>
```

先等待迁移与 rollout，再 port-forward。验收执行真实 Git、ZIP、临时验证 Pod、三语言处理、流式输入输出、Trace、规则、Kimi 真实评分、重跑与旧报告。真实服务凭据读取已有加密凭据引用，证据不保存正文。浏览器交互和视觉检查另行执行，API 验收不能替代这些关卡。

运行证据保存在 `.data/acceptance/`，实施状态见 `docs/voice-test-platform/16-完整实施记录.md`。保存证据后只删除本次测试 namespace；保留用户正常部署与 Docker Desktop 集群。

镜像拉取失败查看 Pod Events；准备失败核对 health/contract 和实际 imageID；节点超时与收尾超时在执行详情分开显示。后台重启保留已确定终态，实际运行中断标记 interrupted，剩余未开始项继续，已经运行的调用不会自动重试。删除 Pod 的控制面证据和实际远端停止证据分开记录。

研发脚本创建的安装可使用 `scripts/backup-kubernetes.py --namespace testflow-dev` 备份，同时保存数据库、PVC 和加密密钥；目录 0700、敏感文件 0600。恢复使用 `scripts/restore-kubernetes.py --namespace <空的 testflow 或 testflow- 前缀 namespace> --backup <备份目录>`，拒绝覆盖存在资源或执行记录的目标，保留源 admin 密码与加密凭据。恢复后的访问文件始终指向目标集群。恢复验收见配套脚本与实施记录。未经实测的浏览器/视觉/恢复关卡不标记通过。

2026-10-12 输入组升级增加数据迁移 `a2d91c50b7e4`。使用新后端镜像运行单次 Alembic Job，再完成前后端 rollout；迁移只追加测试集修订，已完成执行和报告不改写。模型 API Key 改在模型配置直接填写，删除资源只能由数据库恢复。详见 [输入组与工作区简化](../../docs/voice-test-platform/23-输入组与简化工作区.md)。
