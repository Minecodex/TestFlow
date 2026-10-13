# ZIP 模块、动态配置与运行契约

模块使用任意后端语言，但全部容器化，由 Kubernetes Pod 启动。平台只管理模块身份、版本、契约、参数和 Pod 生命周期；内部仓库代码调用、外部 HTTP 和私有 WebSocket 均由模块代码实现。没有能力来源分类或通用外部服务表单。

## ZIP v1

example 可将 ZIP 和 workflow 放在仓库的 `examples/` 目录供下载导入。ZIP 继续声明契约、参数、组件和镜像；仓库代码通过固定 commit 挂载由薄适配层导入，镜像须事先构建并加载或发布。平台不因下载来源变化而编译代码。实现见 [repository-helpdesk](../../examples/repository-helpdesk/README.md)。

```text
module.zip
  manifest.json
  schemas/inputs.json
  schemas/outputs.json
  schemas/parameters.json
  ui/config-panel.js
  README.md
```

manifest 固定 `testflow.module.v1`，运行模式固定 `pod`，声明镜像、端口、可选只读代码挂载、`batch_node`/`execution_node` 复用、`requires_sequential` 和内部 Trace。参数使用 JSON Schema 2020-12；字段组使用有序数组，名称唯一。模块配置组件使用 `testflow.ui.v1`，共享宿主 React/JSX runtime/HeroUI，不包含第二套运行时。

镜像必须定义 ENTRYPOINT/CMD 并提供标准模块服务。平台不从 ZIP 构建后端代码，不覆盖启动命令。代码挂载固定仓库版本及 commit，目标是容器绝对目录。digest 优先；开发不可变标签需校验实际 imageID，变化需新版本。

导入校验结构、摘要、Schema、兼容版本及参数默认值，登记不可变版本。可用性验证另创建临时 Pod，核验就绪、实际契约与镜像身份；导入成功不等于可运行。

导入时将 manifest 的 Pod 配置登记为模块运行默认值。镜像、端口、仓库固定 commit 挂载、资源和复用设置只在能力模块中编辑，通过 `PUT /api/v1/modules/{id}/runtime` 校验并保存新平台修订。运行默认值单独保存在模块数据的 `runtime`，不重写 ZIP、manifest 或包摘要。新节点复制所选修订的默认值；已有节点、流程和执行继续固定原值。更新后验证已保存修订，不能把未保存表单当作可用配置。

## 运行与协议

详见 [模块 v1 契约](../../contracts/module/README.md)。HTTP 创建、查询、取消 invocation；WebSocket 传输增量字段、片段序号、显式 EOS、错误及声明暴露的 Trace。每次调用固定 batch_id/execution_id/node_id/trace_id/span_id，不用断连或首片段替代正常 EOS。

默认同一批次、流程版本和节点按运行配置摘要复用 Pod；模块可声明每次执行独立实例。批次结束清理实例，重跑记录新的实例身份；平台不还原隐藏内存。共享 Pod 优先取消 invocation，收尾超时请求终止 Pod，受影响调用记录 runtime_lost。

准备 60 秒、节点运行 30 秒、独立收尾 10 秒为默认值，在流程中可调并固定快照。前置等待不计入尚未启动节点的运行超时。控制面删除、容器退出与远端活动停止分别记录，已有终态不变。Q56 高级缓冲策略暂缓。

## 配置与历史

宿主传入 value/onChange/schema/readonly/locale/theme 及固定版本上下文，后端再次校验。加载失败显示错误和只读原始参数，保留已保存值。模块详情中的业务组件示例只读，运行默认值可编辑保存；画布节点侧栏直接编辑名称、描述和由 ZIP 组件提供的业务参数，不提供镜像或仓库挂载控件。没有业务参数的模块明确显示空状态。节点超时和能力版本在流程设置中编辑，契约在画布上展示，开始/结束节点保留契约编辑入口。

ZIP、图、参数、镜像及代码挂载变更新建版本。凭据只保存引用；历史保留固定包摘要、代码、实际实例/镜像身份、输入输出、Trace 和收尾证据。隐藏不删除文件或旧版本。专用 ai、robot-voice-agent 适配不在本次交付范围。
