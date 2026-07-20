// 自動產生 App Store 截圖（iPhone 6.7"：1284×2778，用 428×926 CSS px × 3 倍畫素密度直接拍出正確解析度）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'store-assets', 'screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 428, height: 926 },
    deviceScaleFactor: 3,
    locale: 'zh-TW'
  });
  const page = await context.newPage();
  await page.goto('https://jiuhaogo.vercel.app/app/', { waitUntil: 'networkidle' });

  // 建立示範寶貝資料，讓截圖畫面看起來是「有在用」的樣子
  await page.evaluate(() => {
    $('ob-name').value = '波比';
    $('ob-type').value = '狗';
    $('ob-breed').value = '柯基・3 歲・男生';
    savePet();
  });
  await page.waitForTimeout(2200); // 等歡迎提示（toast）自動消失，避免蓋住畫面

  const shots = [
    { tab: 'home',  file: '01-動態牆.png',   wait: 600 },
    { tab: 'walk',  file: '02-揪團地圖.png', wait: 1500 }, // 等即時天氣 API 回來
    { tab: 'match', file: '03-配對交友.png', wait: 400 },
    { tab: 'dog',   file: '04-我的寶貝.png', wait: 400 },
    { tab: 'serve',  file: '05-服務.png',     wait: 400 }
  ];

  for (const s of shots) {
    await page.evaluate((tab) => switchTab(tab), s.tab);
    await page.waitForTimeout(s.wait);
    await page.screenshot({ path: path.join(OUT_DIR, s.file) });
    console.log('已拍攝', s.file);
  }

  await browser.close();
  console.log('全部完成，輸出於', OUT_DIR);
})();
