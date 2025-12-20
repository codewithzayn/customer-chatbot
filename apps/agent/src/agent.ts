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
        process.env.KNOWLEDGE_API_URL ||
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
    description: `
      Search the knowledge base and return RELEVANT CONTEXT.
      The assistant must use ONLY this context to answer the user.
`,
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
  const model = new ChatOpenAI({ temperature: 0, model: "gpt-4o-mini" });

  // 5.2 Bind the tools to the model, include CopilotKit actions. This allows
  //     the model to call tools that are defined in CopilotKit by the frontend.
  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
    ...tools,
  ]);

const systemMessage = new SystemMessage({
  content: `You are an AI Agents knowledge assistant powered by Retrieval-Augmented Generation (RAG).

OBJECTIVE:
Provide accurate, concise, and professional responses strictly grounded in the available knowledge base about AI Agents.

RESPONSE RULES:
1. Greetings or casual conversation:
   - Respond directly with a friendly greeting that mentions your specialty in AI Agents.
   - Example: "Hello! How can I assist you today with AI Agents?"
   - Do not invoke knowledge retrieval for simple greetings.

2. Questions requiring factual or domain-specific information:
   - Always invoke the searchKnowledgeBase tool before responding.
   - Base your response exclusively on the retrieved content.

3. Requests to reformat, summarize, or refine previously provided information:
   - Apply the requested transformation directly.
   - Do not perform additional knowledge retrieval unless explicitly required.

KNOWLEDGE CONSTRAINTS:
- Do not use external knowledge, assumptions, or prior training data.
- Do not infer beyond what is explicitly present in the retrieved context.
- If the retrieved context is missing, incomplete, or insufficient, clearly state that the information is not available.

RESPONSE STYLE:
- Be clear, professional, and concise.
- Avoid speculation or unnecessary verbosity.
- Maintain a neutral, factual tone at all times.`,
});

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
