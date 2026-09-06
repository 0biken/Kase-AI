import { Module } from '@nestjs/common';
import { GitCliResolver } from './git-cli-resolver';
import { GitCheckoutService } from './git-checkout.service';
import { BUILD_INFO_FETCH, HttpBuildInfoReader } from './http-build-info-reader';
import { ProvenanceResolver } from './provenance-resolver';

@Module({
  providers: [
    GitCliResolver,
    { provide: BUILD_INFO_FETCH, useValue: fetch },
    HttpBuildInfoReader,
    GitCheckoutService,
    {
      provide: ProvenanceResolver,
      useFactory: (git: GitCliResolver, buildInfo: HttpBuildInfoReader) => new ProvenanceResolver(git, buildInfo),
      inject: [GitCliResolver, HttpBuildInfoReader],
    },
  ],
  exports: [ProvenanceResolver, GitCheckoutService],
})
export class ProvenanceModule {}
