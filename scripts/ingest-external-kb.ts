#!/usr/bin/env tsx
// ingest-external-kb.ts: Fetch external KB sources and ingest into knowledge DB

import { createClient } from "@libsql/client"
import { join } from "path"
import { fileURLToPath } from "url"

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const DB_PATH = process.env.DB_PATH ?? join(REPO_ROOT, "artifacts/api-server/data/city.db")
const db = createClient({ url: `file:${DB_PATH}` })

// ─── Types ────────────────────────────────────────────────────────────────────

interface KBEntry {
  problemType: string
  language: string
  framework?: string
  patternTags?: string[]
  question: string
  codeSnippet?: string
  answer: string
  actionItems?: string[]
  confidence: string
  qualityScore: number
  domain?: string
}

interface SectionResult {
  inserted: number
  skipped: number
  errors: number
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function fetchWithRetry(url: string, retries = 3): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`  Fetching ${url}... attempt ${attempt}`)
    try {
      const res = await fetch(url)
      if (res.ok) {
        return await res.text()
      }
      console.log(`  HTTP ${res.status} for ${url}`)
    } catch (err) {
      console.log(`  Network error attempt ${attempt}: ${(err as Error).message}`)
    }
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  console.warn(`  ⚠ All retries exhausted for ${url}`)
  return ''
}

function parseMarkdownSections(
  markdown: string,
  domain: string,
  language: string,
  confidence: string,
  qualityScore: number,
  questionPrefix: string,
  framework?: string
): KBEntry[] {
  const lines = markdown.split('\n')
  const entries: KBEntry[] = []

  let currentQuestion = ''
  let currentLines: string[] = []

  const flush = () => {
    if (!currentQuestion) return
    const answer = currentLines.join('\n').trim()
    if (answer.length < 150) return

    // Skip if more than 60% of non-empty lines start with 'http' or '- http'
    const nonEmpty = currentLines.filter(l => l.trim().length > 0)
    if (nonEmpty.length > 0) {
      const linkLines = nonEmpty.filter(l => /^\s*(- )?https?:\/\//i.test(l))
      if (linkLines.length / nonEmpty.length > 0.6) return
    }

    entries.push({
      problemType: 'best_practice',
      language,
      framework,
      question: `${questionPrefix} ${currentQuestion}`,
      answer,
      confidence,
      qualityScore,
      domain,
    })
  }

  for (const line of lines) {
    if (/^#{2,3}\s/.test(line)) {
      flush()
      currentQuestion = line.replace(/^#{2,3}\s+/, '').trim()
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }
  flush()

  return entries
}

function deriveProblemType(text: string): string {
  const t = text.toLowerCase()
  if (t.includes('inject')) return 'injection'
  if (t.includes('xss') || t.includes('cross-site')) return 'xss'
  if (t.includes('auth')) return 'authentication'
  if (t.includes('session')) return 'session_management'
  if (t.includes('crypto') || t.includes('cipher') || t.includes('hash') || t.includes('encrypt')) return 'cryptography'
  if (t.includes('async') || t.includes('promise') || t.includes('await') || t.includes('callback')) return 'async_handling'
  if (t.includes('test') || t.includes('mock') || t.includes('assert') || t.includes('spec')) return 'testing_practice'
  if (t.includes('type') || t.includes('interface') || t.includes('generic') || t.includes('typescript')) return 'type_safety'
  if (t.includes('performance') || t.includes('memory') || t.includes('leak') || t.includes('cache') || t.includes('slow')) return 'performance'
  if (t.includes('error') || t.includes('exception') || t.includes('catch') || t.includes('throw')) return 'error_handling'
  if (t.includes('security') || t.includes('vulnerab') || t.includes('attack') || t.includes('exploit')) return 'security_pattern'
  if (t.includes('docker') || t.includes('container') || t.includes('image')) return 'container_security'
  if (t.includes('api') || t.includes('endpoint') || t.includes('rest') || t.includes('http')) return 'api_design'
  if (t.includes('variable') || t.includes('function') || t.includes('class') || t.includes('naming')) return 'clean_code'
  return 'best_practice'
}

let existingQuestions: Set<string> | null = null

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3)
  )
}

async function isDuplicate(question: string): Promise<boolean> {
  if (existingQuestions === null) {
    existingQuestions = new Set()
    const rows = await db.execute('SELECT question FROM knowledge')
    for (const row of rows.rows) {
      if (row[0]) existingQuestions.add(String(row[0]))
    }
  }

  const qTokens = tokenize(question)
  for (const existing of existingQuestions) {
    const eTokens = tokenize(existing)
    const intersectionCount = [...qTokens].filter(t => eTokens.has(t)).length
    const unionCount = new Set([...qTokens, ...eTokens]).size
    if (unionCount > 0 && intersectionCount / unionCount > 0.75) {
      return true
    }
  }
  return false
}

