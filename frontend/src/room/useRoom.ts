import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionState,
  type Participant,
  type RemoteAudioTrack,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
// import { NoiseGate } from './noiseGate';

const ROOM_OPTIONS = {
  audioCaptureDefaults: {
    echoCancellation: true,
    noiseSuppression: true,
    voiceIsolation: true,  // Chrome: isolates voice signal, drops non-voice background
    channelCount: 1,
  },
  publishDefaults: {
    audioPreset: { maxBitrate: 96_000 },
    dtx: false,
    red: true,
  },
};

export type RoomState = {
  connectionState: ConnectionState;
  participants: Participant[];
  activeSpeakerIds: Set<string>;
  isMuted: boolean;
  audioTracks: RemoteAudioTrack[];
};

const DISCONNECTED: RoomState = {
  connectionState: ConnectionState.Disconnected,
  participants: [],
  activeSpeakerIds: new Set(),
  isMuted: false,
  audioTracks: [],
};

export function useRoom() {
  const roomRef = useRef<Room | null>(null);
  // const noiseGateRef = useRef<NoiseGate | null>(null);
  const [state, setState] = useState<RoomState>(DISCONNECTED);

  const connect = useCallback(async (url: string, token: string) => {
    const room = new Room(ROOM_OPTIONS);
    roomRef.current = room;

    const getAll = (): Participant[] => [
      room.localParticipant,
      ...Array.from(room.remoteParticipants.values()),
    ];

    room
      .on(RoomEvent.ConnectionStateChanged, (cs) =>
        setState((s) => ({ ...s, connectionState: cs })),
      )
      .on(RoomEvent.ParticipantConnected, () =>
        setState((s) => ({ ...s, participants: getAll() })),
      )
      .on(RoomEvent.ParticipantDisconnected, () =>
        setState((s) => ({ ...s, participants: getAll() })),
      )
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) =>
        setState((s) => ({
          ...s,
          activeSpeakerIds: new Set(speakers.map((p) => p.identity)),
        })),
      )
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
      });

    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);

    // Noise gate disabled for now — needs more tuning
    // const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    // if (pub?.track) {
    //   const gate = new NoiseGate();
    //   noiseGateRef.current = gate;
    //   await pub.track.setProcessor(gate);
    // }

    const audioTracks: RemoteAudioTrack[] = [];
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) {
        if (pub.track) audioTracks.push(pub.track as RemoteAudioTrack);
      }
    }

    setState({
      connectionState: room.state,
      participants: getAll(),
      activeSpeakerIds: new Set(),
      isMuted: false,
      audioTracks,
    });
  }, []);

  const disconnect = useCallback(() => {
    roomRef.current?.disconnect();
    roomRef.current = null;
    // noiseGateRef.current = null;
    setState(DISCONNECTED);
  }, []);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const enabled = room.localParticipant.isMicrophoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(!enabled);
    setState((s) => ({ ...s, isMuted: enabled }));
  }, []);

  useEffect(
    () => () => {
      roomRef.current?.disconnect();
    },
    [],
  );

  return { state, connect, disconnect, toggleMute };
}
