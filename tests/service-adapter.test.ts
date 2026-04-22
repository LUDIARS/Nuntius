/**
 * Nuntius PeerAdapter integration test — actio / imperativus からの
 * ping を受けられるか、逆方向も成立するかを FakeCernere で確認.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PeerAdapter } from "@ludiars/cernere-service-adapter";
import { FakeCernere } from "@ludiars/cernere-service-adapter/testing";

describe("Nuntius ↔ peer via PeerAdapter", () => {
  let cernere: FakeCernere;
  let baseUrl: string;
  let nuntius: PeerAdapter;
  let actio:   PeerAdapter;

  beforeAll(async () => {
    cernere = new FakeCernere({
      projects: [
        { projectKey: "nuntius", clientId: "nun-cid",   clientSecret: "nun-sec" },
        { projectKey: "actio",   clientId: "actio-cid", clientSecret: "actio-sec" },
      ],
      relayPairs: [["nuntius", "actio"]],
    });
    const r = await cernere.start(); baseUrl = r.baseUrl;

    nuntius = new PeerAdapter({
      projectId: "nun-cid", projectSecret: "nun-sec", cernereBaseUrl: baseUrl,
      saListenHost: "127.0.0.1", saListenPort: 0,
      saPublicBaseUrl: "ws://127.0.0.1:{port}",
      accept: { actio: ["ping"] },
    });
    nuntius.handle("ping", async (caller, payload) => ({
      ok: true, from: caller.projectKey, echo: payload,
    }));
    await nuntius.start();

    actio = new PeerAdapter({
      projectId: "actio-cid", projectSecret: "actio-sec", cernereBaseUrl: baseUrl,
      saListenHost: "127.0.0.1", saListenPort: 0,
      saPublicBaseUrl: "ws://127.0.0.1:{port}",
      accept: { nuntius: ["ping"] },
    });
    actio.handle("ping", async () => ({ pong: true }));
    await actio.start();
  });

  afterAll(async () => {
    await actio.stop();
    await nuntius.stop();
    await cernere.stop();
  });

  it("actio → nuntius.ping が caller.projectKey 付きで応答", async () => {
    const r = await actio.invoke<{ ok: true; from: string; echo: { n: number } }>(
      "nuntius", "ping", { n: 42 },
    );
    expect(r.ok).toBe(true);
    expect(r.from).toBe("actio");
    expect(r.echo).toEqual({ n: 42 });
  });

  it("nuntius → actio.ping も双方向で成立", async () => {
    const r = await nuntius.invoke<{ pong: true }>("actio", "ping", {});
    expect(r).toEqual({ pong: true });
  });
});
