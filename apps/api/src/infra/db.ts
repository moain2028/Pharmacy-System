import { type DynamicModule, Global, Inject, Injectable, Module, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { connect, migrate, type Sql } from "@pharmacore/db";
import { CONFIG, type AppConfig } from "./config.js";

export const SQL = Symbol("SQL");

/**
 * Database access. `tx(tenantId, fn)` is the ONLY sanctioned way for application code to touch
 * tenant data: it opens a transaction, sets `app.tenant_id` (RLS) and runs `fn`.
 * `admin()` returns the raw owner connection — used by bootstrap/migrations only.
 */
@Injectable()
export class Db implements OnModuleInit, OnModuleDestroy {
  private readonly sql: Sql;
  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    this.sql = connect(cfg.DATABASE_URL, 8);
  }
  async onModuleInit(): Promise<void> {
    if (this.cfg.AUTO_MIGRATE) await migrate(this.sql);
  }
  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
  admin(): Sql {
    return this.sql;
  }
  async tx<T>(tenantId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx as unknown as Sql);
    }) as Promise<T>;
  }
}

@Global()
@Module({})
export class DbModule {
  static forRoot(cfg: AppConfig): DynamicModule {
    return { module: DbModule, providers: [{ provide: CONFIG, useValue: cfg }, Db], exports: [CONFIG, Db] };
  }
}
