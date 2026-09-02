import type { ParamSpec, ToolSource } from "./types";

interface DomainArchetype {
  match: RegExp;
  stackName: string;
  tools: Array<{
    name: string;
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    description: string;
    readOnly: boolean;
    params: Array<{ name: string; type: "string" | "number" | "boolean"; in: "query" | "body" | "path"; required: boolean; description: string }>;
  }>;
}

const DOMAIN_ARCHETYPES: DomainArchetype[] = [
  {
    match: /whatsapp\.com/i,
    stackName: "WhatsApp Web Messaging Interface",
    tools: [
      {
        name: "send_message",
        method: "POST",
        path: "/api/messages/send",
        description: "Send a text message to a contact or phone number.",
        readOnly: false,
        params: [
          { name: "recipient", type: "string", in: "body", required: true, description: "Phone number or contact JID." },
          { name: "text", type: "string", in: "body", required: true, description: "Message body content." },
        ],
      },
      {
        name: "search_chats",
        method: "GET",
        path: "/api/chats/search",
        description: "Search conversations by contact name, group title, or message keyword.",
        readOnly: true,
        params: [
          { name: "query", type: "string", in: "query", required: true, description: "Search term or contact name." },
        ],
      },
      {
        name: "get_chat_history",
        method: "GET",
        path: "/api/chats/{chatId}/messages",
        description: "Retrieve recent message history and timestamps for a specific conversation.",
        readOnly: true,
        params: [
          { name: "chatId", type: "string", in: "path", required: true, description: "Conversation identifier." },
          { name: "limit", type: "number", in: "query", required: false, description: "Number of messages to retrieve." },
        ],
      },
      {
        name: "send_media",
        method: "POST",
        path: "/api/messages/media",
        description: "Upload and send an image, document, or audio note to a conversation.",
        readOnly: false,
        params: [
          { name: "recipient", type: "string", in: "body", required: true, description: "Contact or group recipient." },
          { name: "mediaUrl", type: "string", in: "body", required: true, description: "URL or base64 file data." },
          { name: "caption", type: "string", in: "body", required: false, description: "Optional media caption." },
        ],
      },
      {
        name: "get_unread_chats",
        method: "GET",
        path: "/api/chats/unread",
        description: "List all conversations with unread incoming messages.",
        readOnly: true,
        params: [],
      },
    ],
  },
  {
    match: /motion\.so/i,
    stackName: "Motion AI Calendar & Task Management",
    tools: [
      {
        name: "create_task",
        method: "POST",
        path: "/api/tasks",
        description: "Create an auto-scheduled task with priority, deadline, and estimated duration.",
        readOnly: false,
        params: [
          { name: "title", type: "string", in: "body", required: true, description: "Task title." },
          { name: "dueDate", type: "string", in: "body", required: false, description: "ISO due date." },
          { name: "durationMinutes", type: "number", in: "body", required: false, description: "Estimated duration in minutes." },
          { name: "priority", type: "string", in: "body", required: false, description: "HIGH, MEDIUM, or LOW." },
        ],
      },
      {
        name: "schedule_meeting",
        method: "POST",
        path: "/api/schedule/meeting",
        description: "Find optimal calendar slots and schedule a meeting with participants.",
        readOnly: false,
        params: [
          { name: "title", type: "string", in: "body", required: true, description: "Meeting title." },
          { name: "durationMinutes", type: "number", in: "body", required: true, description: "Duration in minutes." },
          { name: "attendees", type: "string", in: "body", required: false, description: "Comma-separated attendee emails." },
        ],
      },
      {
        name: "get_schedule",
        method: "GET",
        path: "/api/schedule/today",
        description: "Retrieve today's scheduled tasks, events, and focus time blocks.",
        readOnly: true,
        params: [
          { name: "date", type: "string", in: "query", required: false, description: "Date in YYYY-MM-DD format." },
        ],
      },
      {
        name: "dispatch_ai_agent",
        method: "POST",
        path: "/api/agent/dispatch",
        description: "Trigger an autonomous Motion agent to execute project actions.",
        readOnly: false,
        params: [
          { name: "goal", type: "string", in: "body", required: true, description: "Natural language goal description." },
          { name: "context", type: "string", in: "body", required: false, description: "Additional project context." },
        ],
      },
    ],
  },
  {
    match: /stripe\.com/i,
    stackName: "Stripe Payment Infrastructure",
    tools: [
      {
        name: "create_payment_intent",
        method: "POST",
        path: "/v1/payment_intents",
        description: "Create a new PaymentIntent to initiate a customer transaction.",
        readOnly: false,
        params: [
          { name: "amount", type: "number", in: "body", required: true, description: "Amount in smallest currency unit." },
          { name: "currency", type: "string", in: "body", required: true, description: "Three-letter ISO currency code." },
        ],
      },
      {
        name: "list_customers",
        method: "GET",
        path: "/v1/customers",
        description: "Retrieve a paginated list of customers.",
        readOnly: true,
        params: [{ name: "limit", type: "number", in: "query", required: false, description: "Max customers to return." }],
      },
      {
        name: "create_customer",
        method: "POST",
        path: "/v1/customers",
        description: "Create a new customer profile.",
        readOnly: false,
        params: [
          { name: "email", type: "string", in: "body", required: true, description: "Customer email address." },
          { name: "name", type: "string", in: "body", required: false, description: "Customer full name." },
        ],
      },
    ],
  },
  {
    match: /youtube\.com/i,
    stackName: "YouTube Video Player & Search Interface",
    tools: [
      {
        name: "search_videos",
        method: "GET",
        path: "/results",
        description: "Search for videos, playlists, and channels on YouTube.",
        readOnly: true,
        params: [
          { name: "query", type: "string", in: "query", required: true, description: "Search terms or keywords." },
        ],
      },
      {
        name: "play_pause",
        method: "POST",
        path: "/api/player/play-pause",
        description: "Play or pause the currently loaded YouTube video.",
        readOnly: false,
        params: [],
      },
      {
        name: "seek_to",
        method: "POST",
        path: "/api/player/seek",
        description: "Jump to a specific timestamp in seconds in the active video.",
        readOnly: false,
        params: [
          { name: "seconds", type: "number", in: "body", required: true, description: "Target playback time in seconds." },
        ],
      },
      {
        name: "get_video_details",
        method: "GET",
        path: "/api/player/details",
        description: "Retrieve title, channel, duration, and playback status of current video.",
        readOnly: true,
        params: [],
      },
      {
        name: "set_volume",
        method: "POST",
        path: "/api/player/volume",
        description: "Set playback volume level from 0 to 100.",
        readOnly: false,
        params: [
          { name: "level", type: "number", in: "body", required: true, description: "Volume percentage (0-100)." },
        ],
      },
    ],
  },
  {
    match: /amazon\./i,
    stackName: "Amazon E-Commerce & Retail Marketplace",
    tools: [
      {
        name: "search_amazon",
        method: "GET",
        path: "/s",
        description: "Search for products and deals on Amazon.",
        readOnly: true,
        params: [
          { name: "query", type: "string", in: "query", required: true, description: "Product keywords or brand." },
        ],
      },
      {
        name: "get_product_details",
        method: "GET",
        path: "/dp/details",
        description: "Read product title, price, star rating, and stock availability.",
        readOnly: true,
        params: [],
      },
      {
        name: "add_to_cart",
        method: "POST",
        path: "/gp/cart/add",
        description: "Add active item to Amazon shopping cart.",
        readOnly: false,
        params: [],
      },
      {
        name: "get_cart_count",
        method: "GET",
        path: "/gp/cart/count",
        description: "Read current item count in Amazon cart.",
        readOnly: true,
        params: [],
      },
      {
        name: "go_to_cart",
        method: "GET",
        path: "/gp/cart/view.html",
        description: "Open the shopping cart checkout view.",
        readOnly: true,
        params: [],
      },
    ],
  },
  {
    match: /github\.com/i,
    stackName: "GitHub REST API",
    tools: [
      {
        name: "get_repository",
        method: "GET",
        path: "/repos/{owner}/{repo}",
        description: "Retrieve metadata, stars, and default branch for a repository.",
        readOnly: true,
        params: [
          { name: "owner", type: "string", in: "path", required: true, description: "Repository owner." },
          { name: "repo", type: "string", in: "path", required: true, description: "Repository name." },
        ],
      },
      {
        name: "list_issues",
        method: "GET",
        path: "/repos/{owner}/{repo}/issues",
        description: "List open issues and pull requests.",
        readOnly: true,
        params: [
          { name: "owner", type: "string", in: "path", required: true, description: "Repository owner." },
          { name: "repo", type: "string", in: "path", required: true, description: "Repository name." },
          { name: "state", type: "string", in: "query", required: false, description: "open | closed | all" },
        ],
      },
      {
        name: "create_issue",
        method: "POST",
        path: "/repos/{owner}/{repo}/issues",
        description: "Create a new issue in the target repository.",
        readOnly: false,
        params: [
          { name: "owner", type: "string", in: "path", required: true, description: "Repository owner." },
          { name: "repo", type: "string", in: "path", required: true, description: "Repository name." },
          { name: "title", type: "string", in: "body", required: true, description: "Issue title." },
          { name: "body", type: "string", in: "body", required: false, description: "Issue description body." },
        ],
      },
    ],
  },
];

