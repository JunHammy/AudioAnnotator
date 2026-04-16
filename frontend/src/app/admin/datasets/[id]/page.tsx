"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Collapsible,
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
  Archive,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Database,
  Download,
  FileAudio2,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Unlock,
  Upload,
  X,
} from "lucide-react"
import api, { downloadExport } from "@/lib/axios"
import ToastWizard from "@/lib/toastWizard"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Dataset {
  id: number
  name: string
  description: string | null
  file_count: number
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
  is_deleted: boolean
}

interface Assignment {
  id: number
  audio_file_id: number
  annotator_id: number
  task_type: string
  status: string
}

type Stage = "unassigned" | "in_progress" | "complete" | "finalized"

interface TaskStat { total: number; done: number }
interface FileRow { file: AudioFile; assignments: Assignment[]; stage: Stage; taskSummary: Record<string, TaskStat> }

// ─── Constants ────────────────────────────────────────────────────────────────

const TASK_ORDER = ["speaker", "gender", "emotion", "transcription"]
const TASK_META: Record<string, { short: string; color: string }> = {
  speaker:       { short: "Spk", color: "blue"   },
  gender:        { short: "Gnd", color: "purple" },
  emotion:       { short: "Emo", color: "yellow" },
  transcription: { short: "Trn", color: "green"  },
}
const STAGE_META: Record<Stage, { label: string; color: string }> = {
  unassigned:  { label: "Unassigned",  color: "gray"   },
  in_progress: { label: "In Progress", color: "blue"   },
  complete:    { label: "Complete",    color: "teal"   },
  finalized:   { label: "Finalized",   color: "purple" },
}
const LOCK_TYPES = [
  { key: "speaker",       label: "Spk" },
  { key: "gender",        label: "Gnd" },
  { key: "transcription", label: "Trn" },
]
const JSON_TYPE_META: Record<string, { short: string }> = {
  emotion_gender: { short: "E/G" },
  speaker:        { short: "Spk" },
  transcription:  { short: "Trn" },
}
const JSON_TYPE_ORDER = ["speaker", "transcription", "emotion_gender"]

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
  if (!stat) return (
    <Flex direction="column" align="center" gap="2px" minW="28px">
      <Box w="6px" h="6px" rounded="full" bg="gray.700" />
      <Text fontSize="8px" color="gray.600" fontFamily="mono">{meta.short}</Text>
    </Flex>
  )
  const allDone = stat.done === stat.total
  const someDone = stat.done > 0
  return (
    <Flex direction="column" align="center" gap="2px" minW="28px">
      <Badge
        colorPalette={allDone ? "green" : someDone ? "blue" : "gray"}
        size="xs" fontFamily="mono" px="3px" py="0px" fontSize="9px"
        variant={allDone ? "solid" : "subtle"}
      >
        {stat.done}/{stat.total}
      </Badge>
      <Text fontSize="8px" color="fg.muted" fontFamily="mono">{meta.short}</Text>
    </Flex>
  )
}

function JsonTypeBadges({ jsonTypes }: { jsonTypes: string[] }) {
  const present = new Set(jsonTypes)
  return (
    <HStack gap="3px" flexWrap="wrap">
      {JSON_TYPE_ORDER.map(t => {
        const has = present.has(t)
        return (
          <Badge key={t} size="xs" colorPalette={has ? "green" : "gray"} variant={has ? "subtle" : "outline"}
            fontSize="8px" px="3px" py="0px" opacity={has ? 1 : 0.4}
          >
            {JSON_TYPE_META[t].short}
          </Badge>
        )
      })}
    </HStack>
  )
}

