"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Badge,
  Box,
  Button,
  Dialog,
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
  Database,
  Download,
  FileAudio2,
  Lock,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Unlock,
  X,
} from "lucide-react"
import api, { downloadExport } from "@/lib/axios"
import ToastWizard from "@/lib/toastWizard"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Dataset {
  id: number
  name: string
}

interface AudioFile {
  id: number
  filename: string
  dataset_id: number | null
  duration: number | null
  language: string | null
  num_speakers: number | null
  collaborative_locked_speaker: boolean
  collaborative_locked_gender: boolean
  collaborative_locked_transcription: boolean
  created_at: string
  json_types: string[]
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

const JSON_TYPE_META: Record<string, { short: string }> = {
  emotion_gender: { short: "E/G" },
  speaker:        { short: "Spk" },
  transcription:  { short: "Trn" },
}
const JSON_TYPE_ORDER = ["speaker", "transcription", "emotion_gender"]

function JsonTypeBadges({ jsonTypes }: { jsonTypes: string[] }) {
  const present = new Set(jsonTypes)
  return (
    <HStack gap="3px" flexWrap="wrap">
      {JSON_TYPE_ORDER.map(t => {
        const has = present.has(t)
        return (
          <Badge
            key={t}
            size="xs"
            colorPalette={has ? "green" : "gray"}
            variant={has ? "subtle" : "outline"}
            fontSize="8px"
            px="3px"
            py="0px"
            opacity={has ? 1 : 0.4}
            title={has ? `${t} JSON linked` : `${t} JSON not uploaded`}
          >
            {JSON_TYPE_META[t].short}
          </Badge>
        )
      })}
    </HStack>
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
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [loading, setLoading] = useState(true)
  const [lockLoading, setLockLoading] = useState<Record<string, boolean>>({})
  const [deleteTarget, setDeleteTarget] = useState<AudioFile | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Filters
  const [search, setSearch] = useState("")
  const [filterLanguage, setFilterLanguage] = useState<string[]>([])
  const [filterStage, setFilterStage] = useState<string[]>([])
  const [filterDataset, setFilterDataset] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [filesRes, assignRes, datasetsRes] = await Promise.all([
        api.get("/api/audio-files"),
        api.get("/api/assignments"),
        api.get("/api/datasets"),
      ])
      setFiles(filesRes.data)
      setAssignments(assignRes.data)
      setDatasets(datasetsRes.data)
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

  const datasetMap = useMemo(() => new Map(datasets.map(d => [d.id, d.name])), [datasets])

  const languageOptions = useMemo(() =>
    createListCollection({
      items: [...new Set(files.map(f => f.language).filter(Boolean) as string[])].map(l => ({ label: l, value: l })),
    }), [files])

  const datasetOptions = useMemo(() =>
    createListCollection({
      items: [
        { label: "No dataset", value: "none" },
        ...datasets.map(d => ({ label: d.name, value: String(d.id) })),
      ],
    }), [datasets])

  const stageOptions = createListCollection({
    items: (Object.entries(STAGE_META) as [Stage, typeof STAGE_META[Stage]][]).map(([v, m]) => ({ label: m.label, value: v })),
  })

  // ── Filtered rows ───────────────────────────────────────────────────────────

  const filteredRows = useMemo(() => {
    return rows.filter(row => {
      if (search && !row.file.filename.toLowerCase().includes(search.toLowerCase())) return false
      if (filterLanguage.length && !filterLanguage.includes(row.file.language ?? "")) return false
      if (filterStage.length && !filterStage.includes(row.stage)) return false
      if (filterDataset.length) {
        const dsVal = row.file.dataset_id == null ? "none" : String(row.file.dataset_id)
        if (!filterDataset.includes(dsVal)) return false
      }
      return true
    })
  }, [rows, search, filterLanguage, filterStage, filterDataset])

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

  // ── Delete file ─────────────────────────────────────────────────────────────

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.delete(`/api/audio-files/${deleteTarget.id}`)
      setFiles(prev => prev.filter(f => f.id !== deleteTarget.id))
      setAssignments(prev => prev.filter(a => a.audio_file_id !== deleteTarget.id))
      ToastWizard.standard("success", `Deleted "${deleteTarget.filename}"`)
      setDeleteTarget(null)
    } catch {
      ToastWizard.standard("error", "Failed to delete file")
    } finally {
      setDeleting(false)
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
          <Button
            size="sm" variant="outline" colorPalette="green"
            onClick={async () => {
              try { await downloadExport("/api/export/all?format=json", "all_files_export.zip") }
              catch { ToastWizard.standard("error", "Export failed") }
            }}
          >
            <Download size={14} /> Export All (JSON)
          </Button>
          <Button
            size="sm" variant="outline" colorPalette="green"
            onClick={async () => {
              try { await downloadExport("/api/export/all?format=csv", "all_files_export.zip") }
              catch { ToastWizard.standard("error", "Export failed") }
            }}
          >
            <Download size={14} /> Export All (CSV)
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

        {/* Dataset filter */}
        {datasetOptions.items.length > 1 && (
          <Select.Root
            collection={datasetOptions}
            size="sm"
            value={filterDataset}
            onValueChange={({ value }) => setFilterDataset(value)}
            maxW="180px"
          >
            <Select.HiddenSelect />
            <Select.Control>
              <Select.Trigger bg="bg.muted" borderColor="border" color={filterDataset.length ? "fg" : "fg.muted"} minW="150px">
                <Select.ValueText placeholder="Dataset…" />
              </Select.Trigger>
            </Select.Control>
            <Portal>
              <Select.Positioner>
                <Select.Content bg="bg.subtle" borderColor="border">
                  {datasetOptions.items.map(item => (
                    <Select.Item key={item.value} item={item} color="fg" _hover={{ bg: "bg.muted" }}>
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Positioner>
            </Portal>
          </Select.Root>
        )}

        {/* Clear all filters */}
        {(search || filterLanguage.length || filterStage.length || filterDataset.length) && (
          <Button
            size="xs"
            variant="ghost"
            color="fg.muted"
            onClick={() => { setSearch(""); setFilterLanguage([]); setFilterStage([]); setFilterDataset([]) }}
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
                  datasetMap={datasetMap}
                  lockLoading={lockLoading}
                  onToggleLock={toggleLock}
                  onNavigate={router.push}
                  onDelete={setDeleteTarget}
                  onMetadataUpdate={(fileId, language, numSpeakers) => {
                    setFiles(prev => prev.map(f =>
                      f.id === fileId ? { ...f, language, num_speakers: numSpeakers } : f
                    ))
                  }}
                />
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      )}

      {/* Delete confirm dialog */}
      <Dialog.Root
        open={!!deleteTarget}
        onOpenChange={({ open }) => { if (!open && !deleting) setDeleteTarget(null) }}
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="bg.subtle" borderWidth="1px" borderColor="border" maxW="420px">
              <Dialog.Header>
                <Dialog.Title color="fg">Delete File</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Text color="fg.muted" fontSize="sm">
                  Permanently delete{" "}
                  <Text as="span" color="fg" fontFamily="mono" fontWeight="medium">
                    {deleteTarget?.filename}
                  </Text>
                  {" "}and all linked data (segments, assignments, JSONs)?
                </Text>
                {deleteTarget && deleteTarget.json_types.length > 0 && (
                  <HStack mt={3} gap={1}>
                    <Text fontSize="xs" color="fg.muted">Linked JSONs:</Text>
                    {deleteTarget.json_types.map(t => (
                      <Badge key={t} size="xs" colorPalette="green" variant="subtle" fontSize="9px">
                        {JSON_TYPE_META[t]?.short ?? t}
                      </Badge>
                    ))}
                  </HStack>
                )}
                <Text mt={3} fontSize="xs" color="red.400" fontWeight="medium">
                  This action cannot be undone.
                </Text>
              </Dialog.Body>
              <Dialog.Footer gap={2}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  colorPalette="red"
                  onClick={confirmDelete}
                  loading={deleting}
                >
                  <Trash2 size={13} />
                  Delete
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Box>
  )
}

// ─── Table Row (extracted to avoid re-renders of the full list) ───────────────

const LANGUAGE_PRESETS = ["English", "Malay", "Chinese", "Tamil", "Mixed"]

function FileTableRow({
  row,
  datasetMap,
  lockLoading,
  onToggleLock,
  onNavigate,
  onDelete,
  onMetadataUpdate,
}: {
  row: FileRow
  datasetMap: Map<number, string>
  lockLoading: Record<string, boolean>
  onToggleLock: (fileId: number, taskType: string, locked: boolean) => void
  onNavigate: (href: string) => void
  onDelete: (file: AudioFile) => void
  onMetadataUpdate: (fileId: number, language: string | null, numSpeakers: number | null) => void
}) {
  const { file, stage, taskSummary } = row
  const stageMeta = STAGE_META[stage]
  const [editOpen, setEditOpen] = useState(false)
  const [editLang, setEditLang] = useState(file.language ?? "")
  const [editSpk, setEditSpk] = useState(String(file.num_speakers ?? ""))
  const [saving, setSaving] = useState(false)

  const openEdit = () => {
    setEditLang(file.language ?? "")
    setEditSpk(String(file.num_speakers ?? ""))
    setEditOpen(true)
  }

  const saveEdit = async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {}
      const lang = editLang.trim() || null
      const spk = editSpk.trim() ? parseInt(editSpk, 10) : null
      if (lang !== (file.language ?? null)) body.language = lang
      if (spk !== (file.num_speakers ?? null)) body.num_speakers = spk
      if (Object.keys(body).length === 0) { setEditOpen(false); return }
      await api.patch(`/api/audio-files/${file.id}/metadata`, body)
      onMetadataUpdate(file.id, lang, spk)
      setEditOpen(false)
    } catch {
      // let parent show error if needed; keep modal open
    } finally {
      setSaving(false)
    }
  }

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
            {file.dataset_id != null && (
              <HStack gap="3px" mt="2px">
                <Database size={9} color="var(--chakra-colors-blue-400)" />
                <Text fontSize="9px" color="blue.400" truncate maxW="160px">
                  {datasetMap.get(file.dataset_id) ?? `Dataset #${file.dataset_id}`}
                </Text>
              </HStack>
            )}
            <JsonTypeBadges jsonTypes={file.json_types ?? []} />
            <Text fontSize="10px" color="fg.muted" mt={0.5}>
              {new Date(file.created_at).toLocaleDateString()}
            </Text>
          </Box>
        </HStack>
      </Table.Cell>

      {/* Info */}
      <Table.Cell px={4} py={3}>
        <HStack gap={1} align="flex-start">
          <VStack align="flex-start" gap={1}>
            {file.language
              ? <Badge size="xs" colorPalette="blue" variant="subtle">{file.language}</Badge>
              : <Badge size="xs" colorPalette="gray" variant="subtle">no language</Badge>
            }
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">{fmtDuration(file.duration)}</Text>
            <Text fontSize="xs" color="fg.muted">
              {file.num_speakers != null ? `${file.num_speakers} spk` : "? spk"}
            </Text>
          </VStack>
          <IconButton
            aria-label="Edit metadata" size="2xs" variant="ghost" color="fg.muted"
            onClick={openEdit} title="Edit language / speakers"
          >
            <Pencil size={11} />
          </IconButton>
        </HStack>

        {/* Edit metadata modal */}
        <Dialog.Root open={editOpen} onOpenChange={({ open }) => setEditOpen(open)}>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" maxW="340px" w="full">
              <Dialog.Header borderBottomWidth="1px" borderColor="border" pb={3}>
                <Dialog.Title fontSize="sm" color="fg">Edit file metadata</Dialog.Title>
                <Text fontSize="xs" color="fg.muted" mt={0.5} fontFamily="mono">{file.filename}</Text>
              </Dialog.Header>
              <Dialog.Body pt={4}>
                <VStack gap={4} align="stretch">
                  <Box>
                    <Text fontSize="xs" color="fg.muted" mb={1}>Language</Text>
                    <Input
                      size="sm" bg="bg.muted" borderColor="border" color="fg"
                      placeholder="e.g. English, Mixed…"
                      value={editLang}
                      onChange={e => setEditLang(e.target.value)}
                      mb={2}
                    />
                    <Flex gap={1} flexWrap="wrap">
                      {LANGUAGE_PRESETS.map(l => (
                        <button
                          key={l} type="button"
                          onClick={() => setEditLang(l)}
                          style={{
                            padding: "1px 8px", fontSize: "12px", borderRadius: "9999px",
                            border: `1px solid ${editLang === l ? "var(--chakra-colors-blue-400)" : "var(--chakra-colors-border)"}`,
                            background: editLang === l ? "var(--chakra-colors-blue-900)" : "var(--chakra-colors-bg-muted)",
                            color: editLang === l ? "var(--chakra-colors-blue-300)" : "var(--chakra-colors-fg-muted)",
                            cursor: "pointer",
                          }}
                        >
                          {l}
                        </button>
                      ))}
                    </Flex>
                  </Box>
                  <Box>
                    <Text fontSize="xs" color="fg.muted" mb={1}>Number of speakers</Text>
                    <Input
                      size="sm" type="number" min={1} bg="bg.muted" borderColor="border" color="fg"
                      placeholder="e.g. 2"
                      value={editSpk}
                      onChange={e => setEditSpk(e.target.value)}
                    />
                  </Box>
                </VStack>
              </Dialog.Body>
              <Dialog.Footer borderTopWidth="1px" borderColor="border" pt={3} gap={2}>
                <Button size="sm" variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button size="sm" colorPalette="blue" loading={saving} onClick={saveEdit}>Save</Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Dialog.Root>
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

          <IconButton
            size="2xs"
            variant="ghost"
            colorPalette="red"
            aria-label="Delete file"
            title="Delete file and all linked data"
            mt={1}
            onClick={() => onDelete(file)}
          >
            <Trash2 size={11} />
          </IconButton>
        </VStack>
      </Table.Cell>
    </Table.Row>
  )
}
