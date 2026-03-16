"use client"

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react"
import { useSearchParams, useRouter } from "next/navigation"
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Field,
  HStack,
  Heading,
  IconButton,
  Input,
  Select,
  Spinner,
  Text,
  Textarea,
  VStack,
  createListCollection,
} from "@chakra-ui/react"
import { ArrowLeft, CheckCheck, Plus, RefreshCw, Save, Trash2 } from "lucide-react"
import dynamic from "next/dynamic"
import api from "@/lib/axios"
import ToastWizard from "@/lib/toastWizard"
import type { WaveformPlayerRef } from "@/components/WaveformPlayer"

// SSR-safe dynamic import for WaveformPlayer (uses Web Audio)
const WaveformPlayer = dynamic(() => import("@/components/WaveformPlayer"), {
  ssr: false,
  loading: () => (
    <Box h="120px" bg="bg.subtle" rounded="md" borderWidth="1px" borderColor="border" />
  ),
})

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnnotateData {
  audio_file: {
    id: number
    filename: string
    duration: number | null
    num_speakers: number | null
    language: string | null
    emotion_gated: boolean
  }
  speaker_segments: Segment[]
  emotion_segments: Segment[]
  transcription_segments: TranscriptSegment[]
  assignments: Assignment[]
}

interface Segment {
  id: number
  start_time: number
  end_time: number
  speaker_label: string | null
  gender: string | null
  emotion: string | null
  emotion_other: string | null
  is_ambiguous: boolean
  notes: string | null
  source: string
  updated_at: string
}

interface TranscriptSegment {
  id: number
  start_time: number
  end_time: number
  original_text: string | null
  edited_text: string | null
  notes: string | null
  updated_at: string
}

interface Assignment {
  id: number
  task_type: string
  status: string
}

type SelectionType = "emotion" | "speaker" | "transcription"
interface Selection {
  type: SelectionType
  segment: Segment | TranscriptSegment
}

// ─── Constants / helpers ──────────────────────────────────────────────────────

const EMOTIONS = ["Neutral", "Happy", "Sad", "Angry", "Surprised", "Fear", "Disgust", "Other"]
const GENDERS = ["Male", "Female", "Mixed", "unk"]

const emotionCollection = createListCollection({
  items: EMOTIONS.map(e => ({ label: e, value: e })),
})
const genderCollection = createListCollection({
  items: GENDERS.map(g => ({ label: g, value: g })),
})

function fmtTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

const SPEAKER_COLORS: Record<string, string> = {
  speaker_1: "#3b82f6",
  speaker_2: "#10b981",
  speaker_3: "#f59e0b",
  speaker_4: "#ef4444",
  speaker_5: "#8b5cf6",
}
function speakerColor(label: string | null): string {
  if (!label) return "#6b7280"
  return SPEAKER_COLORS[label] ?? "#6b7280"
}

const EMOTION_COLORS: Record<string, string> = {
  Neutral: "#6b7280",
  Happy: "#f59e0b",
  Sad: "#3b82f6",
  Angry: "#ef4444",
  Surprised: "#8b5cf6",
  Fear: "#ec4899",
  Disgust: "#84cc16",
  Other: "#14b8a6",
}
function emotionColor(e: string | null): string {
  if (!e) return "#374151"
  return EMOTION_COLORS[e] ?? "#374151"
}

const GENDER_COLORS: Record<string, string> = {
  Male: "#60a5fa",
  Female: "#f472b6",
  Mixed: "#a78bfa",
  unk: "#6b7280",
}
function genderColor(g: string | null): string {
  return GENDER_COLORS[g ?? "unk"] ?? "#6b7280"
}

// Smart placement: if playhead is inside an existing segment, jump to its end.
// Clip end_time against the next segment start to avoid overlap.
function smartPlacement(
  segs: Array<{ start_time: number; end_time: number }>,
  currentT: number,
  duration: number
): { start: number; end: number } {
  const container = segs.find(s => s.start_time <= currentT && currentT < s.end_time)
  const start = container ? container.end_time : currentT
  const next = segs
    .filter(s => s.start_time > start)
    .sort((a, b) => a.start_time - b.start_time)[0]
  let end = start + 2.0
  if (next && end > next.start_time) end = next.start_time
  if (duration > 0) end = Math.min(end, duration)
  if (end <= start) end = start + 0.1
  return { start, end }
}

// Returns a signature of the collaborative segment state for change detection
function getDataSig(d: AnnotateData): string {
  const maxTs = (segs: { updated_at: string }[]) =>
    segs.length === 0 ? "0" : String(Math.max(...segs.map(s => new Date(s.updated_at).getTime())))
  return [
    d.speaker_segments.length,
    maxTs(d.speaker_segments),
    d.transcription_segments.length,
    maxTs(d.transcription_segments),
  ].join("|")
}

// ─── Segment Track ────────────────────────────────────────────────────────────

