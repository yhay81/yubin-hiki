import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("product surface", () => {
  const worker = read("src/worker.tsx");
  const client = read("public/app.js");
  const css = read("public/styles.css");
  const migration = read("migrations/0001_postal_and_telemetry.sql");
  const builder = read("scripts/build_postal.py");
  const indexNow = read("ops/submit-indexnow.ps1");

  it("communicates through a postal visual system without oversized type", () => {
    expect(worker).toContain('class="envelope"');
    expect(worker).toContain('class="postal-boxes"');
    expect(worker).toContain('class="saved-tray"');
    expect(client).toContain('card.className = "address-card"');
    expect(css.toLowerCase()).not.toContain("gradient");
    expect(css).not.toMatch(/h1\s*\{[^}]*font-size:\s*(?:[4-9]\d|[1-9]\d{2})px/su);
  });

  it("keeps search and address data out of storage and URLs", () => {
    const telemetrySchema = migration.slice(migration.indexOf("CREATE TABLE product_events"));
    expect(worker).toContain('app.post("/api/search"');
    expect(worker).toContain('c.header("Cache-Control", "no-store")');
    expect(worker).not.toContain("search_query");
    expect(telemetrySchema).not.toMatch(/query|postal_code|address_value|email|phone/iu);
    expect(migration).toContain("CHECK(event_name IN");
  });

  it("does not interpret source data as markup", () => {
    expect(client).not.toContain("innerHTML");
    expect(worker).not.toContain("dangerouslySetInnerHTML");
    expect(worker).toContain(".bind(...values)");
  });

  it("lets D1 manage import transactions", () => {
    expect(builder).not.toContain('lines = ["BEGIN TRANSACTION;"]');
    expect(builder).not.toContain('lines.append("COMMIT;")');
  });

  it("delimits PowerShell variables before sitemap query strings", () => {
    expect(indexNow).toContain('"${SitemapLocation}?v=$Stamp"');
    expect(indexNow).not.toContain('"$SitemapLocation?v=$Stamp"');
  });
});
