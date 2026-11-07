/** AUDIT SOUND — tipos propuestos para cableado. No implican endpoints implementados. */
export type OperationName = "transport.play" | "transport.pause" | "transport.cue" | "transport.sync" | "transport.hotcue" | "transport.loop" | "transport.beatjump" | "transport.pitch" | "transport.keylock" | "mixer.control" | "mixer.crossfade" | "mixer.master" | "video.transport" | "video.crossfade" | "video.program" | "video.transition" | "video.output" | "mic.channel" | "mic.talkover" | "fx.control" | "fx.preset" | "agent.plan" | "agent.command" | "agent.mode" | "agent.policy" | "agent.approval" | "catalog.import" | "catalog.queue" | "stream.configure" | "stream.status" | "event.cue" | "auth.login" | "iam.users" | "iam.roles" | "saas.licenses" | "saas.plans" | "saas.invoices" | "system.health";
export type DJMode = 'manual' | 'hibrido' | 'automatico';
export type DeckId = 'A' | 'B';
export type EffectChannel = 'A' | 'B' | 'Master' | 'MIC1' | 'MIC2' | 'MIC3' | 'MIC4' | 'Video';
export type RequestStatus = 'idle' | 'pending' | 'success' | 'error' | 'offline' | 'mock';
export interface DeckTransportPayload { deck:DeckId; position?:number; beats?:number; rate?:number; sync?:boolean; slot?:number; }
export interface MixerPayload { channel?:DeckId | EffectChannel; key?:string; value?:number; position?:number; volume?:number; }
export interface VideoControlPayload { deck?:DeckId; op?:'load'|'play'|'pause'|'cue'|'seek'|'loop'|'sync-local'; position?:number; transition?:string; source?:DeckId; crossfade?:number; }
export interface EffectControlPayload { bank:number; enabled?:boolean; field?:'wet'|'parameter'|'type'|'channel'|'bpmSync'; value?:number|string|boolean; }
export interface AgentCommandPayload { text:string; route:'auto'|'qwen'|'deepseek'; policy?:string; }
export interface ApiCommand<T extends OperationName=OperationName> {
  type:T;
  correlationId:string;
  timestamp:string;
  payload:Record<string,unknown>;
  mode:'mock'|'live';
}
export interface ApiResult<T=unknown> {
  correlationId:string;
  ok:boolean;
  status:RequestStatus;
  data?:T;
  error?:{code:string;message:string;retryable:boolean};
}
export interface ServerState {
  sessionId:string;
  mode:DJMode;
  audio:Record<DeckId,{playing:boolean;position:number;bpm:number;loaded:boolean} >;
  video:Record<DeckId,{playing:boolean;position:number;loaded:boolean} >;
  stream:{connected:boolean;listeners?:number};
  agent:{qwen:'online'|'offline';deepseek:'online'|'offline';tokenCount:number};
}
export interface WebSocketMessage {
  type:'state.snapshot'|'state.patch'|'command.ack'|'command.error'|'stream.status'|'agent.decision'|'silence.alert';
  timestamp:string;
  sessionId:string;
  correlationId?:string;
  payload:Record<string,unknown>;
}
export interface Adapter {
  execute<T extends OperationName>(cmd:ApiCommand<T>):Promise<ApiResult>;
  subscribe?(onEvent:(event:WebSocketMessage)=>void):()=>void;
  health?():Promise<ApiResult>;
}
