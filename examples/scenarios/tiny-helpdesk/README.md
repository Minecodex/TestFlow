# 极小模型帮助台实验

虚拟项目 Acorn Mini Store 保存三条英文商店政策。平台实际同步 Git、固定 commit、导入 ZIP、验证镜像与契约，再在 Kubernetes Pod 中执行模块。知识库不是测试案例的参考答案；案例未配置参考，知识文档由 RAG 模块从固定仓库只读挂载读取。

## 三条链路

1. 文字问题 → 内置 BM25 → Kimi `k3` 流式回答 → 收集完整文本 → eSpeak NG → WAV、引用证据、规则和报告。
2. 合成英文问题音频 → PocketSphinx → 同一 RAG/回答/语音链路。
3. 印有英文问题的 PNG → Tesseract OCR → 同一 RAG/回答/语音链路。

所有回答必须引用实际检索结果中的文档 ID。每次调用记录内部 Trace、模型调用的结束状态、增量片段数量及 usage。Kimi 凭据通过 `x-testflow-credential` 引用和模块资源接口读取，ZIP、镜像和任务快照均不包含密钥。

## 实际体积与能力边界

| 组件 | 实测模型/数据体积 | 边界 |
| --- | --- | --- |
| BM25 | 三条文档，无模型下载 | 词汇检索，没有向量嵌入模型 |
| PocketSphinx 5.1.1 | 6,609,947 字节，约 6.30 MiB | 保留声学模型；删除大语言模型，裁剪词典，使用帮助台英文 JSGF 语法 |
| Tesseract `eng.traineddata` | 4,113,088 字节，约 3.92 MiB | 英文印刷文字 OCR，不是通用图片理解 |
| eSpeak NG | 11,627,329 字节，约 11.09 MiB | 共振峰合成及语言数据，不是神经 TTS |
| Kimi `k3` | 远程 API，无本地权重 | 使用真实兼容 Chat Completions 服务 |

这些是模型与语言数据的体积，不能当作完整容器镜像的体积。镜像还包含 Python、HTTP 服务、解码器和系统依赖。ASR 使用限定词汇和语法，实验不衡量自由语音识别、中文、噪声或声音自然度。

协议服务共用 `service.py`，实际处理在 `processors.py`。取消会中断 HTTP/SSE 请求并杀死仍在运行的外部进程。构建时保存模型数据摘要，manifest 使用带源码摘要的不可变标签；启动仍使用镜像 ENTRYPOINT。

模型和协议来源：[PocketSphinx](https://pocketsphinx.readthedocs.io/en/latest/)、[Tesseract fast 数据](https://github.com/tesseract-ocr/tessdata_fast)、[eSpeak NG](https://github.com/espeak-ng/espeak-ng)、[Kimi Code API](https://www.kimi.com/code/docs/)。

## 重复执行

先按平台部署说明启动独立 `testflow-e2e-<run-id>` namespace，并完成 migration/rollout/localhost port-forward。实验要求已有可解密的 `.data/kimi-credential-reference`；不要把凭据正文加入命令、Git 或镜像。

```sh
python3 examples/scenarios/tiny-helpdesk/build.py --build
```

构建生成 `.data/tiny-scenario-modules.json` 和五个 ZIP。将其中五个镜像按名称逐一加载到自己的 Minikube profile，再执行：

```sh
uv run --project server python tests/kubernetes/tiny_scenario.py --namespace testflow-e2e-<run-id>
TESTFLOW_E2E_NAMESPACE=testflow-e2e-<run-id> node tests/tiny-scenario-ui.e2e.mjs
python3 scripts/cleanup-acceptance.py --namespace testflow-e2e-<run-id>
```

API 验收保存实际执行、声音、图片、Trace、任务和旧报告；浏览器验收另外查看真实报告、播放产物、检查六个页签和 Kimi 评分。测试不申请麦克风权限。失败的调试记录保留，只有最终完成的检查计入通过结果。

2026-10-11 的十项实际场景检查已通过，产物见 `.data/acceptance/testflow-e2e-20261011-09/tiny-scenario.json`。平台前端的原型对照结论另见 `docs/voice-test-platform/18-极小模型场景与界面对照.md`。
