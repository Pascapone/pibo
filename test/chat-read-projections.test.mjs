import {ChatReadStateService} from "../dist/apps/chat/data/read-state-service.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {CHAT_READ_PROJECTION_SCHEMA,ChatReadProjectionStore} from '../dist/data/chat-read-projections.js';
import {PiboDataStore} from '../dist/data/pibo-store.js';
import {ChatHistoryQueryService} from '../dist/apps/chat/data/history-query-service.js';
import {ChatTimelineQueryService} from '../dist/apps/chat/data/timeline-query-service.js';

test('bounded history backfill resumes and merges concurrent insert update and delete without duplicate counts',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE event_log(stream_id INTEGER PRIMARY KEY,session_id TEXT,session_sequence INTEGER,type TEXT,retention_class TEXT);
   CREATE TABLE app_session_read_state(session_id TEXT PRIMARY KEY,last_read_stream_id INTEGER);
   CREATE TABLE chat_messages(id TEXT PRIMARY KEY,session_id TEXT,sequence INTEGER,source_stream_id INTEGER,role TEXT,created_at TEXT);`);
  const add=db.prepare("INSERT INTO chat_messages VALUES(?, 'session', ?, NULL, 'user', '2026-09-07')");
  for(let i=1;i<=400;i++)add.run('m'+i,i);
  db.exec(CHAT_READ_PROJECTION_SCHEMA);const maintenance=new ChatReadProjectionStore(db);
  const first=maintenance.step(17,1000);assert.equal(first.processed,17);assert.equal(first.cursor,17);
  maintenance.setPaused(true);assert.equal(maintenance.step().processed,0);
  add.run('new',401);db.exec("UPDATE chat_messages SET sequence=999 WHERE id='m300'; DELETE FROM chat_messages WHERE id='m350'");
  maintenance.setPaused(false);
  for(let i=0;i<100&&!maintenance.status().complete;i++)maintenance.step(17,1000);
  assert.equal(maintenance.status().complete,true);
  assert.equal(db.prepare("SELECT message_count FROM chat_history_counts WHERE session_id='session'").get().message_count,400);
  assert.equal(db.prepare("SELECT event_sequence FROM chat_history_index WHERE message_id='m300'").get().event_sequence,999);
  assert.equal(maintenance.step().processed,0);
 }finally{db.close();}
});
test('history coverage and keyset pages use indexed edges and preserve page boundaries',()=>{
 const store=new PiboDataStore(':memory:',{payloadRootDir:':memory:'});
 try{
  for(let i=1;i<=100;i++)store.messages.insertMessage({id:'m'+i,sessionId:'session',sequence:i,role:'user',status:'complete',createdAt:'2026-09-07',contentPreview:'text '+i});
  const history=new ChatHistoryQueryService(store);const coverage=history.getProductHistoryCoverage('session');
  assert.equal(coverage.messageCount,100);assert.equal(coverage.complete,true);assert.equal(coverage.firstEventSequence,1);assert.equal(coverage.lastEventSequence,100);
  const sql=[];const prepare=store.db.prepare.bind(store.db);store.db.prepare=text=>{sql.push(text);return prepare(text);};
  assert.deepEqual(history.listProductHistoryEntries({piboSessionId:'session',beforeSequence:51,limit:3}).map(x=>x.sequence),[48,49,50]);
  const pageSql=sql.find(s=>s.includes('JOIN chat_messages'));
  const plan=prepare('EXPLAIN QUERY PLAN '+pageSql).all('session',51,3).map(x=>x.detail).join(' ');
  assert.match(plan,/idx_chat_history_index_session_event/);assert.doesNotMatch(plan,/TEMP B-TREE/);
  const timeline=new ChatTimelineQueryService(store);timeline.scanMessageTurnTimings('session');
  const timingSql=sql.find(s=>s.includes('INDEXED BY idx_event_log_timing_sequence'));
  const timingPlan=prepare('EXPLAIN QUERY PLAN '+timingSql).all('session',501).map(x=>x.detail).join(' ');
  assert.match(timingPlan,/idx_event_log_timing_sequence/);assert.doesNotMatch(timingPlan,/TEMP B-TREE/);
 }finally{store.close();}
});

 test('unread projection follows completed turns and monotonic read markers without a polling history scan',()=>{
  const store=new PiboDataStore(':memory:',{payloadRootDir:':memory:'});
  try{
   const reads=new ChatReadStateService(store);const ids=['session'];
   const event=(type,retentionClass='chat_message')=>store.eventLog.appendEvent({sessionId:'session',topic:'pibo.output',source:'test',type,retentionClass});
   event('user.message.accepted');event('assistant_message');event('session_error','trace_event');event('tool_execution_finished','trace_event');
   assert.equal(reads.countUnreadMessagesBySession({piboSessionIds:ids}).size,0);
   const first=event('message_finished');event('assistant_message');const second=event('message_finished');
   assert.equal(reads.countUnreadMessagesBySession({piboSessionIds:ids}).get('session'),2);
   reads.markSessionRead('session',first.streamId);assert.equal(reads.countUnreadMessagesBySession({piboSessionIds:ids}).get('session'),1);
   reads.markSessionRead('session',second.streamId);assert.equal(reads.countUnreadMessagesBySession({piboSessionIds:ids}).size,0);
   reads.markSessionRead('session',first.streamId);assert.equal(reads.countUnreadMessagesBySession({piboSessionIds:ids}).size,0);
   const newEvent=event('message_finished');assert.equal(reads.countUnreadMessagesBySession({piboSessionIds:ids}).get('session'),1);
   store.db.prepare('DELETE FROM event_log WHERE stream_id=?').run(newEvent.streamId);assert.equal(reads.countUnreadMessagesBySession({piboSessionIds:ids}).size,0);
   const prepare=store.db.prepare.bind(store.db);store.db.prepare=sql=>{assert.doesNotMatch(sql,/FROM event_log/);return prepare(sql);};
   reads.countUnreadMessagesBySession({piboSessionIds:ids});
  }finally{store.close();}
 });
 test('unread backfill resumes beside newer completed turns and preserves read markers',()=>{
  const store=new PiboDataStore(':memory:',{payloadRootDir:':memory:'});
  try{
   store.db.exec('DROP TRIGGER chat_unread_event_insert');
   for(let i=0;i<75;i++)store.eventLog.appendEvent({sessionId:'session',topic:'pibo.output',source:'test',type:'message_finished',retentionClass:'chat_message'});
   store.db.exec('UPDATE chat_read_backfill SET event_target=75,event_cursor=0');store.db.exec(CHAT_READ_PROJECTION_SCHEMA);
   const reads=new ChatReadStateService(store);reads.markSessionRead('session',50);const maintenance=new ChatReadProjectionStore(store.db);
   assert.equal(reads.countUnreadMessagesBySession({piboSessionIds:['session']}).get('session'),25);
   maintenance.step(7,1000);maintenance.setPaused(true);assert.equal(maintenance.step().processed,0);maintenance.setPaused(false);
   store.eventLog.appendEvent({sessionId:'session',topic:'pibo.output',source:'test',type:'message_finished',retentionClass:'chat_message'});
   for(let i=0;i<30&&!maintenance.status().complete;i++)maintenance.step(7,1000);
   assert.equal(maintenance.status().complete,true);assert.equal(reads.countUnreadMessagesBySession({piboSessionIds:['session']}).get('session'),26);
  }finally{store.close();}
 });
