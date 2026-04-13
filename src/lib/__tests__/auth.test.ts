// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, jwtVerify } from "jose";
import { NextRequest } from "next/server";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("server-only", () => ({}));

const cookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(cookieStore),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const SECRET = new TextEncoder().encode("development-secret-key");

async function makeToken(payload: object, expiresIn = "7d") {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .sign(SECRET);
}

function makeRequest(token?: string) {
  const req = new NextRequest("http://localhost/");
  if (token) {
    req.cookies.set("auth-token", token);
  }
  return req;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("createSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets an httpOnly cookie with a signed JWT", async () => {
    const { createSession } = await import("@/lib/auth");
    await createSession("user-1", "test@example.com");

    expect(cookieStore.set).toHaveBeenCalledOnce();

    const [name, token, options] = cookieStore.set.mock.calls[0];
    expect(name).toBe("auth-token");
    expect(typeof token).toBe("string");
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  it("embeds userId and email in the JWT payload", async () => {
    const { createSession } = await import("@/lib/auth");
    await createSession("user-42", "alice@example.com");

    const [, token] = cookieStore.set.mock.calls[0];
    const { payload } = await jwtVerify(token, SECRET);

    expect(payload.userId).toBe("user-42");
    expect(payload.email).toBe("alice@example.com");
  });

  it("sets an expiry roughly 7 days from now", async () => {
    const { createSession } = await import("@/lib/auth");
    const before = Date.now();
    await createSession("u1", "u@e.com");
    const after = Date.now();

    const [, , options] = cookieStore.set.mock.calls[0];
    const expiresAt: Date = options.expires;
    const diff = expiresAt.getTime() - before;
    const sevenDays = 7 * 24 * 60 * 60 * 1000;

    expect(diff).toBeGreaterThanOrEqual(sevenDays - (after - before));
    expect(diff).toBeLessThanOrEqual(sevenDays + 1000);
  });
});

describe("getSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when no cookie is present", async () => {
    cookieStore.get.mockReturnValue(undefined);
    const { getSession } = await import("@/lib/auth");
    expect(await getSession()).toBeNull();
  });

  it("returns the session payload for a valid token", async () => {
    const token = await makeToken({
      userId: "user-1",
      email: "a@b.com",
      expiresAt: new Date(),
    });
    cookieStore.get.mockReturnValue({ value: token });

    const { getSession } = await import("@/lib/auth");
    const session = await getSession();

    expect(session?.userId).toBe("user-1");
    expect(session?.email).toBe("a@b.com");
  });

  it("returns null for a tampered token", async () => {
    cookieStore.get.mockReturnValue({ value: "invalid.token.value" });
    const { getSession } = await import("@/lib/auth");
    expect(await getSession()).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const token = await makeToken(
      { userId: "u", email: "e@e.com", expiresAt: new Date() },
      "-1s"
    );
    cookieStore.get.mockReturnValue({ value: token });

    const { getSession } = await import("@/lib/auth");
    expect(await getSession()).toBeNull();
  });
});

describe("deleteSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes the auth-token cookie", async () => {
    const { deleteSession } = await import("@/lib/auth");
    await deleteSession();

    expect(cookieStore.delete).toHaveBeenCalledOnce();
    expect(cookieStore.delete).toHaveBeenCalledWith("auth-token");
  });
});

describe("verifySession", () => {
  it("returns null when no auth-token cookie is on the request", async () => {
    const { verifySession } = await import("@/lib/auth");
    expect(await verifySession(makeRequest())).toBeNull();
  });

  it("returns the session payload for a valid token on the request", async () => {
    const token = await makeToken({
      userId: "user-99",
      email: "x@y.com",
      expiresAt: new Date(),
    });

    const { verifySession } = await import("@/lib/auth");
    const session = await verifySession(makeRequest(token));

    expect(session?.userId).toBe("user-99");
    expect(session?.email).toBe("x@y.com");
  });

  it("returns null for a tampered token on the request", async () => {
    const { verifySession } = await import("@/lib/auth");
    expect(await verifySession(makeRequest("bad.token"))).toBeNull();
  });

  it("returns null for an expired token on the request", async () => {
    const token = await makeToken(
      { userId: "u", email: "e@e.com", expiresAt: new Date() },
      "-1s"
    );

    const { verifySession } = await import("@/lib/auth");
    expect(await verifySession(makeRequest(token))).toBeNull();
  });
});
