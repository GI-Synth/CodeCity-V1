export function buildTestGenerationPrompt(
  file: string,
  content: string,
  language: string,
): { system: string; prompt: string } {
  const truncated = content.slice(0, 2500);
  return {
    system:
      "You are an expert QA engineer. Output ONLY a JSON array of test cases. Each item: {name, type, input, expected, reasoning}. No markdown. No explanation. Valid JSON array only.",
    prompt: `Filename: ${file}\nLanguage: ${language}\n\nCode:\n${truncated}\n\nGenerate test cases as a JSON array.`,
  };
}

export function buildDialoguePrompt(
  npcRole: string,
  buildingFile: string,
  recentFindings: string[],
  question: string,
): { system: string; prompt: string } {
  const findings = recentFindings.slice(-3).join("; ") || "none yet";
  return {
    system:
      "You are a software testing NPC in a city simulation. Be helpful, specific, and brief (2-4 sentences). After your answer, add: CONFIDENCE:0.XX (a number from 0.0 to 1.0 reflecting your certainty).",
    prompt: `Role: ${npcRole}\nCurrently analyzing: ${buildingFile}\nRecent findings: ${findings}\n\nPlayer question: ${question}`,
  };
}

export function buildEscalationPrompt(
  question: string,
  codeSnippet: string,
  failedAttempts: string[],
): { system: string; prompt: string } {
  const code = codeSnippet.slice(0, 1500);
  const attempts = failedAttempts.slice(0, 3).map((a, i) => `Attempt ${i + 1}: ${a}`).join("\n");
  return {
    system:
      "You are a senior engineer consulted by an AI agent. Output ONLY valid JSON: {\"answer\": string, \"confidence\": number, \"action_items\": string[]}",
    prompt: `Question: ${question}\n\nCode snippet:\n${code}\n\nPrevious failed attempts:\n${attempts}`,
  };
}
