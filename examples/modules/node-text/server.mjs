import http from 'node:http';
import fs from 'node:fs';
import {WebSocketServer} from 'ws';
const manifest=JSON.parse(fs.readFileSync('/app/manifest.json'));
const contract={protocol:manifest.protocol,id:manifest.id,version:manifest.version,inputs:JSON.parse(fs.readFileSync('/app/schemas/inputs.json')),outputs:JSON.parse(fs.readFileSync('/app/schemas/outputs.json')),parameters:JSON.parse(fs.readFileSync('/app/schemas/parameters.json'))};
const invocations=new Map();
const server=http.createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');let output;
 try{
 if(req.url==='/module/v1/health')output={ready:true};
 else if(req.url==='/module/v1/contract')output=contract;
 else if(req.method==='POST'&&req.url==='/module/v1/executions'){
 let data='';for await(const chunk of req)data+=chunk;const body=JSON.parse(data);
 if(!invocations.has(body.invocation_id))invocations.set(body.invocation_id,{body,state:'created',socket:null,canceled:false});output={invocation_id:body.invocation_id};
 }else {const match=req.url.match(/^\/module\/v1\/executions\/([^/]+)(\/cancel)?$/);const invocation=match&&invocations.get(match[1]);if(!invocation){res.statusCode=404;output={error:'not_found'};}else if(match[2]){invocation.canceled=true;if(!['completed','failed'].includes(invocation.state)){invocation.state='canceled';invocation.socket?.send(JSON.stringify({type:'execution.canceled',invocation_id:match[1],remote_stop_confirmed:true}));}output={accepted:true,state:invocation.state};}else output={invocation_id:match[1],state:invocation.state};}
 }catch{res.statusCode=400;output={error:'invalid_request'};}
 res.end(JSON.stringify(output));
});
const wss=new WebSocketServer({server});
wss.on('connection',async(socket,request)=>{
 const id=request.url.match(/^\/module\/v1\/executions\/([^/]+)\/stream$/)?.[1];const invocation=invocations.get(id);if(!invocation){socket.close();return;}
 invocation.socket=socket;invocation.state='running';const body=invocation.body;const send=(type,payload={})=>{if(socket.readyState===1)socket.send(JSON.stringify({type,invocation_id:id,...payload}));};
 try{
 const values={};let received=0;
 for(const [name,value]of Object.entries(body.inputs))if(!value.stream)values[name]=value.value;
 const streams=Object.entries(body.inputs).filter(([,v])=>v.stream);
 if(streams.length)await new Promise((resolve,reject)=>{const sequences={};const ended=new Set();socket.on('message',raw=>{try{const event=JSON.parse(raw);if(!body.inputs[event.field]?.stream)throw Error('undeclared stream');const seq=sequences[event.field]||0;if(event.seq!==seq)throw Error('sequence gap');if(ended.has(event.field))throw Error('data after EOS');if(event.type==='input.chunk'){if(event.format!==body.inputs[event.field].format||typeof event.data!=='string')throw Error('invalid text chunk');values[event.field]=(values[event.field]||'')+event.data;sequences[event.field]=seq+1;received++;}else if(event.type==='input.eos'){ended.add(event.field);if(ended.size===streams.length)resolve();}else throw Error('invalid input event');}catch(e){reject(e);}});socket.once('close',()=>reject(Error('truncated input')));});
 let text=Object.values(values).map(v=>typeof v==='string'?v:JSON.stringify(v)).join('\n');
 const mode=body.parameters.mode||'uppercase';text=mode==='lowercase'?text.toLowerCase():mode==='reverse'?[...text].reverse().join(''):mode==='identity'?text:text.toUpperCase();
 send('trace',{trace_id:body.context.trace_id,parent_span_id:body.context.span_id,span_id:id+'-transform',name:'text_transform',mode,characters:[...text].length});
 for(const field of contract.outputs.fields){
  if(field.type==='JSON'){send('output.value',{field:field.name,value:{characters:[...text].length,words:text.trim()?text.trim().split(/\s+/u).length:0,received_chunks:received}});continue;}
  if(field.stream){const size=Math.max(1,body.parameters.chunk_size||3);const codepoints=[...text];let sequence=0;for(let i=0;i<codepoints.length;i+=size){if(invocation.canceled)return;send('output.chunk',{field:field.name,seq:sequence++,format:field.format,data:codepoints.slice(i,i+size).join('')});await new Promise(resolve=>setTimeout(resolve,Math.max(0,body.parameters.delay_ms||0)));}send('output.eos',{field:field.name,seq:sequence});}
  else send('output.value',{field:field.name,value:text});
 }
 if(invocation.canceled)return;invocation.state='completed';send('execution.completed');socket.close();
 }catch(e){if(invocation.canceled)return;invocation.state='failed';send('execution.error',{code:'text_error',message:e.message});socket.close();}
});
server.listen(Number(process.env.TESTFLOW_MODULE_PORT||8080),'0.0.0.0');
