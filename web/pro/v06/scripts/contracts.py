from pathlib import Path
import re,json
R=Path(__file__).resolve().parents[1]
s=(R/'src/modules/01-core-console.js').read_text()
body=s.split('const API={',1)[1].split('};',1)[0]
ops=re.findall(r"'([^']+)':'([^']+)'",body)
assert len(ops)>35,len(ops)
registry={}
for name,raw in ops:
 if raw.startswith('/'):
  method='POST';path=raw
 else:
  method,path=raw.split(' ',1)
 registry[name]={'method':method,'path':path,'status':'PROPUESTO — adaptar a API existente','mock':True}
(R/'contracts/event-registry.json').write_text(json.dumps(registry,indent=2,ensure_ascii=False))
# Type definitions: check with 'tsc -p contracts/tsconfig.json --noEmit'.
keys=' | '.join(json.dumps(x) for x in registry)
types=f'''/** AUDIT SOUND — tipos propuestos para cableado. No implican endpoints implementados. */
export type OperationName = {keys};
export type DJMode = 'manual' | 'hibrido' | 'automatico';
export type DeckId = 'A' | 'B';
export type EffectChannel = 'A' | 'B' | 'Master' | 'MIC1' | 'MIC2' | 'MIC3' | 'MIC4' | 'Video';
export type RequestStatus = 'idle' | 'pending' | 'success' | 'error' | 'offline' | 'mock';
export interface DeckTransportPayload {{ deck:DeckId; position?:number; beats?:number; rate?:number; sync?:boolean; slot?:number; }}
export interface MixerPayload {{ channel?:DeckId | EffectChannel; key?:string; value?:number; position?:number; volume?:number; }}
export interface VideoControlPayload {{ deck?:DeckId; op?:'load'|'play'|'pause'|'cue'|'seek'|'loop'|'sync-local'; position?:number; transition?:string; source?:DeckId; crossfade?:number; }}
export interface EffectControlPayload {{ bank:number; enabled?:boolean; field?:'wet'|'parameter'|'type'|'channel'|'bpmSync'; value?:number|string|boolean; }}
export interface AgentCommandPayload {{ text:string; route:'auto'|'qwen'|'deepseek'; policy?:string; }}
export interface ApiCommand<T extends OperationName=OperationName> {{
  type:T;
  correlationId:string;
  timestamp:string;
  payload:Record<string,unknown>;
  mode:'mock'|'live';
}}
export interface ApiResult<T=unknown> {{
  correlationId:string;
  ok:boolean;
  status:RequestStatus;
  data?:T;
  error?:{{code:string;message:string;retryable:boolean}};
}}
export interface ServerState {{
  sessionId:string;
  mode:DJMode;
  audio:Record<DeckId,{{playing:boolean;position:number;bpm:number;loaded:boolean}} >;
  video:Record<DeckId,{{playing:boolean;position:number;loaded:boolean}} >;
  stream:{{connected:boolean;listeners?:number}};
  agent:{{qwen:'online'|'offline';deepseek:'online'|'offline';tokenCount:number}};
}}
export interface WebSocketMessage {{
  type:'state.snapshot'|'state.patch'|'command.ack'|'command.error'|'stream.status'|'agent.decision'|'silence.alert';
  timestamp:string;
  sessionId:string;
  correlationId?:string;
  payload:Record<string,unknown>;
}}
export interface Adapter {{
  execute<T extends OperationName>(cmd:ApiCommand<T>):Promise<ApiResult>;
  subscribe?(onEvent:(event:WebSocketMessage)=>void):()=>void;
  health?():Promise<ApiResult>;
}}
'''
(R/'contracts/types.ts').write_text(types)
(R/'contracts/tsconfig.json').write_text(json.dumps({'compilerOptions':{'strict':True,'target':'ES2020','module':'ESNext','lib':['ES2020','DOM'],'noEmit':True},'include':['types.ts']},indent=2))
# Draft OpenAPI: endpoints all proposals, NEVER assert they exist.
paths={}
for name,op in registry.items():
 method=op['method'].lower()
 path=op['path']
 # Distinct operations can share a method+path: group with x-operations.
 paths.setdefault(path,{}).setdefault(method,[]).append(name)
yaml=['openapi: 3.0.3','info:','  title: AUDIT SOUND — Contratos PROPUESTOS (NO API REAL)','  version: 0.6.0','  description: Endpoints de referencia que requieren conciliación con el backend real.','servers:','  - url: https://your-audit-sound-backend.example','security:','  - bearerAuth: []','paths:']
for path,methods in sorted(paths.items()):
 yaml.append('  '+path+':')
 for method,names in methods.items():
  yaml+=['    '+method+':','      tags: ['+names[0].split('.')[0]+']','      summary: "Propuesto — '+', '.join(names)+'"','      operationId: '+names[0].replace('.','_').replace('-','_'),'      x-audit-sound-commands: '+json.dumps(names,ensure_ascii=False),'      x-implementation-status: PROPOSED_NOT_VERIFIED']
  params=re.findall(r'\{([^}]+)\}',path)
  if params:
   yaml.append('      parameters:')
   for param in params: yaml.extend(['        - in: path','          name: '+param,'          required: true','          schema:','            type: string'])
  if method in ('post','put','patch'):
   yaml.extend(['      requestBody:','        required: true','        content:','          application/json:','            schema:','              type: object','              additionalProperties: true'])
  yaml+=['      responses:','        "200":','          description: Respuesta normalizada (por implementar)','        "401":','          description: No autenticado','        "403":','          description: Sin permisos','        "500":','          description: Error del motor']
yaml+=['components:','  securitySchemes:','    bearerAuth:','      type: http','      scheme: bearer','      bearerFormat: JWT']
(R/'contracts/openapi-propuesto.yaml').write_text('\n'.join(yaml)+'\n')
print('contract operations',len(registry),'unique endpoint paths',len(paths))
