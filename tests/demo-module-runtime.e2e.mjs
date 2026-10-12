// Pod-only prototype contract checks. Execute through the documented CUA facade.
export default async function verifyModuleRuntime(tab,observe){
 const ui=tab.playwright;
 const assert=(value,message)=>{if(!value)throw Error(message);};
 const button=name=>ui.getByRole('button',{name,exact:true});
 await ui.getByRole('button',{name:/^能力模块/}).click();await observe();
 await button('导入 ZIP 模块').click();await observe();
 for(const label of ['启动方式','后端语言','运行入口','外部服务地址','能力来源'])assert(await ui.getByLabel(label,{exact:true}).count()===0,'No internal implementation control '+label);
 const form=ui.locator('#module-form');
 assert((await form.innerText()).includes('Kubernetes Pod'),'Pod-only runtime');
 await ui.getByLabel('模块名称',{exact:true}).fill('Pod-only prototype audit');
 await ui.getByLabel('模块镜像引用',{exact:true}).fill('example/adapter:immutable-1');await observe();
 assert((await form.innerText()).includes('ENTRYPOINT / CMD'),'Image controls startup');
 await button('取消').click();await observe();
 await ui.locator('.module-card').first().getByRole('button',{name:'查看契约',exact:true}).click();await observe();
 const detail=await ui.locator('#drawer-layer').innerText();
 assert(detail.includes('Kubernetes Pod'),'Module detail runtime');
 assert(!detail.includes('本地进程')&&!detail.includes('后端语言'),'No obsolete launch controls');
 await button('关闭侧栏').click();await observe();
 return ['Pod-only import and contract; implementation stays inside module'];
}
