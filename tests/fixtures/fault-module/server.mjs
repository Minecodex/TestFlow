// Deliberately faulty behaviors, installed only by Kubernetes acceptance tests.
import http from 'node:http';
import fs from 'node:fs';
import {WebSocketServer} from 'ws';
const manifest=JSON.parse(fs.readFileSync('/app/manifest.json'));
const contract={protocol:manifest.protocol,id:manifest.id,version:manifest.version,inputs:JSON.parse(fs.readFileSync('/app/schemas/inputs.json')),outputs:JSON.parse(fs.readFileSync('/app/schemas/outputs.json')),parameters:JSON.parse(fs.readFileSync('/app/schemas/parameters.json'))};
const invocations=new Map();
const server=http.createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');let output;
 try{
  if(req.url==='/module/v1/health') output={ready:true};
  else if(req.url==='/module/v1/contract') output=contract;
  else if(req.method==='POST'&&req.url==='/module/v1/executions'){
   let data='';for await(const chunk of req)data+=chunk;const body=JSON.parse(data);
   if(!invocations.has(body.invocation_id)) invocations.set(body.invocation_id,{body,state:'created',socket:null,canceled:false,wake:()=>{}});
   output={invocation_id:body.invocation_id};
  } else {
   const match=req.url.match(/^\/module\/v1\/executions\/([^/]+)(\/cancel)?$/);const invocation=match&&invocations.get(match[1]);
   if(!invocation){res.statusCode=404;output={error:'not_found'};}
   else if(match[2]){
    if(!invocation.ignoreCancel&&!['completed','failed','canceled'].includes(invocation.state)){
     invocation.canceled=true;invocation.state='canceled';invocation.wake();
     if(invocation.socket?.readyState===1) invocation.socket.send(JSON.stringify({type:'execution.canceled',invocation_id:match[1],remote_stop_confirmed:true}));
    }
    output={accepted:true,state:invocation.state};
   } else output={invocation_id:match[1],state:invocation.state};
  }
 }catch{res.statusCode=400;output={error:'invalid_request'};}
 res.end(JSON.stringify(output));
});
const wss=new WebSocketServer({server});
wss.on('connection',async(socket,request)=>{
 const id=request.url.match(/^\/module\/v1\/executions\/([^/]+)\/stream$/)?.[1];const invocation=invocations.get(id);if(!invocation){socket.close();return;}
 invocation.socket=socket;invocation.state='running';const body=invocation.body;
 const send=(type,payload={})=>{if(socket.readyState===1)socket.send(JSON.stringify({type,invocation_id:id,...payload}));};
 const sleep=ms=>new Promise(resolve=>{const timer=setTimeout(resolve,ms);invocation.wake=()=>{clearTimeout(timer);resolve();};});
 try{
  let text='',received=0;
  await new Promise((resolve,reject)=>{
   socket.on('message',raw=>{const event=JSON.parse(raw);if(event.type==='input.chunk'){text+=event.data;received++;}if(event.type==='input.eos')resolve();});
   socket.once('close',()=>reject(Error('input_truncated')));
  });
  const mode=body.parameters.mode==='by_input'?text:body.parameters.mode;
  invocation.ignoreCancel=['ignore_cancel','end_then_hang','late_error'].includes(mode);
  send('trace',{trace_id:body.context.trace_id,parent_span_id:body.context.span_id,span_id:id+'-fixture',name:'test_fixture',mode});
  if(mode==='spontaneous_cancel'){invocation.state='canceled';send('execution.canceled');return;}
  if(['hang','ignore_cancel'].includes(mode)){await sleep(120000);return;}
  await sleep(mode==='slow_success'?3000:body.parameters.delay_ms);if(invocation.canceled)return;
  if(mode==='error'){invocation.state='failed';send('execution.error',{code:'fixture_error',message:'Test-only explicit error'});socket.close();return;}
  send('output.value',{field:'stats',value:{received_chunks:received,characters:text.length}});
  send('output.chunk',{field:'text',seq:mode==='wrong_sequence'?2:0,format:'UTF-8',data:text.toUpperCase()});
  if(mode==='truncate'){socket.close();return;}
  if(mode==='premature_complete'){invocation.state='completed';send('execution.completed');socket.close();return;}
  send('output.eos',{field:'text',seq:1});
  if(mode==='end_then_hang'){await sleep(120000);return;}
  if(mode==='late_error'){await sleep(100);invocation.state='failed';send('execution.error',{message:'Late fixture error'});socket.close();return;}
  invocation.state='completed';send('execution.completed');socket.close();
 }catch(error){if(invocation.canceled)return;invocation.state='failed';send('execution.error',{message:error.message});socket.close();}
});
server.listen(Number(process.env.TESTFLOW_MODULE_PORT||8080),'0.0.0.0');
