import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const setup = `
 import assert from 'node:assert/strict';
 import { RoomMutationTracker } from './src/apps/chat-ui/src/app-room-mutations.ts';
 const tracker = new RoomMutationTracker();
 const a = { id:'a', name:'Original', topic:'Topic', workspace:'/old', metadata:{workspace:'/old',chatRoomPinnedAt:'pinned'}, children:[{id:'child',name:'Child'}], unreadCount:3, updatedAt:'2026-09-06T00:00:00.000Z' };
 const b = { ...a, id:'b', name:'Other' };
 const session = {id:'session',status:'running'};
 const base = { room:a, rooms:[a,b], session, sessions:[session], selectedRoomId:'a', selectedPiboSessionId:'session' };
 const response = (name) => ({...a,name,updatedAt:'2026-09-06T00:00:01.000Z'});
`;
function scenario(name, body) {
 test(name, async () => {
  await assert.doesNotReject(exec(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", setup + body], {cwd:process.cwd()}));
 });
}

scenario("Room field settlement preserves children, unread counts, selection, Session content, and unrelated metadata", `
 const mutation=tracker.begin(a,{name:'Renamed'});
 const fresh={...base,room:{...a,unreadCount:7,metadata:{...a.metadata,newSignal:1}},rooms:[{...a,unreadCount:7,metadata:{...a.metadata,newSignal:1}},b]};
 const next=tracker.settle(mutation,response('Normalized'))(tracker.apply(fresh));
 assert.equal(next.room.name,'Normalized');assert.equal(next.room.unreadCount,7);
 assert.equal(next.room.metadata.newSignal,1);assert.equal(next.room.metadata.chatRoomPinnedAt,'pinned');
 assert.equal(next.room.children,a.children);assert.equal(next.session,session);assert.equal(next.sessions,base.sessions);
 assert.equal(next.selectedPiboSessionId,base.selectedPiboSessionId);
 assert.equal(next.room.updatedAt,'2026-09-06T00:00:01.000Z');
 assert.equal(tracker.apply(next),next,'settled fields must not leave persistent overlays');
`);
scenario("A failed Room edit cannot roll back another Room or newer navigation", `
 const mutation=tracker.begin(a,{name:'Pending'});
 const newerB={...b,name:'Concurrent saved name'};
 const newer={...base,room:newerB,rooms:[a,newerB],selectedRoomId:'b',selectedPiboSessionId:'new-session',session:{id:'new-session'}};
 const next=tracker.settle(mutation)(tracker.apply(newer));
 assert.equal(next.room,newerB);assert.equal(next.rooms[1],newerB);assert.equal(next.rooms[0].name,'Original');
 assert.equal(next.selectedRoomId,'b');assert.equal(next.session,newer.session);
`);
scenario("Overlapping Room edits settle correctly in both response orders and all success/failure combinations", `
 for (const reverse of [false,true]) for (const firstSuccess of [false,true]) for (const secondSuccess of [false,true]) {
  const t=new RoomMutationTracker();let data=base;
  const first=t.begin(a,{name:'First'});data=t.apply(data);
  const second=t.begin(data.room,{name:'Second'});data=t.apply(data);
  assert.equal(data.room.name,'Second');
  const operations=[[first,firstSuccess?response('First normalized'):undefined],[second,secondSuccess?response('Second normalized'):undefined]];
  if(reverse)operations.reverse();
  data=t.settle(...operations[0])(data);
  assert.equal(data.room.name,reverse?(secondSuccess?'Second normalized':'First'):'Second');
  data=t.settle(...operations[1])(data);
  assert.equal(data.room.name,secondSuccess?'Second normalized':firstSuccess?'First normalized':'Original');
  assert.equal(t.apply(data),data);
 }
`);
scenario("Cleared fields remain cleared, including their Room metadata representation", `
 const first=tracker.begin(a,{topic:'Pending',workspace:'/new'});
 let data=tracker.apply(base);
 const second=tracker.begin(data.room,{topic:null,workspace:null});data=tracker.apply(data);
 assert.equal(data.room.topic,undefined);assert.equal(data.room.workspace,undefined);assert.equal('workspace' in data.room.metadata,false);
 data=tracker.settle(second,{...response('Original'),topic:undefined,workspace:undefined,metadata:{}})(data);
 data=tracker.settle(first)(data);
 assert.equal(data.room.topic,undefined);assert.equal(data.room.workspace,undefined);assert.equal(data.room.metadata.chatRoomPinnedAt,'pinned');
`);
scenario("Completed fields stop overriding fresh navigation while other fields remain pending", `
 const name=tracker.begin(a,{name:'Saved'});
 const archive=tracker.begin(a,{archived:true});
 let data=tracker.settle(name,response('Saved'))(tracker.apply(base));
 const newer={...data,room:{...data.room,name:'Later external name'},rooms:[{...data.rooms[0],name:'Later external name'},b]};
 data=tracker.apply(newer);assert.equal(data.room.name,'Later external name');assert.ok(data.room.metadata.chatRoomArchivedAt);
 data=tracker.settle(archive)(data);
 assert.equal(data.room.name,'Later external name');assert.equal(data.room.metadata.chatRoomArchivedAt,undefined);
`);
scenario("Pending fields survive navigation data without replacing fresh Session or Room summary data", `
 const mutation=tracker.begin(a,{name:'Pending'});
 const updatedSession={...session,status:'streaming'};
 const fresh={...base,session:updatedSession,room:{...a,unreadCount:8}};
 const next=tracker.apply(fresh);
 assert.equal(next.room.name,'Pending');assert.equal(next.room.unreadCount,8);assert.equal(next.session,updatedSession);
 tracker.settle(mutation);
`);
scenario("A failed rename preserves a concurrently confirmed archive", `
 const rename=tracker.begin(a,{name:'Pending'});
 const archive=tracker.begin(a,{archived:true});
 let data=tracker.apply(base);
 data=tracker.settle(archive,{...response('Pending'),metadata:{chatRoomArchivedAt:'server-archive'}})(data);
 data=tracker.settle(rename)(data);
 assert.equal(data.room.name,'Original');assert.equal(data.room.metadata.chatRoomArchivedAt,'server-archive');
 assert.equal(data.room.metadata.chatRoomPinnedAt,'pinned');
`);
