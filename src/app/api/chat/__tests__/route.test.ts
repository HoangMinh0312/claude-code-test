import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";

const mockToDataStreamResponse = vi.fn(() => new Response("stream"));
const mockStreamText = vi.fn(() => ({
  toDataStreamResponse: mockToDataStreamResponse,
}));

vi.mock("ai", () => ({
  streamText: (...args: any[]) => mockStreamText(...args),
  appendResponseMessages: vi.fn((opts: any) => opts.messages),
}));

vi.mock("@/lib/file-system", () => ({
  VirtualFileSystem: vi.fn().mockImplementation(() => ({
    deserializeFromNodes: vi.fn(),
    serialize: vi.fn(() => ({})),
  })),
}));

vi.mock("@/lib/tools/str-replace", () => ({
  buildStrReplaceTool: vi.fn(() => ({})),
}));

vi.mock("@/lib/tools/file-manager", () => ({
  buildFileManagerTool: vi.fn(() => ({})),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/provider", () => ({
  getLanguageModel: vi.fn(() => "mock-model"),
}));

vi.mock("@/lib/prompts/generation", () => ({
  generationPrompt: "system prompt",
}));

function makeRequest(body: object) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a stream response", async () => {
    const req = makeRequest({ messages: [], files: {} });
    const res = await POST(req);
    expect(res).toBeInstanceOf(Response);
    expect(mockStreamText).toHaveBeenCalledOnce();
    expect(mockToDataStreamResponse).toHaveBeenCalledOnce();
  });

  it("prepends system message to messages", async () => {
    const req = makeRequest({
      messages: [{ role: "user", content: "hello" }],
      files: {},
    });
    await POST(req);

    const [callArgs] = mockStreamText.mock.calls;
    const messages = callArgs[0].messages;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toBe("system prompt");
  });

  it("passes model from getLanguageModel", async () => {
    const req = makeRequest({ messages: [], files: {} });
    await POST(req);

    const [callArgs] = mockStreamText.mock.calls;
    expect(callArgs[0].model).toBe("mock-model");
  });

  it("deserializes files into VirtualFileSystem", async () => {
    const { VirtualFileSystem } = await import("@/lib/file-system");
    const req = makeRequest({
      messages: [],
      files: { "/App.jsx": { type: "file", name: "App.jsx", path: "/App.jsx", content: "" } },
    });
    await POST(req);

    const instance = vi.mocked(VirtualFileSystem).mock.results[0].value;
    expect(instance.deserializeFromNodes).toHaveBeenCalledOnce();
  });

  it("includes str_replace_editor and file_manager tools", async () => {
    const req = makeRequest({ messages: [], files: {} });
    await POST(req);

    const [callArgs] = mockStreamText.mock.calls;
    expect(callArgs[0].tools).toHaveProperty("str_replace_editor");
    expect(callArgs[0].tools).toHaveProperty("file_manager");
  });

  it("uses fewer maxSteps when no API key (mock provider)", async () => {
    const { getLanguageModel } = await import("@/lib/provider");
    vi.mocked(getLanguageModel).mockReturnValueOnce("mock-model" as any);
    delete process.env.ANTHROPIC_API_KEY;

    const req = makeRequest({ messages: [], files: {} });
    await POST(req);

    const [callArgs] = mockStreamText.mock.calls;
    expect(callArgs[0].maxSteps).toBe(4);
  });

  it("saves project when projectId provided and user is authenticated", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(getSession).mockResolvedValueOnce({
      userId: "user-1",
      email: "test@test.com",
      expiresAt: new Date(),
    });

    const req = makeRequest({
      messages: [{ role: "user", content: "hello" }],
      files: {},
      projectId: "proj-1",
    });
    await POST(req);

    // Trigger onFinish manually
    const [callArgs] = mockStreamText.mock.calls;
    await callArgs[0].onFinish({ response: { messages: [] } });

    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "proj-1", userId: "user-1" },
      })
    );
  });

  it("does not save project when user is not authenticated", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(getSession).mockResolvedValueOnce(null);

    const req = makeRequest({
      messages: [],
      files: {},
      projectId: "proj-1",
    });
    await POST(req);

    const [callArgs] = mockStreamText.mock.calls;
    await callArgs[0].onFinish({ response: { messages: [] } });

    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("does not save project when no projectId", async () => {
    const { prisma } = await import("@/lib/prisma");

    const req = makeRequest({ messages: [], files: {} });
    await POST(req);

    const [callArgs] = mockStreamText.mock.calls;
    await callArgs[0].onFinish({ response: { messages: [] } });

    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});
