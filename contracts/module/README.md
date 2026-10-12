# TestFlow 模块协议 v1

所有模块由 Kubernetes Pod 启动。平台只管理镜像身份、可选固定仓库挂载、参数、契约与调用生命周期。镜像的 ENTRYPOINT/CMD 启动标准服务；代码语言、第三方 HTTP/私有 WebSocket、直接引用仓库代码都属于模块实现。平台不编译 ZIP 中的后端代码，也不覆盖镜像命令。

## ZIP

必需文件：`manifest.json`、`schemas/inputs.json`、`schemas/outputs.json`、`schemas/parameters.json`、`ui/config-panel.js`、`README.md`。manifest 可以指定这些文件的包内路径。ZIP 不允许绝对路径、上级路径、符号链接、重复路径或超过上传限制的解压内容。

manifest 的权威请求类型是 `ModuleManifest`，见 `contracts/openapi.json`。最小实例：

```json
{
  "protocol": "testflow.module.v1",
  "id": "text-transform",
  "name": "Text transform",
  "version": "1.0.1",
  "defaults": {"mode": "uppercase", "chunk_size": 3, "delay_ms": 0},
  "exposes_trace": true,
  "runtime": {
    "mode": "pod",
    "image": "registry.example/module@sha256:<digest>",
    "port": 8080,
    "reuse_scope": "batch_node",
    "requires_sequential": false,
    "cpu": "500m",
    "memory": "512Mi"
  }
}
```

生产镜像要求 digest。本地 Minikube 可以使用不可变版本加源码摘要的标签，验证并冻结实际 imageID。更改镜像、包或组件身份需要新的模块版本；同一个版本不能重新指向另一份 ZIP。

`code_mount` 为可选对象，包含 `repository_id`、`repository_version`、完整 `commit` 和容器绝对 `mount_path`。代码以固定 commit 只读挂载；RWO 卷下 Pod 与后端处于同一节点。`registry_credential_id` 引用加密仓库凭据，正文不进入快照。

`batch_node` 按批次、流程版本、节点和运行配置摘要复用 Pod；`execution_node` 为每次调用独立实例。模块的顺序或独立实例声明不能被流程覆盖。批次结束清理实例，重跑使用新实例，内存缓存不恢复。

## 有序字段组

```json
{"fields":[{"name":"text","type":"Text","format":"UTF-8","stream":true}]}
```

字段顺序只由 `fields` 数组定义，不能依赖 JSON 对象键顺序。字段类型为 Text、JSON、Audio、Image。JSON 为完整数据；其他字段可流式。普通连线匹配整组的名称、顺序、类型、格式和 stream；字段选取或改名必须使用组装节点，模式变化必须使用转换节点。JSON 在转换中仍保持完整数据。

输入/输出值按字段名称映射；媒体完整值使用 `asset_id + asset_version`。标准音频格式为 `WAV · 16kHz · Mono`，PCM16；图片为 `Image/*`，读取和产物上传检查实际图片编码。

## HTTP

- `GET /module/v1/health` 返回就绪状态，HTTP 200。
- `GET /module/v1/contract` 返回协议、模块 id、version，以及完整 inputs、outputs、parameters；内容必须与 ZIP 一致。
- `POST /module/v1/executions` 创建独立 invocation，返回相同 `invocation_id`。同一 invocation 重复创建不得重复运行。
- `GET /module/v1/executions/{id}` 返回 `invocation_id` 和 created/running/completed/failed/canceled 状态。
- `POST /module/v1/executions/{id}/cancel` 取消这一调用。接受请求不代表实际停止，查询状态或明确终态才提供停止证据。

创建请求：

```json
{
  "invocation_id": "uuid",
  "context": {
    "invocation_id": "uuid", "batch_id": "uuid", "execution_id": "uuid",
    "pipeline_version_id": "revision-uuid", "node_id": "text",
    "trace_id": "uuid", "span_id": "uuid", "parent_span_id": "uuid"
  },
  "parameters": {"mode":"uppercase","chunk_size":3,"delay_ms":0},
  "inputs": {"text":{"stream":true,"format":"UTF-8"}}
}
```

完整字段传 `{"value":...}`，流式字段传 descriptor，随后通过 WebSocket 提供内容。准备超时覆盖 Pod 启动和身份验证；节点运行超时从创建调用开始，不含前置等待。

## WebSocket

连接 `WS /module/v1/executions/{id}/stream`，一条连接同时传输入、输出、终态与声明的内部 Trace。

