export class ParkMap {
  constructor(container,parks,onSelect,onError){
    if(!window.L){onError('地圖元件未載入，仍可使用公園清單。');return;}
    this.map=L.map(container,{scrollWheelZoom:false}).setView([25.005,121.30],13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).on('tileerror',()=>onError('部分地圖載入失敗；仍可使用公園清單。')).addTo(this.map);
    this.markers=new Map();
    this.parkData=new Map(parks.map(p=>[p.id,p]));
    parks.forEach(p=>{
      if(!Number.isFinite(p.lat)||!Number.isFinite(p.lng))return;
      const pet=p.pet_area==='official_listed';
      const marker=L.circleMarker([p.lat,p.lng],{radius:p.priority?12:6,color:'#fff',weight:3,fillColor:pet?'#16856b':p.large?'#f18a30':'#b5b7bf',fillOpacity:p.priority?1:0.65}).addTo(this.map);
      const box=document.createElement('div'),title=document.createElement('b'),label=document.createElement('p'),button=document.createElement('button');
      title.textContent=p.name;label.textContent=[pet?'🐾 設有寵物專區':'',p.large?'🌳 大型公園':'',p.district,'官方公園座標；專區入口與使用範圍請看現場告示'].filter(Boolean).join(' · ');button.textContent='查看這裡的揪團';button.className='btn-green btn-sm';button.onclick=()=>onSelect(p.id);box.append(title,label,button);marker.bindPopup(box);const tooltip=document.createElement('span');tooltip.textContent=(pet?'🐾 ':p.large?'🌳 ':'')+p.name;marker.bindTooltip(tooltip,{permanent:false,direction:'top',className:'park-map-label'});this.markers.set(p.id,marker);
    });
    this.filter('priority');
  }
  filter(kind){if(!this.map)return;this.kind=kind;const visible=[];for(const [id,m] of this.markers){const p=this.parkData.get(id),show=kind==='all'||(kind==='pet'?p.pet_area==='official_listed':kind==='large'?p.large:p.priority);if(show){m.addTo(this.map);visible.push(m.getLatLng());}else this.map.removeLayer(m);}if(visible.length)this.map.fitBounds(visible,{padding:[35,35],maxZoom:13});}
  show(id){if(!this.map)return;requestAnimationFrame(()=>{this.map.invalidateSize();if(id&&this.markers.has(id)){const m=this.markers.get(id);m.addTo(this.map);this.map.setView(m.getLatLng(),15);m.openPopup();}else if(!id)this.filter(this.kind||'priority');});}
  all(){this.filter('all');}
  locate(){return new Promise((resolve,reject)=>{
    if(!navigator.geolocation)return reject(new Error('此裝置不支援定位，請選擇公園'));
    navigator.geolocation.getCurrentPosition(pos=>{this.map?.setView([pos.coords.latitude,pos.coords.longitude],14);resolve(pos.coords);},()=>reject(new Error('無法取得定位，請用公園清單選擇位置')),{timeout:10000,maximumAge:60000});
  });}
}

export class PlacesMap {
  constructor(container,places,onError){
    if(!window.L){onError('地圖元件未載入，仍可使用地點清單。');return;}
    this.map=L.map(container,{scrollWheelZoom:false}).setView([24.9937,121.301],11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).on('tileerror',()=>onError('部分地圖載入失敗，仍可使用地點清單。')).addTo(this.map);
    this.places=places;this.markers=[];this.userMarker=null;this.filter('all');
  }
  filter(category){
    this.category=category;this.markers.forEach(m=>this.map.removeLayer(m));this.markers=[];
    const rows=this.places.filter(p=>(category==='all'||p.category===category)&&Number.isFinite(p.lat)&&Number.isFinite(p.lng));
    rows.forEach(p=>{
      const color=p.category==='pet'?'#16856b':p.category==='vet'?'#d85c52':p.category==='store'?'#4a8cc9':'#6f8375';
      const marker=L.circleMarker([p.lat,p.lng],{radius:p.category==='pet'?9:6,color:'#fff',weight:3,fillColor:color,fillOpacity:.9}).addTo(this.map);
      const box=document.createElement('div');box.className='place-popup';const title=document.createElement('b');title.textContent=p.name;const copy=document.createElement('p');copy.textContent=[p.district,p.subtype].filter(Boolean).join(' · ');const link=document.createElement('a');link.href=p.mapUrl;link.target='_blank';link.rel='noopener';link.textContent='開始導航';box.append(title,copy,link);marker.bindPopup(box);this.markers.push(marker);
    });
    if(rows.length)this.map.fitBounds(rows.map(p=>[p.lat,p.lng]),{padding:[24,24],maxZoom:12});
  }
  show(){requestAnimationFrame(()=>this.map?.invalidateSize());}
  locate(){return new Promise((resolve,reject)=>{
    if(!navigator.geolocation)return reject(new Error('此裝置不支援定位'));
    navigator.geolocation.getCurrentPosition(pos=>{const ll=[pos.coords.latitude,pos.coords.longitude];if(this.userMarker)this.map.removeLayer(this.userMarker);this.userMarker=L.circleMarker(ll,{radius:9,color:'#fff',weight:3,fillColor:'#2d9e5f',fillOpacity:1}).addTo(this.map).bindPopup('你目前在這裡').openPopup();this.map.setView(ll,14);resolve(pos.coords);},()=>reject(new Error('無法取得定位，請確認瀏覽器已允許位置權限')),{timeout:10000,maximumAge:60000});
  });}
}
