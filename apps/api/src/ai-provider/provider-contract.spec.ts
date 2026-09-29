import { AnthropicAdapter } from './anthropic.adapter';
import { OpenAIAdapter } from './openai.adapter';
import { ProviderResolver } from './provider-resolver.service';
import { ProviderRequest } from './ai-provider.interface';
import { backoffMs, classifyError, MAX_RETRIES } from './retry-strategy';

const request: ProviderRequest = { modelId: 'pinned-model', messages: [{ role: 'system', content: [{type:'text', text:'policy', cacheable:true}] }, { role:'user', content:[{type:'text',text:'task'}]}],
  tools:[{name:'read_record',description:'Read fixture',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']}}],
  maxOutputTokens:256, budgetHandle:{auditId:'audit',agentRole:'blackbox',turnSequence:0}};
async function* stream(events: unknown[]) { for(const event of events) yield event; }
async function collect(events: AsyncIterable<unknown>) { const result: any[]=[]; for await(const e of events) result.push(e); return result; }
describe('M4 provider wire contracts',()=>{
  it('uses Responses input, flat tools, output cap and preserves a multi-turn exchange',async()=>{
    const create=jest.fn().mockResolvedValue(stream([
      {type:'response.output_item.added', item:{type:'function_call',id:'item',call_id:'call',name:'read_record'}},
      {type:'response.function_call_arguments.delta',item_id:'item',delta:'{"id":'},
      {type:'response.function_call_arguments.done',item_id:'item',arguments:'{"id":"one"}'},
      {type:'response.completed',response:{id:'response',usage:{input_tokens:50,output_tokens:10,input_tokens_details:{cached_tokens:20}},output:[{type:'function_call'}]}},
    ]));
    const adapter=new OpenAIAdapter({responses:{create}} as any);
    const events=await collect(adapter.runTurn(request));
    expect(create.mock.calls[0][0]).toMatchObject({input:expect.any(Array),tools:[{type:'function',name:'read_record',strict:false,parameters:expect.any(Object)}],max_output_tokens:256,parallel_tool_calls:false,store:false});
    expect(create.mock.calls[0][0]).not.toHaveProperty('messages');
    expect(events).toEqual([{type:'tool_call',toolCallId:'call',name:'read_record',arguments:{id:'one'}},{type:'usage',inputTokens:50,outputTokens:10,cachedTokens:20},{type:'completion',stopReason:'tool_use',providerRequestId:'response'}]);
    create.mockResolvedValue(stream([{type:'response.completed',response:{id:'r2',usage:{input_tokens:5,output_tokens:3,input_tokens_details:{cached_tokens:0}},output:[]}}]));
    await collect(adapter.runTurn({...request,messages:[...request.messages,{role:'assistant',content:[{type:'tool_use',toolCallId:'call',name:'read_record',arguments:{id:'one'}}]},{role:'tool_result',content:[{type:'tool_result',toolCallId:'call',content:'one'}]}]}));
    expect(create.mock.calls[1][0].input).toEqual(expect.arrayContaining([{type:'function_call',call_id:'call',name:'read_record',arguments:'{"id":"one"}'},{type:'function_call_output',call_id:'call',output:'one'}]));
  });
  it('maps Anthropic cache usage, tool results, single calls and output limits',async()=>{
    const create=jest.fn().mockResolvedValue(stream([
      {type:'message_start',message:{id:'a1',usage:{input_tokens:10,cache_read_input_tokens:20,cache_creation_input_tokens:5}}},
      {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'c1',name:'read_record',input:{}}},
      {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"id":"one"}'}},
      {type:'content_block_stop',index:0},
      {type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:6}},
      {type:'message_stop'},
    ]));
    const adapter=new AnthropicAdapter({messages:{create}} as any);
    expect(await collect(adapter.runTurn(request))).toEqual([{type:'tool_call',toolCallId:'c1',name:'read_record',arguments:{id:'one'}},{type:'usage',inputTokens:35,outputTokens:6,cachedTokens:25},{type:'completion',stopReason:'tool_use',providerRequestId:'a1'}]);
    expect(create.mock.calls[0][0]).toMatchObject({max_tokens:256,tool_choice:{type:'auto',disable_parallel_tool_use:true},system:[{type:'text',text:'policy',cache_control:{type:'ephemeral'}}]});
    create.mockResolvedValue(stream([{type:'message_start',message:{id:'a2',usage:{input_tokens:1}}},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1}},{type:'message_stop'}]));
    await collect(adapter.runTurn({...request,messages:[...request.messages,{role:'assistant',content:[{type:'tool_use',toolCallId:'c1',name:'read_record',arguments:{id:'one'}}]},{role:'tool_result',content:[{type:'tool_result',toolCallId:'c1',content:'observation',isError:true}]}]}));
    expect(create.mock.calls[1][0].messages.at(-1)).toEqual({role:'user',content:[{type:'tool_result',tool_use_id:'c1',content:'observation',is_error:true}]});
  });
  it.each(['openai','anthropic'])('rejects interrupted %s streams instead of reporting success',async provider=>{
    const adapter=provider==='openai'?new OpenAIAdapter({responses:{create:async()=>stream([])}} as any):new AnthropicAdapter({messages:{create:async()=>stream([])}} as any);
    const result=await collect(adapter.runTurn(request));
    expect(result).toHaveLength(1);expect(result[0].type).toBe('permanent_error');
  });
  it('does not silently accept malformed function arguments',async()=>{
    const adapter=new OpenAIAdapter({responses:{create:async()=>stream([{type:'response.output_item.added',item:{type:'function_call',id:'i',call_id:'c',name:'read_record'}},{type:'response.function_call_arguments.done',item_id:'i',arguments:'not json'}])}} as any);
    expect((await collect(adapter.runTurn(request)))[0].type).toBe('permanent_error');
  });
  it('preserves refusal and truncation',async()=>{
    const adapter=new OpenAIAdapter({responses:{create:async()=>stream([{type:'response.refusal.delta',delta:'declined'},{type:'response.incomplete',response:{id:'r',usage:{input_tokens:1,output_tokens:1,input_tokens_details:{cached_tokens:0}},output:[]}}])}} as any);
    const result=await collect(adapter.runTurn(request));expect(result[0]).toEqual({type:'refusal',reason:'declined'});expect(result.at(-1).stopReason).toBe('max_tokens');
  });
  it('propagates abort instead of turning it into completion',async()=>{
    const controller=new AbortController();controller.abort(new Error('test abort'));
    const adapter=new AnthropicAdapter({messages:{create:async()=>{throw new Error('aborted')}}} as any);
    await expect(collect(adapter.runTurn(request,controller.signal))).rejects.toThrow('test abort');
  });
  it('has bounded retry classifications and delays',()=>{
    expect(MAX_RETRIES).toBe(3);expect([0,1,2].map(n=>backoffMs(n))).toEqual([1000,2000,4000]);
    expect(backoffMs(0,999999)).toBe(60000);
    expect(classifyError({type:'permanent_error',code:'auth',message:'x'})).toBe('auth');
    expect(classifyError({type:'retryable_error',code:'429',message:'x'})).toBe('retryable');
  });
});
describe('M4 provider credential isolation',()=>{
  const previous={...process.env};
  afterEach(()=>{process.env={...previous};});
  it('constructs resolver without model keys',()=>{delete process.env.OPENAI_API_KEY;delete process.env.ANTHROPIC_API_KEY;expect(()=>new ProviderResolver({} as any,{} as any)).not.toThrow();});
  it('never falls back to platform for revoked project secret',async()=>{
    process.env.OPENAI_API_KEY='must-not-use';
    const prisma={auditAiSnapshot:{findUniqueOrThrow:async()=>({provider:'openai',credentialMode:'project_secret',credentialSecretId:'s',credentialSecretVersion:1,audit:{projectId:'p'}})},secret:{findFirst:async()=>null}};
    const secrets={resolveForWorker:jest.fn()};
    await expect(new ProviderResolver(prisma as any,secrets as any).forAudit('a')).rejects.toThrow('revoked');
    expect(secrets.resolveForWorker).not.toHaveBeenCalled();
  });
  it('pins secret version and validates router host before constructing SDK',async()=>{
    const snapshot={provider:'anthropic',credentialMode:'project_secret',credentialSecretId:'s',credentialSecretVersion:2,audit:{projectId:'p'}};
    const prisma={auditAiSnapshot:{findUniqueOrThrow:async()=>snapshot},secret:{findFirst:async()=>({id:'s'})}};
    const secrets={resolveForWorker:jest.fn().mockResolvedValue('test-value')};
    process.env.KASE_ANTHROPIC_BASE_URL='http://fixture-router:3000';process.env.KASE_AGENT_ROUTER_HOSTS='fixture-router';process.env.NODE_ENV='test';delete process.env.KASE_AGENT_EGRESS_PROXY;
    const provider=await new ProviderResolver(prisma as any,secrets as any).forAudit('a');
    expect(provider.providerName).toBe('anthropic');expect(secrets.resolveForWorker).toHaveBeenCalledWith('p','s',2);
    process.env.KASE_AGENT_ROUTER_HOSTS='another-host';
    await expect(new ProviderResolver(prisma as any,secrets as any).forAudit('a')).rejects.toThrow('not allowed');
  });
});

