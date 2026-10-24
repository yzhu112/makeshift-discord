import assert from 'node:assert/strict';
import test from 'node:test';
import { StatsCollector, transportPath } from '../src/diagnostics/stats.ts';

test('transport classification requires relay evidence and recognizes TLS even for peer-reflexive candidates', () => {
  assert.equal(transportPath({candidateType:'host',protocol:'udp'}),'Direct UDP');
  assert.equal(transportPath({candidateType:'host',protocol:'tcp'}),'Direct TCP');
  assert.equal(transportPath({candidateType:'relay',protocol:'udp',relayProtocol:'tls'}),'TURN/TLS');
  assert.equal(transportPath({candidateType:'prflx',protocol:'udp',url:'turns:turn.example:443'}),'TURN/TLS');
  assert.equal(transportPath({candidateType:'relay',relayProtocol:'tcp'}),'TURN/TCP');
  assert.equal(transportPath({candidateType:'relay'}),'TURN');
  assert.equal(transportPath({}),'Unknown');
});

test('RTP rates use deltas; absent and reset counters never become fabricated zero quality measurements', async () => {
  globalThis.document={visibilityState:'visible'};
  let bytes=1000,packets=100,lost=0,stamp=1000;
  const report=()=>new Map([['audio',{id:'audio',type:'inbound-rtp',kind:'audio',timestamp:stamp,bytesReceived:bytes,packetsReceived:packets,packetsLost:lost,jitter:0.01,trackIdentifier:'mic'}]]);
  const room={engine:{pcManager:{subscriber:{getStats:async()=>report()}}},localParticipant:{trackPublications:new Map(),getTrackPublication:()=>undefined,identity:'me',connectionQuality:'good'},remoteParticipants:new Map(),state:'connected',canPlaybackAudio:true};
  const collector=new StatsCollector(()=>{});
  let data=await collector.sample(room);
  assert.equal(data.incomingAudio[0].bitrateKbps,null);
  assert.equal(data.incomingAudio[0].lossPercent,null);
  stamp+=2000;bytes+=6000;packets+=98;lost+=2;
  data=await collector.sample(room);
  assert.equal(data.incomingAudio[0].bitrateKbps,24);
  assert.equal(data.incomingAudio[0].lossPercent,2);
  assert.equal(data.incomingAudio[0].jitterMs,10);
  stamp+=2000;bytes=0;packets=0;lost=0;
  data=await collector.sample(room);
  assert.equal(data.incomingAudio[0].bitrateKbps,null);
  assert.equal(data.incomingAudio[0].lossPercent,null);
  collector.dispose();
});
