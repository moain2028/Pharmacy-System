import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { CONFIG, type AppConfig } from "../infra/config.js";
import { Db } from "../infra/db.js";
import { hashPassword } from "./password.js";
import { SetupService } from "./setup.service.js";

/** Demo accounts (DEMO_MODE=true only): username/password pairs and the built-in role each gets. */
export const DEMO_USERS: ReadonlyArray<{ username: string; password: string; displayName: string; role: "OWNER" | "CASHIER" }> = [
  { username: "1", password: "1", displayName: "المالك (تجريبي)", role: "OWNER" },
  { username: "2", password: "2", displayName: "كاشير (تجريبي)", role: "CASHIER" },
];

/**
 * Trial installs: make the first visit frictionless. On boot, if DEMO_MODE is on, initialize a demo
 * pharmacy when none exists and ensure the demo users exist with their trivial passwords.
 * Production installs never set DEMO_MODE, so the 8-char password rule and setup wizard stay in force.
 */
@Injectable()
export class DemoSeedService implements OnApplicationBootstrap {
  private readonly log = new Logger("DemoSeed");
  constructor(@Inject(CONFIG) private readonly cfg: AppConfig, @Inject(Db) private readonly db: Db, @Inject(SetupService) private readonly setup: SetupService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.cfg.DEMO_MODE) return;
    try { await this.seed(); } catch (e) { this.log.error(`demo seed failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  async seed(): Promise<{ tenantId: string }> {
    const st = await this.setup.status();
    let tenantId = st.tenants[0]?.id;
    if (!tenantId) {
      const r = await this.setup.initialize({
        pharmacy: { nameAr: "صيدلية تجريبية", nameEn: "Demo Pharmacy", baseCurrency: "YER_NEW" },
        owner: { username: DEMO_USERS[0]!.username, displayName: DEMO_USERS[0]!.displayName, password: "demo-owner-password", locale: "ar" },
      });
      tenantId = r.tenantId;
      this.log.warn("DEMO_MODE: initialized demo pharmacy");
    }
    const admin = this.db.admin();
    for (const u of DEMO_USERS) {
      const hash = await hashPassword(u.password);
      await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        const [role] = await tx<{ id: string }[]>`SELECT id FROM roles WHERE tenant_id = ${tenantId} AND code = ${u.role}`;
        if (!role) throw new Error(`role ${u.role} missing`);
        const [existing] = await tx<{ id: string }[]>`SELECT id FROM users WHERE tenant_id = ${tenantId} AND username = ${u.username}`;
        const userId = existing?.id ?? (await tx<{ id: string }[]>`INSERT INTO users (tenant_id, username, display_name, password_hash, locale)
          VALUES (${tenantId}, ${u.username}, ${u.displayName}, ${hash}, 'ar') RETURNING id`)[0]!.id;
        // Always reset to the documented demo credentials so a trial box can never lock itself out.
        await tx`UPDATE users SET password_hash = ${hash}, is_active = true, failed_logins = 0, locked_until = NULL WHERE id = ${userId}`;
        await tx`INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES (${tenantId}, ${userId}, ${role.id}) ON CONFLICT DO NOTHING`;
      });
    }
    this.log.warn(`DEMO_MODE: demo users ready (${DEMO_USERS.map((u) => u.username).join(", ")})`);
    return { tenantId };
  }
}
