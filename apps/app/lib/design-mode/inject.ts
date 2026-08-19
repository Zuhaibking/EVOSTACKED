import type { FragmentFile } from '@/lib/fragment'
import { EVO_INSPECT_CHANNEL } from './protocol'
import { stampDataOids } from './rewrite-classes'

export const INSPECT_SCRIPT_PATH = 'public/evo-inspect.js'
export const INSPECT_DOCUMENT_PATH = 'pages/_document.tsx'

export function inspectProbeSource(): string {
  return `(function(){
  if (window.__evoInspect) return;
  window.__evoInspect = true;
  var CHANNEL=${JSON.stringify(EVO_INSPECT_CHANNEL)};
  var enabled=false, selected=null;
  var box=document.createElement('div');
  box.setAttribute('data-evo-inspect','overlay');
  box.style.cssText='position:fixed;z-index:2147483646;pointer-events:none;border:1px solid #c4b59a;background:rgba(196,181,154,.12);display:none;';
  function ensure(){ if(!box.parentNode && document.body) document.body.appendChild(box); }
  function overlay(el){ return el && el.getAttribute && el.getAttribute('data-evo-inspect'); }
  function xpathOf(el){
    var parts=[];
    while(el && el.nodeType===1 && el!==document.body){
      var i=1, s=el.previousElementSibling;
      while(s){ if(s.tagName===el.tagName) i++; s=s.previousElementSibling; }
      parts.unshift(el.tagName.toLowerCase()+'['+i+']');
      el=el.parentElement;
    }
    return '/'+parts.join('/');
  }
  function styleOf(el){
    var s=getComputedStyle(el);
    return {color:s.color,background:s.backgroundColor,fontSize:s.fontSize,fontWeight:s.fontWeight,fontFamily:s.fontFamily,lineHeight:s.lineHeight,letterSpacing:s.letterSpacing,textAlign:s.textAlign,textDecoration:s.textDecorationLine||s.textDecoration,padding:s.padding,margin:s.margin,width:s.width,height:s.height,display:s.display,flexDirection:s.flexDirection,gap:s.gap,justifyContent:s.justifyContent,alignItems:s.alignItems,border:s.border,borderRadius:s.borderRadius,opacity:s.opacity,boxShadow:s.boxShadow};
  }
  function payload(el){
    var r=el.getBoundingClientRect();
    return {tag:el.tagName.toLowerCase(),text:(el.innerText||'').trim().slice(0,160),className:el.getAttribute('class')||'',xpath:xpathOf(el),computed:styleOf(el),rect:{top:r.top,left:r.left,width:r.width,height:r.height},oid:el.getAttribute('data-oid')||undefined};
  }
  function paint(el, mode){
    if(!el){ box.style.display='none'; return; }
    ensure();
    var r=el.getBoundingClientRect();
    box.style.display='block';
    box.style.top=r.top+'px'; box.style.left=r.left+'px';
    box.style.width=r.width+'px'; box.style.height=r.height+'px';
    box.style.borderColor=mode==='select'?'#f2eee6':'#c4b59a';
  }
  function post(msg){ try{ parent.postMessage(Object.assign({channel:CHANNEL},msg),'*'); }catch(e){} }
  var MAP={color:'color',background:'backgroundColor',fontSize:'fontSize',fontWeight:'fontWeight',fontFamily:'fontFamily',lineHeight:'lineHeight',letterSpacing:'letterSpacing',textAlign:'textAlign',textDecoration:'textDecoration',padding:'padding',margin:'margin',width:'width',height:'height',display:'display',flexDirection:'flexDirection',gap:'gap',justifyContent:'justifyContent',alignItems:'alignItems',border:'border',borderRadius:'borderRadius',opacity:'opacity',boxShadow:'boxShadow'};
  function applyPatches(patches){
    if(!selected) return;
    (patches||[]).forEach(function(p){
      if(!p||!p.prop) return;
      if(p.prop==='content'){ if(selected.childElementCount===0) selected.textContent=String(p.value||''); return; }
      if(MAP[p.prop]) selected.style[MAP[p.prop]]=String(p.value||'');
    });
  }
  window.addEventListener('message', function(ev){
    if(ev.source!==parent) return;
    var d=ev.data; if(!d||d.channel!==CHANNEL) return;
    if(d.type==='enable'){ enabled=true; document.documentElement.setAttribute('data-evo-inspecting','1'); }
    if(d.type==='disable'){ enabled=false; document.documentElement.removeAttribute('data-evo-inspecting'); paint(null); }
    if(d.type==='applyPending') applyPatches(d.patches);
    if(d.type==='resetPending' && selected) selected.style.cssText=selected.getAttribute('data-evo-prev')||'';
  });
  document.addEventListener('mouseover', function(e){
    if(!enabled) return;
    var t=e.target; if(!t||overlay(t)||t===document.documentElement||t===document.body) return;
    if(t!==selected) paint(t,'hover');
  }, true);
  document.addEventListener('click', function(e){
    if(!enabled) return;
    var t=e.target; if(!t||overlay(t)||t===document.documentElement) return;
    e.preventDefault(); e.stopPropagation();
    selected=t;
    if(!selected.getAttribute('data-evo-prev')) selected.setAttribute('data-evo-prev', selected.style.cssText||'');
    paint(t,'select');
    post({type:'select', node:payload(t)});
  }, true);
  document.addEventListener('keydown', function(e){
    if(enabled && e.key==='Escape'){ selected=null; paint(null); post({type:'clear'}); }
  }, true);
  function hello(){ post({type:'ready'}); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', hello); else hello();
})();`
}

