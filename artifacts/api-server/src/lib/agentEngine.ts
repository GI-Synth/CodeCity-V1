import { type NpcAgent } from "./types";

const AGENT_NAMES: Record<string, string[]> = {
  qa_inspector: ["Inspector Rex", "QA Quinn", "Test Titan", "Vera Verifix", "Ace Auditor"],
  api_fuzzer: ["Fuzzy McFuzz", "API Breaker", "Zara Zero-Day", "Rex Randomizer", "Glitch Hunter"],
  load_tester: ["Max Overload", "Storm Surge", "Traffic Terry", "Pressure Pete", "Load Lord"],
  edge_explorer: ["Edge Eddie", "Boundary Bob", "Null Ninja", "Corner Case Carl", "Extreme Ellie"],
  ui_navigator: ["Click Clicker", "Browser Bot", "UI Uma", "Nav Nemesis", "Page Pilot"],
};

const AGENT_COLORS: Record<string, string> = {
  qa_inspector: "#4a9eff",
  api_fuzzer: "#ff7a2a",
  load_tester: "#ffe44a",
  edge_explorer: "#4aff8c",
  ui_navigator: "#c44aff",
};

const IDLE_DIALOGUES: Record<string, string[]> = {
  qa_inspector: [
    "Scanning for uncovered functions...",
    "Looking for untested edge cases...",
    "Checking assertion coverage...",
    "Ready to generate test cases!",
    "Analyzing control flow complexity...",
  ],
  api_fuzzer: [
    "Probing endpoints for weak spots...",
    "Sending malformed payloads...",
    "Looking for injection vulnerabilities...",
    "Testing authentication bypass...",
    "Hammering that API!",
  ],
  load_tester: [
    "Calculating max throughput...",
    "Simulating 1000 concurrent users...",
    "Watching for memory leaks under load...",
    "Stress testing the database pool...",
    "Ready to bring the traffic!",
  ],
  edge_explorer: [
    "Testing null and undefined inputs...",
    "Checking integer overflow cases...",
    "Exploring boundary conditions...",
    "Finding race conditions...",
    "Probing error handling paths...",
  ],
  ui_navigator: [
    "Navigating user flows...",
    "Clicking every button I can find...",
    "Checking mobile responsiveness...",
    "Testing form validation...",
    "Automating user journeys...",
  ],
};

const WORKING_DIALOGUES = [
  "On it! Deep diving this building...",
  "Found something interesting here...",
  "Running analysis protocol...",
  "Cross-referencing with knowledge base...",
  "This code looks suspicious...",
  "Pattern match detected!",
];

const ESCALATION_DIALOGUES = [
  "This is beyond my local knowledge. Calling senior AI...",
  "Consulting the external oracle...",
  "Local model failed 3 times. Escalating...",
  "Need backup on this one!",
];

export function createAgent(role: NpcAgent["role"], targetBuilding: string | null = null): NpcAgent {
  const names = AGENT_NAMES[role];
  const name = names[Math.floor(Math.random() * names.length)];
  const dialogues = IDLE_DIALOGUES[role];

  return {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    role,
    status: "idle",
    currentBuilding: targetBuilding,
    currentTask: null,
    bugsFound: 0,
    testsGenerated: 0,
    escalations: 0,
    accuracy: 0.75 + Math.random() * 0.2,
    level: 1,
    dialogue: dialogues[Math.floor(Math.random() * dialogues.length)],
    x: Math.random() * 800,
    y: Math.random() * 600,
    color: AGENT_COLORS[role],
  };
}

export function getAgentDialogue(agent: NpcAgent): string {
  if (agent.status === "escalating") {
    return ESCALATION_DIALOGUES[Math.floor(Math.random() * ESCALATION_DIALOGUES.length)];
  }
  if (agent.status === "working") {
    return WORKING_DIALOGUES[Math.floor(Math.random() * WORKING_DIALOGUES.length)];
  }
  const dialogues = IDLE_DIALOGUES[agent.role];
  return dialogues[Math.floor(Math.random() * dialogues.length)];
}