```json
{"type":"input.chunk","field":"text","seq":0,"format":"UTF-8","data":"hello"}
{"type":"input.eos","field":"text","seq":1}
{"type":"output.chunk","invocation_id":"uuid","field":"text","seq":0,"format":"UTF-8","data":"HELLO"}
{"type":"output.eos","invocation_id":"uuid","field":"text","seq":1}
{"type":"execution.completed","invocation_id":"uuid"}
```

- seq 每个字段独立，从 0 连续递增；EOS 的 seq 为下一片段序号。EOS 后不得继续写入。
- 文本是增量内容。媒体片段使用 `encoding: "base64"`，拼接后的内容符合声明格式。
- 空流也需要 seq=0 的 EOS。连接关闭、首片段或含“完成”的文字都不能替代 EOS。
- 完整输出为 `output.value`，包含 invocation_id、field、value。
- 失败为 `execution.error`，包含 code、message；取消为 `execution.canceled`，可附停止证据。
- completed 必须在所需完整字段和全部正常 EOS 之后出现。字段缺失、序号缺口、截断、身份错误均为执行错误。
- 内部事件 `trace` 必须匹配 trace_id，包含唯一 span_id、已知 parent_span_id 和 name。根父级是节点 span，子级可继续形成树。未声明 exposes_trace 的模块不能发送内部 Span。

实时录音使用 WAV 流头与 PCM16 片段；无法预知长度时 RIFF/data 长度为 0xffffffff。采集完成时按实际字节数形成可回放 WAV。断连、取消保留片段和可解码素材，并记录 truncated，不能变为正常 EOS。

高级有界缓冲、慢消费者策略属于暂缓的 Q56；当前实现不丢弃正常流的片段。

## 受限资源访问

Pod 获取 `TESTFLOW_PLATFORM_URL`、`TESTFLOW_RUNTIME_ID`、`TESTFLOW_RUNTIME_TOKEN`，以 Bearer token 访问当前调用范围：

- `GET /api/v1/module-resources/{runtime_id}/assets/{asset_id}?execution_id=...&version=...`
- `POST /api/v1/module-resources/{runtime_id}/assets?execution_id=...&type=Audio|Image&format=...`，multipart 的 file 为产物。

只能读取冻结输入、同一执行的中间产物及本调用产物；不能读取其他调用的数据。引用资源的原版本在隐藏后仍可用于历史回放。模块 ServiceAccount 不持有 Kubernetes API token。

## 配置组件

组件是 ES module，导出 `sdk = "testflow.ui.v1"` 和默认 React 组件。宿主 `window.TestFlowHost` 提供共享 React、JSXRuntime、HeroUI。组件接收 value、onChange、readonly、schema、locale、theme 和固定模块版本 identity。组件不打包另一份 React/HeroUI。失败时宿主显示错误与只读参数，保留已保存值。

示例源码、Dockerfile、UI 和打包工具见 `examples/modules/`、`scripts/module-package.py`。ZIP 默认包含契约和 UI；构建镜像是明确的开发工具操作，平台导入不会执行构建。

模块自己的外部服务凭据可使用参数 Schema 的 `x-testflow-credential: true` 标记字符串引用。配置只保存 credential_id；凭据类别为 module。模块通过 `GET /api/v1/module-resources/{runtime_id}/credentials/{credential_id}?execution_id=...` 读取本次参数明确授权的引用，不能读取 Git、镜像、评测或其他节点凭据。已读取的敏感正文和运行 token 会从执行事件/输出证据中移除，导出只保留引用。凭据始终由模块代码决定如何使用，不增加“外部接口来源”枚举。

参数 Schema 固定使用 JSON Schema Draft 2020-12，`$schema` 可省略或为 `https://json-schema.org/draft/2020-12/schema`。只允许当前 Schema 内的 `#` 引用，禁止依赖可变的远端 Schema。参数默认值、前端草稿、保存及执行参数均按同一版本校验，校验不转换类型或改写用户值。`format` 为注释，不作为参数验证断言。宿主 SDK 的 `credentialOptions("module")` 返回可选择的引用，正文不会返回前端。Git SSH 凭据支持含 private_key、known_hosts 的 JSON；HTTP 凭据支持 Token 或 username/password JSON。

React/TypeScript 配置组件可使用 `node packages/tooling/module-ui.mjs <源码.tsx> <输出.js>` 编译。编译器将 React、JSX runtime 和 HeroUI 导入映射到宿主桥接，不把另一份依赖打进 ZIP。组件接收受控的 `value/onChange`，并遵守只读、语言和主题属性。
