"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  Badge,
  Box,
  Button,
  HStack,
  Heading,
  IconButton,
  Input,
  Spinner,
  Table,
  Tabs,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react"
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Lock,
  MessageSquare,
  Send,
  Unlock,
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
  collaborative_locked_speaker: boolean
  collaborative_locked_gender: boolean
  collaborative_locked_transcription: boolean
  collaborative_locked_emotion: boolean
  annotator_remarks: string | null
  admin_response: string | null
}

interface EmotionAnnotatorEntry {
  username: string
  emotions: string[]
  is_ambiguous: boolean
}

interface EmotionSegmentReview {
  segment_id: number
  start_time: number
  end_time: number
  speaker_label: string | null
  annotations: EmotionAnnotatorEntry[]
  emotion_counts: Record<string, number>
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

function emotionLabel(e: string): string {
  return e.startsWith("Other:") ? `Other: (${e.slice(6)})` : e
}

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

function EmotionTab({
  fileId,
  locked,
  onLockToggle,
}: {
  fileId: number
  locked: boolean
  onLockToggle: () => void
}) {
  const [segments, setSegments] = useState<EmotionSegmentReview[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)

  const toggleLock = async () => {
    setToggling(true)
    try {
      await api.patch(`/api/audio-files/${fileId}/lock`, {
        task_type: "emotion",
        locked: !locked,
      })
      onLockToggle()
      ToastWizard.standard("success", locked ? "Emotion unlocked" : "Emotion locked")
    } catch {
      ToastWizard.standard("error", "Lock toggle failed")
    } finally {
      setToggling(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get(`/api/review/${fileId}/emotion`)
      setSegments(res.data)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status !== 404) {
        ToastWizard.standard("error", "Failed to load emotion review data")
      }
    } finally {
      setLoading(false)
    }
  }, [fileId])

  useEffect(() => { load() }, [load])

  if (loading) return <Spinner />