export function simulateAgentTask(
  agent: NpcAgent,
  taskType: string,
  buildingName: string,
  context: string
): {
  result: string;
  actionItems: string[];
  bugsFound: number;
  escalated: boolean;
  fromKnowledgeBase: boolean;
} {
  const bugsFound = Math.random() < 0.35 ? Math.floor(Math.random() * 3) + 1 : 0;
  const escalated = agent.escalations < 5 && Math.random() < 0.06;
  const fromKnowledgeBase = !escalated && Math.random() < 0.3;

  const results: Record<string, string> = {
    generate_tests: `Generated ${Math.floor(Math.random() * 8) + 3} test cases for ${buildingName}. Found ${bugsFound} potential issues. Test coverage improved from ${Math.floor(Math.random() * 40 + 20)}% to ${Math.floor(Math.random() * 20 + 70)}%.`,
    analyze_bug: `Analyzed ${buildingName}. ${bugsFound > 0 ? `Found ${bugsFound} bugs: null pointer in line 42, race condition in async handler, missing error boundary.` : "No critical bugs found. Code looks clean."}`,
    fuzz_api: `Fuzzed ${buildingName} API with 500 random payloads. ${bugsFound > 0 ? `${bugsFound} endpoints vulnerable to malformed input.` : "All endpoints handled edge inputs gracefully."}`,
    load_test: `Load tested ${buildingName} with 100-2000 concurrent requests. P99 latency: ${Math.floor(Math.random() * 200 + 50)}ms. ${bugsFound > 0 ? "Memory leak detected under sustained load." : "Performance is stable."}`,
    explore_edge_cases: `Explored ${Math.floor(Math.random() * 20 + 10)} edge cases in ${buildingName}. ${bugsFound > 0 ? `${bugsFound} cases caused unexpected behavior.` : "All edge cases handled correctly."}`,
  };

  const actionItems = bugsFound > 0
    ? [
        `Add null checks in ${buildingName}`,
        `Increase test coverage for error paths`,
        `Review async error handling`,
        `Add input validation`,
      ].slice(0, bugsFound + 1)
    : [`Consider adding more edge case tests`, `Document the current behavior`];

  return {
    result: results[taskType] || `Completed ${taskType} on ${buildingName}.`,
    actionItems,
    bugsFound,
    escalated,
    fromKnowledgeBase,
  };
}

const AI_RESPONSES = [
  "I've analyzed this code thoroughly. The main issue is in the error handling — you're swallowing exceptions silently. Add proper try-catch blocks with logging.",
  "This function has a cyclomatic complexity of 15, which makes it hard to test. Consider breaking it into smaller functions.",
  "The database queries here are N+1 — you're fetching records in a loop. Use a JOIN or batch fetch instead.",
  "Missing input validation on this API endpoint. Any user can send malformed data and cause a 500 error.",
  "Race condition detected! Two async operations write to the same variable without a lock or atomic operation.",
  "Memory leak: you're creating event listeners but never removing them. Use cleanup functions.",
  "This code is actually well-structured! Good use of dependency injection and single responsibility principle.",
  "The test coverage looks good here. One suggestion: add property-based tests for the parsing functions.",
];

export function simulateAgentChat(
  agent: NpcAgent,
  message: string,
  buildingContext: string | null
): {
  message: string;
  escalated: boolean;
  fromKnowledgeBase: boolean;
  actionItems: string[];
} {
  const lower = message.toLowerCase();
  const escalated = lower.includes("how do i") || lower.includes("why") || Math.random() < 0.08;
  const fromKnowledgeBase = !escalated && Math.random() < 0.4;

  let response = AI_RESPONSES[Math.floor(Math.random() * AI_RESPONSES.length)];

  if (lower.includes("bug") || lower.includes("fix")) {
    response = "I found a potential issue: the error handling in this module doesn't cover all async failure paths. Wrap your await calls in try-catch blocks.";
  } else if (lower.includes("test")) {
    response = "For better test coverage, I recommend using parameterized tests. Start with the happy path, then add edge cases: null inputs, empty arrays, and boundary values.";
  } else if (lower.includes("performance") || lower.includes("slow")) {
    response = "Performance issue detected: database queries are not indexed on the foreign key columns. Add an index on user_id and created_at columns.";
  } else if (lower.includes("hello") || lower.includes("hi")) {
    response = `Hey! I'm ${agent.name}, your ${agent.role.replace("_", " ")}. I've been analyzing ${buildingContext || "the codebase"} and I'm ready to help!`;
  }

  return {
    message: response,
    escalated,
    fromKnowledgeBase,
    actionItems: escalated
      ? ["Review the escalated answer", "Apply recommended fix", "Run tests to verify"]
      : ["Check the relevant code section", "Add tests for the identified case"],
  };
}