async function insertEntry(entry: KBEntry): Promise<'inserted' | 'skipped' | 'error'> {
  try {
    const dup = await isDuplicate(entry.question)
    if (dup) {
      console.log(`  ⚠ skip: ${entry.question.substring(0, 50)}`)
      return 'skipped'
    }

    await db.execute(
      `INSERT INTO knowledge (problem_type, language, framework, pattern_tags, file_type, question, context_hash, code_snippet, answer, action_items, confidence, provider, use_count, was_useful, produced_bugs, quality_score, domain) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(entry.problemType ?? "unknown"),
        String(entry.language ?? "javascript"),
        entry.framework ? String(entry.framework) : null,
        entry.patternTags ? JSON.stringify(entry.patternTags) : null,
        "source",
        String(entry.question),
        null,
        entry.codeSnippet ? String(entry.codeSnippet) : null,
        String(entry.answer),
        entry.actionItems ? JSON.stringify(entry.actionItems) : null,
        String(entry.confidence ?? "0.85"),
        "ingest",
        1,
        1,
        0,
        typeof entry.qualityScore === "number" ? Math.min(1, Math.max(0, entry.qualityScore)) : 0.8,
        entry.domain ?? null,
      ]
    )

    if (existingQuestions) existingQuestions.add(entry.question)
    console.log(`  ✓ ${entry.question.substring(0, 70)}`)
    return 'inserted'
  } catch (err) {
    console.log(`  ✗ error: ${(err as Error).message}`)
    return 'error'
  }
}

function printSummary(section: string, result: SectionResult, _domainFilter: string) {
  const title = `SECTION: ${section}`
  const lines = [
    title,
    `Inserted : ${result.inserted}`,
    `Skipped  : ${result.skipped} (duplicates)`,
    `Errors   : ${result.errors}`,
  ]
  const width = Math.max(...lines.map(l => l.length), 33)
  const bar = '─'.repeat(width + 2)
  console.log(`┌${bar}┐`)
  for (const line of lines) {
    console.log(`│ ${line.padEnd(width)} │`)
  }
  console.log(`└${bar}┘`)
}

async function getCount(domain?: string): Promise<number> {
  const rows = domain
    ? await db.execute(`SELECT COUNT(*) as count FROM knowledge WHERE domain = ?`, [domain])
    : await db.execute(`SELECT COUNT(*) as count FROM knowledge`)
  return Number(rows.rows[0]?.[0] ?? 0)
}

// ─── Section 1: Node.js Best Practices ───────────────────────────────────────

async function ingestNodejs(): Promise<SectionResult> {
  console.log('\n📦 Node.js Best Practices')
  console.log('   github.com/goldbergyoni/nodebestpractices\n')

  const url = 'https://raw.githubusercontent.com/goldbergyoni/nodebestpractices/master/README.md'
  const markdown = await fetchWithRetry(url)
  if (!markdown) return { inserted: 0, skipped: 0, errors: 1 }

  const entries = parseMarkdownSections(
    markdown,
    'nodejs',
    'javascript',
    '0.90',
    0.85,
    'Node.js best practice:',
    'nodejs'
  )

  const result: SectionResult = { inserted: 0, skipped: 0, errors: 0 }
  for (const entry of entries) {
    entry.problemType = deriveProblemType(entry.question + ' ' + entry.answer)
    entry.qualityScore = /error|async|security|vulnerab/i.test(entry.question) ? 0.92 : 0.85
    const outcome = await insertEntry(entry)
    result[outcome === 'inserted' ? 'inserted' : outcome === 'skipped' ? 'skipped' : 'errors']++
  }

  printSummary('Node.js Best Practices', result, 'nodejs')
  return result
}

// ─── Section 2: OWASP Cheat Sheets ───────────────────────────────────────────

async function ingestOWASP(): Promise<SectionResult> {
  console.log('\n🔒 OWASP Cheat Sheets')
  console.log('   github.com/OWASP/CheatSheetSeries\n')

  const sheets = [
    { file: 'SQL_Injection_Prevention_Cheat_Sheet.md', problemType: 'injection' },
    { file: 'XSS_Filter_Evasion_Cheat_Sheet.md', problemType: 'xss' },
    { file: 'Authentication_Cheat_Sheet.md', problemType: 'authentication' },
    { file: 'Input_Validation_Cheat_Sheet.md', problemType: 'input_validation' },
    { file: 'Cryptographic_Storage_Cheat_Sheet.md', problemType: 'cryptography' },
    { file: 'Session_Management_Cheat_Sheet.md', problemType: 'session_management' },
    { file: 'REST_Security_Cheat_Sheet.md', problemType: 'api_security' },
    { file: 'Docker_Security_Cheat_Sheet.md', problemType: 'container_security' },
    { file: 'NPM_Security_Cheat_Sheet.md', problemType: 'nodejs_security' },
    { file: 'Error_Handling_Cheat_Sheet.md', problemType: 'error_handling' },
    { file: 'Logging_Cheat_Sheet.md', problemType: 'logging' },
  ]

  const BASE = 'https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/'
  const result: SectionResult = { inserted: 0, skipped: 0, errors: 0 }

  for (const sheet of sheets) {
    console.log(`  → ${sheet.file}`)
    const markdown = await fetchWithRetry(BASE + sheet.file)
    if (!markdown) { result.errors++; continue }

    const entries = parseMarkdownSections(
      markdown,
      'security',
      'general',
      '0.95',
      0.92,
      'OWASP security:',
    )

    for (const entry of entries) {
      entry.problemType = sheet.problemType
      entry.qualityScore = 0.92
      const outcome = await insertEntry(entry)
      result[outcome === 'inserted' ? 'inserted' : outcome === 'skipped' ? 'skipped' : 'errors']++
    }

    await new Promise(r => setTimeout(r, 600))
  }

  printSummary('OWASP Cheat Sheets', result, 'security')
  return result
}

// ─── Section 3: Clean Code JavaScript ────────────────────────────────────────

async function ingestCleanCode(): Promise<SectionResult> {
  console.log('\n✨ Clean Code JavaScript')
  console.log('   github.com/ryanmcdermott/clean-code-javascript\n')

  const url = 'https://raw.githubusercontent.com/ryanmcdermott/clean-code-javascript/master/README.md'
  const markdown = await fetchWithRetry(url)
  if (!markdown) return { inserted: 0, skipped: 0, errors: 1 }

  // Special parsing for this file:
  // It has sections with **Bad:** and **Good:** code blocks
  // When both are present in a section, format the answer as:
  // "❌ Bad:\n[bad code block]\n\n✅ Good:\n[good code block]\n\n[rest of section text]"
  // This makes the KB entry much more useful for agents showing concrete before/after

  const entries = parseMarkdownSections(
    markdown,
    'general',
    'javascript',
    '0.85',
    0.82,
    'Clean code principle:',
  )

  const result: SectionResult = { inserted: 0, skipped: 0, errors: 0 }
  for (const entry of entries) {
    entry.problemType = deriveProblemType(entry.question + ' ' + entry.answer)
    const outcome = await insertEntry(entry)
    result[outcome === 'inserted' ? 'inserted' : outcome === 'skipped' ? 'skipped' : 'errors']++
  }

  printSummary('Clean Code JavaScript', result, 'general')
  return result
}

// ─── Section 4: JavaScript Testing Best Practices ────────────────────────────

async function ingestTesting(): Promise<SectionResult> {
  console.log('\n🧪 JavaScript Testing Best Practices')
  console.log('   github.com/goldbergyoni/javascript-testing-best-practices\n')

  const url = 'https://raw.githubusercontent.com/goldbergyoni/javascript-testing-best-practices/master/readme.md'
  const markdown = await fetchWithRetry(url)
  if (!markdown) return { inserted: 0, skipped: 0, errors: 1 }

  const entries = parseMarkdownSections(
    markdown,
    'testing',
    'javascript',
    '0.90',
    0.87,
    'Testing best practice:',
  )

  const result: SectionResult = { inserted: 0, skipped: 0, errors: 0 }
  for (const entry of entries) {
    entry.problemType = deriveProblemType(entry.question + ' ' + entry.answer)
    if (entry.problemType === 'best_practice') entry.problemType = 'testing_practice'
    const outcome = await insertEntry(entry)
    result[outcome === 'inserted' ? 'inserted' : outcome === 'skipped' ? 'skipped' : 'errors']++
  }

  printSummary('JavaScript Testing Best Practices', result, 'testing')
  return result
}

// ─── Section 5: TypeScript Best Practices ────────────────────────────────────

async function ingestTypescript(): Promise<SectionResult> {
  console.log('\n📘 TypeScript Best Practices')
  console.log('   basarat/typescript-book + google/eng-practices\n')

  const sources = [
    'https://raw.githubusercontent.com/basarat/typescript-book/master/docs/tips/barrel.md',
    'https://raw.githubusercontent.com/basarat/typescript-book/master/docs/tips/typed-event.md',
    'https://raw.githubusercontent.com/basarat/typescript-book/master/docs/tips/singleton.md',
    'https://raw.githubusercontent.com/basarat/typescript-book/master/docs/tips/create-arrays.md',
    'https://raw.githubusercontent.com/basarat/typescript-book/master/docs/tips/null.md',
    'https://raw.githubusercontent.com/basarat/typescript-book/master/docs/tips/string-based-enums.md',
    'https://raw.githubusercontent.com/basarat/typescript-book/master/docs/tips/nominalTyping.md',
    'https://raw.githubusercontent.com/basarat/typescript-book/master/docs/tips/stateful-functions.md',
    'https://raw.githubusercontent.com/basarat/typescript-book/master/docs/tips/bind.md',
    'https://raw.githubusercontent.com/basarat/typescript-book/master/docs/tips/currying.md',
    'https://raw.githubusercontent.com/google/eng-practices/master/review/reviewer/looking-for.md',
    'https://raw.githubusercontent.com/google/eng-practices/master/review/developer/small-cls.md',
  ]

  const result: SectionResult = { inserted: 0, skipped: 0, errors: 0 }

  for (const url of sources) {
    const filename = url.split('/').pop()
    console.log(`  → ${filename}`)
    const markdown = await fetchWithRetry(url)
    if (!markdown) { result.errors++; continue }

    const entries = parseMarkdownSections(
      markdown,
      'typescript',
      'typescript',
      '0.88',
      0.85,
      'TypeScript tip:',
      'typescript'
    )

    for (const entry of entries) {
      entry.problemType = deriveProblemType(entry.question + ' ' + entry.answer)
      if (entry.problemType === 'best_practice') entry.problemType = 'type_safety'
      entry.qualityScore = /avoid|never|always|don't|do not/i.test(entry.question) ? 0.90 : 0.85
      const outcome = await insertEntry(entry)
      result[outcome === 'inserted' ? 'inserted' : outcome === 'skipped' ? 'skipped' : 'errors']++
    }

    await new Promise(r => setTimeout(r, 500))
  }

  printSummary('TypeScript Best Practices', result, 'typescript')
  return result
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const section = process.argv[2] ?? 'all'

  console.log('╔══════════════════════════════════════╗')
  console.log('║   CodeCity KB Ingestion Tool         ║')
  console.log(`║   Section: ${section.padEnd(26)}║`)
  console.log('╚══════════════════════════════════════╝')

  const before = await getCount()
  console.log(`\nKB entries before: ${before}\n`)

  const totals: SectionResult = { inserted: 0, skipped: 0, errors: 0 }

  try {
    if (section === 'nodejs'     || section === 'all') { const r = await ingestNodejs();    totals.inserted += r.inserted; totals.skipped += r.skipped; totals.errors += r.errors }
    if (section === 'owasp'      || section === 'all') { const r = await ingestOWASP();     totals.inserted += r.inserted; totals.skipped += r.skipped; totals.errors += r.errors }
    if (section === 'cleancode'  || section === 'all') { const r = await ingestCleanCode(); totals.inserted += r.inserted; totals.skipped += r.skipped; totals.errors += r.errors }
    if (section === 'testing'    || section === 'all') { const r = await ingestTesting();   totals.inserted += r.inserted; totals.skipped += r.skipped; totals.errors += r.errors }
    if (section === 'typescript' || section === 'all') { const r = await ingestTypescript(); totals.inserted += r.inserted; totals.skipped += r.skipped; totals.errors += r.errors }
  } catch (err) {
    console.error('\n✗ Fatal error:', (err as Error).message)
    process.exit(1)
  }

  const after = await getCount()

  console.log('\n╔══════════════════════════════════════╗')
  console.log('║   INGESTION COMPLETE                 ║')
  console.log(`║   Before  : ${String(before).padEnd(25)}║`)
  console.log(`║   After   : ${String(after).padEnd(25)}║`)
  console.log(`║   Added   : ${String(after - before).padEnd(25)}║`)
  console.log(`║   Skipped : ${String(totals.skipped).padEnd(25)}║`)
  console.log(`║   Errors  : ${String(totals.errors).padEnd(25)}║`)
  console.log('╚══════════════════════════════════════╝')

  // Print final domain breakdown
  console.log('\nFinal KB breakdown:')
  const rows = await db.execute(`SELECT domain, COUNT(*) as count FROM knowledge GROUP BY domain ORDER BY count DESC`)
  for (const row of rows.rows) {
    console.log(`  ${String(row[0] ?? 'null').padEnd(15)} ${row[1]}`)
  }

  await db.close()
}

main().catch(err => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
