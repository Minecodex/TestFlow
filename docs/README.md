# TestFlow 文档

- [平台设计总览与文档目录](voice-test-platform/README.md)
- [讨论决策与待定工程契约](voice-test-platform/QA.md)
- [工程结构与 Kubernetes 部署](voice-test-platform/15-工程结构与部署.md)
- [项目概述、界面预览与快速部署](../README.md)
- [Docker Hub 镜像部署 v0.0.1-beta](../deploy/k8s/README.md#用户部署-v001-beta)
- [语言无关适配模块、启动与通信](voice-test-platform/14-ZIP模块与动态配置设计.md)
- [交互原型](demo.html)
- [原型验证说明](../tests/README.md)
- [原型全流程审查结果](voice-test-platform/10-首版范围与验收.md#2026-10-11-原型全流程审查结果)

原型在浏览器中模拟业务交互；正式前后端实现真实 Git、ZIP、Pod 执行、评测和持久化。模块统一由 Kubernetes Pod 启动。

当前本地部署运行在 Docker Desktop 内置 Kubernetes（`docker-desktop` 上下文、`testflow-dev` namespace），操作入口见 [Kubernetes 部署说明](../deploy/k8s/README.md)。

项目首页使用 [docs/images](images) 中的流程画布、能力模块、测试集和测试任务截图。用户部署使用 Docker Hub 的 `v0.0.1-beta` 双架构镜像，部署清单位于 `deploy/k8s/beta`，执行一次 `kubectl apply -f deploy/k8s/beta` 即可创建全部资源，密钥生成和迁移等待由集群完成。用户 namespace 固定为 `testflow`，后续版本通过镜像标签区分。[源码开发与测试](development.md) 独立说明，研发继续使用 `:dev` 镜像。

- [完整实施与实际验收记录](voice-test-platform/16-完整实施记录.md)
- [原型控件对应表](voice-test-platform/17-原型控件对应表.md)
- [极小模型场景与界面对照](voice-test-platform/18-极小模型场景与界面对照.md)
- [模块开发契约](../contracts/module/README.md)
- [GitHub 仓库、模块 ZIP 与 workflow 示例](../examples/repository-helpdesk/README.md)
- [workflow 导入导出契约](../contracts/workflow/README.md)
- [GitHub 与 workflow 实际验收](voice-test-platform/19-GitHub仓库与workflow闭环.md)

- [素材池与测试集导入导出](../contracts/data/README.md)
- [本地示例数据与导入闭环](voice-test-platform/20-示例素材和测试集导入闭环.md)
- [界面密度、评测卡片与画布交互调整](voice-test-platform/21-界面密度和画布交互调整.md)

- [全局素材、标签和多模态列表完善](voice-test-platform/22-全局素材和多模态列表完善.md)
- [能力运行配置与节点业务参数](voice-test-platform/24-能力运行配置与节点业务参数.md)

- [输入组、素材只读预览与工作区简化](voice-test-platform/23-输入组与简化工作区.md)