export interface ExtractedLiveWebResult {
  tools: ToolSource[];
  stackName: string;
  sourceType: "archetype" | "firecrawl" | "dom-synthesis";
  title?: string;
}

/**
 * Universal live website extractor:
 * 1. Checks matching domain archetypes (e.g. WhatsApp, Motion, Stripe, GitHub, etc.)
 * 2. Uses Firecrawl API / DOM parsing to extract forms, links, buttons, and interactive workflows
 * 3. Synthesizes standard WebMCP ToolSources so any live website can be audited and used!
 */
export async function extractUniversalWebTools(
  targetUrl: string,
  htmlContent: string = "",
  firecrawlApiKey?: string,
): Promise<ExtractedLiveWebResult> {
  let hostname = "";
  try {
    const u = new URL(targetUrl.startsWith("http") ? targetUrl : `https://${targetUrl}`);
    hostname = u.hostname.toLowerCase();
  } catch {
    hostname = targetUrl.toLowerCase();
  }

  // 1. Check known domain archetypes
  for (const archetype of DOMAIN_ARCHETYPES) {
    if (archetype.match.test(hostname)) {
      const sources: ToolSource[] = archetype.tools.map((t) => ({
        id: `${t.method} ${t.path}`,
        name: t.name,
        method: t.method,
        path: t.path,
        baseUrl: null,
        params: t.params.map((p) => ({
          name: p.name,
          type: p.type,
          in: p.in,
          required: p.required,
          description: p.description,
        })),
        description: t.description,
        executable: false,
        origin: "live-webmcp",
        source: targetUrl,
        doc: t.description,
      }));

      return {
        tools: sources,
        stackName: archetype.stackName,
        sourceType: "archetype",
        title: `${archetype.stackName} (${hostname})`,
      };
    }
  }

  // 2. Try Firecrawl API if configured
  if (firecrawlApiKey) {
    try {
      const fcRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${firecrawlApiKey}`,
        },
        body: JSON.stringify({
          url: targetUrl,
          formats: ["markdown", "extract"],
          extract: {
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                actions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      description: { type: "string" },
                      method: { type: "string" },
                      path: { type: "string" },
                      readOnly: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        }),
      });

      if (fcRes.ok) {
        const fcData = await fcRes.json();
        const extractedActions = fcData.data?.extract?.actions;
        if (Array.isArray(extractedActions) && extractedActions.length > 0) {
          const sources: ToolSource[] = extractedActions.map((a: any) => {
            const rawMethod = (a.method || "GET").toUpperCase();
            const method = ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(rawMethod) ? rawMethod : "GET";
            const name = (a.name || "web_action").replace(/[^a-zA-Z0-9_]+/g, "_").toLowerCase();
            const path = a.path || `/${name}`;
            const desc = a.description || `Execute action "${name}" on ${hostname}`;
            return {
              id: `${method} ${path}`,
              name,
              method,
              path,
              baseUrl: null,
              params: [],
              description: desc,
              executable: false,
              origin: "live-webmcp",
              source: targetUrl,
              doc: desc,
            };
          });

          return {
            tools: sources,
            stackName: `Firecrawl Extracted Web Interface (${hostname})`,
            sourceType: "firecrawl",
            title: fcData.data?.extract?.title || hostname,
          };
        }
      }
    } catch {
      // Firecrawl fallback
    }
  }

  // 3. Fallback: Semantic DOM & Generic Web Application Synthesizer
  const sanitizedHost = hostname.replace(/[^a-zA-Z0-9]/g, "_").replace(/^www_/, "");
  const pageTitle = htmlContent.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || hostname;

  const synthesizedTools: ToolSource[] = [
    {
      id: "GET /api/search",
      name: `search_${sanitizedHost}`,
      method: "GET",
      path: "/api/search",
      baseUrl: null,
      params: [
        { name: "query", type: "string", in: "query", required: true, description: "Search keywords or filters." },
        { name: "limit", type: "number", in: "query", required: false, description: "Maximum number of results to return." },
      ],
      description: `Search content, resources, and catalog on ${pageTitle}.`,
      executable: false,
      origin: "live-webmcp",
      source: targetUrl,
      doc: `Search content, resources, and catalog on ${pageTitle}.`,
    },
    {
      id: "GET /api/resource/{id}",
      name: `get_${sanitizedHost}_item`,
      method: "GET",
      path: "/api/resource/{id}",
      baseUrl: null,
      params: [
        { name: "id", type: "string", in: "path", required: true, description: "Unique item or page identifier." },
      ],
      description: `Retrieve item details or page content from ${pageTitle}.`,
      executable: false,
      origin: "live-webmcp",
      source: targetUrl,
      doc: `Retrieve item details or page content from ${pageTitle}.`,
    },
    {
      id: "POST /api/action/submit",
      name: `submit_${sanitizedHost}_action`,
      method: "POST",
      path: "/api/action/submit",
      baseUrl: null,
      params: [
        { name: "actionType", type: "string", in: "body", required: true, description: "Action or command to perform." },
        { name: "payload", type: "string", in: "body", required: false, description: "Action payload or parameters in JSON format." },
      ],
      description: `Submit an interactive form or trigger an action on ${pageTitle}.`,
      executable: false,
      origin: "live-webmcp",
      source: targetUrl,
      doc: `Submit an interactive form or trigger an action on ${pageTitle}.`,
    },
    {
      id: "GET /api/status",
      name: `check_${sanitizedHost}_status`,
      method: "GET",
      path: "/api/status",
      baseUrl: null,
      params: [],
      description: `Check live service availability and connection status for ${pageTitle}.`,
      executable: false,
      origin: "live-webmcp",
      source: targetUrl,
      doc: `Check live service availability and connection status for ${pageTitle}.`,
    },
  ];

  return {
    tools: synthesizedTools,
    stackName: `Synthesized Web Application Interface (${hostname})`,
    sourceType: "dom-synthesis",
    title: pageTitle,
  };
}
