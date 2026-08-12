const CACHE='fm24-tactics-v1.0.0';
const ASSETS=['./','./index.html','./engine.js','./importer.js','./data/roles.js','./data/formations.js','./data/tactics.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));
self.addEventListener('message',event=>{if(event.data&&event.data.type==='SKIP_WAITING')self.skipWaiting();});
// 이 앱은 서버에서 받아 오는 데이터가 없습니다. 전부 앱 셸이므로 캐시 우선으로 두고,
// 새 버전은 CACHE 이름이 바뀔 때 install에서 통째로 받습니다.
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;
  event.respondWith(
    caches.match(event.request).then(hit=>hit||fetch(event.request).then(res=>{
      if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}
      return res;
    }).catch(()=>event.request.mode==='navigate'?caches.match('./index.html'):Response.error()))
  );
});
