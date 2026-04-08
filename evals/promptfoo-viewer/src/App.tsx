import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { categorizeCheckType, isJudgeCheckType } from './checkCategories'
import type {
  InteractionTurn,
  LatestPointerFile,
  PromptfooEvalFile,
  PromptfooResultRow,
  ScenarioMetadata,
  StreamEvent,
  TranscriptStep,
} from './types'

type PassFilter = 'all' | 'pass' | 'fail'
type SortMode = 'name' | 'failFirst' | 'latency'
type PanelTab =
  | 'overview'
  | 'chat'
  | 'checks'
  | 'events'
  | 'retrieval'
  | 'todos'
  | 'library'
  | 'pipeline'
  | 'raw'

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function getScenarioId(row: PromptfooResultRow): string {
  return (
    row.vars?.scenarioId
    ?? row.testCase?.metadata?.scenarioId
    ?? row.response?.metadata?.scenarioId
    ?? '(unknown)'
  )
}

function getScenarioTitle(row: PromptfooResultRow): string {
  return (
    row.testCase?.metadata?.scenarioTitle
    ?? row.testCase?.description
    ?? getScenarioId(row)
  )
}

function getTopic(row: PromptfooResultRow): string {
  return row.testCase?.metadata?.topic ?? '—'
}

function getMetadata(row: PromptfooResultRow): ScenarioMetadata | undefined {
  return row.response?.metadata
}

function parseEvalJson(text: string): PromptfooResultRow[] {
  const parsed = JSON.parse(text) as PromptfooEvalFile
  const rows = parsed.results?.results
  if (!Array.isArray(rows)) {
    throw new Error('Invalid promptfoo JSON: missing results.results array')
  }
  return rows as PromptfooResultRow[]
}

function BubbleMarkdown(props: { readonly text: string }): ReactElement {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.text}</ReactMarkdown>
    </div>
  )
}

function renderEventLine(event: StreamEvent, index: number): ReactElement {
  const type = event.type ?? 'unknown'
  let detail = ''
  if (type === 'status' && typeof event.message === 'string') {
    detail = event.message
  }
  if (type === 'chunk' && typeof event.content === 'string') {
    detail = event.content.slice(0, 500) + (event.content.length > 500 ? '…' : '')
  }
  if (type === 'stored' && typeof event.documentId === 'string') {
    detail = event.documentId
  }
  if (type === 'retrieved') {
    const count = event.totalRetrieved ?? event.documentIds?.length ?? 0
    detail = `${count} doc(s)`
  }
  return (
    <div key={index} className="event-line">
      <span className="type">{type}</span>
      {detail}
    </div>
  )
}