function SegmentTrack<T extends { id: number; start_time: number; end_time: number }>({
  label,
  segments,
  duration,
  currentTime,
  selectedId,
  getColor,
  getLabel,
  onSelect,
  trackColor = "bg.subtle",
  warningCount,
}: {
  label: string
  segments: T[]
  duration: number
  currentTime: number
  selectedId?: number
  getColor: (s: T) => string
  getLabel: (s: T) => string
  onSelect: (s: T) => void
  trackColor?: string
  warningCount?: number
}) {
  return (
    <Box>
      <HStack mb={1} gap={2} align="center">
        <Text fontSize="xs" fontWeight="medium" color="fg.muted" userSelect="none">
          {label}
        </Text>
        {warningCount != null && warningCount > 0 && (
          <Badge size="xs" colorPalette="orange">
            {warningCount} boundary mismatch{warningCount > 1 ? "es" : ""}
          </Badge>
        )}
      </HStack>
      {!duration ? (
        // Waveform not yet loaded — show placeholder until real duration is known
        <Box
          h="32px"
          bg={trackColor}
          rounded="sm"
          borderWidth="1px"
          borderColor="border"
          display="flex"
          alignItems="center"
          px={3}
        >
          <Text fontSize="xs" color="fg.subtle" fontStyle="italic">
            {segments.length === 0 ? "No segments — add one above" : "Loading…"}
          </Text>
        </Box>
      ) : (
      <Box
        position="relative"
        h="32px"
        bg={trackColor}
        rounded="sm"
        overflow="hidden"
        borderWidth="1px"
        borderColor="border"
      >
        {/* Playhead */}
        <Box
          position="absolute"
          top={0}
          left={`${(currentTime / duration) * 100}%`}
          h="full"
          w="2px"
          bg="red.400"
          zIndex={10}
          pointerEvents="none"
        />
        {/* Segments */}
        {segments.map(seg => {
          const left = (seg.start_time / duration) * 100
          const width = ((seg.end_time - seg.start_time) / duration) * 100
          const isSelected = selectedId === seg.id
          return (
            <Box
              key={seg.id}
              position="absolute"
              top="2px"
              bottom="2px"
              left={`${left}%`}
              w={`${width}%`}
              bg={getColor(seg)}
              opacity={isSelected ? 1 : 0.75}
              rounded="sm"
              cursor="pointer"
              borderWidth={isSelected ? "2px" : "0"}
              borderColor="white"
              overflow="hidden"
              onClick={() => onSelect(seg)}
              title={`${fmtTime(seg.start_time)}–${fmtTime(seg.end_time)}: ${getLabel(seg)}`}
            >
              <Text
                fontSize="9px"
                color="white"
                px="2px"
                lineHeight="28px"
                overflow="hidden"
                whiteSpace="nowrap"
                textOverflow="ellipsis"
                userSelect="none"
              >
                {getLabel(seg)}
              </Text>
            </Box>
          )
        })}
      </Box>
      )}
    </Box>
  )
}

// ─── Segment Editor ───────────────────────────────────────────────────────────

