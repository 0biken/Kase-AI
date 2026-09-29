import { AiConfigurationService, AiConfigurationSchema } from './ai-configuration.service';
import { AiConfigurationController } from './ai-configuration.controller';
import { AgentRunController } from './agent-run.controller';
import { TestIdentitiesController } from './test-identities.controller';
import { SCOPE_KEY } from '../auth/project-scope.decorator';
import { ROLES_KEY } from '../auth/roles.decorator';
import { MethodologyGuard } from './methodology.guard';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const input={provider:'openai',modelId:'pinned-test-2026',catalogRevision:1,credentialMode:'project_secret',credentialSecretId:'secret'};
describe('M4 AI configuration and scoped API',()=>{
  function setup(){
    const db:any={modelCatalogEntry:{findUnique:jest.fn().mockResolvedValue({status:'available',retiredAt:null,capabilities:['streaming','tool_use'],contextLimit:200000,outputLimit:16000})},
      secret:{findFirst:jest.fn().mockResolvedValue({currentVersion:3})},projectAiConfiguration:{findUnique:jest.fn().mockResolvedValue({...AiConfigurationSchema.parse(input),projectId:'p',updatedBy:'u',updatedAt:new Date(),createdAt:new Date()})}};
    const guard={verifyIntegrity:jest.fn().mockResolvedValue('digest'),getPromptVersion:()=> 'v1'};
    return {db,service:new AiConfigurationService(db,guard as any,{} as any)};
  }
  it('pins validated credentials, limits and methodology in snapshot',async()=>{
    const {db,service}=setup();expect(await service.snapshot('p')).toMatchObject({provider:'openai',credentialSecretVersion:3,methodologyDigest:'digest',promptVersion:'v1',budgetMaxCalls:120});
    expect(db.secret.findFirst.mock.calls[0][0].where).toEqual({id:'secret',projectId:'p',revokedAt:null,kind:'openai_api_key'});
  });
  it.each([{modelId:'latest'},{credentialMode:'platform'},{budgetTotalTokens:1},{budgetMaxCalls:1},{budgetMaxOutputTokens:0},{provider:'unknown'}])('rejects invalid configuration %p',async changes=>{
    await expect(setup().service.validate('p',{...input,...changes})).rejects.toThrow();
  });
  it('rejects retired or incompatible catalog entries',async()=>{
    const {db,service}=setup();db.modelCatalogEntry.findUnique.mockResolvedValue({status:'retired',capabilities:['streaming','tool_use'],outputLimit:16000});
    await expect(service.validate('p',input)).rejects.toThrow();
  });
  it('rejects unavailable project credentials',async()=>{
    const {db,service}=setup();db.secret.findFirst.mockResolvedValue(null);
    await expect(service.validate('p',input)).rejects.toThrow();
  });
  it('requires explicit platform deployment policy',async()=>{
    const previous=process.env.KASE_PLATFORM_AI_PROVIDERS;delete process.env.KASE_PLATFORM_AI_PROVIDERS;
    try {await expect(setup().service.validate('p',{...input,credentialMode:'platform',credentialSecretId:null})).rejects.toThrow();}
    finally {if(previous===undefined)delete process.env.KASE_PLATFORM_AI_PROVIDERS;else process.env.KASE_PLATFORM_AI_PROVIDERS=previous;}
  });
  it('declares scope metadata and admin-only writes',()=>{
    for(const cls of [AiConfigurationController,AgentRunController,TestIdentitiesController])expect(Reflect.getMetadata(SCOPE_KEY,cls)).toMatchObject({param:'projectId'});
    expect(Reflect.getMetadata(ROLES_KEY,AiConfigurationController.prototype.updateConfiguration)).toEqual(['admin']);
    expect(Reflect.getMetadata(ROLES_KEY,TestIdentitiesController.prototype.create)).toEqual(['admin']);
  });
  it('rejects cross-project audit reads before querying runs',async()=>{
    const db={audit:{findFirst:jest.fn().mockResolvedValue(null)},agentRun:{findMany:jest.fn()}};
    await expect(new AgentRunController(db as any).getRuns('p','a')).rejects.toThrow();
    expect(db.agentRun.findMany).not.toHaveBeenCalled();
  });
  it('lists metadata without secrets or authorization headers',async()=>{
    const db={testIdentity:{findMany:jest.fn().mockResolvedValue([])}};
    await new TestIdentitiesController(db as any,{} as any).getIdentities('p');
    expect(db.testIdentity.findMany.mock.calls[0][0]).toMatchObject({where:{projectId:'p'}});
    expect(db.testIdentity.findMany.mock.calls[0][0].select).not.toHaveProperty('credentialSecretId');
  });
});
describe('M4 methodology integrity',()=>{
  it('checks every file and rejects deletion, modification and additions',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'kase-methodology-'));const previous=process.env.KASE_METHODOLOGY_ROOT;
    const source=resolve(__dirname,'../../../..','methodology/v1');
    try {
      await cp(source,dir,{recursive:true});process.env.KASE_METHODOLOGY_ROOT=dir;
      const guard=new MethodologyGuard();expect(await guard.verifyIntegrity()).toMatch(/^[a-f0-9]{64}$/);
      const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));const file=Object.keys(manifest.referenceFiles)[0];
      const bytes=await readFile(join(dir,file));await writeFile(join(dir,file),'modified');await expect(guard.verifyIntegrity()).rejects.toThrow();
      await writeFile(join(dir,file),bytes);await writeFile(join(dir,'blackbox/extra.md'),'extra');await expect(guard.verifyIntegrity()).rejects.toThrow();
      await rm(join(dir,'blackbox/extra.md'));await rm(join(dir,file));await expect(guard.verifyIntegrity()).rejects.toThrow();
    } finally {await rm(dir,{recursive:true,force:true});if(previous===undefined)delete process.env.KASE_METHODOLOGY_ROOT;else process.env.KASE_METHODOLOGY_ROOT=previous;}
  });
});