function LockToggle({ locked, label, onToggle, loading }: { locked: boolean; label: string; onToggle: () => void; loading?: boolean }) {
  return (
    <Flex direction="column" align="center" gap="2px">
      <IconButton
        size="2xs" variant={locked ? "solid" : "ghost"} colorPalette={locked ? "orange" : "gray"}
        aria-label={`${locked ? "Unlock" : "Lock"} ${label}`} onClick={onToggle} loading={loading}
      >
        {locked ? <Lock size={9} /> : <Unlock size={9} />}
      </IconButton>
      <Text fontSize="8px" color={locked ? "orange.400" : "gray.600"} fontFamily="mono">{label}</Text>
    </Flex>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DatasetDetailPage() {
  const params = useParams()
  const router = useRouter()
  const rawId = params?.id as string
  const isUnassigned = rawId === "unassigned"
  const datasetId = isUnassigned ? null : parseInt(rawId, 10)

  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [allFiles, setAllFiles] = useState<AudioFile[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [allDatasets, setAllDatasets] = useState<Dataset[]>([])
  const [loading, setLoading] = useState(true)
  const [lockLoading, setLockLoading] = useState<Record<string, boolean>>({})
  const [archiveTarget, setArchiveTarget] = useState<AudioFile | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [permDeleteTarget, setPermDeleteTarget] = useState<AudioFile | null>(null)
  const [permDeleteInput, setPermDeleteInput] = useState("")
  const [permDeleting, setPermDeleting] = useState(false)
  const [archivedFiles, setArchivedFiles] = useState<AudioFile[]>([])
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [search, setSearch] = useState("")

  // Add files dialog
  const [addOpen, setAddOpen] = useState(false)
  const [selectedToAdd, setSelectedToAdd] = useState<Set<number>>(new Set())
  const [adding, setAdding] = useState(false)

  // Move file dialog
  const [moveTarget, setMoveTarget] = useState<AudioFile | null>(null)
  const [moveToDataset, setMoveToDataset] = useState<string[]>([])
  const [moving, setMoving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [filesRes, assignRes, datasetsRes, archivedRes] = await Promise.all([
        api.get("/api/audio-files"),
        api.get("/api/assignments"),
        api.get("/api/datasets"),
        api.get("/api/audio-files/?include_deleted=true"),
      ])
      setAllFiles(filesRes.data)
      setAssignments(assignRes.data)
      setAllDatasets(datasetsRes.data)
      // Archived = files returned only in include_deleted but not in active list
      const activeIds = new Set((filesRes.data as AudioFile[]).map(f => f.id))
      setArchivedFiles((archivedRes.data as AudioFile[]).filter(f => !activeIds.has(f.id)))
      if (!isUnassigned && datasetId != null) {
        const ds = (datasetsRes.data as Dataset[]).find(d => d.id === datasetId)
        if (!ds) { router.push("/admin/datasets"); return }
        setDataset(ds)
      }
    } catch {
      ToastWizard.standard("error", "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [datasetId, isUnassigned, router])

  useEffect(() => { load() }, [load])

  // Files in this view
  const scopedFiles = useMemo(() =>
    isUnassigned
      ? allFiles.filter(f => f.dataset_id == null)
      : allFiles.filter(f => f.id != null && f.dataset_id === datasetId),
    [allFiles, isUnassigned, datasetId]
  )

  // Files that can be added (not already in this dataset)
  const addableFiles = useMemo(() =>
    isUnassigned ? [] : allFiles.filter(f => f.dataset_id !== datasetId),
    [allFiles, isUnassigned, datasetId]
  )

  const rows = useMemo((): FileRow[] =>
    scopedFiles.map(file => {
      const fileAssignments = assignments.filter(a => a.audio_file_id === file.id)
      const taskSummary: Record<string, TaskStat> = {}
      for (const a of fileAssignments) {
        if (!taskSummary[a.task_type]) taskSummary[a.task_type] = { total: 0, done: 0 }
        taskSummary[a.task_type].total++
        if (a.status === "completed") taskSummary[a.task_type].done++
      }
      return { file, assignments: fileAssignments, stage: computeStage(file, fileAssignments), taskSummary }
    }),
    [scopedFiles, assignments]
  )

  const filteredRows = useMemo(() =>
    rows.filter(row => !search || row.file.filename.toLowerCase().includes(search.toLowerCase())),
    [rows, search]
  )

  // ── Lock toggle ─────────────────────────────────────────────────────────────

  const toggleLock = async (fileId: number, taskType: string, locked: boolean) => {
    const key = `${fileId}-${taskType}`
    setLockLoading(prev => ({ ...prev, [key]: true }))
    try {
      await api.patch(`/api/audio-files/${fileId}/lock`, { task_type: taskType, locked })
      setAllFiles(prev => prev.map(f =>
        f.id === fileId ? { ...f, [`collaborative_locked_${taskType}`]: locked } : f
      ))
    } catch {
      ToastWizard.standard("error", "Failed to toggle lock")
    } finally {
      setLockLoading(prev => ({ ...prev, [key]: false }))
    }
  }

  // ── Archive file (soft-delete) ───────────────────────────────────────────────

  const confirmArchive = async () => {
    if (!archiveTarget) return
    setArchiving(true)
    try {
      await api.delete(`/api/audio-files/${archiveTarget.id}`)
      setArchivedFiles(prev => [{ ...archiveTarget, is_deleted: true }, ...prev])
      setAllFiles(prev => prev.filter(f => f.id !== archiveTarget.id))
      setAssignments(prev => prev.filter(a => a.audio_file_id !== archiveTarget.id))
      ToastWizard.standard("success", `"${archiveTarget.filename}" archived`)
      setArchiveTarget(null)
    } catch {
      ToastWizard.standard("error", "Failed to archive file")
    } finally {
      setArchiving(false)
    }
  }

  // ── Restore file ─────────────────────────────────────────────────────────────

  const restoreFile = async (file: AudioFile) => {
    try {
      const res = await api.patch(`/api/audio-files/${file.id}/restore`)
      setArchivedFiles(prev => prev.filter(f => f.id !== file.id))
      setAllFiles(prev => [...prev, res.data])
      ToastWizard.standard("success", `"${file.filename}" restored`)
    } catch {
      ToastWizard.standard("error", "Failed to restore file")
    }
  }

  // ── Permanently delete ───────────────────────────────────────────────────────

  const confirmPermDelete = async () => {
    if (!permDeleteTarget || permDeleteInput !== permDeleteTarget.filename) return
    setPermDeleting(true)
    try {
      await api.delete(`/api/audio-files/${permDeleteTarget.id}/permanent`)
      setArchivedFiles(prev => prev.filter(f => f.id !== permDeleteTarget.id))
      ToastWizard.standard("success", `"${permDeleteTarget.filename}" permanently deleted`)
      setPermDeleteTarget(null)
      setPermDeleteInput("")
    } catch {
      ToastWizard.standard("error", "Failed to permanently delete file")
    } finally {
      setPermDeleting(false)
    }
  }

  // ── Remove from dataset ─────────────────────────────────────────────────────

  const removeFromDataset = async (file: AudioFile) => {
    try {
      await api.patch(`/api/audio-files/${file.id}/dataset`, { dataset_id: null })
      setAllFiles(prev => prev.map(f => f.id === file.id ? { ...f, dataset_id: null } : f))
      ToastWizard.standard("success", "Removed from dataset")
    } catch {
      ToastWizard.standard("error", "Failed to remove from dataset")
    }
  }

  // ── Add files to dataset ────────────────────────────────────────────────────

  const confirmAdd = async () => {
    if (!datasetId || selectedToAdd.size === 0) return
    setAdding(true)
    try {
      // Get current file IDs in this dataset + new ones
      const currentIds = allFiles.filter(f => f.dataset_id === datasetId).map(f => f.id)
      const newIds = [...new Set([...currentIds, ...selectedToAdd])]
      await api.patch(`/api/datasets/${datasetId}/files`, { audio_file_ids: newIds })
      // Reflect changes locally
      setAllFiles(prev => prev.map(f =>
        selectedToAdd.has(f.id) ? { ...f, dataset_id: datasetId } : f
      ))
      setAddOpen(false)
      setSelectedToAdd(new Set())
      ToastWizard.standard("success", `Added ${selectedToAdd.size} file${selectedToAdd.size !== 1 ? "s" : ""} to dataset`)
    } catch {
      ToastWizard.standard("error", "Failed to add files")
    } finally {
      setAdding(false)
    }
  }

  // ── Move file ───────────────────────────────────────────────────────────────

  const confirmMove = async () => {
    if (!moveTarget) return
    const targetId = moveToDataset[0] === "unassigned" ? null : parseInt(moveToDataset[0], 10)
    setMoving(true)
    try {
      await api.patch(`/api/audio-files/${moveTarget.id}/dataset`, { dataset_id: targetId })
      setAllFiles(prev => prev.map(f => f.id === moveTarget.id ? { ...f, dataset_id: targetId } : f))
      setMoveTarget(null)
      setMoveToDataset([])
      ToastWizard.standard("success", "File moved")
    } catch {
      ToastWizard.standard("error", "Failed to move file")
    } finally {
      setMoving(false)
    }
  }

  const moveOptions = useMemo(() => createListCollection({
    items: [
      { label: "Unassigned (no dataset)", value: "unassigned" },
      ...allDatasets
        .filter(d => d.id !== datasetId)
        .map(d => ({ label: d.name, value: String(d.id) })),
    ],
  }), [allDatasets, datasetId])

  // ── Render ──────────────────────────────────────────────────────────────────

  const title = isUnassigned ? "Unassigned Files" : dataset?.name ?? "Loading…"
  const subtitle = isUnassigned
    ? "Files not yet assigned to a dataset"
    : dataset?.description ?? ""

  return (
    <Box p={6} maxW="1400px">
      {/* Breadcrumb header */}
      <HStack mb={5} justify="space-between" flexWrap="wrap" gap={3}>
        <Box>
          <HStack gap={2} mb={1}>
            <Button size="xs" variant="ghost" color="fg.muted" onClick={() => router.push("/admin/datasets")} px={1}>
              <ArrowLeft size={13} />
              Datasets
            </Button>
            <Text color="fg.muted" fontSize="xs">/</Text>
            <HStack gap={1}>
              {isUnassigned
                ? null
                : <Database size={13} color="var(--chakra-colors-blue-400)" />
              }
              <Text fontSize="xs" color="fg">{title}</Text>
            </HStack>
          </HStack>
          <Heading size="lg" color="fg">{title}</Heading>
          {subtitle && <Text color="fg.muted" fontSize="sm" mt={0.5}>{subtitle}</Text>}
          <Text color="fg.muted" fontSize="xs" mt={0.5}>
            {scopedFiles.length} file{scopedFiles.length !== 1 ? "s" : ""}
          </Text>
        </Box>
        <HStack gap={2}>
          <Button size="sm" variant="outline" onClick={load} loading={loading}>
            <RefreshCw size={14} /> Refresh
          </Button>
          {!isUnassigned && datasetId != null && (
            <>
              <Button
                size="sm" variant="outline" colorPalette="green"
                onClick={async () => {
                  try { await downloadExport(`/api/export/dataset/${datasetId}?format=json`, `dataset_${datasetId}_export.zip`) }
                  catch { ToastWizard.standard("error", "Export failed") }
                }}
              >
                <Download size={14} /> Export (JSON)
              </Button>
              <Button
                size="sm" variant="outline" colorPalette="green"
                onClick={async () => {
                  try { await downloadExport(`/api/export/dataset/${datasetId}?format=csv`, `dataset_${datasetId}_export.zip`) }
                  catch { ToastWizard.standard("error", "Export failed") }
                }}
              >
                <Download size={14} /> Export (CSV)
              </Button>
            </>
          )}
          {!isUnassigned && (
            <Button size="sm" variant="outline" colorPalette="blue" onClick={() => { setSelectedToAdd(new Set()); setAddOpen(true) }}>
              <Plus size={14} /> Add Files
            </Button>
          )}
          <Button size="sm" colorPalette="blue" onClick={() => router.push("/admin/upload")}>
            <Upload size={14} /> Upload
          </Button>
        </HStack>
      </HStack>

      {/* Search */}
      <HStack gap={3} mb={4}>
        <Box position="relative" flex={1} minW="200px" maxW="320px">
          <Box position="absolute" left={3} top="50%" transform="translateY(-50%)" pointerEvents="none" color="fg.muted">
            <Search size={14} />
          </Box>
          <Input
            size="sm" pl={8} placeholder="Search by filename…"
            value={search} onChange={e => setSearch(e.target.value)}
            bg="bg.muted" borderColor="border"
          />
          {search && (
            <Box position="absolute" right={2} top="50%" transform="translateY(-50%)" cursor="pointer" color="fg.muted" onClick={() => setSearch("")}>
              <X size={12} />
            </Box>
          )}
        </Box>
        {search && (
          <Text fontSize="xs" color="fg.muted">{filteredRows.length} of {rows.length} files</Text>
        )}
      </HStack>

      {/* File table */}
      {loading ? (
        <Flex justify="center" py={16}><Spinner /></Flex>
      ) : filteredRows.length === 0 ? (
        <Box py={16} textAlign="center" color="fg.muted">
          <FileAudio2 size={32} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
          <Text>
            {rows.length === 0
              ? isUnassigned ? "All files are assigned to a dataset." : "No files in this dataset yet. Use \"Add Files\" or upload with this dataset selected."
              : "No files match the search."}
          </Text>
          {rows.length === 0 && !isUnassigned && (
            <Button mt={4} size="sm" colorPalette="blue" onClick={() => { setSelectedToAdd(new Set()); setAddOpen(true) }}>
              <Plus size={13} /> Add Existing Files
            </Button>
          )}
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
                <Table.ColumnHeader color="fg.muted" fontSize="xs" px={4} py={3}>Actions</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filteredRows.map(row => {
                const { file, stage, taskSummary } = row
                const stageMeta = STAGE_META[stage]
                const totalAnnotators = Object.values(taskSummary).reduce((s, t) => s + t.total, 0)
                const doneAnnotators = Object.values(taskSummary).reduce((s, t) => s + t.done, 0)

                return (
                  <Table.Row key={file.id} _hover={{ bg: "bg.muted" }}>
                    {/* File */}
                    <Table.Cell px={4} py={3} maxW="220px">
                      <HStack gap={2} align="flex-start">
                        <Box color="fg.muted" flexShrink={0} mt="1px"><FileAudio2 size={14} /></Box>
                        <Box minW={0}>
                          <Text fontSize="xs" fontFamily="mono" color="fg" fontWeight="medium" truncate>{file.filename}</Text>
                          <JsonTypeBadges jsonTypes={file.json_types ?? []} />
                          <Text fontSize="10px" color="fg.muted" mt={0.5}>{new Date(file.created_at).toLocaleDateString()}</Text>
                        </Box>
                      </HStack>
                    </Table.Cell>

                    {/* Info */}
                    <Table.Cell px={4} py={3}>
                      <VStack align="flex-start" gap={1}>
                        {file.language && <Badge size="xs" colorPalette="blue" variant="subtle">{file.language}</Badge>}
                        <Text fontSize="xs" color="fg.muted" fontFamily="mono">{fmtDuration(file.duration)}</Text>
                        {file.num_speakers != null && <Text fontSize="xs" color="fg.muted">{file.num_speakers} spk</Text>}
                      </VStack>
                    </Table.Cell>

                    {/* Task Progress */}
                    <Table.Cell px={4} py={3}>
                      {totalAnnotators === 0 ? (
                        <Text fontSize="xs" color="fg.muted" fontStyle="italic">No assignments</Text>
                      ) : (
                        <VStack align="flex-start" gap={2}>
                          <HStack gap={3}>
                            {TASK_ORDER.map(task => <TaskPill key={task} taskType={task} stat={taskSummary[task]} />)}
                          </HStack>
                          <Text fontSize="10px" color="fg.muted">{doneAnnotators}/{totalAnnotators} annotators done</Text>
                        </VStack>
                      )}
                    </Table.Cell>

                    {/* Locks */}
                    <Table.Cell px={4} py={3}>
                      <HStack gap={2}>
                        {LOCK_TYPES.map(lt => {
                          const locked = (file as Record<string, unknown>)[`collaborative_locked_${lt.key}`] as boolean
                          return (
                            <LockToggle key={lt.key} locked={locked} label={lt.label}
                              loading={lockLoading[`${file.id}-${lt.key}`]}
                              onToggle={() => toggleLock(file.id, lt.key, !locked)}
                            />
                          )
                        })}
                      </HStack>
                    </Table.Cell>

                    {/* Stage */}
                    <Table.Cell px={4} py={3}>
                      <Badge colorPalette={stageMeta.color} size="sm" variant="subtle">{stageMeta.label}</Badge>
                    </Table.Cell>

                    {/* Actions */}
                    <Table.Cell px={4} py={3}>
                      <VStack align="flex-start" gap={1}>
                        {stage === "unassigned" && (
                          <Button size="xs" colorPalette="blue" variant="outline" onClick={() => router.push("/admin/assignments")}>
                            <ClipboardList size={11} /> Assign
                          </Button>
                        )}
                        {stage === "complete" && (
                          <Button size="xs" colorPalette="teal" onClick={() => router.push("/admin/review")}>
                            <CheckCircle2 size={11} /> Review
                          </Button>
                        )}
                        <Button
                          size="xs" variant="ghost" color="fg.muted"
                          onClick={() => { setMoveTarget(file); setMoveToDataset([]) }}
                        >
                          <Database size={11} /> Move
                        </Button>
                        {!isUnassigned && (
                          <Button size="xs" variant="ghost" color="fg.muted" onClick={() => removeFromDataset(file)}>
                            <X size={11} /> Remove
                          </Button>
                        )}
                        <IconButton
                          size="2xs" variant="ghost" colorPalette="orange"
                          aria-label="Archive file" mt={0.5}
                          title="Archive this file (can be restored or permanently deleted later)"
                          onClick={() => setArchiveTarget(file)}
                        >
                          <Archive size={11} />
                        </IconButton>
                      </VStack>
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table.Root>
        </Box>
      )}

      {/* ── Archived files ─────────────────────────────────────────────────── */}
      {archivedFiles.length > 0 && (
        <Collapsible.Root open={archivedOpen} onOpenChange={d => setArchivedOpen(d.open)} mt={6}>
          <Collapsible.Trigger asChild>
            <Flex align="center" gap={2} px={3} py={2} rounded="md" cursor="pointer"
              color="fg.muted" fontSize="sm" _hover={{ bg: "bg.subtle", color: "fg" }}
              transition="all 0.15s" w="fit-content"
            >
              {archivedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Archive size={14} />
              <Text fontSize="sm">Archived files ({archivedFiles.length})</Text>
            </Flex>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden" mt={2} opacity={0.8}>
              <Table.Root size="sm">
                <Table.Header>
                  <Table.Row>
                    {["File", "Archived", "Actions"].map(h => (
                      <Table.ColumnHeader key={h} color="fg.muted" fontSize="xs" px={4} py={3}>{h}</Table.ColumnHeader>
                    ))}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {archivedFiles.map(file => (
                    <Table.Row key={file.id} _hover={{ bg: "bg.muted" }}>
                      <Table.Cell px={4} py={3}>
                        <HStack gap={2}>
                          <FileAudio2 size={13} color="var(--chakra-colors-fg-muted)" />
                          <Text fontSize="xs" fontFamily="mono" color="fg.muted">{file.filename}</Text>
                          <Badge colorPalette="orange" size="xs" variant="subtle">archived</Badge>
                        </HStack>
                      </Table.Cell>
                      <Table.Cell px={4} py={3}>
                        <Text fontSize="xs" color="fg.muted">{new Date(file.created_at).toLocaleDateString()}</Text>
                      </Table.Cell>
                      <Table.Cell px={4} py={3}>
                        <HStack gap={2}>
                          <Button size="xs" colorPalette="teal" variant="outline" onClick={() => restoreFile(file)}>
                            <RotateCcw size={11} /> Restore
                          </Button>
                          <Button size="xs" colorPalette="red" variant="ghost"
                            onClick={() => { setPermDeleteTarget(file); setPermDeleteInput("") }}
                          >
                            <Trash2 size={11} /> Delete permanently
                          </Button>
                        </HStack>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>
          </Collapsible.Content>
        </Collapsible.Root>
      )}

      {/* ── Add Files dialog ───────────────────────────────────────────────── */}
      <Dialog.Root open={addOpen} onOpenChange={({ open }) => { if (!open && !adding) { setAddOpen(false); setSelectedToAdd(new Set()) } }}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="bg.subtle" borderWidth="1px" borderColor="border" maxW="560px" maxH="80vh">
              <Dialog.Header>
                <Dialog.Title color="fg">Add Files to Dataset</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body overflowY="auto">
                {addableFiles.length === 0 ? (
                  <Text color="fg.muted" fontSize="sm">All files are already in this dataset.</Text>
                ) : (
                  <VStack gap={1} align="stretch">
                    <Text fontSize="xs" color="fg.muted" mb={2}>
                      {selectedToAdd.size} selected · {addableFiles.length} available
                    </Text>
                    {addableFiles.map(f => (
                      <Flex
                        key={f.id}
                        align="center"
                        gap={3}
                        px={3}
                        py={2}
                        rounded="md"
                        bg={selectedToAdd.has(f.id) ? "bg.muted" : "transparent"}
                        _hover={{ bg: "bg.muted" }}
                        cursor="pointer"
                        onClick={() => setSelectedToAdd(prev => {
                          const next = new Set(prev)
                          next.has(f.id) ? next.delete(f.id) : next.add(f.id)
                          return next
                        })}
                      >
                        <Checkbox.Root checked={selectedToAdd.has(f.id)} readOnly size="sm">
                          <Checkbox.HiddenInput />
                          <Checkbox.Control />
                        </Checkbox.Root>
                        <Box flex={1} minW={0}>
                          <Text fontSize="xs" fontFamily="mono" color="fg" truncate>{f.filename}</Text>
                          {f.dataset_id != null && (
                            <Text fontSize="10px" color="fg.muted">
                              Currently in another dataset
                            </Text>
                          )}
                        </Box>
                        {f.language && <Badge size="xs" colorPalette="blue" variant="subtle">{f.language}</Badge>}
                      </Flex>
                    ))}
                  </VStack>
                )}
              </Dialog.Body>
              <Dialog.Footer gap={2}>
                <Button size="sm" variant="ghost" onClick={() => { setAddOpen(false); setSelectedToAdd(new Set()) }} disabled={adding}>
                  Cancel
                </Button>
                <Button
                  size="sm" colorPalette="blue" onClick={confirmAdd}
                  loading={adding} disabled={selectedToAdd.size === 0}
                >
                  <Plus size={13} /> Add {selectedToAdd.size > 0 ? `(${selectedToAdd.size})` : ""}
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* ── Move File dialog ───────────────────────────────────────────────── */}
      <Dialog.Root open={!!moveTarget} onOpenChange={({ open }) => { if (!open && !moving) { setMoveTarget(null); setMoveToDataset([]) } }}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="bg.subtle" borderWidth="1px" borderColor="border" maxW="420px">
              <Dialog.Header>
                <Dialog.Title color="fg">Move File</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Text fontSize="sm" color="fg.muted" mb={4}>
                  Move <Text as="span" color="fg" fontFamily="mono" fontWeight="medium">{moveTarget?.filename}</Text> to:
                </Text>
                <Select.Root collection={moveOptions} value={moveToDataset} onValueChange={({ value }) => setMoveToDataset(value)} size="sm">
                  <Select.HiddenSelect />
                  <Select.Control>
                    <Select.Trigger bg="bg.muted" borderColor="border" color={moveToDataset.length ? "fg" : "fg.muted"}>
                      <Select.ValueText placeholder="Select destination…" />
                    </Select.Trigger>
                  </Select.Control>
                  <Portal>
                    <Select.Positioner>
                      <Select.Content bg="bg.subtle" borderColor="border">
                        {moveOptions.items.map(item => (
                          <Select.Item key={item.value} item={item} color="fg" _hover={{ bg: "bg.muted" }}>{item.label}</Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Positioner>
                  </Portal>
                </Select.Root>
              </Dialog.Body>
              <Dialog.Footer gap={2}>
                <Button size="sm" variant="ghost" onClick={() => { setMoveTarget(null); setMoveToDataset([]) }} disabled={moving}>Cancel</Button>
                <Button size="sm" colorPalette="blue" onClick={confirmMove} loading={moving} disabled={moveToDataset.length === 0}>
                  Move
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* ── Archive confirm dialog ─────────────────────────────────────────── */}
      <Dialog.Root open={!!archiveTarget} onOpenChange={({ open }) => { if (!open && !archiving) setArchiveTarget(null) }}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="bg.subtle" borderWidth="1px" borderColor="border" maxW="420px">
              <Dialog.Header><Dialog.Title color="fg">Archive File</Dialog.Title></Dialog.Header>
              <Dialog.Body>
                <Text color="fg.muted" fontSize="sm">
                  Archive <Text as="span" color="fg" fontFamily="mono" fontWeight="medium">{archiveTarget?.filename}</Text>?
                </Text>
                <Text mt={2} fontSize="xs" color="fg.muted">
                  The file will be hidden from all active lists. You can restore it or permanently delete it later from the Archived section.
                </Text>
              </Dialog.Body>
              <Dialog.Footer gap={2}>
                <Button size="sm" variant="ghost" onClick={() => setArchiveTarget(null)} disabled={archiving}>Cancel</Button>
                <Button size="sm" colorPalette="orange" onClick={confirmArchive} loading={archiving}>
                  <Archive size={13} /> Archive
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* ── Permanent delete confirm dialog ───────────────────────────────── */}
      <Dialog.Root open={!!permDeleteTarget} onOpenChange={({ open }) => { if (!open && !permDeleting) { setPermDeleteTarget(null); setPermDeleteInput("") } }}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="bg.subtle" borderWidth="1px" borderColor="border" maxW="420px">
              <Dialog.Header><Dialog.Title color="fg">Permanently Delete File</Dialog.Title></Dialog.Header>
              <Dialog.Body>
                <Text color="fg.muted" fontSize="sm" mb={3}>
                  This will <Text as="span" color="red.400" fontWeight="semibold">permanently</Text> delete{" "}
                  <Text as="span" color="fg" fontFamily="mono" fontWeight="medium">{permDeleteTarget?.filename}</Text>{" "}
                  and all linked data (assignments, segments, annotations). This cannot be undone.
                </Text>
                <Text fontSize="xs" color="fg.muted" mb={2}>
                  Type <Text as="span" fontFamily="mono" color="fg" fontWeight="semibold">{permDeleteTarget?.filename}</Text> to confirm:
                </Text>
                <Input
                  size="sm" value={permDeleteInput}
                  onChange={e => setPermDeleteInput(e.target.value)}
                  placeholder={permDeleteTarget?.filename}
                  bg="bg.muted" borderColor="red.800" color="fg"
                />
              </Dialog.Body>
              <Dialog.Footer gap={2}>
                <Button size="sm" variant="ghost" onClick={() => { setPermDeleteTarget(null); setPermDeleteInput("") }} disabled={permDeleting}>Cancel</Button>
                <Button size="sm" colorPalette="red" onClick={confirmPermDelete} loading={permDeleting}
                  disabled={permDeleteInput !== permDeleteTarget?.filename}
                >
                  <Trash2 size={13} /> Delete Permanently
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Box>
  )
}
