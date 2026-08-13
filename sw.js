const VERSION='1.5.1';
const CACHE='fm24-tactics-'+VERSION;
const ASSETS=['./','./index.html','./engine.js','./importer.js','./data/roles.js','./data/formations.js','./data/setpieces.js','./data/traits.js','./data/tactics.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));
self.addEventListener('message',event=>{if(event.data&&event.data.type==='SKIP_WAITING')self.skipWaiting();});
/*
 * 네트워크 우선, 실패하면 캐시.
 *
 * 처음에는 캐시 우선으로 두었는데, 그러면 앱을 고쳐 배포해도 이미 한 번 연
 * 사람에게는 영영 옛 버전이 나갑니다. 실제로 가져오기 로직을 세 번 고치는 동안
 * 사용자는 계속 첫 버전을 쓰고 있었고, "합치기가 안 된다"는 증상이 그것이었습니다.
 * 앱 전체가 300KB 남짓이라 네트워크 우선의 비용은 작고, 오프라인은 캐시가 받칩니다.
 */
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;
  event.respondWith(
    fetch(event.request).then(res=>{
      if(res&&res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}
      return res;
    }).catch(()=>caches.match(event.request).then(hit=>
      hit||(event.request.mode==='navigate'?caches.match('./index.html'):Response.error())
    ))
  );
});
