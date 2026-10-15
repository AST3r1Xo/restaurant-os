import {createClient} from '@supabase/supabase-js';
if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Set the project URL and server-only media key in .env.local.');
const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const id='restaurant-media',options={public:true,fileSizeLimit:4_000_000,allowedMimeTypes:['image/webp','model/gltf-binary','model/vnd.usdz+zip']};
const {data,error}=await client.storage.getBucket(id);
if(error&&error.status!=='404'&&Number(error.status)!==404&&!/not found/i.test(error.message))throw new Error('Could not inspect the media bucket.');
const result=data?await client.storage.updateBucket(id,options):await client.storage.createBucket(id,options);
if(result.error)throw new Error(`Could not configure the media bucket (${result.error.status??'storage error'}).`);
console.log('restaurant-media configured: public read, 4 MB, validated WebP / GLB / USDZ. Apply the menu administration migration to enforce gateway-only writes.');