export function App(): ReactElement {
  const fileInputReference = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<readonly PromptfooResultRow[]>([])
  const [loadedLabel, setLoadedLabel] = useState<string>('')
  const [loadError, setLoadError] = useState<string>('')
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const [passFilter, setPassFilter] = useState<PassFilter>('all')
  const [search, setSearch] = useState<string>('')
  const [sortMode, setSortMode] = useState<SortMode>('name')
  const [activeTab, setActiveTab] = useState<PanelTab>('overview')
  const [eventTypeFilter, setEventTypeFilter] = useState<string | null>(null)

  const applyRows = useCallback((nextRows: readonly PromptfooResultRow[], label: string) => {
    setRows(nextRows)
    setLoadedLabel(label)
    setLoadError('')
    setSelectedIndex(0)
  }, [])

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) {
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const text = typeof reader.result === 'string' ? reader.result : ''
          applyRows(parseEvalJson(text), file.name)
        } catch (error) {
          setLoadError(error instanceof Error ? error.message : String(error))
        }
      }
      reader.readAsText(file, 'utf-8')
      event.target.value = ''
    },
    [applyRows],
  )

  const loadLatestFromDevServer = useCallback(async () => {
    try {
      const pointerResponse = await fetch('/evals/results/.promptfoo-latest.json')
      if (!pointerResponse.ok) {
        throw new Error(`Could not load .promptfoo-latest.json (${pointerResponse.status})`)
      }
      const pointer = (await pointerResponse.json()) as LatestPointerFile
      const name = typeof pointer.resultFile === 'string' ? pointer.resultFile : ''
      if (name.length === 0) {
        throw new Error('Pointer file missing resultFile')
      }
      const dataResponse = await fetch(`/evals/results/${encodeURIComponent(name)}`)
      if (!dataResponse.ok) {
        throw new Error(`Could not load ${name} (${dataResponse.status})`)
      }
      const text = await dataResponse.text()
      applyRows(parseEvalJson(text), name)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [applyRows])

  const filteredIndices = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const indices: number[] = []
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const passed = row.success === true
      if (passFilter === 'pass' && !passed) {
        continue
      }
      if (passFilter === 'fail' && passed) {
        continue
      }
      if (needle.length > 0) {
        const haystack = `${getScenarioId(row)} ${getScenarioTitle(row)} ${getTopic(row)} ${row.provider?.label ?? ''}`.toLowerCase()
        if (!haystack.includes(needle)) {
          continue
        }
      }
      indices.push(index)
    }
    indices.sort((leftIndex, rightIndex) => {
      const left = rows[leftIndex]
      const right = rows[rightIndex]
      if (sortMode === 'failFirst') {
        const leftFail = left.success === true ? 1 : 0
        const rightFail = right.success === true ? 1 : 0
        if (leftFail !== rightFail) {
          return leftFail - rightFail
        }
      }
      if (sortMode === 'latency') {
        const leftLatency = left.latencyMs ?? 0
        const rightLatency = right.latencyMs ?? 0
        if (leftLatency !== rightLatency) {
          return rightLatency - leftLatency
        }
      }
      return getScenarioId(left).localeCompare(getScenarioId(right))
    })
    return indices
  }, [rows, passFilter, search, sortMode])

  const safeSelectedIndex = useMemo(() => {
    if (filteredIndices.length === 0) {
      return -1
    }
    if (filteredIndices.includes(selectedIndex)) {
      return selectedIndex
    }
    return filteredIndices[0]
  }, [filteredIndices, selectedIndex])

  const selectedRow = safeSelectedIndex >= 0 ? rows[safeSelectedIndex] : undefined
  const metadata = selectedRow ? getMetadata(selectedRow) : undefined

  const tabs: { readonly id: PanelTab; readonly label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'chat', label: 'Chat' },
    { id: 'checks', label: 'Checks' },
    { id: 'events', label: 'Events' },
    { id: 'retrieval', label: 'Retrieval' },
    { id: 'todos', label: 'Todos' },
    { id: 'library', label: 'Library' },
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'raw', label: 'Raw row' },
  ]

  const eventTypes = useMemo(() => {
    const set = new Set<string>()
    if (!metadata?.transcript) {
      return []
    }
    for (const step of metadata.transcript) {
      const turns = step.interactionTurns && step.interactionTurns.length > 0
        ? step.interactionTurns
        : [{ events: step.events }]
      for (const turn of turns) {
        for (const event of turn.events ?? []) {
          if (typeof event.type === 'string') {
            set.add(event.type)
          }
        }
      }
    }
    return [...set].sort()
  }, [metadata?.transcript])

  return (
    <div className="viewer-app">
      <header className="viewer-toolbar">
        <h1>Lore promptfoo results</h1>
        <div className="viewer-toolbar-actions">
          <input
            ref={fileInputReference}
            type="file"
            accept=".json,application/json"
            className="hidden-input"
            aria-hidden
            onChange={handleFileChange}
          />
          <button
            type="button"
            className="file-button"
            onClick={() => fileInputReference.current?.click()}
          >
            Open JSON…
          </button>
          <button type="button" className="ghost-button" onClick={loadLatestFromDevServer}>
            Load latest (dev server)
          </button>
          {loadedLabel.length > 0 ? (
            <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{loadedLabel}</span>
          ) : null}
        </div>
      </header>
      {loadError.length > 0 ? <div className="error-banner">{loadError}</div> : null}
      <div className="viewer-body">
        <aside className="viewer-sidebar">
          <div className="viewer-sidebar-filters">
            <input
              type="search"
              placeholder="Search id / title / topic / provider…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              value={passFilter}
              onChange={(event) => setPassFilter(event.target.value as PassFilter)}
            >
              <option value="all">All</option>
              <option value="pass">Passed</option>
              <option value="fail">Failed</option>
            </select>
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
            >
              <option value="name">Sort: name</option>
              <option value="failFirst">Sort: failures first</option>
              <option value="latency">Sort: latency</option>
            </select>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
              {filteredIndices.length} / {rows.length} visible
            </span>
          </div>
          <ul className="viewer-row-list">
            {filteredIndices.map((rowIndex) => {
              const row = rows[rowIndex]
              const passed = row.success === true
              return (
                <li key={rowIndex}>
                  <button
                    type="button"
                    className={`viewer-row-item ${rowIndex === safeSelectedIndex ? 'is-selected' : ''}`}
                    onClick={() => setSelectedIndex(rowIndex)}
                  >
                    <span>
                      <span className={passed ? 'badge badge-pass' : 'badge badge-fail'}>
                        {passed ? 'pass' : 'fail'}
                      </span>{' '}
                      {getScenarioId(row)}
                    </span>
                    <span className="viewer-row-meta">
                      {row.provider?.label ?? '—'} · {getTopic(row)} ·{' '}
                      {typeof row.latencyMs === 'number' ? `${Math.round(row.latencyMs / 1000)}s` : '—'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>
        <main className="viewer-main">
          {!selectedRow || !metadata ? (
            <div className="viewer-panel empty-state">Open a promptfoo results JSON to inspect runs.</div>
          ) : (
            <>
              <div className="viewer-tabs" role="tablist">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    className={activeTab === tab.id ? 'is-active' : ''}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="viewer-panel">
                {activeTab === 'overview' ? (
                  <>
                    <h2>{getScenarioTitle(selectedRow)}</h2>
                    <p>
                      <strong>Scenario id:</strong> {getScenarioId(selectedRow)}
                    </p>
                    <p>
                      <strong>Topic:</strong> {getTopic(selectedRow)}
                    </p>
                    <p>
                      <strong>Provider:</strong> {selectedRow.provider?.label ?? '—'}
                    </p>
                    <p>
                      <strong>Model:</strong> {metadata.model ?? '—'}
                    </p>
                    <p>
                      <strong>Judge model:</strong> {metadata.judgeModel ?? '—'}
                    </p>
                    <p>
                      <strong>Latency:</strong>{' '}
                      {typeof selectedRow.latencyMs === 'number' ? `${selectedRow.latencyMs} ms` : '—'}
                    </p>
                    <p>
                      <strong>Summary:</strong> {metadata.summary ?? selectedRow.response?.output ?? '—'}
                    </p>
                    {metadata.failures && metadata.failures.length > 0 ? (
                      <>
                        <h3>Failure strings</h3>
                        <ul>
                          {metadata.failures.map((failure, failureIndex) => (
                            <li key={failureIndex}>{failure}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </>
                ) : null}
                {activeTab === 'chat' ? (
                  <>
                    <h2>Transcript</h2>
                    {(metadata.transcript ?? []).map((step: TranscriptStep, stepIndex: number) => (
                      <section key={stepIndex} className="chat-step">
                        <h3>
                          Step {(step.stepIndex ?? stepIndex) + 1}
                          {step.initialUserInput && step.initialUserInput !== step.finalUserInput
                            ? ` (initial: ${step.initialUserInput.slice(0, 40)}…)`
                            : null}
                        </h3>
                        {(step.interactionTurns && step.interactionTurns.length > 0
                          ? step.interactionTurns
                          : [
                              {
                                userInput: step.finalUserInput ?? step.initialUserInput ?? '',
                                response: step.response ?? '',
                                events: step.events,
                              },
                            ]
                        ).map((turn: InteractionTurn, turnIndex: number) => (
                          <div key={turnIndex}>
                            <div className="chat-bubble-row user">
                              <div className="chat-bubble">
                                <div className="chat-bubble-label">User</div>
                                <BubbleMarkdown text={turn.userInput ?? ''} />
                              </div>
                            </div>
                            <div className="chat-bubble-row assistant">
                              <div className="chat-bubble">
                                <div className="chat-bubble-label">Assistant</div>
                                <BubbleMarkdown text={turn.response ?? ''} />
                              </div>
                            </div>
                            {turn.simulatedUserDecision?.selectedUserInput ? (
                              <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                                Simulated follow-up: {turn.simulatedUserDecision.selectedUserInput}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </section>
                    ))}
                  </>
                ) : null}
                {activeTab === 'checks' ? (
                  <>
                    <h2>Failed checks</h2>
                    {!metadata.failedChecks || metadata.failedChecks.length === 0 ? (
                      <p className="empty-state">No failedChecks on this row (may have passed).</p>
                    ) : (
                      metadata.failedChecks.map((check, checkIndex) => {
                        const category = categorizeCheckType(check.checkType)
                        return (
                          <div key={checkIndex} className="check-card">
                            <div>
                              <span
                                className={
                                  isJudgeCheckType(check.checkType) ? 'badge badge-judge' : 'badge badge-deterministic'
                                }
                              >
                                {category}
                              </span>{' '}
                              <strong>{check.checkType ?? 'unknown'}</strong> · step{' '}
                              {(check.stepIndex ?? 0) + 1}
                            </div>
                            <p>{check.reason}</p>
                            <h4 style={{ margin: '0.5rem 0 0', fontSize: '0.8rem' }}>Expected</h4>
                            <pre>{stringifyJson(check.expected)}</pre>
                            <h4 style={{ margin: '0.5rem 0 0', fontSize: '0.8rem' }}>Actual</h4>
                            <pre>{stringifyJson(check.actual)}</pre>
                          </div>
                        )
                      })
                    )}
                  </>
                ) : null}
                {activeTab === 'events' ? (
                  <>
                    <h2>Stream events</h2>
                    <div className="chip-row">
                      <button
                        type="button"
                        className={`chip ${eventTypeFilter === null ? 'is-on' : ''}`}
                        onClick={() => setEventTypeFilter(null)}
                      >
                        all
                      </button>
                      {eventTypes.map((type) => (
                        <button
                          key={type}
                          type="button"
                          className={`chip ${eventTypeFilter === type ? 'is-on' : ''}`}
                          onClick={() => setEventTypeFilter(type)}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                    {(metadata.transcript ?? []).map((step: TranscriptStep, stepIndex: number) => {
                      const turns =
                        step.interactionTurns && step.interactionTurns.length > 0
                          ? step.interactionTurns
                          : [{ events: step.events }]
                      return (
                        <section key={stepIndex}>
                          <h3>Step {(step.stepIndex ?? stepIndex) + 1}</h3>
                          {turns.map((turn: InteractionTurn, turnIndex: number) => (
                            <div key={turnIndex}>
                              <h4 style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                                Turn {(turn.turnIndex ?? turnIndex) + 1}
                              </h4>
                              {(turn.events ?? [])
                                .filter((event) => eventTypeFilter === null || event.type === eventTypeFilter)
                                .map((event, eventIndex) => renderEventLine(event, eventIndex))}
                            </div>
                          ))}
                        </section>
                      )
                    })}
                  </>
                ) : null}
                {activeTab === 'retrieval' ? (
                  <>
                    <h2>Retrieval</h2>
                    {(metadata.transcript ?? []).map((step: TranscriptStep, stepIndex: number) => {
                      const turns =
                        step.interactionTurns && step.interactionTurns.length > 0
                          ? step.interactionTurns
                          : [
                              {
                                retrievedContents: step.retrievedContents,
                                retrievedCount: step.retrievedCount,
                                totalCandidates: step.totalCandidates,
                              },
                            ]
                      return (
                        <section key={stepIndex}>
                          <h3>Step {(step.stepIndex ?? stepIndex) + 1}</h3>
                          {turns.map((turn: InteractionTurn, turnIndex: number) => (
                            <div key={turnIndex}>
                              <p>
                                Retrieved: {turn.retrievedCount ?? turn.retrievedContents?.length ?? 0}
                                {typeof turn.totalCandidates === 'number'
                                  ? ` / candidates ${turn.totalCandidates}`
                                  : null}
                              </p>
                              <pre className="json-block">
                                {stringifyJson(turn.retrievedContents ?? [])}
                              </pre>
                            </div>
                          ))}
                        </section>
                      )
                    })}
                  </>
                ) : null}
                {activeTab === 'todos' ? (
                  <>
                    <h2>Final todos</h2>
                    {Array.isArray(metadata.finalTodos) && metadata.finalTodos.length > 0 ? (
                      <table className="todo-table">
                        <thead>
                          <tr>
                            <th>id</th>
                            <th>content</th>
                            <th>tags</th>
                          </tr>
                        </thead>
                        <tbody>
                          {metadata.finalTodos.map((todo: unknown, todoIndex: number) => {
                            const record = todo as Record<string, unknown>
                            return (
                              <tr key={todoIndex}>
                                <td>{String(record.id ?? '')}</td>
                                <td>
                                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                                    {String(record.content ?? '')}
                                  </pre>
                                </td>
                                <td>{String(record.tags ?? '')}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <p className="empty-state">No finalTodos.</p>
                    )}
                    <h3>Todo snapshots (transcript steps)</h3>
                    {(metadata.transcript ?? []).map((step: TranscriptStep, stepIndex: number) => (
                      <div key={stepIndex}>
                        <strong>Step {(step.stepIndex ?? stepIndex) + 1}</strong>
                        <pre className="json-block">{stringifyJson(step.todoContents ?? [])}</pre>
                      </div>
                    ))}
                  </>
                ) : null}
                {activeTab === 'library' ? (
                  <>
                    <h2>Library snapshot (end of each step)</h2>
                    {(metadata.transcript ?? []).map((step: TranscriptStep, stepIndex: number) => (
                      <details key={stepIndex} className="pipeline-block" open={stepIndex === 0}>
                        <summary>Step {(step.stepIndex ?? stepIndex) + 1}</summary>
                        <h4 style={{ fontSize: '0.85rem' }}>Notes (allDocuments)</h4>
                        <pre className="json-block">
                          {stringifyJson(step.librarySnapshot?.allDocuments ?? [])}
                        </pre>
                        <h4 style={{ fontSize: '0.85rem' }}>Todos (todoDocuments)</h4>
                        <pre className="json-block">
                          {stringifyJson(step.librarySnapshot?.todoDocuments ?? [])}
                        </pre>
                      </details>
                    ))}
                  </>
                ) : null}
                {activeTab === 'pipeline' ? (
                  <>
                    <h2>Pipeline trace</h2>
                    {(metadata.transcript ?? []).map((step: TranscriptStep, stepIndex: number) => {
                      const turns =
                        step.interactionTurns && step.interactionTurns.length > 0
                          ? step.interactionTurns
                          : []
                      if (turns.length === 0) {
                        return (
                          <p key={stepIndex} className="empty-state">
                            Step {(step.stepIndex ?? stepIndex) + 1}: no interactionTurns
                          </p>
                        )
                      }
                      return (
                        <section key={stepIndex}>
                          <h3>Step {(step.stepIndex ?? stepIndex) + 1}</h3>
                          {turns.map((turn: InteractionTurn, turnIndex: number) => (
                            <details key={turnIndex} className="pipeline-block">
                              <summary>
                                Turn {(turn.turnIndex ?? turnIndex) + 1} (schema{' '}
                                {turn.traceSchemaVersion ?? 1})
                              </summary>
                              <pre className="json-block">{stringifyJson(turn.pipelineTrace ?? [])}</pre>
                            </details>
                          ))}
                        </section>
                      )
                    })}
                  </>
                ) : null}
                {activeTab === 'raw' ? (
                  <>
                    <h2>Raw result row</h2>
                    <pre className="json-block">{stringifyJson(selectedRow)}</pre>
                  </>
                ) : null}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
