# 动态模块配置宿主

`host.tsx` 按模块固定版本加载 ZIP 中的配置组件，核对 `testflow.ui.v1` SDK 标识，通过 `window.TestFlowHost` 共享 React、JSX runtime、HeroUI 和凭据元数据接口。组件接收参数 Schema、语言、主题和模块版本；参数在前后端校验。

契约示例以只读模式呈现。加载、兼容或组件渲染失败时显示错误与已保存参数，并支持重新载入；故障不会清空参数。ZIP 配置组件是具有平台页面执行权限的可信代码，导入和构建约定见 `contracts/module/README.md` 与 `packages/module-ui-sdk`。
