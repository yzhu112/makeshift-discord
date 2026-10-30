import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionState,
  type LocalAudioTrack,
  type Participant,
  type RemoteAudioTrack,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';

import { RnnoiseProcessor } from './rnnoise';
import { PresenceSounds } from '@/audio/PresenceSounds';
import { muteForMicrophoneTest } from '@/audio/callTestMute';
import { startMicrophone, microphoneIssue, type MicrophoneIssue } from '@/audio/startMicrophone';

import { captureOptions, savedNoiseMode, saveNoiseMode, type NoiseMode } from '@/audio/preferences';

const ROOM_OPTIONS = {
  // Web Audio gain supports amplification above the media element limit of 100%.
  webAudioMix: true,
  audioCaptureDefaults: captureOptions('browser'),
  publishDefaults: {
    audioPreset: { maxBitrate: 96_000 },
    dtx: false,
    red: true,
  },
};

export type ChatMessage = {
  id: string;
  sender: string;
  text: string;
  ts: number;
};

export type RoomState = {
  connectionState: ConnectionState;
  canPlaybackAudio: boolean;
  participants: Participant[];
  activeSpeakerIds: Set<string>;
  lastSpoke: Map<string, number>;
  isMuted: boolean;
  microphoneIssue: MicrophoneIssue | null;
  audioTracks: RemoteAudioTrack[];
  messages: ChatMessage[];
};

const DISCONNECTED: RoomState = {
  connectionState: ConnectionState.Disconnected,
  canPlaybackAudio: true,
  participants: [],
  activeSpeakerIds: new Set(),
  lastSpoke: new Map(),
  isMuted: true,
  microphoneIssue: null,
  audioTracks: [],
  messages: [],
};

