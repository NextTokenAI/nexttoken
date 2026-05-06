import { describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/http";
import { Integrations } from "../src/integrations";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Integrations", () => {
  it("list() unwraps data.integrations", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: { integrations: [{ slug: "gmail" }] } }),
    );
    const i = new Integrations(new HttpClient({ apiKey: "k", fetchImpl }));
    expect(await i.list()).toEqual([{ slug: "gmail" }]);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://api.nexttoken.co/integrations",
    );
  });

  it("search() encodes query as q param and unwraps data.apps", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: { apps: [{ slug: "slack" }] } }),
    );
    const i = new Integrations(new HttpClient({ apiKey: "k", fetchImpl }));
    expect(await i.search("messaging")).toEqual([{ slug: "slack" }]);
    const url = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/integrations/search");
    expect(url.searchParams.get("q")).toBe("messaging");
  });

  it("listActions() encodes app and unwraps data.actions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: { actions: [{ key: "send" }] } }),
    );
    const i = new Integrations(new HttpClient({ apiKey: "k", fetchImpl }));
    expect(await i.listActions("gmail")).toEqual([{ key: "send" }]);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://api.nexttoken.co/integrations/gmail/actions",
    );
  });

  it("getActionDetails() returns data object", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: { name: "Send", configurable_props: [] } }),
    );
    const i = new Integrations(new HttpClient({ apiKey: "k", fetchImpl }));
    const details = await i.getActionDetails("gmail", "gmail-send-email");
    expect(details).toMatchObject({ name: "Send" });
  });

  it("invoke() posts action_key + props and returns data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: { sent: true } }),
    );
    const i = new Integrations(new HttpClient({ apiKey: "k", fetchImpl }));
    const res = await i.invoke("gmail", "gmail-send-email", {
      to: "a@b.com",
      subject: "hi",
    });
    expect(res).toEqual({ sent: true });
    const sent = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sent).toEqual({
      action_key: "gmail-send-email",
      props: { to: "a@b.com", subject: "hi" },
    });
  });

  it("invoke() defaults props to empty object", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: {} }));
    const i = new Integrations(new HttpClient({ apiKey: "k", fetchImpl }));
    await i.invoke("gmail", "test");
    const sent = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sent.props).toEqual({});
  });
});