  return (
    <VStack align="start" gap={4}>
      {/* Lock toggle */}
      <HStack justify="space-between" w="full">
        <HStack gap={2}>
          {locked ? (
            <Badge colorPalette="orange">
              <Lock size={12} /> Locked
            </Badge>
          ) : (
            <Badge colorPalette="gray">
              <Unlock size={12} /> Open for annotation
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

      {/* Summary */}
      <HStack gap={2}>
        <Badge colorPalette="blue">{segments.length} segments</Badge>
        <Badge colorPalette="gray">{segments.filter(s => s.annotations.length > 0).length} annotated</Badge>
      </HStack>

      {segments.length === 0 && (
        <Box py={10} textAlign="center" w="full" color="fg.muted">
          <Text fontSize="sm">No speaker segments yet.</Text>
          <Text fontSize="xs" mt={1}>Assign and complete a speaker task first, then emotion annotation can begin.</Text>
        </Box>
      )}

      {/* Table */}
      <Box w="full" overflowX="auto">
        <Table.Root size="sm" variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader w="110px">Time</Table.ColumnHeader>
              <Table.ColumnHeader w="90px">Speaker</Table.ColumnHeader>
              <Table.ColumnHeader>Per-Annotator Emotions</Table.ColumnHeader>
              <Table.ColumnHeader w="180px">Aggregation</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {segments.map(seg => (
              <Table.Row key={seg.segment_id}>
                <Table.Cell>
                  <Text fontFamily="mono" fontSize="xs" color="fg.muted">
                    {fmtTime(seg.start_time)} – {fmtTime(seg.end_time)}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text fontSize="xs">{seg.speaker_label ?? "—"}</Text>
                </Table.Cell>
                <Table.Cell>
                  <VStack align="start" gap={1.5}>
                    {seg.annotations.length === 0 && (
                      <Text fontSize="xs" color="fg.muted">No annotations yet</Text>
                    )}
                    {seg.annotations.map(a => (
                      <HStack key={a.username} gap={1} flexWrap="wrap">
                        <Text fontSize="xs" color="fg.muted" flexShrink={0}>{a.username}:</Text>
                        {a.emotions.length === 0 ? (
                          <Badge size="sm" colorPalette="gray">—</Badge>
                        ) : (
                          a.emotions.map((e, i) => (
                            <Badge key={i} size="sm" colorPalette="blue">
                              {emotionLabel(e)}
                            </Badge>
                          ))
                        )}
                        {a.is_ambiguous && (
                          <Badge size="sm" colorPalette="orange">⚠ ambiguous</Badge>
                        )}
                      </HStack>
                    ))}
                  </VStack>
                </Table.Cell>
                <Table.Cell>
                  <VStack align="start" gap={0.5}>
                    {Object.entries(seg.emotion_counts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([label, count]) => (
                        <HStack key={label} gap={1}>
                          <Badge size="xs" colorPalette="gray">
                            {emotionLabel(label)}: {count}
                          </Badge>
                        </HStack>
                      ))}
                    {Object.keys(seg.emotion_counts).length === 0 && (
                      <Text fontSize="xs" color="fg.muted">—</Text>
                    )}
                  </VStack>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
        {segments.length === 0 && (
          <Box textAlign="center" py={8} color="fg.muted">
            <Text>No segments found.</Text>
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

function ReviewFinalizeInner() {
  const [files, setFiles] = useState<ReviewFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [selectedFile, setSelectedFile] = useState<ReviewFile | null>(null)
  const [responseText, setResponseText] = useState("")
  const [savingResponse, setSavingResponse] = useState(false)
  const [fileSearch, setFileSearch] = useState("")

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

  const handleLockToggle = async () => {
    try {
      const res = await api.get("/api/review/files")
      setFiles(res.data)
      if (selectedFile) {
        const updated = (res.data as ReviewFile[]).find(f => f.id === selectedFile.id)
        if (updated) setSelectedFile(updated)
      }
    } catch {
      ToastWizard.standard("error", "Failed to reload file state")
    }
  }

  const [lockingAll, setLockingAll] = useState(false)
  const lockAll = async (lock: boolean) => {
    if (!selectedFile) return
    setLockingAll(true)
    try {
      await Promise.all(
        (["speaker", "gender", "transcription", "emotion"] as const).map(t =>
          api.patch(`/api/audio-files/${selectedFile.id}/lock`, { task_type: t, locked: lock })
        )
      )
      await handleLockToggle()
      ToastWizard.standard("success", lock ? "All tasks locked" : "All tasks unlocked")
    } catch {
      ToastWizard.standard("error", "Failed to update locks")
    } finally {
      setLockingAll(false)
    }
  }

  // Pre-select file from ?file= query param
  const searchParams = useSearchParams()
  const autoSelectDone = useRef(false)
  useEffect(() => {
    if (autoSelectDone.current || files.length === 0) return
    const fileId = searchParams.get("file")
    if (!fileId) return
    const match = files.find(f => f.id === Number(fileId))
    if (match) { setSelectedFile(match); autoSelectDone.current = true }
  }, [files, searchParams])

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
        <HStack mb={2} justify="space-between" align="center">
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
        <Input
          size="xs"
          placeholder="Search files…"
          value={fileSearch}
          onChange={e => setFileSearch(e.target.value)}
          bg="bg.muted"
          borderColor="border"
          color="fg"
          mb={2}
        />
        {loadingFiles ? (
          <Spinner size="sm" />
        ) : (
          <VStack align="stretch" gap={1}>
            {files.filter(f => !fileSearch || f.filename.toLowerCase().includes(fileSearch.toLowerCase())).map(f => {
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
                    {f.collaborative_locked_emotion && (
                      <Badge size="sm" colorPalette="orange" variant="subtle">
                        <Lock size={10} /> emo
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
              {/* Lock All / Unlock All + Export buttons */}
              <HStack gap={2} flexShrink={0}>
                {(() => {
                  const allLocked =
                    selectedFile.collaborative_locked_speaker &&
                    selectedFile.collaborative_locked_gender &&
                    selectedFile.collaborative_locked_transcription &&
                    selectedFile.collaborative_locked_emotion
                  return (
                    <Button
                      size="sm"
                      colorPalette={allLocked ? "gray" : "orange"}
                      variant={allLocked ? "outline" : "solid"}
                      loading={lockingAll}
                      onClick={() => lockAll(!allLocked)}
                      title={allLocked ? "Unlock all tasks for this file" : "Lock all tasks for this file"}
                    >
                      {allLocked ? <Unlock size={14} /> : <Lock size={14} />}
                      {allLocked ? "Unlock All" : "Lock All"}
                    </Button>
                  )
                })()}
              </HStack>
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
                  <EmotionTab
                    fileId={selectedFile.id}
                    locked={selectedFile.collaborative_locked_emotion}
                    onLockToggle={handleLockToggle}
                  />
                </Tabs.Content>
                <Tabs.Content value="speaker">
                  <CollabTab
                    fileId={selectedFile.id}
                    taskType="speaker"
                    locked={selectedFile.collaborative_locked_speaker}
                    onLockToggle={handleLockToggle}
                  />
                </Tabs.Content>
                <Tabs.Content value="gender">
                  <CollabTab
                    fileId={selectedFile.id}
                    taskType="gender"
                    locked={selectedFile.collaborative_locked_gender}
                    onLockToggle={handleLockToggle}
                  />
                </Tabs.Content>
                <Tabs.Content value="transcription">
                  <CollabTab
                    fileId={selectedFile.id}
                    taskType="transcription"
                    locked={selectedFile.collaborative_locked_transcription}
                    onLockToggle={handleLockToggle}
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

export default function ReviewFinalizePage() {
  return (
    <Suspense>
      <ReviewFinalizeInner />
    </Suspense>
  )
}
