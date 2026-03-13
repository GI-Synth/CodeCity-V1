# Software City — Demo Guide

A 5-minute walkthrough to experience everything the app can do.

## Step 1: Open the City (30 seconds)

Navigate to the **City** tab. You'll see a pixel-art city with:
- Colored buildings (cyan = classes, orange = API files, purple = database, green = functions)
- Glowing roads connecting dependent files
- Moving NPC agents (colored dots with task icons)
- A health score and season indicator at the top

If no repo is loaded, a demo city is auto-generated.

## Step 2: Load a Real Repo (1 minute)

1. Click **Load Repo** in the sidebar
2. Enter any public GitHub URL, e.g.: `https://github.com/sindresorhus/p-queue`
3. Click **Analyze**
4. Watch the city rebuild in real time

For private repos: enter your GitHub PAT in the token field. It is never stored.

## Step 3: Explore the Map (1 minute)

- **Scroll** to zoom in/out
- **Drag** to pan
- **Click a building** to open the inspector (file path, complexity, imports, agent activity)
- Press `?` to see all keyboard shortcuts

Notice buildings with 🔥 (bugs), ✨ (excellent coverage), or 🚨 (alarms).

## Step 4: Watch the Agents (1 minute)

Go to the **Agents** tab. Each agent has:
- A role (QA Inspector, API Fuzzer, Load Tester, etc.)
- A level and rank (junior → mid → senior → principal)
- Bug count, test count, accuracy

Back on the city map, hover over an agent to see their current thought bubble.

## Step 5: Check the Knowledge Base (30 seconds)

Go to **Knowledge**. This is the persistent memory agents build over time:
- Each entry is a pattern learned from escalation
- Entries are retrieved by semantic similarity
- Agents that hit KB entries get a ⚡ KB hit badge

## Step 6: Export the City (30 seconds)

On the city view, click **Export ▾**:
- **JSON Snapshot** — full city state for archiving
- **SVG Map** — vector image of the current city view
- **Markdown Report** — human-readable summary with agent table and event log

## Step 7: Metrics Dashboard (30 seconds)

Go to **Metrics**. You'll see:
- 8 stat cards: bugs found, tests generated, escalations, KB hits, etc.
- SVG line charts showing health score and agent activity over time
- Data is snapshotted every 30 seconds automatically

## What to Show Someone in 60 Seconds

1. Open the city → "This is your codebase as a city"
2. Click a building → "This is one source file"
3. Point to a moving agent → "This AI is writing tests for it right now"
4. Point to a fire building → "This one has a detected bug"
5. Open Metrics → "Here's the trend over time"

That's Software City.
