import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {priceMinor,validateProduct} from '../src/features/menu-admin/validation.ts';
import {validateMedia,inspectGlb,MAX_UPLOAD_BYTES} from '../src/features/menu-admin/media-validation.ts';
import {productVisualization,safeModelAsset,arAvailability} from '../src/features/ar/assets.ts';
const r=randomUUID(),p=randomUUID();
function product(){return{name:'Dish',description:'',category_id:randomUUID(),price_minor:1234,ingredients:[],allergens:[],dietary_tags:[],is_available:true,status:'draft',keep_legacy_image:false,image_asset_id:null,model_asset_id:null,model_usdz_asset_id:null,model_poster_asset_id:null,model_verified:false,model_ar_enabled:false,review:{license:'',provenance:'',measurement_notes:'',confirmed:false},groups:[]};}
test('decimal prices become exact minor units; fractional cents and ambiguous input fail',()=>{
 for(const [text,n]of [['0',0],['0.01',1],['12.30',1230],['1,05',105],['10000',1000000]])assert.equal(priceMinor(text),n);
 for(const text of ['-1','1e3','1.001','NaN','10000.01','1,000.20',''])assert.throws(()=>priceMinor(text));
});
test('product and modifier constraints are checked before mutation',()=>{
 assert.equal(validateProduct(product()).price_minor,1234);
 for(const changes of [{price_minor:NaN},{price_minor:.5},{ingredients:['']},{model_ar_enabled:true},{model_verified:true},{category_id:r+'x'}])assert.throws(()=>validateProduct({...product(),...changes}));
 const g={id:randomUUID(),name:'Bread',description:'',selection_type:'single',min_selections:1,max_selections:1,is_active:true,options:[{id:randomUUID(),name:'Brioche',price_adjustment_minor:50,is_available:true}]};
 validateProduct({...product(),groups:[g]});
 for(const changes of [{max_selections:2},{min_selections:2},{options:[]},{options:[{...g.options[0],is_available:false}]}])assert.throws(()=>validateProduct({...product(),groups:[{...g,...changes}]}));
});
test('real images are fully decoded, optimized and metadata is removed',async()=>{
 const original=await sharp({create:{width:2000,height:1000,channels:3,background:'#314d3b'}}).jpeg().withMetadata().toBuffer();
 const file=await validateMedia('photo','dish.jpg','image/jpeg',original),meta=await sharp(file.bytes).metadata();
 assert.equal(file.contentType,'image/webp');assert.equal(meta.width,1600);assert.equal(meta.exif,undefined);assert.equal(file.sha256,createHash('sha256').update(file.bytes).digest('hex'));
});
test('spoofed, malformed, unsafe and oversized uploads are rejected',async()=>{
 const png=await sharp({create:{width:10,height:10,channels:3,background:'#fff'}}).png().toBuffer();
 for(const [kind,name,mime,bytes]of [['photo','dish.svg','image/svg+xml',Buffer.from('<svg/>')],['photo','dish.jpg','image/jpeg',png],['photo','../dish.png','image/png',png],['photo','dish.png','image/png',png.subarray(0,24)],['photo','dish.png','image/png',Buffer.alloc(MAX_UPLOAD_BYTES+1)],['glb','dish.glb','model/gltf-binary',png],['usdz','dish.usdz','application/zip',png]])await assert.rejects(validateMedia(kind,name,mime,bytes));
});
let original;
test('GLB validation measures actual geometry instead of trusting supplied bounds',async()=>{
 original=await readFile('public/models/demo-mesa/eggs/avocado.glb');const d=await inspectGlb(original);assert.ok(Math.abs(d[0]-.06767037)<.00001);assert.ok(Math.abs(d[1]-.04391073)<.00001);assert.ok(Math.abs(d[2]-.1)<.00001);
 const file=await validateMedia('glb','avocado.glb','application/octet-stream',original);assert.deepEqual(file.dimensions,d);
});
function editJson(b,change){const length=b.readUInt32LE(12),json=JSON.parse(b.toString('utf8',20,20+length));change(json);let text=JSON.stringify(json);text+=' '.repeat((4-Buffer.byteLength(text)%4)%4);const chunk=Buffer.from(text),result=Buffer.alloc(20+chunk.length+b.length-20-length);b.copy(result,0,0,20);result.writeUInt32LE(result.length,8);result.writeUInt32LE(chunk.length,12);chunk.copy(result,20);b.copy(result,20+chunk.length,20+length);return result;}
test('GLB rejects external resources, compressed extensions, wrong units and unsafe geometry',async()=>{
 original??=await readFile('public/models/demo-mesa/eggs/avocado.glb');
 for(const change of [j=>j.buffers[0].uri='https://evil.test/model.bin',j=>j.images[0].uri='other.png',j=>j.extensionsRequired=['KHR_draco_mesh_compression'],j=>j.nodes[0].scale=[100,100,100],j=>j.accessors[3].count=99999999,j=>j.bufferViews[0].byteLength=99999999,j=>j.animations=[{}]])await assert.rejects(inspectGlb(editJson(original,change)));
 await assert.rejects(inspectGlb(original.subarray(0,original.length-8)));
});
// Minimal valid, aligned USDA-only USDZ used for package validation (not a dish).
function crc32(b){let c=0xffffffff;for(const byte of b){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
export function usdzFixture(name='scene.usda',text='#usda 1.0\n( metersPerUnit = 1 )\ndef Xform "Test" {}\n'){
 const n=Buffer.from(name),data=Buffer.from(text),extra=(64-((30+n.length)%64))%64,local=Buffer.alloc(30+n.length+extra);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(crc32(data),14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(n.length,26);local.writeUInt16LE(extra,28);n.copy(local,30);
 const central=Buffer.alloc(46+n.length);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc32(data),16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(n.length,28);n.copy(central,46);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(local.length+data.length,16);return Buffer.concat([local,data,central,end]);
}
test('USDZ validates aligned ZIP, scene signatures, CRC and embedded references',async()=>{
 const good=usdzFixture();await validateMedia('usdz','dish.usdz','model/vnd.usdz+zip',good);
 for(const bytes of [usdzFixture('../scene.usda'),usdzFixture('scene.usda','#usda 1.0\ndef Xform "x" ( references = @https://evil.test/a.usd@ ) {}'),usdzFixture('scene.usda','#usda 1.0\ndef Xform "x" ( references = @missing.usd@ ) {}'),good.subarray(0,good.length-1)])await assert.rejects(validateMedia('usdz','dish.usdz','application/octet-stream',bytes));
 const corrupt=Buffer.from(good);corrupt[70]^=1;await assert.rejects(validateMedia('usdz','dish.usdz','application/octet-stream',corrupt));
});
test('managed models use exact tenant/product paths; live unreviewed models remain hidden',()=>{
 const base='https://test.supabase.co',src=`${base}/storage/v1/object/public/restaurant-media/restaurants/${r}/products/${p}/models/${randomUUID()}.glb`;
 assert.equal(safeModelAsset(src,'glb',r,p,base),src);assert.equal(safeModelAsset(src,'glb',randomUUID(),p,base),undefined);
 const row={id:p,name:'Dish',model_glb_url:src,model_dimensions_m:[.2,.05,.2],model_verified:false,model_ar_enabled:false};assert.equal(productVisualization(row,r,base),undefined);const asset=productVisualization({...row,model_verified:true},r,base);assert.equal(asset.arEnabled,false);assert.equal(arAvailability(true,true,true,false),'disabled');assert.equal(productVisualization({...row,model_verified:true,model_ar_enabled:true},r,base).arEnabled,true);
});
