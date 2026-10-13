# 执行层边界

执行层与业务接口运行在同一个 FastAPI 应用进程内。`scheduler.py` 从数据库领取持久操作并调度已冻结的计划项；`engine.py` 处理 DAG、终态裁决、超时和独立收尾；`runners/pods.py` 管理模块 Pod、身份核验、复用与回收。后台重启核对持久记录和遗留 Pod，已经启动且无法恢复的执行记录为中断，未开始的计划继续。

`infrastructure/retry.py` 仅重试独立数据库操作；调用方取消时先等待当前事务提交或回滚，重复取消不会打断事务清理，也不会再发起下一次重试。模块与模型调用继续保持在此边界之外。

模块使用任意语言，统一由 Kubernetes Pod 启动镜像的 ENTRYPOINT/CMD，按需只读挂载固定 commit。`transport/module.py` 使用 HTTP 创建/查询/取消调用，使用 WebSocket 传输有序数据、显式 EOS 和声明暴露的 Trace；`transport/channels.py` 管理流式分发与字段完整性。模块私有协议及外部业务调用由模块代码封装。

真实 Pod、恢复与取消收尾证据见 [实施记录](../../../../docs/voice-test-platform/16-完整实施记录.md) 和 `tests/kubernetes/`；整体完成状态仍受前端逐控件、视觉及最终 E2E 验收门槛约束。
