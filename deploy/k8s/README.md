# Kubernetes 部署

当前部署两个组件：静态前端 Nginx 与一个 FastAPI 单体服务。业务 API、未来调度器和执行器都属于单体；没有独立 Worker。后端固定一个 Pod、一个 Uvicorn 进程，并使用 Recreate 策略挂载 RWO 数据卷。业务实现前不要通过增加副本实现执行并发。

## 构建与部署

从仓库根目录执行：

```sh
docker build -f server/Dockerfile -t testflow-server:dev .
docker build -f web/Dockerfile -t testflow-web:dev .
kubectl kustomize deploy/k8s/overlays/development
```

先把镜像推到集群节点可访问的镜像仓库，并在 overlay 的 images 中设置 newName/newTag；若使用 kind，可用 `kind load docker-image testflow-server:dev testflow-web:dev --name <集群名>` 加载本地镜像。构建架构需匹配节点；跨架构使用 Docker buildx。清单依赖集群默认 StorageClass，若没有需在 storage.yaml 明确配置可用的 storageClassName。

```sh
kubectl --context <集群上下文> apply -k deploy/k8s/overlays/development
kubectl --context <集群上下文> -n testflow-dev rollout status deployment/testflow-server
kubectl --context <集群上下文> -n testflow-dev rollout status deployment/testflow-web
kubectl --context <集群上下文> -n testflow-dev port-forward service/testflow-web 8080:8080
```

浏览器打开 http://127.0.0.1:8080。Nginx 同源转发 /api/ 至后端；SPA 深层地址刷新有效。Ingress 示例不默认安装，使用前替换域名、入口类并配置 TLS。

production overlay 使用 testflow namespace 与 0.1.0 标签；构建时使用对应标签并设置镜像仓库，再 apply -k deploy/k8s/overlays/production。当前只有基础工程，production 是环境模板，业务能力和鉴权仍须后续完成。

## 配置与存储

ConfigMap 管理环境及 /data 路径。PVC 保存 assets、module-packages、repositories、runs；当前只初始化目录，尚无业务写入。/tmp 使用 emptyDir，两个容器非 root，根文件系统只读。

数据库暂可不配置；首页会明确显示“未配置”。接入 PostgreSQL 时，由部署环境创建 testflow-secrets Secret 的 database-url 键，值采用 postgresql+asyncpg URL。不要将实际口令提交到仓库。配置后就绪探针会检查数据库连通性；schema 迁移后续由独立一次性 Job 执行，不在每个 API Pod 启动时自动建表。本清单不部署 PostgreSQL。

/health/live 检查服务存活，/health/ready 检查数据目录可写及已配置数据库连通；前端 /healthz 检查 Nginx。后端不会将依赖异常正文暴露到健康响应中。

## 当前边界

这是可运行的基础工程；admin 鉴权、业务持久化、ZIP 加载、仓库同步、DAG 执行和模块启动尚未实现。Kubernetes 只负责部署平台。Pod 内的“本地启动”及 Docker 模块运行所需隔离、网络、卷和生命周期接入，将随执行器实现确定；当前不挂载宿主机 Docker Socket，也不要求平台业务接口带 Kubernetes 参数。

验证记录见 ../../README.md。实际集群部署需可访问的集群、镜像和 StorageClass；本轮本机已有集群连接超时，未宣称完成集群 rollout。

安装 kubeconform 后可重复不连接集群的 Schema 校验：

```sh
kubectl kustomize deploy/k8s/overlays/development | kubeconform -strict -summary -kubernetes-version 1.35.0
kubectl kustomize deploy/k8s/overlays/production | kubeconform -strict -summary -kubernetes-version 1.35.0
kubeconform -strict -summary -kubernetes-version 1.35.0 deploy/k8s/examples/ingress.yaml
```

Schema 校验不能替代实际集群的服务端准入、镜像拉取和卷供应验证。
