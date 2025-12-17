import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { NextRequest, NextResponse } from "next/server";
import { chatRateLimiter } from "../../lib/rate-limit";

// 1. You can use any service adapter here for multi-agent support. We use
//    the empty adapter since we're only using one agent.
const serviceAdapter = new ExperimentalEmptyAdapter();

// 2. Create the CopilotRuntime instance and utilize the LangGraph AG-UI
//    integration to setup the connection.
const runtime = new CopilotRuntime({
  agents: {
    starterAgent: new LangGraphAgent({
      deploymentUrl:
        process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123",
      graphId: "starterAgent",
      langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
    }),
  },
});

// 3. Build a Next.js API route that handles the CopilotKit runtime requests.
export const POST = async (req: NextRequest) => {
  const requestClone = req.clone();
  let isActualChatMessage = false;
  let userMessageCount = 0;

  try {
    const body = await requestClone.json();
    const actualBody = body.body || body.params || body;
    const messages = actualBody?.messages;

    if (messages && Array.isArray(messages)) {
      userMessageCount = messages.filter(
        (msg: any) => msg.role === "user"
      ).length;
      isActualChatMessage = userMessageCount > 0;
    }
  } catch (e) {
    console.log(
      "[CopilotKit] Could not parse request body, skipping rate limit"
    );
  }

  // Apply rate limiting only to actual chat messages with new user content
  if (isActualChatMessage) {
    const ip =
      req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      "anonymous";
    const allowed = await chatRateLimiter.check(ip);

    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    } else {
    }
  }

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
