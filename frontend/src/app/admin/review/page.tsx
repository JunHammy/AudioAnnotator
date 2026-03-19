"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Badge,
  Box,
  Button,
  HStack,
  Heading,
  Icon,
  IconButton,
  Input,
  Select,
  Spinner,
  Table,
  Tabs,
  Text,
  Textarea,
  VStack,
  createListCollection,
} from "@chakra-ui/react"
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Lock,
  MessageSquare,
  Pencil,
  Send,
  Unlock,
  X,
} from "lucide-react"
import api, { downloadExport } from "@/lib/axios"
import ToastWizard from "@/lib/toastWizard"

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReviewFile {
  id: number
  filename: string
  duration: number | null
  language: string | null
  total_segments: number
  emotion_annotators: number
  finalized_emotions: number
  collaborative_locked_speaker: boolean
  collaborative_locked_gender: boolean
  collaborative_locked_transcription: boolean
  annotator_remarks: string | null
  admin_response: string | null
}

interface AnnotatorVote {
  annotator_id: number
  username: string
  trust_score: number
  emotion: string | null
  emotion_other: string | null
  is_ambiguous: boolean
  segment_id: number
}

interface EmotionSegmentReview {
  segment_id: number
  start_time: number
  end_time: number
  speaker_label: string | null
  tier: 1 | 2 | 3
  winning_label: string | null
  confidence: number
  annotations: AnnotatorVote[]
  finalized: boolean
  final_emotion: string | null
  final_emotion_other: string | null
  final_method: string | null
}

interface EditEntry {
  field_changed: string
  old_value: string | null
  new_value: string | null
  username: string
  edited_at: string
}

interface CollabSegment {
  id: number
  start_time: number
  end_time: number
  speaker_label?: string
  gender?: string
  original_text?: string
  edited_text?: string
  notes: string | null
  is_ambiguous?: boolean
  updated_at: string
  edit_history: EditEntry[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

function tierBadge(tier: 1 | 2 | 3) {
  if (tier === 1) return <Badge colorPalette="green" size="sm">Tier 1 ✓</Badge>
  if (tier === 2) return <Badge colorPalette="yellow" size="sm">Tier 2</Badge>
  return <Badge colorPalette="red" size="sm">Tier 3</Badge>
}

const EMOTIONS = ["Neutral", "Happy", "Sad", "Angry", "Surprised", "Fear", "Disgust", "Other"]
const emotionCollection = createListCollection({
  items: EMOTIONS.map(e => ({ label: e, value: e })),
})

// ─── Sub-components ───────────────────────────────────────────────────────────

function CollabSegmentRow({ seg, taskType }: { seg: CollabSegment; taskType: string }) {
  const [open, setOpen] = useState(false)

  const mainValue =
    taskType === "transcription"
      ? seg.edited_text ?? seg.original_text ?? "—"
      : taskType === "gender"
      ? seg.gender ?? "—"
      : seg.speaker_label ?? "—"

  return (
    <>
      <Table.Row>
        <Table.Cell>
          <Text fontFamily="mono" fontSize="xs" color="fg.muted">
            {fmtTime(seg.start_time)} – {fmtTime(seg.end_time)}
          </Text>
        </Table.Cell>
        <Table.Cell>
          <Text fontSize="sm" truncate maxW="300px" title={mainValue}>
            {mainValue}
          </Text>
        </Table.Cell>
        <Table.Cell>
          <Text fontSize="xs" color="fg.muted" suppressHydrationWarning>
            {new Date(seg.updated_at).toLocaleString()}
          </Text>
        </Table.Cell>
        <Table.Cell>
          <IconButton
            aria-label="Toggle history"
            size="xs"
            variant="ghost"
            onClick={() => setOpen(o => !o)}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </IconButton>
          <Text as="span" fontSize="xs" color="fg.muted" ml={1}>
            {seg.edit_history.length} edit{seg.edit_history.length !== 1 ? "s" : ""}
          </Text>
        </Table.Cell>
      </Table.Row>
      {open && seg.edit_history.length > 0 && (
        <Table.Row>
          <Table.Cell colSpan={4} bg="bg.muted" py={2} px={4}>
            <VStack align="start" gap={1}>
              {seg.edit_history.map((h, i) => (
                <HStack key={i} gap={2} fontSize="xs">
                  <Text color="fg.muted" fontFamily="mono" suppressHydrationWarning>
                    {new Date(h.edited_at).toLocaleString()}
                  </Text>
                  <Text color="blue.300">{h.username}</Text>
                  <Text color="fg.muted">changed</Text>
                  <Text fontWeight="medium">{h.field_changed}</Text>
                  <Text color="red.400" textDecoration="line-through">
                    {h.old_value ?? "—"}
                  </Text>
                  <Text color="fg.muted">→</Text>
                  <Text color="green.400">{h.new_value ?? "—"}</Text>
                </HStack>
              ))}
            </VStack>
          </Table.Cell>
        </Table.Row>
      )}
    </>
  )
}

// ─── Emotion Tab ─────────────────────────────────────────────────────────────

function EmotionTab({ fileId }: { fileId: number }) {
  const [segments, setSegments] = useState<EmotionSegmentReview[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"all" | "1" | "2" | "3" | "unresolved">("all")
  const [decisions, setDecisions] = useState<Record<number, string>>({})
  const [decisionOthers, setDecisionOthers] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState<Record<number, boolean>>({})
  const [batchSaving, setBatchSaving] = useState(false)
  const [overriding, setOverriding] = useState<Set<number>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get(`/api/review/${fileId}/emotion`)
      setSegments(res.data)
      const init: Record<number, string> = {}
      const initOthers: Record<number, string> = {}
      for (const s of res.data) {
        if (s.final_emotion) {
          init[s.segment_id] = s.final_emotion
          if (s.final_emotion_other) initOthers[s.segment_id] = s.final_emotion_other
        } else if (s.winning_label && s.tier <= 2) {
          init[s.segment_id] = s.winning_label
        }
      }
      setDecisions(init)
      setDecisionOthers(initOthers)
    } catch {
      ToastWizard.standard("error", "Failed to load emotion review data")
    } finally {
      setLoading(false)
    }
  }, [fileId])