// Chat travels over LiveKit reliable data packets. Those must stay under
// ~15 KiB including LiveKit's own framing, so we cap the encoded payload a
// little below that. Measured in UTF-8 bytes so non-Latin text counts right.
const CHAT_TOPIC = 'chat';
const MAX_CHAT_BYTES = 13_000;
const RECEIVED_TEXT_CLAMP = 4_000; // defensive cap on untrusted incoming text
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function useRoom() {
  const roomRef = useRef<Room | null>(null);
  const presenceSoundsRef = useRef<PresenceSounds | null>(null);
  const [microphoneBusy, setMicrophoneBusy] = useState(false);
  const microphoneBusyRef = useRef(false);
  const [noiseMode, setNoiseMode] = useState<NoiseMode>(savedNoiseMode);
  const noiseModeRef = useRef(noiseMode);
  const [noiseBusy, setNoiseBusy] = useState(true);
  const noiseBusyRef = useRef(false);
  const noiseQueue = useRef<Promise<void>>(Promise.resolve());
  const [noiseNotice, setNoiseNotice] = useState<'fallback' | 'error' | 'restore' | null>(null);
  const testMuteRef = useRef<object | null>(null);
  const [isTestingMicrophone, setIsTestingMicrophone] = useState(false);
  const [state, setState] = useState<RoomState>(DISCONNECTED);

  const applyNoiseMode = useCallback(async (room: Room, mode: NoiseMode) => {
    if (roomRef.current !== room) return;
    const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined;
    if (!track) throw new Error('Microphone unavailable');
    const browserFallback = async () => {
      if (roomRef.current !== room) return;
      await track.stopProcessor();
      if (roomRef.current !== room) return;
      await track.restartTrack(captureOptions('browser'));
      if (roomRef.current !== room) { track.stop(); return; }
      setNoiseMode('browser');
      setNoiseNotice('fallback');
    };
    await track.stopProcessor();
    if (roomRef.current !== room) return;
    if (mode === 'rnnoise') {
      const processor = new RnnoiseProcessor(() => {
        // Serialize failures with setup and user changes; ignore an obsolete processor.
        noiseQueue.current = noiseQueue.current.catch(() => {}).then(async () => {
          if (roomRef.current !== room || track.getProcessor() !== processor) return;
          noiseBusyRef.current = true;
          setNoiseBusy(true);
          try { await browserFallback(); }
          catch { if (roomRef.current === room) setNoiseNotice('error'); }
          finally {
            noiseBusyRef.current = false;
            if (roomRef.current === room) setNoiseBusy(false);
          }
        });
      });
      try {
        await track.restartTrack(captureOptions(mode));
        if (roomRef.current !== room) { track.stop(); return; }
        await track.setProcessor(processor);
      } catch {
        await processor.destroy();
        await browserFallback();
        return;
      }
    } else {
      await track.restartTrack(captureOptions(mode));
    }
    if (roomRef.current !== room) { track.stop(); return; }
    setNoiseMode(mode);
    setNoiseNotice(null);
  }, []);

  const changeNoiseMode = useCallback(async (mode: NoiseMode) => {
    const room = roomRef.current;
    if (!room || noiseBusyRef.current) return;
    noiseBusyRef.current = true;
    setNoiseBusy(true);
    try {
      const operation = noiseQueue.current.catch(() => {}).then(async () => {
        if (room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track) await applyNoiseMode(room, mode);
        else if (roomRef.current === room) setNoiseMode(mode);
      });
      noiseQueue.current = operation;
      await operation;
      if (roomRef.current !== room) return;
      noiseModeRef.current = mode;
      saveNoiseMode(mode);
    } catch {
      if (roomRef.current === room) setNoiseNotice('error');
    } finally {
      noiseBusyRef.current = false;
      if (roomRef.current === room) setNoiseBusy(false);
    }
  }, [applyNoiseMode]);

  const enableMicrophone = useCallback(async (room: Room) => {
    if (microphoneBusyRef.current || roomRef.current !== room) return;
    microphoneBusyRef.current = true;
    setMicrophoneBusy(true);
    try {
      const result = await startMicrophone(room.localParticipant, async () => {
        const operation = noiseQueue.current.catch(() => {}).then(() => applyNoiseMode(room, noiseModeRef.current));
        noiseQueue.current = operation;
        await operation;
      }, () => roomRef.current === room);
      if (roomRef.current !== room) return;
      setState(s => ({ ...s, isMuted: !room.localParticipant.isMicrophoneEnabled, microphoneIssue: result.issue }));
      if (result.noiseFailed) setNoiseNotice('error');
    } finally {
      if (roomRef.current === room) {
        microphoneBusyRef.current = false;
        setMicrophoneBusy(false);
        setNoiseBusy(false);
      }
    }
  }, [applyNoiseMode]);

  const connect = useCallback(async (url: string, token: string, observe?: (room: Room) => void) => {
    const sounds = new PresenceSounds();
    presenceSoundsRef.current = sounds;
    const room = new Room({ ...ROOM_OPTIONS, webAudioMix: sounds.context ? { audioContext: sounds.context } : true });
    let joined = false;
    const playPresence = (kind: 'join' | 'leave') => {
      if (joined && roomRef.current === room && room.state === ConnectionState.Connected) sounds.play(kind);
    };
    roomRef.current = room;
    observe?.(room);

    const getAll = (): Participant[] => [
      room.localParticipant,
      ...Array.from(room.remoteParticipants.values()),
    ];

    room
      .on(RoomEvent.AudioPlaybackStatusChanged, () =>
        setState(s => ({ ...s, canPlaybackAudio: room.canPlaybackAudio })),
      )
      .on(RoomEvent.ConnectionStateChanged, (cs) => {
        if (cs !== ConnectionState.Connected) sounds.silence();
        setState((s) => ({ ...s, connectionState: cs }));
      })
      .on(RoomEvent.Disconnected, () => sounds.close())
      .on(RoomEvent.ParticipantConnected, () => {
        playPresence('join');
        setState((s) => ({ ...s, participants: getAll() }));
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        playPresence('leave');
        setState((s) => {
          const lastSpoke = new Map(s.lastSpoke);
          lastSpoke.delete(participant.identity);
          const activeSpeakerIds = new Set(s.activeSpeakerIds);
          activeSpeakerIds.delete(participant.identity);
          return { ...s, participants: getAll(), lastSpoke, activeSpeakerIds };
        });
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const now = performance.now();
        setState((s) => {
          const lastSpoke = new Map(s.lastSpoke);
          // Include speakers who just stopped: their last speech happened now too.
          for (const identity of s.activeSpeakerIds) lastSpoke.set(identity, now);
          for (const participant of speakers) lastSpoke.set(participant.identity, now);
          return { ...s, lastSpoke, activeSpeakerIds: new Set(speakers.map(p => p.identity)) };
        });
      })
      .on(RoomEvent.TrackMuted, () =>
        setState((s) => ({ ...s, participants: getAll() })),
      )
      .on(RoomEvent.TrackUnmuted, () =>
        setState((s) => ({ ...s, participants: getAll() })),
      )
      .on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          setState((s) => ({
            ...s,
            audioTracks: [...s.audioTracks, track as RemoteAudioTrack],
          }));
        }
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          setState((s) => ({
            ...s,
            audioTracks: s.audioTracks.filter((t) => t !== track),
          }));
        }
      })
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (topic !== CHAT_TOPIC) return;
        let text: unknown;
        try {
          text = (JSON.parse(decoder.decode(payload)) as { text?: unknown })
            .text;
        } catch {
          return; // ignore malformed packets
        }
        if (typeof text !== 'string') return;
        // Trust LiveKit's authenticated identity for the sender, not the
        // payload — clamp the untrusted text defensively.
        const clean = text.slice(0, RECEIVED_TEXT_CLAMP);
        if (!clean) return;
        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          sender: participant?.identity ?? '?',
          text: clean,
          ts: Date.now(),
        };
        setState((s) => ({ ...s, messages: [...s.messages, msg] }));
      });

    try { await room.connect(url, token); }
    catch (error) { sounds.close(); throw error; }
    joined = true;
    if (roomRef.current !== room) { await room.disconnect(); return; }
    const audioTracks: RemoteAudioTrack[] = [];
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) {
        if (pub.track) audioTracks.push(pub.track as RemoteAudioTrack);
      }
    }

    setState((s) => ({
      ...s,
      connectionState: room.state,
      canPlaybackAudio: room.canPlaybackAudio,
      participants: getAll(),
      activeSpeakerIds: new Set(),
      isMuted: !room.localParticipant.isMicrophoneEnabled,
      microphoneIssue: null,
      audioTracks,
    }));
    await enableMicrophone(room);
  }, [enableMicrophone]);

  const startAudio = useCallback(async () => {
    await roomRef.current?.startAudio();
  }, []);

  const disconnect = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    room?.removeAllListeners();
    void room?.disconnect();
    presenceSoundsRef.current?.close();
    presenceSoundsRef.current = null;
    microphoneBusyRef.current = false;
    setMicrophoneBusy(false);
    setState(DISCONNECTED);
  }, []);

  const beginMicrophoneTest = useCallback(async () => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected || testMuteRef.current || microphoneBusyRef.current) throw new Error('Call unavailable');
    const token = {};
    testMuteRef.current = token;
    setIsTestingMicrophone(true);
    const isCurrent = () => roomRef.current === room && testMuteRef.current === token;
    const finish = () => {
      if (testMuteRef.current === token) {
        testMuteRef.current = null;
        setIsTestingMicrophone(false);
      }
    };
    try {
      const restore = await muteForMicrophoneTest(room.localParticipant, isCurrent, muted => setState(s => ({ ...s, isMuted: muted })));
      return async () => {
        try { await restore(); }
        catch (error) {
          if (isCurrent()) setNoiseNotice('restore');
          throw error;
        } finally { finish(); }
      };
    } catch (error) {
      if (isCurrent()) setNoiseNotice('restore');
      finish();
      throw error;
    }
  }, []);

  const toggleMute = useCallback(async () => {
    if (testMuteRef.current || microphoneBusyRef.current || noiseBusyRef.current) return;
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;
    if (!room.localParticipant.isMicrophoneEnabled) {
      await enableMicrophone(room);
      return;
    }
    microphoneBusyRef.current = true;
    setMicrophoneBusy(true);
    try {
      await room.localParticipant.setMicrophoneEnabled(false);
      if (roomRef.current === room) setState(s => ({ ...s, isMuted: true, microphoneIssue: null }));
    } catch (error) {
      if (roomRef.current === room) setState(s => ({ ...s, isMuted: !room.localParticipant.isMicrophoneEnabled, microphoneIssue: microphoneIssue(error) }));
    } finally {
      if (roomRef.current === room) {
        microphoneBusyRef.current = false;
        setMicrophoneBusy(false);
      }
    }
  }, [enableMicrophone]);

  const sendMessage = useCallback(async (text: string) => {
    const room = roomRef.current;
    const trimmed = text.trim();
    if (!room || !trimmed) return;

    const payload = encoder.encode(JSON.stringify({ text: trimmed }));
    if (payload.length > MAX_CHAT_BYTES) {
      throw new Error('message too large');
    }
    await room.localParticipant.publishData(payload, {
      reliable: true,
      topic: CHAT_TOPIC,
    });
    // LiveKit doesn't deliver our own data back to us — reflect it locally.
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      sender: room.localParticipant.identity,
      text: trimmed,
      ts: Date.now(),
    };
    setState((s) => ({ ...s, messages: [...s.messages, msg] }));
  }, []);

  useEffect(
    () => () => {
      const room = roomRef.current;
      roomRef.current = null;
      room?.removeAllListeners();
      void room?.disconnect();
      presenceSoundsRef.current?.close();
      presenceSoundsRef.current = null;
    },
    [],
  );

  return { microphoneBusy, startAudio, beginMicrophoneTest, isTestingMicrophone, state, connect, disconnect, toggleMute, sendMessage, noiseMode, noiseBusy, noiseNotice, changeNoiseMode };
}
