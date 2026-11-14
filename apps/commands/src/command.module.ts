import { Module } from '@nestjs/common';
import { CommandModule as ExternalCommandModule } from 'nestjs-command';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { RefreshTokens } from './tasks/refresh.tokens';
import { EncryptTokens } from './tasks/encrypt.tokens';
import { AdminGrant, AdminRevoke } from './tasks/platform.admin';
import { ConfigurationTask } from './tasks/configuration';
import { AgentRun } from './tasks/agent.run';
import { AgentModule } from '@gitroom/nestjs-libraries/agent/agent.module';

@Module({
  imports: [ExternalCommandModule, DatabaseModule, AgentModule],
  controllers: [],
  providers: [
    RefreshTokens,
    ConfigurationTask,
    AgentRun,
    EncryptTokens,
    AdminGrant,
    AdminRevoke,
  ],
  get exports() {
    return [...this.imports, ...this.providers];
  },
})
export class CommandModule {}
