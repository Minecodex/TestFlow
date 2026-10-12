# TestFlow 文档

- [平台设计总览与文档目录](voice-test-platform/README.md)
- [讨论决策与待定工程契约](voice-test-platform/QA.md)
- [工程结构与 Kubernetes 部署](voice-test-platform/15-工程结构与部署.md)
- [平台启动与验证](../README.md)
- [语言无关适配模块、启动与通信](voice-test-platform/14-ZIP模块与动态配置设计.md)
- [交互原型](demo.html)
- [原型验证说明](../tests/README.md)
- [原型全流程审查结果](voice-test-platform/10-首版范围与验收.md#2026-10-11-原型全流程审查结果)

原型在浏览器中模拟业务交互；正式前后端实现真实 Git、ZIP、Pod 执行、评测和持久化。模块统一由 Kubernetes Pod 启动。

当前本地部署运行在 Docker Desktop 内置 Kubernetes（`docker-desktop` 上下文、`testflow-dev` namespace），操作入口见 [Kubernetes 部署说明](../deploy/k8s/README.md)。

- [完整实施与实际验收记录](voice-test-platform/16-完整实施记录.md)
- [原型控件对应表](voice-test-platform/17-原型控件对应表.md)
- [极小模型场景与界面对照](voice-test-platform/18-极小模型场景与界面对照.md)
- [模块开发契约](../contracts/module/README.md)
