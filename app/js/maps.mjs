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
