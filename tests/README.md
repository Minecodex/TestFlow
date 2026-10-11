# TestFlow 验证

## 正式基础工程

工作区检查：`pnpm typecheck`、`pnpm build`、`pnpm test:server`。Kubernetes 渲染：`pnpm check:k8s`；两镜像构建后运行 `python3 tests/container-smoke.py`，实际验证 API 代理、SPA 刷新、静态资源 404、健康检查、非 root / 只读运行及数据目录可写，最后自动清理本次测试资源。

`foundation.e2e.mjs` 验证首页真实 API 和刷新、八个业务路由、卡片入口、导航选中、深层地址重载、每页双语、深浅主题及偏好持久化、404 返回。还提供断线和恢复检查函数。2026-10-11 已通过 CUA Playwright facade 执行这些检查；故障检查实际停止本次启动的后端，再重新启动并手动重试恢复。

常规 Playwright 入口已创建，需安装 Chromium 后执行：

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

playwright.config.mjs 可自动启动前后端，使用 1440 × 1000 桌面视口；foundation.spec.mjs 复用同一验收函数，常规 runner 的断线用网络拦截验证。当前会话浏览器验收通过 CUA 完成，没有运行常规 runner 浏览器；可用 `pnpm exec playwright test --list` 检查测试发现。

CUA 调用：

```js
const { verifyFoundation, verifyUnavailable, verifyRecovery } = await import('/absolute/project/path/tests/foundation.e2e.mjs');
const observe = () => tab.getAXState({ emit: false });
nodeRepl.write(await verifyFoundation(tab, observe));
// 在测试拥有的后端停止 / 重启后分别调用 verifyUnavailable / verifyRecovery。
```

以上验证覆盖基础工程，不代表业务功能或模块执行已实现。两套 Kubernetes overlay 和 Ingress 示例通过 1.35 Schema 严格校验，实际集群 rollout 尚未验证。

## 交互原型

运行无需额外依赖的业务逻辑测试：

```sh
node --test tests/*.test.cjs
```

测试通过公共 `demo-test-helpers.cjs` 载入 `docs/demo.html` 的实际业务逻辑，不连接网络、不操作浏览器或注入浏览器状态。17 项测试覆盖 9 个页面和 6 个详情页签渲染、Docker/本地启动声明、镜像/挂载校验、任意语言、有效运行分支快照、排队输入冻结、案例完整性、重跑计数与旧报告、固定评测版本、质量合格线、CER 适用性、任意命名输出预览、文字/多模态执行、开始流与双向显式转换、错误和取消收尾。

为浏览器导入生成非私人合成文件，并启动静态预览：

```sh
python3 tests/create-demo-fixtures.py
python3 -m http.server 8765 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8765/docs/demo.html`。默认合成目录 `/tmp/testflow-ui-audit` 包含 TXT、SVG、可解码 WAV、坏 WAV 及只用于文件选择的 ZIP。该 ZIP 不包含待执行代码。

两个 `.e2e.mjs` 文件是通过 Codex CUA 支持的 Playwright facade 执行的浏览器测试，使用页面控件与可见 DOM，不通过页面脚本读写应用状态。按正式桌面范围使用宽度至少 1200 像素的视口，将已绑定的 `tab` 和观察函数传入。按阶段执行全流程测试，便于观察和报告进度：

```js
const viewport = await browser.capabilities.get('viewport');
await viewport.set({ width: 1440, height: 1000 });
const workflow = await import('/absolute/project/path/tests/demo-workflow.e2e.mjs');
const observe = () => tab.getAXState({ emit: false });
try {
  workflow.context.passed.length = 0;
  workflow.context.downloads.length = 0;
  for (const stage of ['resources', 'assets', 'datasets', 'flow', 'canvas', 'tasks', 'history', 'utility']) {
    nodeRepl.write(await workflow.verifyStage(stage, tab, observe));
  }
  const { default: verifyModuleRuntime } = await import('/absolute/project/path/tests/demo-module-runtime.e2e.mjs');
  nodeRepl.write(await verifyModuleRuntime(tab, observe));
} finally {
  await viewport.reset();
}
```

浏览器测试会重新加载页面，只修改当前浏览器中的内存演示数据。文件选择使用合成文件；下载测试实际生成流程和执行 JSON 文件，路径保存在 `workflow.context.downloads`。全部浏览器场景共 8 组主流程 + 6 组模块配置。当前审查另外实际检查了节点拖动、编辑过程中搜索快捷键保护、无 ASR 的严格评测，结果见 [原型全流程审查](../docs/voice-test-platform/10-首版范围与验收.md#2026-10-11-原型全流程审查结果)。

全流程测试覆盖注册/同步/编辑/隐藏恢复、真实素材解码及逐文件错误、案例向导和结构修订、从零编排 DAG、组装/循环/重复边/超时校验、删边取消、节点增删、保存撤销、快速输入和导出、显式任务/并发/失败继续/取消、重跑/旧报告、复评错误/恢复/旧版本及一致统计、搜索/导览/快捷键/播放。模块测试验证 ZIP 文件选择重绘保留、启动方式优先、本地语言/入口/自定义语言、Docker 镜像/挂载及目录校验、两套草稿、固定 commit 和历史快照、顺序限制。

修改 `.mjs` 后，持久 Node REPL 可能缓存旧模块。复测时使用新的临时副本路径再 import；对 HTML 修改则重新加载页面。全流程阶段可以分成多个 CUA 调用，避免长时间占用单次调用。

本轮没有授予或使用麦克风权限；录音实际采集及权限拒绝路径需要独立浏览器环境验证。正式模块执行器尚未实现。原型测试不代表真实 ZIP 解包/动态组件、Git/依赖准备、本地/Docker 启动、HTTP/私有 WebSocket、远端取消、AI 服务或持久化已通过集成验收；双语、主题与正式 React/HeroUI 构建也不在此单文件测试范围。
