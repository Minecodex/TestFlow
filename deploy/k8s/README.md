# Kubernetes 部署与验收

前端 Nginx、后端 FastAPI 单体、PostgreSQL 18 和动态模块 Pod 运行在同一 namespace。后端只有一个副本、一个 Uvicorn 进程；持久队列和任务领取使用数据库锁，DAG/案例并发在该进程内完成。

## Docker Desktop Kubernetes

本地部署使用 Docker Desktop 内置 Kubernetes，`docker-desktop` 上下文，kind 模式、单节点。本机实测版本为 Kubernetes 1.36.1。独立 Minikube 已由此部署替代。

首次启用：Docker Desktop → Kubernetes → Create cluster → kind → 1 个节点 → Create。镜像下载失败时先用 `docker desktop kubernetes images list` 核对所需镜像并重新拉取。仅对没有需要保留数据的失败集群执行 `docker desktop kubernetes reset-cluster`。

```sh
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
docker desktop kubernetes status
kubectl --context=docker-desktop get nodes
```

Docker Desktop 管理 `$HOME/.kube/config`。部署、备份、恢复、端口转发和验收统一使用 `scripts/kubernetes_support.py`，每次命令显式指定 kubeconfig 与 context；macOS 默认选用 Docker Desktop 自带的 kubectl，避免旧 Homebrew 客户端版本偏差。其他集群通过 `--context`、`--kubeconfig` 和可选 `--kubectl` 指定，镜像需发布到该集群可访问的仓库。

## 本地构建与部署

```sh
docker build -f server/Dockerfile -t testflow-server:dev .
docker build -f web/Dockerfile -t testflow-web:dev .
uv run --project server python scripts/module-package.py examples --version 1.0.2 --build
uv run --project server python scripts/deploy-kubernetes.py --namespace testflow-dev --port 18765 --load-images
```

部署脚本只创建新的 `testflow-` namespace，拒绝覆盖现有 namespace，并等待数据库、迁移及前后端就绪。`--load-images` 将本地平台、PostgreSQL 和示例模块镜像按节点平台流式导入 Docker Desktop kind 节点的 containerd；服务不挂载 Docker socket。脚本生成数据库密码、admin 哈希和加密密钥，通过 stdin 创建 Secret；私有访问文件及集群连接信息保存在 `.data/kubernetes/<namespace>/access.json`，权限 0600，不提交到 Git。

```sh
kubectl --context=docker-desktop -n testflow-dev get pods,services,pvc
python3 scripts/port-forward.py --namespace testflow-dev --port 18765
```

浏览器访问 `http://127.0.0.1:18765`。初始 admin 密码从 `.data/kubernetes/testflow-dev/admin-initial-password` 读取（0600）。默认安装没有虚构执行或评分记录，示例 ZIP 按需导入并验证。

迁移 Job 执行 Alembic，后台调度器在数据库迁移就绪后启动。ConfigMap 的 PUBLIC_URL 必须匹配实际浏览器 origin；Nginx 同源转发 HTTP 与 WebSocket，支持媒体 Range 和 100 MiB 上传。

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

备份使用 `scripts/backup-kubernetes.py --namespace testflow-dev`，同时保存数据库、PVC 和加密密钥；目录 0700、敏感文件 0600。恢复使用 `scripts/restore-kubernetes.py --namespace <空的 testflow- namespace> --backup <备份目录>`，拒绝覆盖存在资源或执行记录的目标，保留源 admin 密码与加密凭据。恢复后的访问文件始终指向目标集群。恢复验收见配套脚本与实施记录。未经实测的浏览器/视觉/恢复关卡不标记通过。
