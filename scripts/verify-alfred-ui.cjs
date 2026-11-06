const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const results=[];
 for(const viewport of [{width:1440,height:1000},{width:430,height:932},{width:375,height:812}]){
  const page=await browser.newPage({viewport});const errors=[];const modelCalls=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/alfred'))modelCalls.push(r.url());});
  await page.goto(`${process.env.ALFRED_TEST_URL || 'http://localhost:3000'}/admin/preview#alfred/command`,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Meet Alfred.'}).waitFor();
  await page.getByRole('button',{name:'Marketing studio Turn recorded results into ideas.'}).click();
  assert.ok((await page.getByLabel('Your request').inputValue()).includes('marketing results'));
  await page.getByRole('button',{name:'Ask Alfred',exact:true}).click();
  for(const tab of ['command','approvals','activity','knowledge','controls']){
   await page.evaluate(tab=>{location.hash=`alfred/${tab}`;},tab);
   await page.waitForTimeout(160);
   const width=await page.evaluate(()=>({inner:innerWidth,scroll:document.documentElement.scrollWidth}));
   assert.ok(width.scroll<=width.inner+1,`Overflow ${JSON.stringify({viewport,tab,width})}`);
  }
  assert.equal(errors.length,0,errors.join('\n'));assert.equal(modelCalls.length,0,'Preview must never access private Alfred endpoints');
  await page.evaluate(()=>{location.hash='alfred/command'});await page.waitForTimeout(150);
  await page.screenshot({path:`/tmp/alfred-${viewport.width}.png`,fullPage:true});
  results.push({viewport:viewport.width,tabs:5,clientErrors:errors.length,privateApiCalls:modelCalls.length,horizontalOverflow:false});await page.close();
 }
 console.log(JSON.stringify(results,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});

