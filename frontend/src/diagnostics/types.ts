export type Details = Record<string, unknown>;
export type Transport = {
  role: string;
  path: string;
  state?: string;
  iceState?: string;
  candidateType?: string;
  protocol?: string;
  relayProtocol?: string;
  relayUrl?: string;
  rttMs?: number | null;
  bytesSent?: number;
  bytesReceived?: number;
};
export type AudioStats = {
  trackId: string;
  participant?: string;
  codec?: string;
  bitrateKbps: number | null;
  packetsLost?: number;
  lossPercent?: number | null;
  jitterMs?: number | null;
  rttMs?: number | null;
  concealedPercent?: number | null;
  jitterBufferMs?: number | null;
  audioLevel?: number | null;
  bytes?: number;
};
export type Metrics = {
  connectionState: string;
  connectionQuality: string;
  transports: Transport[];
  outgoingAudio: AudioStats[];
  incomingAudio: AudioStats[];
  localAudio: Details;
  deviceState: Details;
};
export type Sample = {
  id: number;
  sampled_at: number;
  received_at: number;
  data: Metrics;
};
export type Session = {
  id: string;
  call_id: string | null;
  room_name: string;
  username: string;
  user_id: number;
  attempted_at: number;
  connected_at: number | null;
  ended_at: number | null;
  last_seen_at: number;
  status: string;
  end_reason: string | null;
  client_info: Details;
  livekit_room_sid?: string;
  livekit_participant_sid?: string;
  latest?: Sample | null;
};
export type Call = {
  id: string;
  room_name: string;
  started_at: number;
  ended_at: number | null;
  end_reason: string | null;
  participant_count?: number;
  active_count?: number;
  last_seen_at?: number;
  sessions?: Session[];
};
export type DiagnosticEvent = {
  id: number;
  call_id: string | null;
  participant_session_id: string | null;
  room_name: string | null;
  source: string;
  occurred_at: number;
  received_at: number;
  level: string;
  type: string;
  message: string;
  details: Details;
};
export type Service = {
  status: string;
  error?: string;
  restartCount?: number;
  certificateExpiresAt?: number;
};
export type ServerSample = {
  id: number;
  server_instance_id: string;
  sampled_at: number;
  data: {
    cpuPercent: number | null;
    memoryUsedBytes: number;
    memoryTotalBytes: number;
    processMemoryBytes: number;
    diskFreeBytes: number;
    uptimeSeconds: number;
    backendUptimeSeconds: number;
    services: Record<string, Service>;
    collectorLastSeenAt: number | null;
  };
};
export type Overview = {
  now: number;
  calls: Call[];
  attempts: Session[];
  server: ServerSample | null;
  storage: {
    bytes: number;
    budget: number;
    target: number;
    lastPrunedAt: number | null;
  };
};
