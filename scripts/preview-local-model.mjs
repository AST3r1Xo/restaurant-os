// Private, loopback-only review tool. Never publishes a model or reads .env.
// Usage: npm run preview:model -- .local-assets/yakitori/yakitori-momo-optimized.glb
import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { validateMedia } from "../src/features/menu-admin/media-validation.ts";

if (process.env.VERCEL) throw new Error("This preview tool is local-only.");
const root = await realpath(".local-assets");
const path = await realpath(resolve(process.argv[2] ?? ""));
if (!path.startsWith(root + sep) || !path.endsWith(".glb"))
  throw new Error("Choose a local GLB inside .local-assets.");
const model = await readFile(path);
await validateMedia("glb", "preview.glb", "model/gltf-binary", model);
const runtime = await readFile(
  new URL(
    "../node_modules/@google/model-viewer/dist/model-viewer.min.js",
    import.meta.url,
  ),
);
let poster;
try {
  poster = await readFile(resolve(dirname(path), "yakitori-poster.webp"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const port = Number(process.env.LOCAL_MODEL_PORT ?? "3015");
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Choose a local preview port between 1024 and 65535.");
const nonce = randomBytes(24).toString("base64");
const html = `<!doctype html><html lang="pt-PT"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Restaurant OS · Pré-visualização local</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#f6f4ee;color:#243e32;font-family:system-ui,sans-serif}main{max-width:1020px;margin:auto;padding:32px 20px}header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}small{letter-spacing:.14em;text-transform:uppercase;font-size:10px}h1{font-family:Georgia,serif;font-size:clamp(32px,6vw,54px);font-weight:400;margin:40px 0 14px}p{font-size:14px;line-height:1.7;max-width:720px}#stage{height:clamp(350px,65vh,650px);margin-top:28px;background:#efeee5;border:1px solid #deded3;border-radius:24px;overflow:hidden}#stage img{width:100%;height:100%;object-fit:contain}model-viewer{display:block;width:100%;height:100%;--progress-bar-color:#344e3d}button{min-height:48px;min-width:48px;border-radius:100px;border:1px solid #c9cdbf;padding:12px 22px;background:white;color:#243e32;font-size:14px;cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:3px solid #577b46;outline-offset:4px}.primary{background:#344e3d;color:white}nav{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}#state{min-height:28px}footer{margin-top:28px;padding-top:18px;border-top:1px solid #deded3;color:#62685c;font-size:12px}a{color:inherit} @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}</style>
<main><header><strong>Restaurant OS.</strong><small>Local · modelo não publicado</small></header>
<h1>Um olhar mais próximo.</h1><p>Modelo de stock para avaliação. A dimensão vem do ficheiro original; ainda não foi confirmada num prato real. Esta página funciona apenas neste computador e não envia o modelo para o Supabase.</p>
<div id="stage" aria-label="Pré-visualização do modelo">${poster ? '<img src="/poster.webp" alt="Imagem do modelo em avaliação">' : ""}</div>
<nav aria-label="Controlos do modelo"><button id="open" class="primary">Explorar em 3D</button><button id="less" disabled aria-label="Afastar modelo">−</button><button id="reset" disabled>Repor vista</button><button id="more" disabled aria-label="Aproximar modelo">+</button><button id="photo" disabled>Voltar à imagem</button></nav>
<p id="state" role="status" aria-live="polite">Arrasta para rodar. Usa dois dedos ou a roda do rato para aproximar.</p><p id="dimensions"></p>
<footer>AR desativada até revisão da licença e da escala física. A pré-visualização não altera produtos, preços, personalizações ou encomendas.</footer></main>
<script type="module" nonce="${nonce}">
const stage=document.querySelector('#stage'),status=document.querySelector('#state'),open=document.querySelector('#open');
let viewer,attempt=0;
const buttons=['less','reset','more','photo'].map(id=>document.getElementById(id));
function controls(enabled){for(const b of buttons)b.disabled=!enabled;}
function cleanup(){if(viewer){viewer.pause();viewer.removeAttribute('src');viewer.remove();viewer=undefined;}controls(false);document.querySelector('#dimensions').textContent='';}
open.addEventListener('click',async()=>{
cleanup();open.disabled=true;status.textContent='A carregar a pré-visualização…';
try{const {ModelViewerElement}=await import('/model-viewer.js');ModelViewerElement.modelCacheSize=0;
viewer=document.createElement('model-viewer');viewer.setAttribute('alt','Modelo 3D local para avaliação; escala ainda não confirmada');
for(const [k,v] of Object.entries({'camera-controls':'','camera-orbit':'30deg 55deg 115%','min-camera-orbit':'auto 10deg 55%','max-camera-orbit':'auto 100deg 200%','touch-action':'pan-y','environment-image':'neutral','shadow-intensity':'0.8','shadow-softness':'0.9','exposure':'1','interaction-prompt':'none','interpolation-decay':matchMedia('(prefers-reduced-motion:reduce)').matches?'0':'50'}))viewer.setAttribute(k,v);
viewer.addEventListener('load',()=>{controls(true);open.disabled=false;open.textContent='Recarregar modelo';status.textContent='Modelo carregado. Arrasta para rodar; usa os controlos para aproximar.';const d=viewer.getDimensions();document.querySelector('#dimensions').textContent='Dimensão de origem: '+[d.x,d.y,d.z].map(n=>(n*100).toFixed(1)).join(' × ')+' cm (largura × altura × profundidade).';});
viewer.addEventListener('error',()=>{cleanup();open.disabled=false;status.textContent='Não foi possível carregar o modelo. Podes tentar novamente.';});
viewer.setAttribute('src','/model.glb?attempt='+ ++attempt);stage.replaceChildren(viewer);
}catch{cleanup();open.disabled=false;status.textContent='A pré-visualização 3D não está disponível neste navegador.';}
});
document.querySelector('#less').onclick=()=>viewer?.zoom(-1);document.querySelector('#more').onclick=()=>viewer?.zoom(1);
document.querySelector('#reset').onclick=()=>{viewer?.setAttribute('camera-orbit','30deg 55deg 115%');viewer?.jumpCameraToGoal();};
document.querySelector('#photo').onclick=()=>{cleanup();stage.innerHTML=${JSON.stringify(poster ? '<img src="/poster.webp" alt="Imagem do modelo em avaliação">' : "")};open.textContent='Explorar em 3D';status.textContent='Pré-visualização terminada. O modelo continua apenas local.';};
window.addEventListener('pagehide',cleanup);
</script></html>`;
const resources = new Map([
  ["/", [Buffer.from(html), "text/html; charset=utf-8"]],
  ["/model.glb", [model, "model/gltf-binary"]],
  ["/model-viewer.js", [runtime, "text/javascript"]],
  ...(poster ? [["/poster.webp", [poster, "image/webp"]]] : []),
]);
const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob: data:; worker-src blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
  );
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), xr-spatial-tracking=()",
  );
  if (
    !["127.0.0.1:" + port, "localhost:" + port].includes(
      request.headers.host,
    ) ||
    request.headers["sec-fetch-site"] === "cross-site"
  ) {
    response.writeHead(403).end();
    return;
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const found = resources.get(
    new URL(request.url, "http://localhost").pathname,
  );
  if (!found) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": found[1],
    "Content-Length": found[0].length,
  });
  response.end(request.method === "HEAD" ? undefined : found[0]);
});
server.on("error", (error) => {
  console.error("Local preview failed:", error.code);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Local-only preview: http://localhost:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close());
