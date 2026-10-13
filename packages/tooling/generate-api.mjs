import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import openapiTS, {astToString} from 'openapi-typescript';
const root=path.resolve(import.meta.dirname,'../..');
const schema=JSON.parse(fs.readFileSync(path.join(root,'contracts/openapi.json'),'utf8'));
const source=astToString(await openapiTS(schema));
const tree=ts.createSourceFile('api.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const interfaces=new Map(tree.statements.filter(ts.isInterfaceDeclaration).map(node=>[node.name.text,node]));
const files={};
const banner='// Generated from contracts/openapi.json. Do not edit.\n';
const lines=text=>text.split('\n').length;
function partition(name,members,imports,stem,exportName=name){
 let part=[],size=0,groups=[];
 for(const member of members){const text=member.getFullText(tree);const count=lines(text);if(count>1750)throw Error('An API member exceeds the source-file limit: '+name);if(size+count>1750){groups.push(part);part=[];size=0;}part.push(text);size+=count;}
 if(part.length)groups.push(part);
 groups.forEach((members,index)=>{files[`${stem}-${index}.ts`]=imports+`export interface ${name}${index} {\n`+members.join('')+'\n}\n';});
 return groups.map((_,index)=>`import type { ${name}${index} } from './${stem}-${index}';`).join('\n')+`\nexport type ${exportName} = `+groups.map((_,index)=>`${name}${index}`).join(' & ')+';\n';
}
files['paths.ts']=partition('PathsPart',interfaces.get('paths').members,"import type { operations } from './operations';\nimport type { components } from './schemas';\n",'paths','paths');
files['operations.ts']=partition('OperationsPart',interfaces.get('operations').members,"import type { components } from './schemas';\n",'operations','operations');
const components=interfaces.get('components');
if(lines(components.getFullText(tree))<1800)files['schemas.ts']=components.getFullText(tree).trim()+'\n';
else {
 const dictionary=components.members.find(member=>member.name?.getText(tree)==='schemas');
 const combined=partition('SchemasPart',dictionary.type.members,"import type { components } from './schemas';\n",'schema-values','SchemaDictionary');
 files['schemas.ts']=combined+'\nexport interface components {\n schemas: SchemaDictionary;\n'+components.members.filter(member=>member!==dictionary).map(member=>member.getFullText(tree)).join('')+'\n}\n';
}
for(const [name,body]of Object.entries(files))if(lines(banner+body)>1990)throw Error(name+' exceeds the source-file limit');
const dir=path.join(root,'web/src/shared/api/generated');fs.mkdirSync(dir,{recursive:true});
// Validate the complete result before replacing any generated file.
for(const [name,body]of Object.entries(files))fs.writeFileSync(path.join(dir,name),banner+body);
for(const old of fs.readdirSync(dir))if(!files[old]&&fs.readFileSync(path.join(dir,old),'utf8').startsWith(banner))fs.unlinkSync(path.join(dir,old));
fs.writeFileSync(path.join(root,'web/src/shared/api/generated.ts'),"export type { paths } from './generated/paths';\nexport type { components } from './generated/schemas';\nexport type { operations } from './generated/operations';\n");
