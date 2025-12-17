/**
 * This is the main entry point for the agent.
 * It defines the workflow graph, state, tools, nodes and edges.
 */

import { z } from "zod";
import { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  convertActionsToDynamicStructuredTools,
  CopilotKitStateAnnotation,
} from "@copilotkit/sdk-js/langgraph";
import { Annotation } from "@langchain/langgraph";

// 1. Define our agent state, which includes CopilotKit state to
//    provide actions to the state.
const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec, // CopilotKit state annotation already includes messages, as well as frontend tools
  proverbs: Annotation<string[]>,
});

// 2. Define the type for our agent state
export type AgentState = typeof AgentStateAnnotation.State;

// 3. Define a simple tool to get the weather statically
const getWeather = tool(
  (args) => {
    return `The weather for ${args.location} is 70 degrees, clear skies, 45% humidity, 5 mph wind, and feels like 72 degrees.`;
  },
  {
    name: "getWeather",
    description: "Get the weather for a given location.",
    schema: z.object({
      location: z.string().describe("The location to get weather for"),
    }),
  }
);

// 4. Define tool to search knowledge base
const searchKnowledgeBase = tool(
  async (args) => {
    try {
      const response = await fetch(
        "http://localhost:3000/api/knowledge/search",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: args.query }),
        }
      );

      if (!response.ok) {
        return "I apologize, but I encountered an error accessing the knowledge base.";
      }

      const data = await response.json();

      if (data.cached) {
        console.log("[Agent] Using cached response");
        return data.response;
      }

      if (!data.foundDocuments) {
        return "I apologize, but I don't have any information about that in my knowledge base.";
      }

      return data.contextString;
    } catch (error) {
      console.error("Knowledge base search error:", error);
      return "I apologize, but I encountered an error searching the knowledge base.";
    }
  },
  {
    name: "searchKnowledgeBase",
    description:
      "Search the knowledge base and return the FINAL answer to display to the user. This tool returns complete, user-ready responses that should be shown directly without any modification or additional processing. The tool contains information about AI agents, their capabilities, use cases, frameworks, and resources.",
    schema: z.object({
      query: z
        .string()
        .describe(
          "The user's question or query to search for in the knowledge base"
        ),
    }),
  }
);

// 5. Put our tools into an array
const tools = [getWeather, searchKnowledgeBase];

// 5. Define the chat node, which will handle the chat logic
async function chat_node(state: AgentState, config: RunnableConfig) {
  // 5.1 Define the model, using gpt-4o-mini for cost efficiency
  const model = new ChatOpenAI({ temperature: 0, model: "gpt-4o-mini" });

  // 5.2 Bind the tools to the model, include CopilotKit actions. This allows
  //     the model to call tools that are defined in CopilotKit by the frontend.
  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
    ...tools,
  ]);

  // 5.3 Define the system message to enforce RAG-only approach (no LLM generation)
  const systemMessage = new SystemMessage({
    content: `You are a knowledge base assistant that ONLY returns information from the database.

CRITICAL RULES - NO EXCEPTIONS:
1. ALWAYS call searchKnowledgeBase tool for user questions
2. Return the EXACT response from searchKnowledgeBase WITHOUT any modifications, additions, or elaborations
3. Do NOT add your own knowledge, explanations, or interpretations
4. Do NOT rephrase, summarize, or rewrite the knowledge base response
5. Simply return what searchKnowledgeBase provides - nothing more, nothing less

This ensures 100% accuracy and zero hallucinations.`,
  });

  // 5.4 Invoke the model with the system message and the messages in the state
  const response = await modelWithTools.invoke(
    [systemMessage, ...state.messages],
    config
  );

  // 5.5 Log what tools were called (if any)
  const aiResponse = response as AIMessage;
  if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
  } else {
    console.log("[Agent] No tool calls made - responding directly");
  }

  // 5.6 Return the response, which will be added to the state
  return {
    messages: response,
  };
}

// 6. Define the function that determines whether to continue or not,
//    this is used to determine the next node to run
function shouldContinue({ messages, copilotkit }: AgentState) {
  // 6.1 Get the last message from the state
  const lastMessage = messages[messages.length - 1] as AIMessage;

  // 7.2 If the LLM makes a tool call, then we route to the "tools" node
  if (lastMessage.tool_calls?.length) {
    // Actions are the frontend tools coming from CopilotKit
    const actions = copilotkit?.actions;
    const toolCallName = lastMessage.tool_calls![0].name;

    // 7.3 Only route to the tool node if the tool call is not a CopilotKit action
    if (!actions || actions.every((action) => action.name !== toolCallName)) {
      return "tool_node";
    }
  }

  // 6.4 Otherwise, we stop (reply to the user) using the special "__end__" node
  return "__end__";
}

// Define the workflow graph
const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chat_node)
  .addNode("tool_node", new ToolNode(tools))
  .addEdge(START, "chat_node")
  .addEdge("tool_node", "chat_node")
  .addConditionalEdges("chat_node", shouldContinue as any);

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
});
