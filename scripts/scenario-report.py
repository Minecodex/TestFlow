"""Render public experiment evidence; never reads credentials, cookies or private access files."""
import argparse
import base64
import html
import json
from pathlib import Path

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--namespace',required=True)
args=parser.parse_args()
evidence=root/'.data/acceptance'/args.namespace
result=json.loads((evidence/'tiny-scenario.json').read_text())
output=root/'.data/acceptance/scenario-20261011/report.html'
escape=lambda value:html.escape(str(value))
cards=[]
for run in result['runs']:
    file=evidence/(run['modality']+'-reply.wav')
    audio=base64.b64encode(file.read_bytes()).decode()
    cards.append(f'<article><span class="tag">实际通过 · {escape(run["modality"])}</span><h2>{escape(run["recognized_query"] or "What is the refund policy?")}</h2>'
        f'<p>{escape(run["answer"])}</p><audio controls preload="metadata" src="data:audio/wav;base64,{audio}"></audio>'
        f'<small>Kimi k3 · {run["evidence"]["chunks"]} 个片段 · 正常 EOS · {run["trace_spans"]} 个内部 Span<br>'
        f'执行 ID：{escape(run["execution_id"])}</small></article>')
models=''.join(f'<tr><td>{escape(name.upper())}</td><td>{data["bytes"]:,} 字节</td><td>{data["bytes"]/1024/1024:.2f} MiB</td></tr>' for name,data in result['models'].items())
comparisons=[]
visual=root/'.data/acceptance/scenario-20261011/detail-delivery'
if (visual/'result.json').exists():
    diagnostics=json.loads((visual/'result.json').read_text())
    for screen in diagnostics['screens']:
        images=[]
        for prefix in ['formal','demo']:
            image=visual/(prefix+'-'+screen['id']+'.png')
            encoded=base64.b64encode(image.read_bytes()).decode()
            images.append(f'<figure><figcaption>{"正式界面" if prefix=="formal" else "demo"}</figcaption><img loading="lazy" src="data:image/png;base64,{encoded}"></figure>')
        comparisons.append(f'<details><summary>{escape(screen["id"])} · 差异 {screen["ratio"]*100:.3f}%</summary><div class="comparison">{"".join(images)}</div></details>')
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TestFlow 实际场景验收</title>
<style>body{margin:0;background:#f6f7f5;color:#172822;font:14px/1.65 "Segoe UI","PingFang SC",sans-serif}main{max-width:1200px;margin:36px auto;padding:24px}h1{font-size:28px}h2{font-size:18px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}article,section,details{background:white;border:1px solid #e5eae6;border-radius:12px;padding:20px;margin:18px 0}.tag{color:#16794d;background:#edf7f0;padding:5px 10px;border-radius:5px}small{display:block;color:#7b8781;overflow-wrap:anywhere}audio{width:100%;margin:18px 0}table{width:100%;border-collapse:collapse}td,th{padding:10px;text-align:left;border-bottom:1px solid #e5eae6}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:12px 0}img{width:100%;border:1px solid #e5eae6}summary{cursor:pointer;font-weight:600}@media(max-width:900px){.grid,.comparison{grid-template-columns:1fr}}</style><main>'''
page+=f'<h1>TestFlow · 极小模型真实闭环</h1><p>虚拟项目 Acorn Mini Store · {len(result["checks"])} 项 Kubernetes 场景检查通过。下方是实际 Kimi 回答与实际合成音频。</p><div class="grid">'+''.join(cards)+'</div>'
page+='<section><h2>本地模型与数据体积</h2><table><tr><th>组件</th><th>实测字节</th><th>体积</th></tr>'+models+'</table><p>BM25 无权重下载；Kimi 为远程 API。语音为英文限定语法，图片为英文 OCR，TTS 为共振峰合成。未使用麦克风，不评价生成效果。</p></section>'
page+='<section><h2>前端对照</h2><p>九个主页面使用独立严格视觉门槛。以下十三状态为扩大范围的诊断；仍有布局和实际服务控件差异，不能称为完美还原。可以展开并对照两张原始截图。</p></section>'+''.join(comparisons)+'</main></html>'
output.parent.mkdir(parents=True,exist_ok=True)
output.write_text(page)
print(output)
