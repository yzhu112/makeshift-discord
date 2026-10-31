// Browser-only LiveKit stand-in: measures lifecycle without a server or microphone.
export const ConnectionState = { Disconnected: 'disconnected', Connecting: 'connecting', Connected: 'connected', Reconnecting: 'reconnecting' };
export const RoomEvent = Object.fromEntries(['AudioPlaybackStatusChanged','ConnectionStateChanged','Disconnected','ParticipantConnected','ParticipantDisconnected','ActiveSpeakersChanged','TrackMuted','TrackUnmuted','TrackSubscribed','TrackUnsubscribed','DataReceived'].map(name => [name, name === 'Disconnected' ? 'disconnected' : name]));
export const Track = { Kind: { Audio: 'audio' }, Source: { Microphone: 'microphone' } };
const stats = window.callTest = { connects: 0, disconnects: 0, attached: 0, detached: 0, rooms: [], telemetryFinished: 0, concurrent: 0, maxConcurrent: 0 };
const input = { stopProcessor: async () => {}, restartTrack: async () => {}, stop: () => {} };
export class Room {
  handlers = new Map();
  state = ConnectionState.Disconnected;
  canPlaybackAudio = true;
  remoteParticipants = new Map();
  localParticipant = {
    identity: 'tester', isMicrophoneEnabled: false, audioTrackPublications: new Map(),
    setMicrophoneEnabled: async enabled => { this.localParticipant.isMicrophoneEnabled = enabled; },
    getTrackPublication: () => ({ track: input }),
    publishData: async () => {},
  };
  constructor() {
    const track = { sid: 'remote-audio', kind: 'audio',
      attach: el => { stats.attached++; stats.audioElement = el; },
      detach: () => { stats.detached++; },
      setVolume: value => { stats.volume = value; },
    };
    this.remoteParticipants.set('friend', { identity: 'friend', isMicrophoneEnabled: true, audioTrackPublications: new Map([['mic', { track }]]) });
    stats.rooms.push(this);
  }
  on(name, fn) { this.handlers.set(name, [...(this.handlers.get(name) || []), fn]); return this; }
  once(name, fn) { const once = (...args) => { this.off(name, once); fn(...args); }; return this.on(name, once); }
  off(name, fn) { this.handlers.set(name, (this.handlers.get(name) || []).filter(f => f !== fn)); }
  emit(name, ...args) { for (const fn of this.handlers.get(name) || []) fn(...args); }
  removeAllListeners() { this.handlers.clear(); }
  async connect() {
    stats.connects++;
    stats.concurrent++;
    stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.concurrent);
    this.state = ConnectionState.Connected;
    this.emit(RoomEvent.ConnectionStateChanged, this.state);
    this.emit('connected');
  }
  async disconnect() {
    if (this.state === ConnectionState.Disconnected) return;
    // Deliberately asynchronous: switching channels must wait for teardown.
    await new Promise(resolve => setTimeout(resolve, 60));
    this.state = ConnectionState.Disconnected;
    stats.concurrent--;
    stats.disconnects++;
    this.emit('disconnected');
  }
  async startAudio() { this.canPlaybackAudio = true; }
}
