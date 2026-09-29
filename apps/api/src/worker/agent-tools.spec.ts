import { mkdtemp, writeFile, mkdir, rm, symlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { readSource, sourceFiles } from '../agent-runtime/code-map/source-safety';
import { CodeMapService } from '../agent-runtime/code-map/code-map.service';

describe('M4 source containment and code-map worker input', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'm4-source-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  it('reads bounded real source and rejects traversal and absolute paths', async () => {
    await writeFile(join(root, 'ok.ts'), 'export const value = 1;');
    expect(await readSource(root, 'ok.ts')).toContain('value');
    await expect(readSource(root, '../escape.ts')).rejects.toThrow();
    await expect(readSource(root, 'C:\\outside.ts')).rejects.toThrow();
    await expect(readSource(root, '/etc/passwd')).rejects.toThrow();
  });
  it('rejects junction and symlink source aliases', async () => {
    await mkdir(join(root, 'real')); await writeFile(join(root, 'real', 'ok.ts'), 'safe');
    await symlink(join(root, 'real'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(readSource(root, 'alias/ok.ts')).rejects.toThrow('Symbolic links');
  });
  it('rejects oversized text and binary source', async () => {
    await writeFile(join(root,'big.ts'), 'x'.repeat(1024*1024+1));
    await writeFile(join(root,'binary.ts'), '\0');
    await expect(readSource(root,'big.ts')).rejects.toThrow();
    await expect(readSource(root,'binary.ts')).rejects.toThrow();
  });
  it('does not enumerate dependencies and persists audit-linked parsed routes', async () => {
    await mkdir(join(root,'node_modules')); await writeFile(join(root,'node_modules','bad.ts'),'bad');
    await writeFile(join(root,'invoice.ts'), "import {Controller,Get} from '@nestjs/common'; @Controller('invoices') class InvoiceController { @Get(':id') getOne() { return this.service.find(); } }");
    expect(await sourceFiles(root)).toEqual(['invoice.ts']);
    const db: any = { codeMap: { upsert: jest.fn() } };
    await new CodeMapService(db).buildForAudit('audit','project','repo','a'.repeat(40),root);
    expect(db.codeMap.upsert.mock.calls[0][0].create).toMatchObject({ auditId:'audit',projectId:'project',repositoryId:'repo',commitSha:'a'.repeat(40),routeMappings:{create:[expect.objectContaining({method:'GET',pathTemplate:'/invoices/:id',handlerSymbol:'InvoiceController.getOne',file:'invoice.ts'})]} });
  });
});

import { HttpJobConsumerService } from './http-job-consumer.service';
import { runControlledProcess } from './process-control';
import { EvidenceCaptureService } from '../evidence/evidence-capture.service';
jest.mock('./process-control', () => ({ runControlledProcess: jest.fn() }));
jest.mock('./curl-auth-config', () => ({ materializeCurlConfig: jest.fn().mockResolvedValue(null) }));
describe('M4 HTTP worker', () => {
  function setup(response='HTTP/1.1 200 OK\r\n\r\n{"owner":"alice"}') {
    const invocation={id:'inv',arguments:{capability:'run_http_probe',testIdentityId:'bob',url:'https://target.test/invoices/1',method:'GET',followRedirects:true},agentRun:{auditId:'audit'}};
    const db:any={audit:{findFirst:jest.fn().mockResolvedValue({target:{id:'target',baseUrl:'https://target.test',authMode:'header'}})},agentToolInvocation:{findFirst:jest.fn().mockResolvedValue(invocation),update:jest.fn()},scopePolicy:{findFirst:jest.fn().mockResolvedValue({allowedHosts:['target.test'],deniedPaths:[],maxRequestsPerAudit:100,maxRequestsPerSecond:10,destructiveAllowed:false})},testIdentity:{findFirst:jest.fn().mockResolvedValue({credentialSecretId:'secret',credentialSecret:{revokedAt:null}})},reconRequestBudget:{findUnique:jest.fn().mockResolvedValue({maxRequests:100,consumed:1,reserved:0}),update:jest.fn()},reconRequestReservation:{count:jest.fn().mockResolvedValue(0),create:jest.fn()},toolExecution:{upsert:jest.fn()},evidence:{upsert:jest.fn()},$queryRawUnsafe:jest.fn()};
    db.$transaction=async (value:any)=>typeof value==='function'?value(db):Promise.all(value);
    const lifecycle:any={claim:jest.fn().mockResolvedValue({timeoutMs:1000}),heartbeat:jest.fn(),succeed:jest.fn(),fail:jest.fn()};
    const worker=new HttpJobConsumerService(db,{uploadEvidence:async()=>({uri:'s3://proof'}),verifyEvidence:jest.fn()} as any,lifecycle,{watch:()=>({signal:new AbortController().signal,close:jest.fn()})} as any,{expiryForCapture:async()=>new Date(Date.now()+100000)} as any,new EvidenceCaptureService(),{resolveForWorker:async()=> 'Authorization: Bearer bob-secret'} as any,{record:jest.fn()} as any);
    (runControlledProcess as jest.Mock).mockReset().mockResolvedValue({exitCode:0,stdout:response,stderr:''});process.env.KASE_EGRESS_PROXY='http://proxy:3128';
    return {db,run:()=> (worker as any).process({data:{auditId:'audit',projectId:'project',auditJobId:'child'}})};
  }
  it('executes invoice URL and persists bounded observation',async()=>{const {db,run}=setup();await run();expect((runControlledProcess as jest.Mock).mock.calls[0][1]).toContain('https://target.test/invoices/1');expect(db.agentToolInvocation.update.mock.calls[0][0].data).toMatchObject({status:'completed',resultEvidenceIds:[expect.any(String)]});});
  it('denies off-target redirect before second request',async()=>{const {run}=setup('HTTP/1.1 302 Found\r\nLocation: https://evil.test/private\r\n\r\n');await expect(run()).rejects.toThrow('outside target scope');expect(runControlledProcess).toHaveBeenCalledTimes(1);});
  it('revoked identity cannot send request',async()=>{const {db,run}=setup();db.testIdentity.findFirst.mockResolvedValue(null);await expect(run()).rejects.toThrow('Identity');expect(runControlledProcess).not.toHaveBeenCalled();});
  it('includes outstanding allocation in request cap',async()=>{const {db,run}=setup();db.reconRequestBudget.findUnique.mockResolvedValue({maxRequests:100,consumed:80,reserved:20});await expect(run()).rejects.toThrow('budget exhausted');expect(runControlledProcess).not.toHaveBeenCalled();});
});
