import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectShadowbanForAccount } from "../shadowban-detector.js";
import { prisma } from "../../lib/prisma.js";

vi.mock("../../lib/prisma.js");
vi.mock("../../lib/socket-logger.js", () => ({
  SocketLogger: vi.fn().mockImplementation(() => ({
    warn: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

const hour = 3_600_000;
const now = Date.now();

const mkAccount = (overrides = {}) => ({
  id: "acc-1",
  userId: "u-1",
  nickname: "test",
  status: "ALIVE",
  warmupCompletedAt: new Date(now - 30 * 24 * hour),
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe("detectShadowbanForAccount", () => {
  it("does NOT flag accounts still in warmup", async () => {
    (prisma.socialAccount.findUniqueOrThrow as any).mockResolvedValue(
      mkAccount({ warmupCompletedAt: null }),
    );
    const r = await detectShadowbanForAccount("acc-1");
    expect(r.flagged).toBe(false);
    expect(prisma.video.findMany).not.toHaveBeenCalled();
  });

  it("does NOT flag when there are <3 videos older than 24h", async () => {
    (prisma.socialAccount.findUniqueOrThrow as any).mockResolvedValue(mkAccount());
    (prisma.video.findMany as any).mockResolvedValue([
      { id: "v1", views: 5, uploadedAt: new Date(now - 30 * hour) },
      { id: "v2", views: 12, uploadedAt: new Date(now - 26 * hour) },
      // only 2 aged videos
    ]);
    const r = await detectShadowbanForAccount("acc-1");
    expect(r.flagged).toBe(false);
  });

  it("does NOT flag fresh videos with low views (the 24h gate)", async () => {
    // 3 videos but all under 24h old — must NOT trigger
    (prisma.socialAccount.findUniqueOrThrow as any).mockResolvedValue(mkAccount());
    // Prisma `lte: 24h-ago` filter should already exclude these,
    // so findMany returns empty.
    (prisma.video.findMany as any).mockResolvedValue([]);
    const r = await detectShadowbanForAccount("acc-1");
    expect(r.flagged).toBe(false);
  });

  it("flags when 3+ consecutive aged videos all under 100 views", async () => {
    (prisma.socialAccount.findUniqueOrThrow as any).mockResolvedValue(mkAccount());
    (prisma.video.findMany as any).mockResolvedValue([
      { id: "v1", views: 30, uploadedAt: new Date(now - 26 * hour) },
      { id: "v2", views: 55, uploadedAt: new Date(now - 50 * hour) },
      { id: "v3", views: 8, uploadedAt: new Date(now - 75 * hour) },
    ]);
    (prisma.socialAccount.update as any).mockResolvedValue({});
    (prisma.task.updateMany as any).mockResolvedValue({ count: 2 });

    const r = await detectShadowbanForAccount("acc-1");
    expect(r.flagged).toBe(true);
    expect(r.matchedVideos).toEqual(["v1", "v2", "v3"]);
    expect(prisma.socialAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "SHADOWBAN_SUSPECTED" } }),
    );
    expect(prisma.task.updateMany).toHaveBeenCalled();
  });

  it("does NOT flag when at least one aged video has >=100 views", async () => {
    (prisma.socialAccount.findUniqueOrThrow as any).mockResolvedValue(mkAccount());
    (prisma.video.findMany as any).mockResolvedValue([
      { id: "v1", views: 30, uploadedAt: new Date(now - 26 * hour) },
      { id: "v2", views: 250, uploadedAt: new Date(now - 50 * hour) }, // healthy
      { id: "v3", views: 8, uploadedAt: new Date(now - 75 * hour) },
    ]);
    const r = await detectShadowbanForAccount("acc-1");
    expect(r.flagged).toBe(false);
    expect(prisma.socialAccount.update).not.toHaveBeenCalled();
  });
});