  useEffect(() => { load() }, [load])

  const saveDecision = async (segId: number, method: string) => {
    const emotion = decisions[segId]
    if (!emotion) return
    const emotionOther = emotion === "Other" ? (decisionOthers[segId] || null) : null
    setSaving(s => ({ ...s, [segId]: true }))
    try {
      await api.post(`/api/review/${fileId}/emotion/decide`, {
        segment_id: segId,
        emotion,
        emotion_other: emotionOther,
        decision_method: method,
      })
      setSegments(prev =>
        prev.map(s => s.segment_id === segId
          ? { ...s, finalized: true, final_emotion: emotion, final_emotion_other: emotionOther, final_method: method }
          : s
        )
      )
      ToastWizard.standard("success", "Decision saved")
    } catch {
      ToastWizard.standard("error", "Failed to save decision")
    } finally {
      setSaving(s => ({ ...s, [segId]: false }))
    }
  }

  const batchAccept = async (minTier: number) => {
    const toAccept = segments.filter(
      s => s.tier <= minTier && s.winning_label && !s.finalized
    )
    if (!toAccept.length) {
      ToastWizard.standard("info", "Nothing to accept")
      return
    }
    setBatchSaving(true)
    try {
      await api.post(`/api/review/${fileId}/emotion/decide-batch`, {
        decisions: toAccept.map(s => ({
          segment_id: s.segment_id,
          emotion: s.winning_label!,
          decision_method: s.tier === 1 ? "unanimous" : "weighted",
        })),
      })
      await load()
      ToastWizard.standard("success", `Accepted ${toAccept.length} segments`)
    } catch {
      ToastWizard.standard("error", "Batch accept failed")
    } finally {
      setBatchSaving(false)
    }
  }

  const filtered = segments.filter(s => {
    if (filter === "1") return s.tier === 1
    if (filter === "2") return s.tier === 2
    if (filter === "3") return s.tier === 3
    if (filter === "unresolved") return !s.finalized
    return true
  })

  if (loading) return <Spinner />

  const tier1Count = segments.filter(s => s.tier === 1 && !s.finalized).length
  const tier2Count = segments.filter(s => s.tier === 2 && !s.finalized).length
  const resolvedCount = segments.filter(s => s.finalized).length