function SegmentEditor({
  selection,
  onClose,
  onSaved,
  onDelete,
  onTimesChanged,
  playerRef,
  speakerLabels,
  speakerSegments,
  getGenderForSpeaker,
}: {
  selection: Selection
  onClose: () => void
  onSaved: (type: SelectionType, updated: Segment | TranscriptSegment) => void
  onDelete?: () => Promise<void>
  onTimesChanged?: () => void
  playerRef: React.RefObject<WaveformPlayerRef | null>
  speakerLabels?: string[]
  speakerSegments?: Segment[]
  getGenderForSpeaker?: (label: string) => string
}) {
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addingSpeaker, setAddingSpeaker] = useState(false)
  const [newSpeakerInput, setNewSpeakerInput] = useState("")
  const [emotion, setEmotion] = useState<string>(
    (selection.segment as Segment).emotion ?? ""
  )
  const [emotionOther, setEmotionOther] = useState<string>(
    (selection.segment as Segment).emotion_other ?? ""
  )
  const [gender, setGender] = useState<string>(
    (selection.segment as Segment).gender ?? "unk"
  )
  const [speakerLabel, setSpeakerLabel] = useState<string>(
    (selection.segment as Segment).speaker_label ?? ""
  )
  const [startTime, setStartTime] = useState<number>(selection.segment.start_time)
  const [endTime, setEndTime] = useState<number>(selection.segment.end_time)
  const [editedText, setEditedText] = useState<string>(
    (selection.segment as TranscriptSegment).edited_text ??
      (selection.segment as TranscriptSegment).original_text ??
      ""
  )
  const [notes, setNotes] = useState<string>(selection.segment.notes ?? "")
  const [isAmbiguous, setIsAmbiguous] = useState<boolean>(
    (selection.segment as Segment).is_ambiguous ?? false
  )
  const [alignedTo, setAlignedTo] = useState<Segment | null>(null)

  const { type, segment } = selection

  const save = async () => {
    setSaving(true)
    try {
      let res
      if (type === "emotion") {
        res = await api.patch(`/api/segments/speaker/${segment.id}`, {
          emotion: emotion || null,
          emotion_other: emotion === "Other" ? emotionOther || null : null,
          is_ambiguous: isAmbiguous,
          notes: notes || null,
          updated_at: segment.updated_at,
        })
        onSaved(type, res.data)
        ToastWizard.standard("success", "Emotion saved")
      } else if (type === "speaker") {
        const payload: Record<string, unknown> = {
          speaker_label: speakerLabel || null,
          gender: gender || null,
          is_ambiguous: isAmbiguous,
          notes: notes || null,
          updated_at: segment.updated_at,
        }
        if (startTime !== segment.start_time) payload.start_time = startTime
        if (endTime !== segment.end_time) payload.end_time = endTime
        const timesChanged = payload.start_time !== undefined || payload.end_time !== undefined

        res = await api.patch(`/api/segments/speaker/${segment.id}`, payload)
        onSaved(type, res.data)
        if (timesChanged) onTimesChanged?.()
        ToastWizard.standard("success", "Speaker/Gender saved")
      } else {
        const payload: Record<string, unknown> = {
          edited_text: editedText || null,
          notes: notes || null,
          updated_at: segment.updated_at,
        }
        if (startTime !== segment.start_time) payload.start_time = startTime
        if (endTime !== segment.end_time) payload.end_time = endTime
        const timesChanged = payload.start_time !== undefined || payload.end_time !== undefined

        res = await api.patch(`/api/segments/transcription/${segment.id}`, payload)
        onSaved(type, res.data)
        if (timesChanged) onTimesChanged?.()
        ToastWizard.standard("success", "Transcription saved")
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 409) {
        ToastWizard.standard(
          "warning",
          "Segment was modified by another annotator. Reload to get latest."
        )
      } else {
        ToastWizard.standard("error", "Save failed")
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!onDelete) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const jumpToSegment = () => {
    playerRef.current?.seekTo(segment.start_time)
    playerRef.current?.play()
  }

  return (
    <Box
      w="300px"
      flexShrink={0}
      borderLeftWidth="1px"
      borderColor="border"
      p={4}
      overflowY="auto"
    >
      <HStack justify="space-between" mb={3}>
        <Heading size="xs" color="fg">
          {type === "emotion"
            ? "Emotion"
            : type === "speaker"
            ? "Speaker / Gender"
            : "Transcription"}
        </Heading>
        <IconButton
          aria-label="Close editor"
          size="xs"
          variant="ghost"
          onClick={onClose}
        >
          ✕
        </IconButton>
      </HStack>

      <Text fontSize="xs" color="fg.muted" mb={3} fontFamily="mono">
        {fmtTime(segment.start_time)} – {fmtTime(segment.end_time)}
        <Button size="xs" variant="ghost" ml={2} onClick={jumpToSegment}>
          ▶ Play
        </Button>
      </Text>

      <VStack align="stretch" gap={3}>
        {/* Emotion fields */}
        {type === "emotion" && (
          <>
            <Field.Root>
              <Field.Label fontSize="xs">Emotion</Field.Label>
              <Select.Root
                collection={emotionCollection}
                size="sm"
                value={emotion ? [emotion] : []}
                onValueChange={({ value }) => setEmotion(value[0] ?? "")}
              >
                <Select.Trigger>
                  <Select.ValueText placeholder="Select emotion…" />
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
            </Field.Root>

            {emotion === "Other" && (
              <Field.Root>
                <Field.Label fontSize="xs">Specify other emotion</Field.Label>
                <Textarea
                  size="sm"
                  value={emotionOther}
                  onChange={e => setEmotionOther(e.target.value)}
                  rows={2}
                />
              </Field.Root>
            )}

            <Checkbox.Root
              checked={isAmbiguous}
              onCheckedChange={({ checked }) => setIsAmbiguous(!!checked)}
              size="sm"
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label fontSize="xs">Mark as ambiguous</Checkbox.Label>
            </Checkbox.Root>
          </>
        )}

        {/* Speaker / Gender fields */}
        {type === "speaker" && (
          <>
            {/* Time inputs */}
            <HStack gap={2}>
              <Field.Root>
                <Field.Label fontSize="xs">Start (s)</Field.Label>
                <Input
                  size="sm"
                  type="number"
                  step={0.001}
                  min={0}
                  value={startTime}
                  onChange={e => setStartTime(parseFloat(e.target.value) || 0)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label fontSize="xs">End (s)</Field.Label>
                <Input
                  size="sm"
                  type="number"
                  step={0.001}
                  min={0}
                  value={endTime}
                  onChange={e => setEndTime(parseFloat(e.target.value) || 0)}
                />
              </Field.Root>
            </HStack>

            <Field.Root>
              <Field.Label fontSize="xs">Speaker Label</Field.Label>
              {addingSpeaker ? (
                <HStack gap={1}>
                  <Input
                    size="sm"
                    placeholder="e.g. speaker_3"
                    value={newSpeakerInput}
                    onChange={e => setNewSpeakerInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && newSpeakerInput.trim()) {
                        setSpeakerLabel(newSpeakerInput.trim())
                        setAddingSpeaker(false)
                        setNewSpeakerInput("")
                      }
                      if (e.key === "Escape") { setAddingSpeaker(false); setNewSpeakerInput("") }
                    }}
                    autoFocus
                  />
                  <Button
                    size="sm"
                    colorPalette="teal"
                    disabled={!newSpeakerInput.trim()}
                    onClick={() => {
                      if (newSpeakerInput.trim()) {
                        setSpeakerLabel(newSpeakerInput.trim())
                        setAddingSpeaker(false)
                        setNewSpeakerInput("")
                      }
                    }}
                  >
                    Add
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setAddingSpeaker(false); setNewSpeakerInput("") }}>
                    ✕
                  </Button>
                </HStack>
              ) : (
                <Select.Root
                  collection={createListCollection({
                    items: [
                      ...(speakerLabels ?? []).map(l => ({ label: l, value: l })),
                      // Include current label if it's not in the list (manually typed)
                      ...(speakerLabel && !(speakerLabels ?? []).includes(speakerLabel)
                        ? [{ label: speakerLabel, value: speakerLabel }]
                        : []),
                      { label: "+ Add new speaker", value: "__add_new__" },
                    ],
                  })}
                  size="sm"
                  value={speakerLabel ? [speakerLabel] : []}
                  onValueChange={({ value }) => {
                    const v = value[0] ?? ""
                    if (v === "__add_new__") {
                      setAddingSpeaker(true)
                      return
                    }
                    setSpeakerLabel(v)
                    // Auto-fill gender from known speaker
                    if (getGenderForSpeaker) {
                      const known = getGenderForSpeaker(v)
                      if (known && known !== "unk") setGender(known)
                    }
                  }}
                >
                  <Select.Trigger>
                    <Select.ValueText placeholder="Select speaker…" />
                  </Select.Trigger>
                  <Select.Positioner>
                    <Select.Content>
                      {(speakerLabels ?? []).map(v => (
                        <Select.Item key={v} item={{ label: v, value: v }}>
                          {v}
                        </Select.Item>
                      ))}
                      {speakerLabel && !(speakerLabels ?? []).includes(speakerLabel) && (
                        <Select.Item item={{ label: speakerLabel, value: speakerLabel }}>
                          {speakerLabel}
                        </Select.Item>
                      )}
                      <Select.Item item={{ label: "+ Add new speaker", value: "__add_new__" }}>
                        + Add new speaker
                      </Select.Item>
                    </Select.Content>
                  </Select.Positioner>
                </Select.Root>
              )}
            </Field.Root>

            <Field.Root>
              <Field.Label fontSize="xs">Gender</Field.Label>
              <Select.Root
                collection={genderCollection}
                size="sm"
                value={gender ? [gender] : []}
                onValueChange={({ value }) => setGender(value[0] ?? "unk")}
              >
                <Select.Trigger>
                  <Select.ValueText placeholder="Select gender…" />
                </Select.Trigger>
                <Select.Positioner>
                  <Select.Content>
                    {genderCollection.items.map(item => (
                      <Select.Item key={item.value} item={item}>
                        {item.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Positioner>
              </Select.Root>
            </Field.Root>

            <Checkbox.Root
              checked={isAmbiguous}
              onCheckedChange={({ checked }) => setIsAmbiguous(!!checked)}
              size="sm"
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label fontSize="xs">Mark as ambiguous</Checkbox.Label>
            </Checkbox.Root>
          </>
        )}

        {/* Transcription fields */}
        {type === "transcription" && (
          <>
            {/* Time inputs */}
            <HStack gap={2}>
              <Field.Root>
                <Field.Label fontSize="xs">Start (s)</Field.Label>
                <Input
                  size="sm"
                  type="number"
                  step={0.001}
                  min={0}
                  value={startTime}
                  onChange={e => setStartTime(parseFloat(e.target.value) || 0)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label fontSize="xs">End (s)</Field.Label>
                <Input
                  size="sm"
                  type="number"
                  step={0.001}
                  min={0}
                  value={endTime}
                  onChange={e => setEndTime(parseFloat(e.target.value) || 0)}
                />
              </Field.Root>
            </HStack>

            {/* Align to speaker segment */}
            {speakerSegments && speakerSegments.length > 0 && (
              <Field.Root>
                <Field.Label fontSize="xs">Align to speaker segment</Field.Label>
                <Select.Root
                  collection={createListCollection({
                    items: speakerSegments.map(s => ({
                      label: `${s.speaker_label ?? "?"} (${fmtTime(s.start_time)}–${fmtTime(s.end_time)})`,
                      value: String(s.id),
                    })),
                  })}
                  size="sm"
                  value={alignedTo ? [String(alignedTo.id)] : []}
                  onValueChange={({ value }) => {
                    const v = value[0]
                    if (!v) return
                    const seg = speakerSegments.find(s => String(s.id) === v)
                    if (!seg) return
                    setStartTime(seg.start_time)
                    setEndTime(seg.end_time)
                    setAlignedTo(seg)
                  }}
                >
                  <Select.Trigger>
                    <Select.ValueText placeholder="Pick speaker segment to align…" />
                  </Select.Trigger>
                  <Select.Positioner>
                    <Select.Content>
                      {speakerSegments.map(s => (
                        <Select.Item key={s.id} item={{ label: `${s.speaker_label ?? "?"} (${fmtTime(s.start_time)}–${fmtTime(s.end_time)})`, value: String(s.id) }}>
                          <Box
                            display="inline-block"
                            w="8px"
                            h="8px"
                            rounded="full"
                            bg={speakerColor(s.speaker_label)}
                            mr={2}
                            flexShrink={0}
                          />
                          {s.speaker_label ?? "?"} ({fmtTime(s.start_time)}–{fmtTime(s.end_time)})
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Positioner>
                </Select.Root>
                {alignedTo && (
                  <Box mt={1} px={2} py={1} bg="blue.900" borderWidth="1px" borderColor="blue.700" rounded="sm" fontSize="xs" color="blue.300">
                    Aligned to <strong>{alignedTo.speaker_label ?? "?"}</strong> · {fmtTime(alignedTo.start_time)}–{fmtTime(alignedTo.end_time)}
                  </Box>
                )}
              </Field.Root>
            )}

            <Field.Root>
              <Field.Label fontSize="xs">Original text</Field.Label>
              <Box
                p={2}
                bg="bg.muted"
                rounded="sm"
                fontSize="xs"
                color="fg.muted"
                fontFamily="mono"
              >
                {(segment as TranscriptSegment).original_text ?? "—"}
              </Box>
            </Field.Root>
            <Field.Root>
              <Field.Label fontSize="xs">Edited text</Field.Label>
              <Textarea
                size="sm"
                value={editedText}
                onChange={e => setEditedText(e.target.value)}
                rows={4}
                fontFamily="mono"
                fontSize="xs"
              />
            </Field.Root>
          </>
        )}

        {/* Notes (all types) */}
        <Field.Root>
          <Field.Label fontSize="xs">Notes</Field.Label>
          <Textarea
            size="sm"
            placeholder="Optional notes…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
          />
        </Field.Root>

        <Button size="sm" colorPalette="blue" loading={saving} onClick={save}>
          <Save size={14} />
          Save
        </Button>

        {onDelete && !confirmDelete && (
          <Button
            size="sm"
            colorPalette="red"
            variant="outline"
            onClick={handleDelete}
          >
            <Trash2 size={14} />
            Delete Segment
          </Button>
        )}
        {onDelete && confirmDelete && (
          <HStack gap={2}>
            <Button
              size="sm"
              colorPalette="red"
              loading={deleting}
              onClick={handleDelete}
            >
              Yes, Delete
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
          </HStack>
        )}
      </VStack>
    </Box>
  )
}

// ─── Inner page (needs useSearchParams) ──────────────────────────────────────

function AnnotateInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fileId = searchParams.get("file")

  const playerRef = useRef<WaveformPlayerRef>(null)
  const regionTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const dataRef = useRef<AnnotateData | null>(null)
  const [data, setData] = useState<AnnotateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [waveformReady, setWaveformReady] = useState(false)
  const [waveformDuration, setWaveformDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [completing, setCompleting] = useState<Record<number, boolean>>({})
  const [addingSegment, setAddingSegment] = useState(false)
  const [addingSpeakerMode, setAddingSpeakerMode] = useState(false)
  const [newSpeakerName, setNewSpeakerName] = useState("")
  const [openAccordions, setOpenAccordions] = useState<Set<string>>(new Set())
  const [hasUpdates, setHasUpdates] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!fileId) return
    try {
      const res = await api.get(`/api/segments/annotate/${fileId}`)
      setData(res.data)
      // Auto-start assignments that are still pending
      for (const a of res.data.assignments) {
        if (a.status === "pending") {
          await api.patch(`/api/assignments/${a.id}/status`, { status: "in_progress" })
        }
      }
    } catch {
      ToastWizard.standard("error", "Failed to load annotation data")
    } finally {
      setLoading(false)
    }
  }, [fileId])

  useEffect(() => { load() }, [load])

  // Keep dataRef current so the polling interval always compares against latest state
  useEffect(() => { dataRef.current = data }, [data])

  // Helper: check if the annotator has a specific task type assigned for this file
  const hasTask = (t: string) =>
    data?.assignments.some(a => a.task_type === t) ?? false

  const isSpeakerAnnotator = useMemo(
    () => data?.assignments.some(a => a.task_type === "speaker") ?? false,
    [data]
  )

  // Annotators on collaborative tasks (speaker/gender/transcription) can see edits
  // from other annotators on the same file. Poll every 30s and surface a banner
  // when remote changes are detected so they can choose when to reload.
  const hasCollaborativeTasks = useMemo(
    () => data?.assignments.some(a => ["speaker", "gender", "transcription"].includes(a.task_type)) ?? false,
    [data]
  )

  useEffect(() => {
    if (!fileId || !hasCollaborativeTasks) return
    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/api/segments/annotate/${fileId}`)
        const current = dataRef.current
        if (current && getDataSig(res.data) !== getDataSig(current)) {
          setHasUpdates(true)
        }
      } catch {
        // Silent — don't disturb the user if the background check fails
      }
    }, 30_000)
    return () => clearInterval(interval)
  }, [fileId, hasCollaborativeTasks])

  // Unique speaker labels for this file (derived from current speaker segments)
  const speakerLabels = useMemo(() => {
    if (!data) return []
    return [...new Set(
      data.speaker_segments.map(s => s.speaker_label).filter(Boolean) as string[]
    )]
  }, [data])

  // Ordered unique speaker labels for per-lane rendering (null = unknown)
  const uniqueSpeakerLanes = useMemo(() => {
    if (!data) return [] as (string | null)[]
    return [...new Set(data.speaker_segments.map(s => s.speaker_label))]
  }, [data])

  // Look up the known (non-unk) gender for a given speaker label
  const getGenderForSpeaker = useCallback((label: string): string => {
    const seg = data?.speaker_segments.find(
      s => s.speaker_label === label && s.gender && s.gender !== "unk"
    )
    return seg?.gender ?? "unk"
  }, [data])

  // Propagate a gender change to all other segments with the same speaker_label
  const propagateGender = useCallback(async (speakerLabel: string, gender: string, excludeId: number) => {
    if (!data) return
    const targets = data.speaker_segments.filter(
      s => s.speaker_label === speakerLabel && s.id !== excludeId && s.gender !== gender
    )
    if (!targets.length) return
    try {
      await Promise.all(targets.map(s =>
        api.patch(`/api/segments/speaker/${s.id}`, { gender, updated_at: s.updated_at })
      ))
      setData(prev => prev ? {
        ...prev,
        speaker_segments: prev.speaker_segments.map(s =>
          s.speaker_label === speakerLabel && s.id !== excludeId ? { ...s, gender } : s
        ),
      } : prev)
    } catch {
      // Non-blocking — main save already succeeded
    }
  }, [data])

  // Detect boundary mismatches between speaker and transcription segments
  const segmentMismatches = useMemo(() => {
    if (!data) return { speaker: 0, transcription: 0 }
    const transBounds = new Set(
      data.transcription_segments.map(t => `${t.start_time.toFixed(3)}-${t.end_time.toFixed(3)}`)
    )
    const spkBounds = new Set(
      data.speaker_segments.map(s => `${s.start_time.toFixed(3)}-${s.end_time.toFixed(3)}`)
    )
    return {
      speaker: data.speaker_segments.filter(
        s => !transBounds.has(`${s.start_time.toFixed(3)}-${s.end_time.toFixed(3)}`)
      ).length,
      transcription: data.transcription_segments.filter(
        t => !spkBounds.has(`${t.start_time.toFixed(3)}-${t.end_time.toFixed(3)}`)
      ).length,
    }
  }, [data])

  // Group transcription segments by the speaker with the most overlap
  const { groupedTranscription, ungroupedTranscription } = useMemo(() => {
    if (!data) return { groupedTranscription: new Map<string | null, TranscriptSegment[]>(), ungroupedTranscription: [] as TranscriptSegment[] }
    const grouped = new Map<string | null, TranscriptSegment[]>()
    const ungrouped: TranscriptSegment[] = []
    for (const t of data.transcription_segments) {
      let maxOverlap = 0
      let bestLabel: string | null = null
      for (const s of data.speaker_segments) {
        const overlap = Math.min(t.end_time, s.end_time) - Math.max(t.start_time, s.start_time)
        if (overlap > maxOverlap) { maxOverlap = overlap; bestLabel = s.speaker_label }
      }
      if (bestLabel !== null && maxOverlap > 0) {
        if (!grouped.has(bestLabel)) grouped.set(bestLabel, [])
        grouped.get(bestLabel)!.push(t)
      } else {
        ungrouped.push(t)
      }
    }
    return { groupedTranscription: grouped, ungroupedTranscription: ungrouped }
  }, [data])

  // Open all speaker accordions when file loads
  useEffect(() => {
    if (!data) return
    const labels = [...new Set(data.speaker_segments.map(s => s.speaker_label ?? "__null__"))]
    setOpenAccordions(new Set(labels))
  }, [data?.audio_file.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAccordion = (key: string) => {
    setOpenAccordions(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  // Populate WaveSurfer regions whenever speaker segments or waveform readiness change
  useEffect(() => {
    if (!waveformReady || !data || !playerRef.current || !isSpeakerAnnotator) return
    playerRef.current.clearRegions()
    for (const seg of data.speaker_segments) {
      playerRef.current.addRegion(
        String(seg.id),
        seg.start_time,
        seg.end_time,
        speakerColor(seg.speaker_label) + "40",
      )
    }
  }, [waveformReady, data, isSpeakerAnnotator])

  // Debounced handler for region drag/resize — PATCHes segment times then reloads
  const handleRegionUpdate = useCallback(
    (id: string, start: number, end: number) => {
      clearTimeout(regionTimers.current[id])
      regionTimers.current[id] = setTimeout(async () => {
        const segId = parseInt(id, 10)
        const seg = data?.speaker_segments.find(s => s.id === segId)
        if (!seg) return
        try {
          await api.patch(`/api/segments/speaker/${segId}`, {
            start_time: parseFloat(start.toFixed(3)),
            end_time: parseFloat(end.toFixed(3)),
            updated_at: seg.updated_at,
          })
          await load()
        } catch {
          ToastWizard.standard("warning", "Failed to save region drag — reload and retry")
        }
      }, 600)
    },
    [data, load],
  )

  const handleSaved = (type: SelectionType, updated: Segment | TranscriptSegment) => {
    // Capture old segment before state update (for gender propagation check)
    const oldSeg = type === "speaker" ? data?.speaker_segments.find(s => s.id === updated.id) : null

    setData(prev => {
      if (!prev) return prev
      if (type === "emotion") {
        return {
          ...prev,
          emotion_segments: prev.emotion_segments.map(s =>
            s.id === updated.id ? { ...s, ...(updated as Segment) } : s
          ),
        }
      } else if (type === "speaker") {
        return {
          ...prev,
          speaker_segments: prev.speaker_segments.map(s =>
            s.id === updated.id ? { ...s, ...(updated as Segment) } : s
          ),
        }
      } else {
        return {
          ...prev,
          transcription_segments: prev.transcription_segments.map(s =>
            s.id === updated.id ? { ...s, ...(updated as TranscriptSegment) } : s
          ),
        }
      }
    })

    // Update selection's updated_at to prevent stale optimistic-lock errors
    setSelection(prev =>
      prev?.segment.id === updated.id
        ? { ...prev, segment: { ...prev.segment, updated_at: updated.updated_at } }
        : prev
    )

    // Auto-propagate gender to other segments with the same speaker_label
    if (type === "speaker" && oldSeg) {
      const updatedSeg = updated as Segment
      if (
        oldSeg.gender !== updatedSeg.gender &&
        updatedSeg.speaker_label &&
        updatedSeg.gender &&
        updatedSeg.gender !== "unk"
      ) {
        propagateGender(updatedSeg.speaker_label, updatedSeg.gender, updatedSeg.id)
      }
    }
  }

  const addSegment = async () => {
    if (!data) return
    setAddingSegment(true)
    try {
      const currentT = playerRef.current?.getCurrentTime() ?? 0
      const { start, end } = smartPlacement(data.speaker_segments, currentT, waveformDuration)
      // Default to speaker_1; pre-fill its known gender if available
      const defaultLabel = speakerLabels[0] ?? "speaker_1"
      const defaultGender = getGenderForSpeaker(defaultLabel)
      await api.post("/api/segments/speaker", {
        audio_file_id: data.audio_file.id,
        start_time: start,
        end_time: end,
        speaker_label: defaultLabel,
        gender: defaultGender,
      })
      // Reload to get the new segment + matching transcription segment
      await load()
      ToastWizard.standard("success", "Segment added at playhead")
    } catch {
      ToastWizard.standard("error", "Failed to add segment")
    } finally {
      setAddingSegment(false)
    }
  }

  const addSpeaker = async (label: string) => {
    if (!data || !label.trim()) return
    setAddingSegment(true)
    try {
      const currentT = playerRef.current?.getCurrentTime() ?? 0
      const { start, end } = smartPlacement(data.speaker_segments, currentT, waveformDuration)
      await api.post("/api/segments/speaker", {
        audio_file_id: data.audio_file.id,
        start_time: start,
        end_time: end,
        speaker_label: label.trim(),
        gender: "unk",
      })
      setAddingSpeakerMode(false)
      setNewSpeakerName("")
      await load()
      ToastWizard.standard("success", `Speaker "${label.trim()}" added`)
    } catch {
      ToastWizard.standard("error", "Failed to add speaker")
    } finally {
      setAddingSegment(false)
    }
  }

  const deleteSegment = async (segmentId: number) => {
    try {
      await api.delete(`/api/segments/speaker/${segmentId}`)
      setSelection(null)
      await load()
      ToastWizard.standard("success", "Segment deleted")
    } catch {
      ToastWizard.standard("error", "Failed to delete segment")
    }
  }

  const addTranscriptionSegment = async () => {
    if (!data) return
    setAddingSegment(true)
    try {
      const currentT = playerRef.current?.getCurrentTime() ?? 0
      const { start, end } = smartPlacement(data.transcription_segments, currentT, waveformDuration)
      await api.post("/api/segments/transcription", {
        audio_file_id: data.audio_file.id,
        start_time: start,
        end_time: end,
        original_text: "",
      })
      await load()
      ToastWizard.standard("success", "Transcription segment added at playhead")
    } catch {
      ToastWizard.standard("error", "Failed to add transcription segment")
    } finally {
      setAddingSegment(false)
    }
  }

  const deleteTranscriptionSegment = async (segmentId: number) => {
    try {
      await api.delete(`/api/segments/transcription/${segmentId}`)
      setSelection(null)
      await load()
      ToastWizard.standard("success", "Transcription segment deleted")
    } catch {
      ToastWizard.standard("error", "Failed to delete transcription segment")
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await load()
    setHasUpdates(false)
    setRefreshing(false)
  }

  const markComplete = async (assignment: Assignment) => {
    setCompleting(c => ({ ...c, [assignment.id]: true }))
    try {
      await api.patch(`/api/assignments/${assignment.id}/status`, { status: "completed" })
      setData(prev =>
        prev
          ? {
              ...prev,
              assignments: prev.assignments.map(a =>
                a.id === assignment.id ? { ...a, status: "completed" } : a
              ),
            }
          : prev
      )
      ToastWizard.standard("success", `${assignment.task_type} task marked complete`)
    } catch {
      ToastWizard.standard("error", "Failed to update task status")
    } finally {
      setCompleting(c => ({ ...c, [assignment.id]: false }))
    }
  }

  if (!fileId) {
    return (
      <Box p={8} textAlign="center" color="fg.muted">
        <Text>No file selected. Go back and select a task.</Text>
      </Box>
    )
  }

  if (loading) {
    return (
      <Box p={8} display="flex" justifyContent="center">
        <Spinner />
      </Box>
    )
  }

  if (!data) return null

  // Prefer DB-stored duration; fall back to the actual duration from WaveSurfer
  // once it loads. This ensures tracks render even for audio-only uploads where
  // duration was unknown at upload time.
  const duration = data.audio_file.duration ?? waveformDuration
  const audioUrl = `/api/audio-files/${fileId}/stream`
  const emotionGated = data.audio_file.emotion_gated

  return (
    <Box h="100%" display="flex" flexDir="column">
      {/* Emotion gate banner — only shown to annotators with an emotion task */}
      {emotionGated && hasTask("emotion") && (
        <Box px={4} pt={3} flexShrink={0}>
          <Alert.Root status="warning" variant="subtle" rounded="md">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title fontSize="sm">Emotion annotation not yet available</Alert.Title>
              <Alert.Description fontSize="xs">
                Waiting for speaker segments to be finalized by the admin.
                Other tasks are still accessible.
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
        </Box>
      )}

      {/* Collaborative update banner */}
      {hasUpdates && (
        <Box px={4} pt={2} flexShrink={0}>
          <Alert.Root status="info" variant="subtle" rounded="md">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title fontSize="sm">Segments updated by another annotator</Alert.Title>
              <Alert.Description fontSize="xs">
                Reload to see the latest changes before editing.
              </Alert.Description>
            </Alert.Content>
            <Button size="sm" colorPalette="blue" ml="auto" onClick={handleRefresh} loading={refreshing}>
              Reload
            </Button>
          </Alert.Root>
        </Box>
      )}

      {/* Header */}
      <HStack
        px={4}
        py={2}
        borderBottomWidth="1px"
        borderColor="border"
        flexShrink={0}
        flexWrap="wrap"
        gap={2}
      >
        <IconButton
          aria-label="Back"
          size="sm"
          variant="ghost"
          onClick={() => router.push("/annotator")}
        >
          <ArrowLeft size={16} />
        </IconButton>
        {hasCollaborativeTasks && (
          <IconButton
            aria-label="Refresh segments"
            size="sm"
            variant={hasUpdates ? "solid" : "ghost"}
            colorPalette={hasUpdates ? "orange" : "gray"}
            onClick={handleRefresh}
            loading={refreshing}
            title={hasUpdates ? "Updates available — click to reload" : "Refresh segments"}
          >
            <RefreshCw size={14} />
          </IconButton>
        )}
        <Box>
          <Heading size="sm" color="fg">
            {data.audio_file.filename}
          </Heading>
          <HStack gap={2} mt={0.5}>
            {data.audio_file.language && (
              <Badge size="sm" colorPalette="blue">{data.audio_file.language}</Badge>
            )}
            {duration > 0 && (
              <Text fontSize="xs" color="fg.muted">{fmtTime(duration)}</Text>
            )}
            {data.audio_file.num_speakers && (
              <Text fontSize="xs" color="fg.muted">
                {data.audio_file.num_speakers} speaker{data.audio_file.num_speakers !== 1 ? "s" : ""}
              </Text>
            )}
          </HStack>
        </Box>
        <HStack ml="auto" gap={2} flexWrap="wrap">
          {/* Add Speaker — only when annotator has the speaker task */}
          {hasTask("speaker") && (
            addingSpeakerMode ? (
              <HStack gap={1}>
                <Input
                  size="sm"
                  placeholder="e.g. speaker_3"
                  value={newSpeakerName}
                  onChange={e => setNewSpeakerName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && newSpeakerName.trim()) addSpeaker(newSpeakerName)
                    if (e.key === "Escape") { setAddingSpeakerMode(false); setNewSpeakerName("") }
                  }}
                  autoFocus
                  w="140px"
                  bg="bg.muted"
                  borderColor="border"
                  color="fg"
                />
                <Button
                  size="sm"
                  colorPalette="teal"
                  disabled={!newSpeakerName.trim()}
                  loading={addingSegment}
                  onClick={() => addSpeaker(newSpeakerName)}
                >
                  Add
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setAddingSpeakerMode(false); setNewSpeakerName("") }}>
                  ✕
                </Button>
              </HStack>
            ) : (
              <Button
                size="sm"
                variant="outline"
                colorPalette="teal"
                onClick={() => setAddingSpeakerMode(true)}
              >
                <Plus size={14} />
                Add Speaker
              </Button>
            )
          )}
          {/* Add Segment — only when annotator has the speaker task */}
          {hasTask("speaker") && !addingSpeakerMode && (
            <Button
              size="sm"
              variant="outline"
              colorPalette="teal"
              loading={addingSegment}
              onClick={addSegment}
            >
              <Plus size={14} />
              Add Segment
            </Button>
          )}
          {/* Add Transcription Segment — only when annotator has the transcription task */}
          {hasTask("transcription") && (
            <Button
              size="sm"
              variant="outline"
              colorPalette="purple"
              loading={addingSegment}
              onClick={addTranscriptionSegment}
            >
              <Plus size={14} />
              Add Transcription
            </Button>
          )}
          {data.assignments.map(a => (
            <HStack key={a.id} gap={1}>
              <Badge
                colorPalette={
                  a.status === "completed"
                    ? "green"
                    : a.status === "in_progress"
                    ? "blue"
                    : "gray"
                }
                size="sm"
              >
                {a.task_type}:{a.status}
              </Badge>
              {a.status !== "completed" && (
                <Button
                  size="xs"
                  colorPalette="green"
                  variant="outline"
                  loading={completing[a.id]}
                  onClick={() => markComplete(a)}
                >
                  <CheckCheck size={12} /> Done
                </Button>
              )}
            </HStack>
          ))}
        </HStack>
      </HStack>

      {/* Main body */}
      <Box flex={1} display="flex" overflow="hidden">
        <Box flex={1} overflowY="auto" p={4} display="flex" flexDir="column" gap={4}>
          {/* Waveform */}
          <WaveformPlayer
            ref={playerRef}
            audioUrl={audioUrl}
            onTimeUpdate={setCurrentTime}
            onReady={(dur) => { setWaveformReady(true); setWaveformDuration(dur) }}
            onRegionUpdate={isSpeakerAnnotator ? handleRegionUpdate : undefined}
            height={80}
          />

          {/* Segment tracks */}
          {data.assignments.length > 0 && (
            <VStack align="stretch" gap={3}>
              {/* Time ruler */}
              {duration > 0 && (
                <Box position="relative" h="16px">
                  {Array.from({ length: Math.floor(duration / 10) + 1 }, (_, i) => i * 10).map(t => (
                    <Box key={t} position="absolute" left={`${(t / duration) * 100}%`} transform="translateX(-50%)">
                      <Text fontSize="9px" color="fg.muted" userSelect="none">{fmtTime(t)}</Text>
                    </Box>
                  ))}
                </Box>
              )}

              {/* Per-speaker accordion sections */}
              {(hasTask("speaker") || hasTask("transcription") || hasTask("gender")) && uniqueSpeakerLanes.map(label => {
                const key = label ?? "__null__"
                const isOpen = openAccordions.has(key)
                const speakerSegs = data.speaker_segments.filter(s => s.speaker_label === label)
                const currentGender = getGenderForSpeaker(label ?? "") || "unk"
                const trSegs = hasTask("transcription") ? (groupedTranscription.get(label) ?? []) : []
                return (
                  <Box key={key} bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="md" overflow="hidden">
                    {/* Accordion header */}
                    <HStack
                      px={3} py={2} gap={3} cursor="pointer" userSelect="none"
                      _hover={{ bg: "bg.muted" }}
                      onClick={() => toggleAccordion(key)}
                    >
                      <Box w="10px" h="10px" rounded="full" bg={speakerColor(label)} flexShrink={0} />
                      <Text fontSize="sm" fontWeight="semibold" color="fg" flex={1}>{label ?? "Unknown"}</Text>
                      <Text fontSize="xs" color="fg.muted">{speakerSegs.length} seg{speakerSegs.length !== 1 ? "s" : ""}</Text>

                      {/* Gender pills */}
                      {(hasTask("gender") || hasTask("speaker")) && (
                        <HStack gap={1} onClick={e => e.stopPropagation()}>
                          {(["Male", "Female", "Mixed", "unk"] as const).map(g => (
                            <Box
                              key={g}
                              as="button"
                              px={2} py="1px" fontSize="10px" rounded="full" borderWidth="1px"
                              borderColor={currentGender === g ? genderColor(g) : "border"}
                              bg={currentGender === g ? genderColor(g) + "33" : "transparent"}
                              color={currentGender === g ? genderColor(g) : "fg.muted"}
                              cursor="pointer"
                              transition="all 0.1s"
                              title={g === "unk" ? "Unknown" : g}
                              onClick={() => { if (label) propagateGender(label, g, -1) }}
                            >
                              {g === "unk" ? "?" : g}
                            </Box>
                          ))}
                        </HStack>
                      )}

                      <Text fontSize="xs" color="fg.muted">{isOpen ? "▲" : "▼"}</Text>
                    </HStack>

                    {/* Accordion body */}
                    {isOpen && (
                      <Box px={3} pb={3} pt={2} display="flex" flexDir="column" gap={2} borderTopWidth="1px" borderColor="border">
                        {hasTask("speaker") && (
                          <SegmentTrack
                            label="Segments"
                            segments={speakerSegs}
                            duration={duration}
                            currentTime={currentTime}
                            selectedId={selection?.type === "speaker" ? selection.segment.id : undefined}
                            getColor={(s: Segment) => speakerColor(s.speaker_label)}
                            getLabel={(s: Segment) => s.speaker_label ?? "?"}
                            onSelect={s => setSelection({ type: "speaker", segment: s })}
                          />
                        )}
                        {hasTask("transcription") && (
                          trSegs.length > 0 ? (
                            <SegmentTrack
                              label="Transcription"
                              segments={trSegs}
                              duration={duration}
                              currentTime={currentTime}
                              selectedId={selection?.type === "transcription" ? selection.segment.id : undefined}
                              getColor={(_: TranscriptSegment) => "#374151"}
                              getLabel={(s: TranscriptSegment) => s.edited_text ?? s.original_text ?? "—"}
                              onSelect={s => setSelection({ type: "transcription", segment: s })}
                            />
                          ) : (
                            <Text fontSize="xs" color="fg.subtle" fontStyle="italic" py={1}>No transcription segments in this speaker's range.</Text>
                          )
                        )}
                      </Box>
                    )}
                  </Box>
                )
              })}

              {/* Unmatched transcription segments (no speaker overlap) */}
              {hasTask("transcription") && ungroupedTranscription.length > 0 && (
                <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="md" p={3}>
                  <SegmentTrack
                    label="Transcription (unmatched)"
                    segments={ungroupedTranscription}
                    duration={duration}
                    currentTime={currentTime}
                    selectedId={selection?.type === "transcription" ? selection.segment.id : undefined}
                    getColor={(_: TranscriptSegment) => "#374151"}
                    getLabel={(s: TranscriptSegment) => s.edited_text ?? s.original_text ?? "—"}
                    onSelect={s => setSelection({ type: "transcription", segment: s })}
                    warningCount={segmentMismatches.transcription}
                  />
                </Box>
              )}

              {/* Transcription-only task (no speaker sections rendered above) */}
              {hasTask("transcription") && !hasTask("speaker") && !hasTask("gender") && uniqueSpeakerLanes.length === 0 && (
                <SegmentTrack
                  label="Transcription"
                  segments={data.transcription_segments}
                  duration={duration}
                  currentTime={currentTime}
                  selectedId={selection?.type === "transcription" ? selection.segment.id : undefined}
                  getColor={(_: TranscriptSegment) => "#374151"}
                  getLabel={(s: TranscriptSegment) => s.edited_text ?? s.original_text ?? "—"}
                  onSelect={s => setSelection({ type: "transcription", segment: s })}
                  warningCount={segmentMismatches.transcription}
                />
              )}

              {/* Emotion track — shown below all speaker sections */}
              {hasTask("emotion") && !emotionGated && (
                <SegmentTrack
                  label="Emotion (my annotations)"
                  segments={data.emotion_segments}
                  duration={duration}
                  currentTime={currentTime}
                  selectedId={selection?.type === "emotion" ? selection.segment.id : undefined}
                  getColor={(s: Segment) => emotionColor(s.emotion)}
                  getLabel={(s: Segment) => s.emotion ?? "—"}
                  onSelect={s => setSelection({ type: "emotion", segment: s })}
                />
              )}
            </VStack>
          )}

          {/* Emotion colour legend */}
          <HStack gap={4} flexWrap="wrap" pt={2}>
            {Object.entries(EMOTION_COLORS).map(([e, c]) => (
              <HStack key={e} gap={1}>
                <Box w="10px" h="10px" rounded="full" bg={c} flexShrink={0} />
                <Text fontSize="xs" color="fg.muted">{e}</Text>
              </HStack>
            ))}
          </HStack>
        </Box>

        {/* Segment editor sidebar — key forces remount on segment change */}
        {selection && (
          <SegmentEditor
            key={selection.segment.id}
            selection={selection}
            onClose={() => setSelection(null)}
            onSaved={handleSaved}
            onDelete={
              selection.type === "speaker" && hasTask("speaker")
                ? () => deleteSegment(selection.segment.id)
                : selection.type === "transcription" && hasTask("transcription")
                ? () => deleteTranscriptionSegment(selection.segment.id)
                : undefined
            }
            onTimesChanged={load}
            playerRef={playerRef}
            speakerLabels={speakerLabels}
            speakerSegments={data.speaker_segments}
            getGenderForSpeaker={getGenderForSpeaker}
          />
        )}
      </Box>
    </Box>
  )
}

// ─── Page wrapper (Suspense for useSearchParams) ──────────────────────────────

export default function AnnotationViewPage() {
  return (
    <Suspense
      fallback={
        <Box p={8} display="flex" justifyContent="center">
          <Spinner />
        </Box>
      }
    >
      <AnnotateInner />
    </Suspense>
  )
}
