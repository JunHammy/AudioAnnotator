"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Heading,
  IconButton,
  Input,
  Portal,
  Select,
  Spinner,
  Table,
  Text,
  VStack,
  createListCollection,
} from "@chakra-ui/react"
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileAudio2,
  Lock,
  RefreshCw,
  Search,
  Unlock,
  X,
} from "lucide-react"
import api from "@/lib/axios"
import ToastWizard from "@/lib/toastWizard"

// ─── Types ────────────────────────────────────────────────────────────────────

interface AudioFile {
  id: number
  filename: string
  subfolder: string | null
  duration: number | null
  language: string | null
  num_speakers: number | null
  collaborative_locked_speaker: boolean
  collaborative_locked_gender: boolean
  collaborative_locked_transcription: boolean
  created_at: string
}

interface Assignment {
  id: number
  audio_file_id: number
  annotator_id: number
  task_type: string
  status: string
}

type Stage = "unassigned" | "in_progress" | "complete" | "finalized"

interface TaskStat {
  total: number
  done: number
}

interface FileRow {
  file: AudioFile
  assignments: Assignment[]
  stage: Stage
  taskSummary: Record<string, TaskStat>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TASK_ORDER = ["speaker", "gender", "emotion", "transcription"]

const TASK_META: Record<string, { short: string; color: string }> = {
  speaker:       { short: "Spk", color: "blue"   },
  gender:        { short: "Gnd", color: "purple" },
  emotion:       { short: "Emo", color: "yellow" },
  transcription: { short: "Trn", color: "green"  },
}

const STAGE_META: Record<Stage, { label: string; color: string; desc: string }> = {
  unassigned:  { label: "Unassigned",  color: "gray",   desc: "No annotators assigned yet" },
  in_progress: { label: "In Progress", color: "blue",   desc: "Annotation underway" },
  complete:    { label: "Complete",    color: "teal",   desc: "All annotators finished — ready to review" },
  finalized:   { label: "Finalized",   color: "purple", desc: "Speaker + transcription locked and confirmed" },
}

const LOCK_TYPES = [
  { key: "speaker",       label: "Spk" },
  { key: "gender",        label: "Gnd" },
  { key: "transcription", label: "Trn" },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(sec: number | null): string {
  if (!sec) return "—"
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

function computeStage(file: AudioFile, assignments: Assignment[]): Stage {
  if (assignments.length === 0) return "unassigned"
  const allDone = assignments.every(a => a.status === "completed")
  if (!allDone) return "in_progress"
  if (file.collaborative_locked_speaker && file.collaborative_locked_transcription) return "finalized"
  return "complete"
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TaskPill({ taskType, stat }: { taskType: string; stat?: TaskStat }) {
  const meta = TASK_META[taskType]
  if (!stat) {
    return (
      <Flex direction="column" align="center" gap="2px" minW="28px">
        <Box w="6px" h="6px" rounded="full" bg="gray.700" />
        <Text fontSize="8px" color="gray.600" fontFamily="mono">{meta.short}</Text>
      </Flex>
    )
  }
  const allDone = stat.done === stat.total
  const someDone = stat.done > 0
  const palette = allDone ? "green" : someDone ? "blue" : "gray"
  return (
    <Flex direction="column" align="center" gap="2px" minW="28px">
      <Badge
        colorPalette={palette}
        size="xs"
        fontFamily="mono"
        px="3px"
        py="0px"
        fontSize="9px"
        variant={allDone ? "solid" : "subtle"}
      >
        {stat.done}/{stat.total}
      </Badge>
      <Text fontSize="8px" color="fg.muted" fontFamily="mono">{meta.short}</Text>
    </Flex>
  )
}

function LockToggle({
  locked,
  label,
  onToggle,
  loading,
}: {
  locked: boolean
  label: string
  onToggle: () => void
  loading?: boolean
}) {
  return (
    <Flex direction="column" align="center" gap="2px">
      <IconButton
        size="2xs"
        variant={locked ? "solid" : "ghost"}
        colorPalette={locked ? "orange" : "gray"}
        aria-label={`${locked ? "Unlock" : "Lock"} ${label}`}
        onClick={onToggle}
        loading={loading}
        title={`${locked ? "Locked" : "Unlocked"} — click to toggle`}
      >
        {locked ? <Lock size={9} /> : <Unlock size={9} />}
      </IconButton>
      <Text fontSize="8px" color={locked ? "orange.400" : "gray.600"} fontFamily="mono">
        {label}
      </Text>
    </Flex>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ManageFilesPage() {
  const router = useRouter()

  const [files, setFiles] = useState<AudioFile[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [lockLoading, setLockLoading] = useState<Record<string, boolean>>({})

  // Filters
  const [search, setSearch] = useState("")
  const [filterSubfolder, setFilterSubfolder] = useState<string[]>([])
  const [filterLanguage, setFilterLanguage] = useState<string[]>([])
  const [filterStage, setFilterStage] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [filesRes, assignRes] = await Promise.all([
        api.get("/api/audio-files"),
        api.get("/api/assignments"),
      ])
      setFiles(filesRes.data)
      setAssignments(assignRes.data)
    } catch {
      ToastWizard.standard("error", "Failed to load files")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Build rows ──────────────────────────────────────────────────────────────

  const rows = useMemo((): FileRow[] => {
    return files.map(file => {
      const fileAssignments = assignments.filter(a => a.audio_file_id === file.id)

      const taskSummary: Record<string, TaskStat> = {}
      for (const a of fileAssignments) {
        if (!taskSummary[a.task_type]) taskSummary[a.task_type] = { total: 0, done: 0 }
        taskSummary[a.task_type].total++
        if (a.status === "completed") taskSummary[a.task_type].done++
      }

      return {
        file,
        assignments: fileAssignments,
        stage: computeStage(file, fileAssignments),
        taskSummary,
      }
    })
  }, [files, assignments])

  // ── Filter options ──────────────────────────────────────────────────────────

  const subfolderOptions = useMemo(() =>
    createListCollection({
      items: [...new Set(files.map(f => f.subfolder).filter(Boolean) as string[])].map(s => ({ label: s, value: s })),
    }), [files])

  const languageOptions = useMemo(() =>
    createListCollection({
      items: [...new Set(files.map(f => f.language).filter(Boolean) as string[])].map(l => ({ label: l, value: l })),
    }), [files])

  const stageOptions = createListCollection({
    items: (Object.entries(STAGE_META) as [Stage, typeof STAGE_META[Stage]][]).map(([v, m]) => ({ label: m.label, value: v })),
  })

  // ── Filtered rows ───────────────────────────────────────────────────────────

  const filteredRows = useMemo(() => {
    return rows.filter(row => {
      if (search && !row.file.filename.toLowerCase().includes(search.toLowerCase())) return false
      if (filterSubfolder.length && !filterSubfolder.includes(row.file.subfolder ?? "")) return false
      if (filterLanguage.length && !filterLanguage.includes(row.file.language ?? "")) return false
      if (filterStage.length && !filterStage.includes(row.stage)) return false
      return true
    })
  }, [rows, search, filterSubfolder, filterLanguage, filterStage])

  // ── Summary counts ──────────────────────────────────────────────────────────

  const stageCounts = useMemo(() => {
    const counts: Record<Stage, number> = { unassigned: 0, in_progress: 0, complete: 0, finalized: 0 }
    for (const r of rows) counts[r.stage]++
    return counts
  }, [rows])

  // ── Lock toggle ─────────────────────────────────────────────────────────────

  const toggleLock = async (fileId: number, taskType: string, locked: boolean) => {
    const key = `${fileId}-${taskType}`
    setLockLoading(prev => ({ ...prev, [key]: true }))
    try {
      await api.patch(`/api/audio-files/${fileId}/lock`, { task_type: taskType, locked })
      setFiles(prev => prev.map(f =>
        f.id === fileId
          ? { ...f, [`collaborative_locked_${taskType}`]: locked }
          : f
      ))
    } catch {
      ToastWizard.standard("error", "Failed to toggle lock")
    } finally {
      setLockLoading(prev => ({ ...prev, [key]: false }))
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Box p={6} maxW="1400px">
      {/* Header */}
      <HStack justify="space-between" mb={5}>
        <Box>
          <Heading size="lg" color="fg">Manage Files</Heading>
          <Text color="fg.muted" fontSize="sm" mt={0.5}>
            {files.length} file{files.length !== 1 ? "s" : ""} · master view of all annotation progress
          </Text>
        </Box>
        <HStack gap={2}>
          <Button size="sm" variant="outline" onClick={load} loading={loading}>
            <RefreshCw size={14} />
            Refresh
          </Button>
          <Button size="sm" colorPalette="blue" onClick={() => router.push("/admin/upload")}>
            Upload Files
          </Button>
        </HStack>
      </HStack>

      {/* Stage summary cards */}
      <HStack gap={3} mb={5} flexWrap="wrap">
        {(Object.entries(STAGE_META) as [Stage, typeof STAGE_META[Stage]][]).map(([stage, meta]) => (
          <Box
            key={stage}
            bg="bg.subtle"
            borderWidth="1px"
            borderColor={filterStage[0] === stage ? `${meta.color}.500` : "border"}
            rounded="lg"
            px={4}
            py={3}
            minW="120px"
            cursor="pointer"
            onClick={() => setFilterStage(prev => prev[0] === stage ? [] : [stage])}
            _hover={{ borderColor: `${meta.color}.400` }}
            transition="all 0.15s"
          >
            <Text fontSize="xl" fontWeight="bold" color={`${meta.color}.400`}>
              {stageCounts[stage]}
            </Text>
            <Text fontSize="xs" color="fg.muted" mt={0.5}>{meta.label}</Text>
          </Box>
        ))}
        {filterStage.length > 0 && (
          <Button size="xs" variant="ghost" color="fg.muted" onClick={() => setFilterStage([])}>
            <X size={12} /> Clear filter
          </Button>
        )}
      </HStack>

      {/* Filter bar */}
      <HStack gap={3} mb={4} flexWrap="wrap">
        {/* Search */}
        <Box position="relative" flex={1} minW="200px" maxW="320px">
          <Box position="absolute" left={3} top="50%" transform="translateY(-50%)" pointerEvents="none" color="fg.muted">
            <Search size={14} />
          </Box>
          <Input
            size="sm"
            pl={8}
            placeholder="Search by filename…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            bg="bg.muted"
            borderColor="border"
          />
          {search && (
            <Box position="absolute" right={2} top="50%" transform="translateY(-50%)" cursor="pointer" color="fg.muted" onClick={() => setSearch("")}>
              <X size={12} />
            </Box>
          )}
        </Box>

        {/* Subfolder filter */}
        {subfolderOptions.items.length > 0 && (
          <Select.Root
            collection={subfolderOptions}
            size="sm"
            value={filterSubfolder}
            onValueChange={({ value }) => setFilterSubfolder(value)}
            maxW="180px"
          >
            <Select.HiddenSelect />
            <Select.Control>
              <Select.Trigger bg="bg.muted" borderColor="border" color={filterSubfolder.length ? "fg" : "fg.muted"} minW="140px">
                <Select.ValueText placeholder="Subfolder…" />
              </Select.Trigger>
            </Select.Control>
            <Portal>
              <Select.Positioner>
                <Select.Content bg="bg.subtle" borderColor="border">
                  {subfolderOptions.items.map(item => (
                    <Select.Item key={item.value} item={item} color="fg" _hover={{ bg: "bg.muted" }}>
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Positioner>
            </Portal>
          </Select.Root>
        )}

        {/* Language filter */}
        {languageOptions.items.length > 0 && (
          <Select.Root
            collection={languageOptions}
            size="sm"
            value={filterLanguage}
            onValueChange={({ value }) => setFilterLanguage(value)}
            maxW="160px"
          >
            <Select.HiddenSelect />
            <Select.Control>
              <Select.Trigger bg="bg.muted" borderColor="border" color={filterLanguage.length ? "fg" : "fg.muted"} minW="130px">
                <Select.ValueText placeholder="Language…" />
              </Select.Trigger>
            </Select.Control>
            <Portal>
              <Select.Positioner>
                <Select.Content bg="bg.subtle" borderColor="border">
                  {languageOptions.items.map(item => (
                    <Select.Item key={item.value} item={item} color="fg" _hover={{ bg: "bg.muted" }}>
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Positioner>
            </Portal>
          </Select.Root>
        )}

        {/* Stage filter */}
        <Select.Root
          collection={stageOptions}
          size="sm"
          value={filterStage}
          onValueChange={({ value }) => setFilterStage(value)}
          maxW="160px"
        >
          <Select.HiddenSelect />
          <Select.Control>
            <Select.Trigger bg="bg.muted" borderColor="border" color={filterStage.length ? "fg" : "fg.muted"} minW="130px">
              <Select.ValueText placeholder="Stage…" />
            </Select.Trigger>
          </Select.Control>
          <Portal>
            <Select.Positioner>
              <Select.Content bg="bg.subtle" borderColor="border">
                {stageOptions.items.map(item => (
                  <Select.Item key={item.value} item={item} color="fg" _hover={{ bg: "bg.muted" }}>
                    {item.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Positioner>
          </Portal>
        </Select.Root>

        {/* Clear all filters */}
        {(search || filterSubfolder.length || filterLanguage.length || filterStage.length) && (
          <Button
            size="xs"
            variant="ghost"
            color="fg.muted"
            onClick={() => { setSearch(""); setFilterSubfolder([]); setFilterLanguage([]); setFilterStage([]) }}
          >
            <X size={12} /> Clear all
          </Button>
        )}

        <Text fontSize="xs" color="fg.muted" ml="auto">
          {filteredRows.length} of {rows.length} files
        </Text>
      </HStack>

      {/* Table */}
      {loading ? (
        <Flex justify="center" py={16}>
          <Spinner />
        </Flex>
      ) : filteredRows.length === 0 ? (
        <Box py={16} textAlign="center" color="fg.muted">
          <FileAudio2 size={32} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
          <Text>{rows.length === 0 ? "No files uploaded yet." : "No files match the current filters."}</Text>
        </Box>
      ) : (
        <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden">
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader color="fg.muted" fontSize="xs" px={4} py={3}>File</Table.ColumnHeader>
                <Table.ColumnHeader color="fg.muted" fontSize="xs" px={4} py={3}>Info</Table.ColumnHeader>
                <Table.ColumnHeader color="fg.muted" fontSize="xs" px={4} py={3}>Task Progress</Table.ColumnHeader>
                <Table.ColumnHeader color="fg.muted" fontSize="xs" px={4} py={3}>Locks</Table.ColumnHeader>
                <Table.ColumnHeader color="fg.muted" fontSize="xs" px={4} py={3}>Stage</Table.ColumnHeader>
                <Table.ColumnHeader color="fg.muted" fontSize="xs" px={4} py={3}>Quick Actions</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filteredRows.map(row => (
                <FileTableRow
                  key={row.file.id}
                  row={row}
                  lockLoading={lockLoading}
                  onToggleLock={toggleLock}
                  onNavigate={router.push}
                />
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      )}
    </Box>
  )
}

// ─── Table Row (extracted to avoid re-renders of the full list) ───────────────

function FileTableRow({
  row,
  lockLoading,
  onToggleLock,
  onNavigate,
}: {
  row: FileRow
  lockLoading: Record<string, boolean>
  onToggleLock: (fileId: number, taskType: string, locked: boolean) => void
  onNavigate: (href: string) => void
}) {
  const { file, stage, taskSummary } = row
  const stageMeta = STAGE_META[stage]

  // Total annotators across all tasks
  const totalAnnotators = Object.values(taskSummary).reduce((s, t) => s + t.total, 0)
  const doneAnnotators = Object.values(taskSummary).reduce((s, t) => s + t.done, 0)

  return (
    <Table.Row _hover={{ bg: "bg.muted" }}>
      {/* File */}
      <Table.Cell px={4} py={3} maxW="240px">
        <HStack gap={2} align="flex-start">
          <Box color="fg.muted" flexShrink={0} mt="1px">
            <FileAudio2 size={14} />
          </Box>
          <Box minW={0}>
            <Text fontSize="xs" fontFamily="mono" color="fg" fontWeight="medium" truncate>
              {file.filename}
            </Text>
            {file.subfolder && (
              <Badge size="xs" colorPalette="gray" mt={0.5} variant="subtle">
                {file.subfolder}
              </Badge>
            )}
            <Text fontSize="10px" color="fg.muted" mt={0.5}>
              {new Date(file.created_at).toLocaleDateString()}
            </Text>
          </Box>
        </HStack>
      </Table.Cell>

      {/* Info */}
      <Table.Cell px={4} py={3}>
        <VStack align="flex-start" gap={1}>
          {file.language && (
            <Badge size="xs" colorPalette="blue" variant="subtle">{file.language}</Badge>
          )}
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            {fmtDuration(file.duration)}
          </Text>
          {file.num_speakers != null && (
            <Text fontSize="xs" color="fg.muted">
              {file.num_speakers} spk
            </Text>
          )}
        </VStack>
      </Table.Cell>

      {/* Task Progress */}
      <Table.Cell px={4} py={3}>
        {totalAnnotators === 0 ? (
          <Text fontSize="xs" color="fg.muted" fontStyle="italic">No assignments</Text>
        ) : (
          <VStack align="flex-start" gap={2}>
            <HStack gap={3}>
              {TASK_ORDER.map(task => (
                <TaskPill key={task} taskType={task} stat={taskSummary[task]} />
              ))}
            </HStack>
            <Text fontSize="10px" color="fg.muted">
              {doneAnnotators}/{totalAnnotators} annotators done
            </Text>
          </VStack>
        )}
      </Table.Cell>

      {/* Locks */}
      <Table.Cell px={4} py={3}>
        <HStack gap={2}>
          {LOCK_TYPES.map(lt => {
            const locked = (file as Record<string, unknown>)[`collaborative_locked_${lt.key}`] as boolean
            const key = `${file.id}-${lt.key}`
            return (
              <LockToggle
                key={lt.key}
                locked={locked}
                label={lt.label}
                loading={lockLoading[key]}
                onToggle={() => onToggleLock(file.id, lt.key, !locked)}
              />
            )
          })}
        </HStack>
      </Table.Cell>

      {/* Stage */}
      <Table.Cell px={4} py={3}>
        <VStack align="flex-start" gap={1}>
          <Badge colorPalette={stageMeta.color} size="sm" variant="subtle">
            {stageMeta.label}
          </Badge>
          <Text fontSize="9px" color="fg.muted" maxW="100px">
            {stageMeta.desc}
          </Text>
        </VStack>
      </Table.Cell>

      {/* Quick Actions */}
      <Table.Cell px={4} py={3}>
        <VStack align="flex-start" gap={1}>
          {stage === "unassigned" && (
            <Button
              size="xs"
              colorPalette="blue"
              variant="outline"
              onClick={() => onNavigate("/admin/assignments")}
            >
              <ClipboardList size={11} />
              Assign Tasks
              <ArrowRight size={11} />
            </Button>
          )}

          {stage === "in_progress" && (
            <>
              <Button
                size="xs"
                colorPalette="blue"
                variant="ghost"
                onClick={() => onNavigate("/admin/assignments")}
              >
                <ClipboardList size={11} />
                Assign More
              </Button>
              {/* Remind to lock speaker if emotion not yet assignable */}
              {!file.collaborative_locked_speaker && taskSummary.speaker && (
                <Text fontSize="9px" color="orange.400">
                  Lock Spk to enable emotion
                </Text>
              )}
            </>
          )}

          {stage === "complete" && (
            <>
              <Button
                size="xs"
                colorPalette="teal"
                onClick={() => onNavigate("/admin/review")}
              >
                <CheckCircle2 size={11} />
                Review & Finalize
                <ArrowRight size={11} />
              </Button>
              {/* Nudge to lock remaining tasks */}
              {(!file.collaborative_locked_speaker || !file.collaborative_locked_transcription) && (
                <Text fontSize="9px" color="fg.muted">
                  Consider locking completed tasks
                </Text>
              )}
            </>
          )}

          {stage === "finalized" && (
            <HStack gap={1}>
              <CheckCircle2 size={12} color="var(--chakra-colors-purple-400)" />
              <Text fontSize="xs" color="purple.400" fontWeight="medium">Finalized</Text>
            </HStack>
          )}
        </VStack>
      </Table.Cell>
    </Table.Row>
  )
}