export function inspectDocumentSource(): string {
  return `import Document, { Html, Head, Main, NextScript } from 'next/document'

export default class EvoDocument extends Document {
  render() {
    return (
      <Html>
        <Head />
        <body>
          <Main />
          <NextScript />
          <script src="/evo-inspect.js" />
        </body>
      </Html>
    )
  }
}
`
}

export const INSPECT_VUE_PLUGIN_PATH = 'plugins/evo-inspect.client.ts'

export function inspectVuePluginSource(): string {
  return `export default defineNuxtPlugin(() => {
  if (typeof document === 'undefined') return
  if (document.querySelector('script[src="/evo-inspect.js"]')) return
  const script = document.createElement('script')
  script.src = '/evo-inspect.js'
  document.body.appendChild(script)
})
`
}

export function buildInspectInjectFiles(existingPaths: string[]): FragmentFile[] {
  const lower = existingPaths.map((p) => p.replace(/\\/g, '/').toLowerCase())
  const files: FragmentFile[] = [
    { file_path: INSPECT_SCRIPT_PATH, file_content: inspectProbeSource() },
  ]
  const isVue = lower.some(
    (p) => p.endsWith('.vue') || p.includes('nuxt.config'),
  )
  if (isVue) {
    files.push({
      file_path: INSPECT_VUE_PLUGIN_PATH,
      file_content: inspectVuePluginSource(),
    })
    return files
  }
  const hasDocument = lower.some((p) =>
    /(^|\/)pages\/_document\.(tsx|ts|jsx|js)$/.test(p),
  )
  if (!hasDocument) {
    files.push({
      file_path: INSPECT_DOCUMENT_PATH,
      file_content: inspectDocumentSource(),
    })
  }
  return files
}

export function stampFragmentFiles(files: FragmentFile[]): FragmentFile[] {
  return files.map((file) => ({
    ...file,
    file_content: stampDataOids(file.file_path, file.file_content),
  }))
}

export function shouldInjectInspect(templateId: string | undefined): boolean {
  const id = String(templateId || '').replace(/-dev$/, '')
  return id === 'nextjs-developer' || id === 'vue-developer'
}
