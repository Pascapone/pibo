type Entry={body:Uint8Array;headers:Array<[string,string]>;status:number;bytes:number};
/** Exact encoded responses; bounded independently from reconstructed trace caches. */
export class TraceResponseCache {
 private readonly entries=new Map<string,Entry>();private bytes=0;
 constructor(private readonly maximumBytes=8*1024*1024,private readonly maximumEntries=32){}
 get(key:string,request:Request):Response|undefined {
  const entry=this.entries.get(key);if(!entry)return;
  this.entries.delete(key);this.entries.set(key,entry);
  const headers=new Headers(entry.headers);headers.set("server-timing",'trace_cache;desc="watermark-hit"');
  const etag=headers.get("etag");const requested=request.headers.get("if-none-match");
  if(etag&&requested?.split(',').some(v=>v.trim()==='*'||v.trim()===etag||v.trim()==='W/'+etag))return new Response(null,{status:304,headers});
  return new Response(entry.body.slice(),{status:entry.status,headers});
 }
 async set(key:string,response:Response):Promise<void>{
  if(response.status!==200||!response.headers.get("content-type")?.includes("json"))return;
  const body=new Uint8Array(await response.clone().arrayBuffer());const bytes=body.byteLength+Buffer.byteLength(key);
  if(bytes>Math.min(this.maximumBytes,1024*1024))return;
  const previous=this.entries.get(key);if(previous)this.bytes-=previous.bytes;
  this.entries.delete(key);this.entries.set(key,{body,headers:[...response.headers.entries()],status:response.status,bytes});this.bytes+=bytes;
  while(this.bytes>this.maximumBytes||this.entries.size>this.maximumEntries){const oldest=this.entries.keys().next().value!;this.bytes-=this.entries.get(oldest)!.bytes;this.entries.delete(oldest);}
 }
 clear():void {this.entries.clear();this.bytes=0;}
 status(){return {entries:this.entries.size,bytes:this.bytes,maximumBytes:this.maximumBytes,maximumEntries:this.maximumEntries};}
}
