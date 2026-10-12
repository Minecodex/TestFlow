// Bundle a module TSX entry against the platform's shared UI runtime.
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
const [entry,outfile]=process.argv.slice(2);
if(!entry||!outfile)throw Error('Usage: pnpm --filter @testflow/tooling module-ui <entry.tsx> <ui/config-panel.js>');
const require=createRequire(resolve('web/package.json'));
const sources=new Map([['react','React'],['react/jsx-runtime','JSXRuntime'],['react/jsx-dev-runtime','JSXRuntime'],['@heroui/react','HeroUI']]);
const exportsByPackage=new Map();
for(const [name]of sources){
 const module=await import(pathToFileURL(require.resolve(name)).href);
 exportsByPackage.set(name,Object.keys(module).filter(k=>k!=='default'&&/^[A-Za-z_$][\w$]*$/.test(k)));
}
await mkdir(resolve(outfile,'..'),{recursive:true});
await build({entryPoints:[resolve(entry)],outfile:resolve(outfile),bundle:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',plugins:[{
 name:'testflow-shared-ui',setup(builder){
  builder.onResolve({filter:/^(react(?:\/jsx(?:-dev)?-runtime)?|@heroui\/react|@testflow\/module-ui-sdk)$/},args=>({path:args.path,namespace:'testflow-host'}));
  builder.onLoad({filter:/.*/,namespace:'testflow-host'},async args=>{
   if(args.path==='@testflow/module-ui-sdk')return {contents:await readFile(new URL('../module-ui-sdk/src/index.ts',import.meta.url),'utf8'),loader:'ts'};
   const source=sources.get(args.path);
   return {contents:`const runtime=window.TestFlowHost.${source};\nexport default runtime;\n`+exportsByPackage.get(args.path).map(k=>`export const ${k}=runtime.${k};`).join('\n'),loader:'js'};
  });
 }
}],metafile:true}).then(result=>{
 const embedded=Object.keys(result.metafile.inputs).filter(name=>/node_modules.*(?:react|heroui)/.test(name));
 if(embedded.length)throw Error('Shared UI dependency was bundled: '+embedded.join(','));
 console.log('Built module UI:',resolve(outfile));
});