  return (
    <VStack align="start" gap={4}>
      {/* Stats + Bulk actions */}
      <HStack gap={4} flexWrap="wrap">
        <HStack gap={2}>
          <Badge colorPalette="green">{tier1Count} unanimous</Badge>
          <Badge colorPalette="yellow">{tier2Count} high-conf</Badge>
          <Badge colorPalette="blue">{resolvedCount}/{segments.length} resolved</Badge>
        </HStack>
        <HStack gap={2} ml="auto">
          <Button
            size="sm"
            colorPalette="green"
            variant="outline"
            loading={batchSaving}
            onClick={() => batchAccept(1)}
            disabled={tier1Count === 0}
          >
            Accept all Tier 1 ({tier1Count})
          </Button>
          <Button
            size="sm"
            colorPalette="yellow"
            variant="outline"
            loading={batchSaving}
            onClick={() => batchAccept(2)}
            disabled={tier1Count + tier2Count === 0}
          >
            Accept Tier 1+2 ({tier1Count + tier2Count})
          </Button>
        </HStack>
      </HStack>

      {/* Filter tabs */}
      <HStack gap={2}>
        {(["all", "1", "2", "3", "unresolved"] as const).map(f => (
          <Button
            key={f}
            size="xs"
            variant={filter === f ? "solid" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "unresolved" ? "Unresolved" : `Tier ${f}`}
          </Button>
        ))}
      </HStack>

      {/* Table */}
      <Box w="full" overflowX="auto">
        <Table.Root size="sm" variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader w="100px">Time</Table.ColumnHeader>
              <Table.ColumnHeader w="80px">Speaker</Table.ColumnHeader>
              <Table.ColumnHeader>Annotations</Table.ColumnHeader>
              <Table.ColumnHeader w="90px">Tier</Table.ColumnHeader>
              <Table.ColumnHeader w="150px">Decision</Table.ColumnHeader>
              <Table.ColumnHeader w="80px">Status</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {filtered.map(seg => (
              <Table.Row
                key={seg.segment_id}
                bg={seg.finalized ? "transparent" : undefined}
                opacity={seg.finalized ? 0.7 : 1}
              >
                <Table.Cell>
                  <Text fontFamily="mono" fontSize="xs" color="fg.muted">
                    {fmtTime(seg.start_time)} – {fmtTime(seg.end_time)}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text fontSize="xs">{seg.speaker_label ?? "—"}</Text>
                </Table.Cell>
                <Table.Cell>
                  <HStack gap={3} flexWrap="wrap">
                    {seg.annotations.length === 0 && (
                      <Text fontSize="xs" color="fg.muted">No annotations yet</Text>
                    )}
                    {seg.annotations.map(a => (
                      <HStack key={a.annotator_id} gap={1}>
                        <Text fontSize="xs" color="fg.muted">{a.username}:</Text>
                        <Badge
                          size="sm"
                          colorPalette={
                            a.emotion === seg.winning_label ? "blue" : "gray"
                          }
                        >
                          {a.emotion === "Other" && a.emotion_other
                            ? `Other(${a.emotion_other})`
                            : a.emotion ?? "—"}
                        </Badge>
                        <Text fontSize="xs" color="fg.muted">
                          ({(a.trust_score * 100).toFixed(0)}%)
                        </Text>
                        {a.is_ambiguous && (
                          <Badge size="sm" colorPalette="orange">⚠</Badge>
                        )}
                      </HStack>
                    ))}
                  </HStack>
                  {seg.annotations.length > 0 && (
                    <Text fontSize="xs" color="fg.muted" mt={1}>
                      Confidence: {(seg.confidence * 100).toFixed(0)}%
                      {seg.winning_label && ` → ${seg.winning_label}`}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>{tierBadge(seg.tier)}</Table.Cell>
                <Table.Cell>
                  <VStack align="stretch" gap={1}>
                    <Select.Root
                      collection={emotionCollection}
                      size="xs"
                      value={decisions[seg.segment_id] ? [decisions[seg.segment_id]] : []}
                      onValueChange={({ value }) =>
                        setDecisions(d => ({ ...d, [seg.segment_id]: value[0] }))
                      }
                    >
                      <Select.Trigger>
                        <Select.ValueText placeholder="Select…" />
                      </Select.Trigger>
                      <Select.Positioner>
                        <Select.Content>
                          {emotionCollection.items.map(item => (
                            <Select.Item key={item.value} item={item}>
                              {item.label}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Positioner>
                    </Select.Root>
                    {decisions[seg.segment_id] === "Other" && (
                      <Input
                        size="xs"
                        placeholder="Specify emotion…"
                        value={decisionOthers[seg.segment_id] ?? ""}
                        onChange={e =>
                          setDecisionOthers(d => ({ ...d, [seg.segment_id]: e.target.value }))
                        }
                      />
                    )}
                  </VStack>
                </Table.Cell>
                <Table.Cell>
                  {seg.finalized && !overriding.has(seg.segment_id) ? (
                    <VStack align="start" gap={1}>
                      <HStack gap={1}>
                        <CheckCircle size={14} color="green" />
                        <Text fontSize="xs" color="green.400">
                          {seg.final_emotion === "Other" && seg.final_emotion_other
                            ? `Other(${seg.final_emotion_other})`
                            : seg.final_emotion}
                        </Text>
                      </HStack>
                      <Text fontSize="9px" color="fg.muted">{seg.final_method}</Text>
                      <Button
                        size="xs"
                        variant="ghost"
                        colorPalette="orange"
                        onClick={() => setOverriding(prev => new Set(prev).add(seg.segment_id))}
                        title="Override finalized emotion"
                      >
                        <Pencil size={10} />
                        Override
                      </Button>
                    </VStack>
                  ) : overriding.has(seg.segment_id) ? (
                    <VStack align="stretch" gap={1}>
                      <Select.Root
                        collection={emotionCollection}
                        size="xs"
                        value={decisions[seg.segment_id] ? [decisions[seg.segment_id]] : []}
                        onValueChange={({ value }) =>
                          setDecisions(d => ({ ...d, [seg.segment_id]: value[0] }))
                        }
                      >
                        <Select.Trigger>
                          <Select.ValueText placeholder="Select…" />
                        </Select.Trigger>
                        <Select.Positioner>
                          <Select.Content>
                            {emotionCollection.items.map(item => (
                              <Select.Item key={item.value} item={item}>{item.label}</Select.Item>
                            ))}
                          </Select.Content>
                        </Select.Positioner>
                      </Select.Root>
                      {decisions[seg.segment_id] === "Other" && (
                        <Input
                          size="xs"
                          placeholder="Specify emotion…"
                          value={decisionOthers[seg.segment_id] ?? ""}
                          onChange={e =>
                            setDecisionOthers(d => ({ ...d, [seg.segment_id]: e.target.value }))
                          }
                        />
                      )}
                      <HStack gap={1}>
                        <Button
                          size="xs"
                          colorPalette="orange"
                          loading={saving[seg.segment_id]}
                          disabled={
                            !decisions[seg.segment_id] ||
                            (decisions[seg.segment_id] === "Other" && !decisionOthers[seg.segment_id])
                          }
                          onClick={async () => {
                            await saveDecision(seg.segment_id, "manual_override")
                            setOverriding(prev => { const s = new Set(prev); s.delete(seg.segment_id); return s })
                          }}
                        >
                          Save
                        </Button>
                        <IconButton
                          aria-label="Cancel override"
                          size="xs"
                          variant="ghost"
                          onClick={() => setOverriding(prev => { const s = new Set(prev); s.delete(seg.segment_id); return s })}
                        >
                          <X size={12} />
                        </IconButton>
                      </HStack>
                    </VStack>
                  ) : (
                    <Button
                      size="xs"
                      colorPalette="blue"
                      disabled={
                        !decisions[seg.segment_id] ||
                        (decisions[seg.segment_id] === "Other" && !decisionOthers[seg.segment_id])
                      }
                      loading={saving[seg.segment_id]}
                      onClick={() => saveDecision(
                        seg.segment_id,
                        seg.tier === 1 ? "unanimous"
                          : seg.tier === 2 ? "weighted"
                          : "manual"
                      )}
                    >
                      Save
                    </Button>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
        {filtered.length === 0 && (
          <Box textAlign="center" py={8} color="fg.muted">
            <Text>No segments match the current filter.</Text>
          </Box>
        )}
      </Box>
    </VStack>
  )
}

// ─── Collaborative Tab ────────────────────────────────────────────────────────

function CollabTab({
  fileId,
  taskType,
  locked,
  onLockToggle,
}: {
  fileId: number
  taskType: "speaker" | "gender" | "transcription"
  locked: boolean
  onLockToggle: () => void
}) {
  const [data, setData] = useState<{ segments: CollabSegment[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    setLoading(true)
    api
      .get(`/api/review/${fileId}/collaborative/${taskType}`)
      .then(r => setData(r.data))
      .catch(() => ToastWizard.standard("error", "Failed to load"))
      .finally(() => setLoading(false))
  }, [fileId, taskType])

  const toggleLock = async () => {
    setToggling(true)
    try {
      await api.patch(`/api/audio-files/${fileId}/lock`, {
        task_type: taskType,
        locked: !locked,
      })
      onLockToggle()
      ToastWizard.standard("success", locked ? "Unlocked" : "Locked")
    } catch {
      ToastWizard.standard("error", "Lock toggle failed")
    } finally {
      setToggling(false)
    }
  }

  if (loading) return <Spinner />

  const label =
    taskType === "speaker" ? "Speaker Label" : taskType === "gender" ? "Gender" : "Text"

  return (
    <VStack align="start" gap={4}>
      <HStack justify="space-between" w="full">
        <HStack gap={2}>
          {locked ? (
            <Badge colorPalette="orange">
              <Lock size={12} /> Locked
            </Badge>
          ) : (
            <Badge colorPalette="gray">
              <Unlock size={12} /> Open for editing
            </Badge>
          )}
        </HStack>
        <Button
          size="sm"
          colorPalette={locked ? "gray" : "orange"}
          variant="outline"
          loading={toggling}
          onClick={toggleLock}
        >
          {locked ? <Unlock size={14} /> : <Lock size={14} />}
          {locked ? "Unlock" : "Lock"}
        </Button>
      </HStack>

      <Box w="full" overflowX="auto">
        <Table.Root size="sm" variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader w="110px">Time</Table.ColumnHeader>
              <Table.ColumnHeader>{label}</Table.ColumnHeader>
              <Table.ColumnHeader w="160px">Last Updated</Table.ColumnHeader>
              <Table.ColumnHeader w="120px">Edit History</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data?.segments.map(seg => (
              <CollabSegmentRow key={seg.id} seg={seg} taskType={taskType} />
            ))}
          </Table.Body>
        </Table.Root>
        {!data?.segments.length && (
          <Box textAlign="center" py={8} color="fg.muted">
            <Text>No segments found.</Text>
          </Box>
        )}
      </Box>
    </VStack>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ReviewFinalizePage() {
  const [files, setFiles] = useState<ReviewFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [selectedFile, setSelectedFile] = useState<ReviewFile | null>(null)
  const [responseText, setResponseText] = useState("")
  const [savingResponse, setSavingResponse] = useState(false)

  const loadFiles = useCallback(async () => {
    try {
      const res = await api.get("/api/review/files")
      setFiles(res.data)
    } catch {
      ToastWizard.standard("error", "Failed to load files")
    } finally {
      setLoadingFiles(false)
    }
  }, [])

  useEffect(() => { loadFiles() }, [loadFiles])

  // Sync response textarea when selected file changes
  useEffect(() => {
    setResponseText(selectedFile?.admin_response ?? "")
  }, [selectedFile?.id])

  const saveAdminResponse = async () => {
    if (!selectedFile) return
    setSavingResponse(true)
    try {
      const res = await api.patch(`/api/audio-files/${selectedFile.id}/admin-response`, {
        admin_response: responseText.trim() || null,
      })
      const updated: ReviewFile = { ...selectedFile, admin_response: res.data.admin_response }
      setSelectedFile(updated)
      setFiles(prev => prev.map(f => f.id === updated.id ? { ...f, admin_response: updated.admin_response } : f))
      ToastWizard.standard("success", "Response saved")
    } catch {
      ToastWizard.standard("error", "Failed to save response")
    } finally {
      setSavingResponse(false)
    }
  }

  const handleLockToggle = async (taskType: "speaker" | "gender" | "transcription") => {
    await loadFiles()
    if (selectedFile) {
      const updated = (await api.get("/api/review/files")).data.find(
        (f: ReviewFile) => f.id === selectedFile.id
      )
      if (updated) setSelectedFile(updated)
    }
  }

  return (
    <Box h="100%" display="flex">
      {/* Left sidebar — file list */}
      <Box
        w="280px"
        flexShrink={0}
        borderRightWidth="1px"
        borderColor="border"
        overflowY="auto"
        p={3}
        css={{
          "&::-webkit-scrollbar": { width: "5px" },
          "&::-webkit-scrollbar-track": { background: "transparent" },
          "&::-webkit-scrollbar-thumb": { background: "#4a4c54", borderRadius: "999px" },
          "&::-webkit-scrollbar-thumb:hover": { background: "#5c5f6b" },
        }}
      >
        <HStack mb={3} justify="space-between" align="center">
          <Heading size="sm" color="fg.muted">Audio Files</Heading>
          {(() => {
            const warn = files.filter(f => f.emotion_annotators > 0 && f.emotion_annotators < 2).length
            return warn > 0 ? (
              <Badge colorPalette="orange" size="sm" title="Files with fewer than 2 emotion annotators">
                <AlertTriangle size={10} /> {warn} low
              </Badge>
            ) : null
          })()}
        </HStack>
        {loadingFiles ? (
          <Spinner size="sm" />
        ) : (
          <VStack align="stretch" gap={1}>
            {files.map(f => {
              const pct = f.total_segments
                ? Math.round((f.finalized_emotions / f.total_segments) * 100)
                : 0
              const needsMoreAnnotators = f.emotion_annotators > 0 && f.emotion_annotators < 2
              return (
                <Box
                  key={f.id}
                  p={3}
                  rounded="md"
                  cursor="pointer"
                  bg={selectedFile?.id === f.id ? "bg.muted" : "transparent"}
                  borderWidth="1px"
                  borderColor={
                    selectedFile?.id === f.id
                      ? "blue.500"
                      : needsMoreAnnotators
                      ? "orange.800"
                      : "transparent"
                  }
                  _hover={{ bg: "bg.subtle" }}
                  onClick={() => setSelectedFile(f)}
                >
                  <HStack gap={1.5}>
                    <Text fontSize="sm" fontWeight="medium" truncate flex={1}>
                      {f.filename}
                    </Text>
                    {f.annotator_remarks && (
                      <Badge size="xs" colorPalette="orange" flexShrink={0} title={f.annotator_remarks}>
                        ! remark
                      </Badge>
                    )}
                  </HStack>

                  <HStack mt={1} gap={2} flexWrap="wrap">
                    <Badge
                      size="sm"
                      colorPalette={needsMoreAnnotators ? "orange" : "blue"}
                      title={needsMoreAnnotators ? "Fewer than 2 emotion annotators — results may be unreliable" : undefined}
                    >
                      {needsMoreAnnotators && <AlertTriangle size={9} />}
                      {f.emotion_annotators} annotator{f.emotion_annotators !== 1 ? "s" : ""}
                    </Badge>
                    <Badge size="sm" colorPalette={pct === 100 ? "green" : "gray"}>
                      {pct}% done
                    </Badge>
                  </HStack>
                  <HStack mt={1} gap={1}>
                    {f.collaborative_locked_speaker && (
                      <Badge size="sm" colorPalette="orange" variant="subtle">
                        <Lock size={10} /> spk
                      </Badge>
                    )}
                    {f.collaborative_locked_gender && (
                      <Badge size="sm" colorPalette="orange" variant="subtle">
                        <Lock size={10} /> gen
                      </Badge>
                    )}
                    {f.collaborative_locked_transcription && (
                      <Badge size="sm" colorPalette="orange" variant="subtle">
                        <Lock size={10} /> tr
                      </Badge>
                    )}
                  </HStack>
                </Box>
              )
            })}
          </VStack>
        )}
      </Box>

      {/* Right panel */}
      <Box flex={1} overflowY="auto" p={6}>
        {!selectedFile ? (
          <Box textAlign="center" py={20} color="fg.muted">
            <Clock size={40} style={{ margin: "0 auto 12px" }} />
            <Text>Select a file to review</Text>
          </Box>
        ) : (
          <VStack align="start" gap={6}>
            <HStack justify="space-between" w="full" align="start">
              <Box>
                <Heading size="md" color="fg">
                  {selectedFile.filename}
                </Heading>
                <HStack gap={2} mt={1}>
                  {selectedFile.language && (
                    <Badge colorPalette="blue">{selectedFile.language}</Badge>
                  )}
                  {selectedFile.duration && (
                    <Text fontSize="sm" color="fg.muted">
                      {fmtTime(selectedFile.duration)}
                    </Text>
                  )}
                  <Text fontSize="sm" color="fg.muted">
                    {selectedFile.total_segments} segments
                  </Text>
                </HStack>
              </Box>
              {/* Export buttons */}
              <HStack gap={2} flexShrink={0}>
                <Button
                  size="sm" variant="outline" colorPalette="green"
                  onClick={async () => {
                    try {
                      await downloadExport(`/api/export/file/${selectedFile.id}?format=json`, `${selectedFile.filename}.json`)
                    } catch {
                      ToastWizard.standard("error", "Export failed")
                    }
                  }}
                >
                  <Download size={14} /> JSON
                </Button>
                <Button
                  size="sm" variant="outline" colorPalette="green"
                  onClick={async () => {
                    try {
                      await downloadExport(`/api/export/file/${selectedFile.id}?format=csv`, `${selectedFile.filename}_export.zip`)
                    } catch {
                      ToastWizard.standard("error", "Export failed")
                    }
                  }}
                >
                  <Download size={14} /> CSV
                </Button>
              </HStack>
            </HStack>

            {/* Remarks & response panel — only shown when annotator has written something */}
            {selectedFile.annotator_remarks && (
              <Box w="full" borderWidth="1px" borderColor="border" rounded="md" overflow="hidden">
                {/* Annotator remark */}
                <Box bg="orange.900" borderBottomWidth="1px" borderColor="orange.800" px={3} py={2}>
                  <HStack gap={2} mb={1}>
                    <MessageSquare size={12} color="var(--chakra-colors-orange-300)" />
                    <Text fontSize="xs" fontWeight="semibold" color="orange.300">Annotator Remarks</Text>
                  </HStack>
                  <Text fontSize="sm" color="orange.100" whiteSpace="pre-wrap">{selectedFile.annotator_remarks}</Text>
                </Box>
                {/* Admin response */}
                <Box bg="bg.subtle" px={3} py={2}>
                  <HStack gap={2} mb={2}>
                    <Send size={12} color="var(--chakra-colors-blue-400)" />
                    <Text fontSize="xs" fontWeight="semibold" color="blue.400">Admin Response</Text>
                    {selectedFile.admin_response && (
                      <Badge size="xs" colorPalette="green">Responded</Badge>
                    )}
                  </HStack>
                  <Textarea
                    size="sm" rows={3}
                    bg="bg.muted" borderColor="border" color="fg" fontSize="sm"
                    placeholder="Write a response visible to the annotator…"
                    value={responseText}
                    onChange={e => setResponseText(e.target.value)}
                  />
                  <HStack mt={2} justify="flex-end" gap={2}>
                    {selectedFile.admin_response && (
                      <Button
                        size="xs" variant="ghost" color="fg.muted"
                        onClick={() => { setResponseText(""); saveAdminResponse() }}
                      >
                        Clear response
                      </Button>
                    )}
                    <Button
                      size="xs" colorPalette="blue" loading={savingResponse}
                      disabled={responseText.trim() === (selectedFile.admin_response ?? "")}
                      onClick={saveAdminResponse}
                    >
                      <Send size={11} /> Save response
                    </Button>
                  </HStack>
                </Box>
              </Box>
            )}

            <Tabs.Root defaultValue="emotion" w="full">
              <Tabs.List>
                <Tabs.Trigger value="emotion">Emotion Review</Tabs.Trigger>
                <Tabs.Trigger value="speaker">Speaker</Tabs.Trigger>
                <Tabs.Trigger value="gender">Gender</Tabs.Trigger>
                <Tabs.Trigger value="transcription">Transcription</Tabs.Trigger>
              </Tabs.List>

              <Box mt={4}>
                <Tabs.Content value="emotion">
                  <EmotionTab fileId={selectedFile.id} />
                </Tabs.Content>
                <Tabs.Content value="speaker">
                  <CollabTab
                    fileId={selectedFile.id}
                    taskType="speaker"
                    locked={selectedFile.collaborative_locked_speaker}
                    onLockToggle={() => handleLockToggle("speaker")}
                  />
                </Tabs.Content>
                <Tabs.Content value="gender">
                  <CollabTab
                    fileId={selectedFile.id}
                    taskType="gender"
                    locked={selectedFile.collaborative_locked_gender}
                    onLockToggle={() => handleLockToggle("gender")}
                  />
                </Tabs.Content>
                <Tabs.Content value="transcription">
                  <CollabTab
                    fileId={selectedFile.id}
                    taskType="transcription"
                    locked={selectedFile.collaborative_locked_transcription}
                    onLockToggle={() => handleLockToggle("transcription")}
                  />
                </Tabs.Content>
              </Box>
            </Tabs.Root>
          </VStack>
        )}
      </Box>
    </Box>
  )
}
