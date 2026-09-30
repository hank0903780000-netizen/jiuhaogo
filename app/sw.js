const CACHE='jhg-complete-v8';
const CORE=['./','./privacy.html','./vendor/leaflet/images/layers.png','./vendor/leaflet/images/layers-2x.png','./vendor/leaflet/images/marker-icon.png','./vendor/leaflet/images/marker-icon-2x.png','./vendor/leaflet/images/marker-shadow.png','./index.html','./social.css','./features.css','./config.js','./manifest.json','./icon.svg','./icon-192.png','./icon-512.png','./js/main.mjs','./js/domain.mjs','./js/repository.mjs','./js/maps.mjs','./js/backup.mjs','./data/parks.json','./vendor/leaflet/leaflet.js','./vendor/leaflet/leaflet.css','./vendor/supabase.js','./vendor/capacitor.js','./vendor/capacitor-camera.js','./assets/shiba-portrait.png','./assets/dog-friends.png','./assets/cat-nap.png'];
const resources=new Set(CORE.map(p=>new URL(p,self.location.href).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('jhg-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const req=event.request;
 // No private data, POSTs, Supabase requests or OSM tiles in offline cache.
 if(req.method!=='GET'||!resources.has(req.url))return;
 event.respondWith(fetch(req).then(response=>{
  if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,copy)));}
  return response;
 }).catch(async()=>{
  const cached=await caches.match(req);
  return cached||new Response('Offline resource unavailable',{status:503,headers:{'Content-Type':'text/plain'}});
 }));
});
