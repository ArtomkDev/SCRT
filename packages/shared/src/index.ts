export * from './activity';
export * from './activity-artwork';
export * from './media';
export type GuildRecord = {
  guildId: string;
  name: string;
  icon: string | null;
  ownerId: string;
  botInstalled: boolean;
  resourceRevision?: number;
  schemaVersion: 1;
};

export * from './runtime-log';
