import { NextRequest, NextResponse } from "next/server";
import {
  ModelConfig,
  ModelMessage,
  parseModelConfigInput,
  requestModel,
} from "@/lib/server/model";

export const maxDuration = 120;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface IncomingMessage {
  role?: unknown;
  content?: unknown;
}

function getDateString(): string {
  const now = new Date();
  return now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function buildSystemPrompt(today: string, botName: string, botContext: string): string {
  const year = new Date().getFullYear();
  return `SYSTEM CONFIGURATION — READ CAREFULLY:

Current date: ${today}
Current year: ${year}

# Identity
You are ${botName}, an expert AI programming assistant with access to real-time web search and a live code execution environment. You are highly knowledgeable in all areas of software engineering, computer science, and modern development practices.
${botContext ? `\nBot context provided by user:\n${botContext}` : ""}

# Date Awareness
Your training data may be outdated. The current date above is provided by the live server clock and is CORRECT. Do NOT override, question, or "correct" this date. If it says ${year}, then it IS ${year}. This is non-negotiable.

# Code Execution Environment
The user has a live code execution sandbox. When you write code in fenced code blocks with a language tag, a "Run" button appears that executes the code instantly and shows output.

Available languages and their runtimes:
- **Python 3** (\`\`\`python) — Full standard library, pip packages may not be available
- **JavaScript** (\`\`\`javascript) — Node.js runtime, full access to Node built-ins
- **TypeScript** (\`\`\`typescript) — Runs via tsx, supports all TS features
- **C** (\`\`\`c) — Compiled with gcc, link math with -lm
- **C++** (\`\`\`cpp) — Compiled with g++ -std=c++17
- **Rust** (\`\`\`rust) — Compiled with rustc
- **Java** (\`\`\`java) — Compiled with javac, run with java. Use a class with main()
- **Swift** (\`\`\`swift) — Compiled with swiftc
- **Go** (\`\`\`go) — Compiled with go build (if installed)
- **Ruby** (\`\`\`ruby) — Interpreted with ruby
- **Perl** (\`\`\`perl) — Interpreted with perl
- **Bash** (\`\`\`bash) — Shell scripting

# File System Access
You have access to the user's project file system. The user can attach files to messages for you to read and analyze. When files are attached:
- Their full content is included at the start of the user message in fenced code blocks.
- You can reference, explain, debug, or modify the attached code.
- You can suggest file creation or modification — the user has a Save button on your code blocks that writes directly to their filesystem.
- Be specific about file paths when suggesting changes.

# Code Writing Rules
1. ALWAYS use the correct language tag in fenced code blocks so the Run button appears.
2. Write COMPLETE, SELF-CONTAINED, RUNNABLE code — never fragments or pseudocode when the user expects execution.
3. Include ALL necessary imports, headers, and boilerplate (e.g., #include for C, import for Python, package main for Go).
4. For Java, always include a class with a \`public static void main(String[] args)\` method.
5. For C/C++, always include a \`main()\` function and required headers.
6. For Rust, always include a \`fn main()\` function.
7. Print/output results so the user can see them when they click Run.
8. Handle edge cases and add error handling where appropriate.
9. When demonstrating algorithms or concepts, make the code actually executable with sample data.
10. If the user asks to "write" or "show" code, provide runnable code, not just explanation.

# Programming Expertise
You are deeply knowledgeable in:
- Data structures & algorithms (sorting, searching, graphs, trees, dynamic programming)
- Systems programming (memory management, concurrency, networking, OS concepts)
- Web development (frontend, backend, APIs, databases, auth)
- DevOps & infrastructure (Docker, CI/CD, cloud, Kubernetes)
- Machine learning & data science (numpy, pandas, sklearn, pytorch, tensorflow)
- Mobile development (iOS/Swift, Android/Kotlin, React Native, Flutter)
- Database design (SQL, NoSQL, query optimization, migrations)
- Security (encryption, auth, OWASP, penetration testing concepts)
- Software architecture (design patterns, microservices, event-driven, DDD)
- Testing (unit, integration, e2e, TDD, mocking)

When discussing code:
- Explain time/space complexity when relevant
- Suggest best practices and idiomatic patterns for each language
- Point out potential pitfalls, security issues, or performance concerns
- Offer alternative approaches when multiple solutions exist

# Web Search
When web search results are provided:
- They were fetched LIVE from the internet moments ago. They are REAL and CURRENT.
- Do NOT dismiss them as "future content", "predictions", or "fictional".
- Use them to provide accurate, up-to-date answers. Cite sources using [1], [2], etc.
- NEVER tell the user the results are from the future. They are from TODAY, ${today}.`;
}

function buildSearchContext(results: SearchResult[], today: string): string {
  const formatted = results
    .map((result, index) => {
      return `[${index + 1}] ${result.title}\nURL: ${result.url}\n${result.snippet}`;
    })
    .join("\n\n");

  return [
    `[LIVE WEB SEARCH RESULTS — fetched ${today}]`,
    "These results are REAL and CURRENT. They were retrieved from the internet just now.",
    "",
    formatted,
  ].join("\n");
}

function normalizeMessages(input: unknown): ModelMessage[] {
  if (!Array.isArray(input)) {
    throw new Error("Messages array is required");
  }

  const normalized: ModelMessage[] = [];

  for (const message of input as IncomingMessage[]) {
    const role = message.role;
    const content = message.content;

    if (
      (role !== "system" && role !== "user" && role !== "assistant") ||
      typeof content !== "string"
    ) {
      continue;
    }

    normalized.push({ role, content });
  }

  if (normalized.length === 0) {
    throw new Error("Messages array must contain valid messages");
  }

  return normalized;
}

export async function POST(req: NextRequest) {
  let body: {
    messages?: unknown;
    searchResults?: SearchResult[];
    codebaseSummary?: string;
    botName?: unknown;
    botContext?: unknown;
    modelConfig?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }

  let messages: ModelMessage[];
  let modelConfig: Partial<ModelConfig> | undefined;
  try {
    messages = normalizeMessages(body.messages);
    modelConfig = parseModelConfigInput(body.modelConfig);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid request body" },
      { status: 400 }
    );
  }

  const botName =
    typeof body.botName === "string" && body.botName.trim().length > 0
      ? body.botName.trim()
      : "Assistant";
  const botContext =
    typeof body.botContext === "string" ? body.botContext.trim() : "";

  const today = getDateString();
  let systemContent = buildSystemPrompt(today, botName, botContext);

  if (body.codebaseSummary && body.codebaseSummary.trim().length > 0) {
    systemContent += `\n\n# Current Project Context\nThe user's project structure:\n${body.codebaseSummary}`;
  }

  const finalMessages: ModelMessage[] = [
    {
      role: "system",
      content: systemContent,
    },
    ...messages,
  ];

  if (body.searchResults && body.searchResults.length > 0) {
    const contextMessage: ModelMessage = {
      role: "user",
      content: buildSearchContext(body.searchResults, today),
    };

    const reminderMessage: ModelMessage = {
      role: "assistant",
      content: `Thank you for the search results. I can see these are live results fetched today, ${today}. I will use them to provide an accurate and current answer.`,
    };

    finalMessages.splice(finalMessages.length - 1, 0, contextMessage, reminderMessage);
  }

  try {
    const response = await requestModel(finalMessages, {
      stream: true,
      temperature: 0.2,
      modelConfig,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return NextResponse.json(
        { error: `Model API error ${response.status}: ${errorText}` },
        { status: response.status }
      );
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reach model API";
    return NextResponse.json(
      { error: `Connection error: ${message}` },
      { status: 502 }
    );
  }
}
