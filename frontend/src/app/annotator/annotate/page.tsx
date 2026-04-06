"use client"

import {
  Suspense,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
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
  Dialog,
  Field,
  Flex,
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
import { ArrowLeft, CheckCheck, Keyboard, Lock, MessageSquare, Plus, RefreshCw, Save, Trash2 } from "lucide-react"
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
    annotator_remarks: string | null
    admin_response: string | null
    locked_speaker: boolean
    locked_gender: boolean
    locked_transcription: boolean
    locked_emotion: boolean
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
  emotion: string[] | null
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
  if (e.startsWith("Other:")) return EMOTION_COLORS["Other"]
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

function isLockedError(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 423
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
  highlightedId,
  getColor,
  getLabel,
  onSelect,
  trackColor = "bg.subtle",
  warningCount,
  warningLabel,
}: {
  label: string
  segments: T[]
  duration: number
  currentTime: number
  selectedId?: number
  highlightedId?: number
  getColor: (s: T) => string
  getLabel: (s: T) => string
  onSelect: (s: T) => void
  trackColor?: string
  warningCount?: number
  warningLabel?: string
}) {
  return (
    <Box>
      <HStack mb={1} gap={2} align="center">
        <Text fontSize="xs" fontWeight="medium" color="fg.muted" userSelect="none">
          {label}
        </Text>
        {warningCount != null && warningCount > 0 && (
          <Badge size="xs" colorPalette="orange">
            {warningLabel
              ? `${warningCount} ${warningLabel}`
              : `${warningCount} boundary mismatch${warningCount > 1 ? "es" : ""}`}
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
          const isHighlighted = highlightedId === seg.id
          return (
            <Box
              key={seg.id}
              position="absolute"
              top="2px"
              bottom="2px"
              left={`${left}%`}
              w={`${width}%`}
              bg={isHighlighted ? "rgba(6,182,212,0.55)" : getColor(seg)}
              opacity={isSelected || isHighlighted ? 1 : 0.75}
              rounded="sm"
              cursor="pointer"
              borderWidth={isSelected || isHighlighted ? "2px" : "0"}
              borderColor={isHighlighted ? "cyan.300" : "white"}
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

interface SegmentEditorRef {
  save: () => void
  setEmotion: (e: string) => void
  toggleAmbiguous: () => void
  updateTimes: (start: number, end: number) => void
}

const SegmentEditor = forwardRef<SegmentEditorRef, {
  selection: Selection
  onClose: () => void
  onSaved: (type: SelectionType, updated: Segment | TranscriptSegment, previous: Segment | TranscriptSegment) => void
  onDelete?: () => Promise<void>
  onTimesChanged?: () => void
  playerRef: React.RefObject<WaveformPlayerRef | null>
  speakerLabels?: string[]
  speakerSegments?: Segment[]
  getGenderForSpeaker?: (label: string) => string
  onSpeakerSegHover?: (id: number | null) => void
  canEditGender?: boolean
  lockedSpeaker?: boolean
  lockedGender?: boolean
  locked?: boolean
}>(function SegmentEditor({
  selection,
  onClose,
  onSaved,
  onDelete,
  onTimesChanged,
  playerRef,
  speakerLabels,
  speakerSegments,
  getGenderForSpeaker,
  onSpeakerSegHover,
  canEditGender = false,
  lockedSpeaker = false,
  lockedGender = false,
  locked = false,
}, ref) {
  // isSaveDisabled: each track type has its own independent lock.
  // For speaker-type: disabled only when BOTH speaker AND gender are unavailable.
  const isSaveDisabled =
    selection.type === "speaker"
      ? (lockedSpeaker && (!canEditGender || lockedGender))
      : locked  // transcription / emotion use the simple lock prop

  // isDeleteDisabled: deletion is a structural operation — blocked by speaker lock only.
  // Kept separate from isSaveDisabled so a gender-only lock never blocks deletion.
  const isDeleteDisabled =
    selection.type === "speaker" ? lockedSpeaker
    : locked
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addingSpeaker, setAddingSpeaker] = useState(false)
  const [newSpeakerInput, setNewSpeakerInput] = useState("")
  const [emotions, setEmotions] = useState<string[]>(
    (selection.segment as Segment).emotion ?? []
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
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<{ field_changed: string; old_value: string | null; new_value: string | null; username: string; edited_at: string }[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [alignedTo, setAlignedTo] = useState<Segment | null>(() => {
    if (selection.type !== "transcription" || !speakerSegments) return null
    const seg = selection.segment as TranscriptSegment
    return speakerSegments.find(
      s => s.start_time === seg.start_time && s.end_time === seg.end_time
    ) ?? null
  })

  const { type, segment } = selection

  const save = async () => {
    setSaving(true)
    try {
      let res
      if (type === "emotion") {
        res = await api.patch(`/api/segments/speaker/${segment.id}`, {
          emotion: (() => {
            const cleaned = emotions.filter(e => e !== "Other:" && !(e.startsWith("Other:") && e.slice(6).trim() === ""))
            return cleaned.length > 0 ? cleaned : null
          })(),
          is_ambiguous: isAmbiguous,
          notes: notes || null,
          updated_at: segment.updated_at,
        })
        onSaved(type, res.data, segment)
        ToastWizard.standard("success", "Emotion saved")
      } else if (type === "speaker") {
        const payload: Record<string, unknown> = { updated_at: segment.updated_at }
        // Speaker structural fields — only include when speaker track is not locked
        if (!lockedSpeaker) {
          payload.speaker_label = speakerLabel || null
          payload.is_ambiguous = isAmbiguous
          if (startTime !== segment.start_time) payload.start_time = startTime
          if (endTime !== segment.end_time) payload.end_time = endTime
        }
        // Gender — independent track, only blocked by gender lock
        if (!lockedGender) {
          payload.gender = gender || null
        }
        // Notes — always saveable (not a locked structural field)
        payload.notes = notes || null
        const timesChanged = payload.start_time !== undefined || payload.end_time !== undefined

        res = await api.patch(`/api/segments/speaker/${segment.id}`, payload)
        onSaved(type, res.data, segment)
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
        onSaved(type, res.data, segment)
        if (timesChanged) onTimesChanged?.()
        ToastWizard.standard("success", "Transcription saved")
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 423) {
        ToastWizard.standard("warning", "Locked", "All annotators have submitted — no further changes allowed.")
      } else if (status === 409) {
        ToastWizard.standard("warning", "Segment was modified by another annotator. Reload to get latest.")
      } else {
        ToastWizard.standard("error", "Save failed")
      }
    } finally {
      setSaving(false)
    }
  }

  // Expose imperative methods for keyboard shortcuts (after save is defined)
  useImperativeHandle(ref, () => ({
    save,
    setEmotion: (e: string) => {
      if (e === "Other") {
        setEmotions(prev => [...prev, "Other:"])
      } else {
        setEmotions(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e])
      }
    },
    toggleAmbiguous: () => setIsAmbiguous(prev => !prev),
    updateTimes: (start: number, end: number) => {
      setStartTime(start)
      setEndTime(end)
    },
  }))

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
    playerRef.current?.playRange(segment.start_time, segment.end_time)
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
              <Field.Label fontSize="xs">Emotion <Text as="span" color="fg.subtle" fontSize="9px">(keys 1–7 toggle, 8 adds Other)</Text></Field.Label>
              <VStack align="stretch" gap={1.5} mt={1}>
                {["Neutral", "Happy", "Sad", "Angry", "Surprised", "Fear", "Disgust"].map((em, i) => {
                  const isChecked = emotions.includes(em)
                  return (
                    <HStack
                      key={em}
                      gap={2}
                      cursor="pointer"
                      px={1}
                      py={0.5}
                      rounded="sm"
                      _hover={{ bg: "bg.muted" }}
                      onClick={() => setEmotions(prev => prev.includes(em) ? prev.filter(x => x !== em) : [...prev, em])}
                    >
                      <Box
                        w="14px" h="14px" flexShrink={0}
                        borderWidth="1px"
                        borderColor={isChecked ? "blue.400" : "border"}
                        bg={isChecked ? "blue.500" : "transparent"}
                        rounded="sm"
                        display="flex" alignItems="center" justifyContent="center"
                      >
                        {isChecked && <Text color="white" fontSize="9px" lineHeight={1}>✓</Text>}
                      </Box>
                      <Text fontSize="xs" userSelect="none">
                        {em} <Text as="span" color="fg.subtle" fontSize="9px">({i + 1})</Text>
                      </Text>
                    </HStack>
                  )
                })}

                {/* Other entries */}
                {emotions.filter(e => e.startsWith("Other:")).map((entry, idx) => {
                  const desc = entry.slice(6)
                  return (
                    <HStack key={idx} gap={1}>
                      <Input
                        size="xs"
                        placeholder="Describe…"
                        value={desc}
                        onChange={ev => {
                          const newEntry = `Other:${ev.target.value}`
                          setEmotions(prev => {
                            const others = prev.filter(e => e.startsWith("Other:"))
                            others[idx] = newEntry
                            return [...prev.filter(e => !e.startsWith("Other:")), ...others]
                          })
                        }}
                        autoFocus={desc === ""}
                      />
                      <IconButton
                        size="xs"
                        variant="ghost"
                        aria-label="Remove Other"
                        onClick={() =>
                          setEmotions(prev => {
                            const others = prev.filter(e => e.startsWith("Other:"))
                            others.splice(idx, 1)
                            return [...prev.filter(e => !e.startsWith("Other:")), ...others]
                          })
                        }
                      >
                        ✕
                      </IconButton>
                    </HStack>
                  )
                })}

                <Button
                  size="xs"
                  variant="ghost"
                  justifyContent="flex-start"
                  onClick={() => setEmotions(prev => [...prev, "Other:"])}
                >
                  <Plus size={12} /> Add Other…
                </Button>
              </VStack>
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

        {/* Speaker / Gender fields */}
        {type === "speaker" && (
          <>
            {/* Time inputs */}
            <Box>
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
                    disabled={lockedSpeaker}
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
                    disabled={lockedSpeaker}
                  />
                </Field.Root>
              </HStack>
              <Text fontSize="10px" color="fg.subtle" mt={1}>
                💡 Drag the highlighted region on the waveform to adjust times
              </Text>
            </Box>

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
              ) : lockedSpeaker ? (
                <Box px={2} py={1} bg="bg.muted" borderWidth="1px" borderColor="border" rounded="sm" fontSize="sm" color="fg.subtle">
                  {speakerLabel || "Unknown"}
                  <Text as="span" fontSize="10px" color="fg.subtle" ml={2}>(locked)</Text>
                </Box>
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
              {canEditGender && !lockedGender ? (
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
              ) : (
                <Box px={2} py={1} bg="bg.muted" borderWidth="1px" borderColor="border" rounded="sm" fontSize="sm"
                  color={gender && gender !== "unk" ? genderColor(gender) : "fg.subtle"}
                >
                  {gender && gender !== "unk" ? gender : "Unknown"}
                  <Text as="span" fontSize="10px" color="fg.subtle" ml={2}>
                    {lockedGender ? "(locked)" : "(read-only — no gender task assigned)"}
                  </Text>
                </Box>
              )}
            </Field.Root>

            <Checkbox.Root
              checked={isAmbiguous}
              onCheckedChange={({ checked }) => setIsAmbiguous(!!checked)}
              size="sm"
              disabled={lockedSpeaker}
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
                        <Select.Item
                          key={s.id}
                          item={{ label: `${s.speaker_label ?? "?"} (${fmtTime(s.start_time)}–${fmtTime(s.end_time)})`, value: String(s.id) }}
                          onMouseEnter={() => { playerRef.current?.activateRegion(String(s.id)); onSpeakerSegHover?.(s.id) }}
                          onMouseLeave={() => { playerRef.current?.deactivateRegion(String(s.id)); onSpeakerSegHover?.(null) }}
                        >
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
              <Field.Label fontSize="xs">Transcription</Field.Label>
              <Textarea
                size="sm"
                value={editedText}
                onChange={e => setEditedText(e.target.value)}
                placeholder="Type the transcription for this segment…"
                rows={4}
                fontFamily="mono"
                fontSize="xs"
              />
              {/* Show original ASR text as reference whenever it exists */}
              {(segment as TranscriptSegment).original_text != null && (
                <Box mt={1} px={2} py={1.5} bg="bg.muted" borderWidth="1px" borderColor="border" rounded="sm">
                  <Text fontSize="9px" color="fg.subtle" mb={0.5}>Original (ASR)</Text>
                  <Text fontSize="xs" color="fg.muted" fontFamily="mono" whiteSpace="pre-wrap">
                    {(segment as TranscriptSegment).original_text}
                  </Text>
                </Box>
              )}
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

        <Button size="sm" colorPalette="blue" loading={saving} disabled={isSaveDisabled} onClick={save}
          title={isSaveDisabled ? "This task is locked — no further changes allowed" : undefined}>
          <Save size={14} />
          Save
        </Button>

        {onDelete && !confirmDelete && (
          <Button
            size="sm"
            colorPalette="red"
            variant="outline"
            disabled={isDeleteDisabled}
            onClick={handleDelete}
            title={isDeleteDisabled ? "Speaker track is locked — ask admin to unlock before deleting" : undefined}
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

        {/* Edit history */}
        <Box borderTopWidth="1px" borderColor="border" pt={2}>
          <Flex
            as="button"
            w="full"
            align="center"
            justify="space-between"
            onClick={async () => {
              const opening = !historyOpen
              setHistoryOpen(opening)
              if (opening && history.length === 0) {
                setHistoryLoading(true)
                try {
                  const segType = type === "transcription" ? "transcription" : "speaker"
                  const res = await api.get(`/api/segments/history/${segType}/${segment.id}`)
                  setHistory(res.data)
                } catch {} finally {
                  setHistoryLoading(false)
                }
              }
            }}
            color="fg.muted"
            _hover={{ color: "fg" }}
          >
            <Text fontSize="xs">Edit history</Text>
            <Text fontSize="10px">{historyOpen ? "▲" : "▼"}</Text>
          </Flex>
          {historyOpen && (
            <Box mt={2}>
              {historyLoading ? (
                <Text fontSize="xs" color="fg.muted">Loading…</Text>
              ) : history.length === 0 ? (
                <Text fontSize="xs" color="fg.muted" fontStyle="italic">No edits recorded.</Text>
              ) : (
                <VStack align="stretch" gap={1.5}>
                  {history.map((h, i) => (
                    <Box key={i} p={2} bg="bg.muted" rounded="sm" fontSize="10px">
                      <HStack justify="space-between" mb={0.5}>
                        <Text color="fg.muted">{h.username}</Text>
                        <Text color="fg.subtle">{new Date(h.edited_at).toLocaleString()}</Text>
                      </HStack>
                      <Text color="fg">
                        <Text as="span" fontWeight="medium">{h.field_changed}: </Text>
                        <Text as="span" color="red.400" textDecoration="line-through">{h.old_value ?? "—"}</Text>
                        {" → "}
                        <Text as="span" color="green.400">{h.new_value ?? "—"}</Text>
                      </Text>
                    </Box>
                  ))}
                </VStack>
              )}
            </Box>
          )}
        </Box>
      </VStack>
    </Box>
  )
})

// ─── Inner page (needs useSearchParams) ──────────────────────────────────────

function AnnotateInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fileId = searchParams.get("file")

  const playerRef = useRef<WaveformPlayerRef>(null)
  const editorRef = useRef<SegmentEditorRef>(null)
  const regionTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const dataRef = useRef<AnnotateData | null>(null)
  const segmentFilterRef = useRef<"all" | "unannotated" | "ambiguous" | "has_notes">("all")
  const undoStack = useRef<Array<{
    segmentId: number
    type: SelectionType
    prevValues: Record<string, unknown>
    currentUpdatedAt: string
  }>>([])
  const isUndoing = useRef(false)
  const undoRef = useRef<() => void>(() => {})
  const loadingRef = useRef(true)
  const [data, setData] = useState<AnnotateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [waveformReady, setWaveformReady] = useState(false)
  const [waveformDuration, setWaveformDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [hoveredSpeakerSegId, setHoveredSpeakerSegId] = useState<number | null>(null)
  const [completing, setCompleting] = useState<Record<number, boolean>>({})
  const [remarks, setRemarks] = useState("")
  const [remarksSaving, setRemarksSaving] = useState(false)
  const [remarksOpen, setRemarksOpen] = useState(false)
  const [addingSegment, setAddingSegment] = useState(false)
  const [segmentModal, setSegmentModal] = useState<{ open: boolean; speaker: string; start: number; end: number }>({ open: false, speaker: "", start: 0, end: 2 })
  const [trModal, setTrModal] = useState<{ open: boolean; start: number; end: number; originalText: string; alignTo: string }>({ open: false, start: 0, end: 2, originalText: "", alignTo: "" })
  const [openAccordions, setOpenAccordions] = useState<Set<string>>(new Set())
  const [hasUpdates, setHasUpdates] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [segmentFilter, setSegmentFilter] = useState<"all" | "unannotated" | "ambiguous" | "has_notes">("all")
  const [annotatorCount, setAnnotatorCount] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!fileId) return
    setLoading(true)
    try {
      const res = await api.get(`/api/segments/annotate/${fileId}`)
      setData(res.data)
      setRemarks(res.data.audio_file.annotator_remarks ?? "")
      api.get(`/api/audio-files/${fileId}/annotator-count`).then(r => setAnnotatorCount(r.data.count)).catch(() => {})
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

  // Keep refs current
  useEffect(() => { dataRef.current = data }, [data])
  useEffect(() => { loadingRef.current = loading }, [loading])

  // ── Server-Sent Events — real-time segment sync ───────────────────────────
  useEffect(() => {
    if (!fileId) return

    const abortController = new AbortController()
    let retryDelay = 1000

    function handleEvent(raw: string) {
      let event: { type: string; data?: Record<string, unknown> }
      try { event = JSON.parse(raw) } catch { return }
      const { type, data: d } = event
      if (!d) return

      if (type === "speaker_updated") {
        setData(prev => prev ? {
          ...prev,
          speaker_segments: prev.speaker_segments.map(s => s.id === d.id ? { ...s, ...d } as typeof s : s),
        } : prev)
      } else if (type === "speaker_created") {
        setData(prev => {
          if (!prev || prev.speaker_segments.some(s => s.id === d.id)) return prev
          const next = [...prev.speaker_segments, d as unknown as typeof prev.speaker_segments[0]]
          next.sort((a, b) => a.start_time - b.start_time)
          return { ...prev, speaker_segments: next }
        })
      } else if (type === "speaker_deleted") {
        setData(prev => prev ? {
          ...prev,
          speaker_segments: prev.speaker_segments.filter(s => s.id !== d.id),
        } : prev)
        setSelection(prev => prev?.type === "speaker" && prev.segment.id === d.id ? null : prev)
      } else if (type === "transcription_updated") {
        setData(prev => prev ? {
          ...prev,
          transcription_segments: prev.transcription_segments.map(s => s.id === d.id ? { ...s, ...d } as typeof s : s),
        } : prev)
      } else if (type === "transcription_created") {
        setData(prev => {
          if (!prev || prev.transcription_segments.some(s => s.id === d.id)) return prev
          const next = [...prev.transcription_segments, d as unknown as typeof prev.transcription_segments[0]]
          next.sort((a, b) => a.start_time - b.start_time)
          return { ...prev, transcription_segments: next }
        })
      } else if (type === "transcription_deleted") {
        setData(prev => prev ? {
          ...prev,
          transcription_segments: prev.transcription_segments.filter(s => s.id !== d.id),
        } : prev)
        setSelection(prev => prev?.type === "transcription" && prev.segment.id === d.id ? null : prev)
      } else if (type === "transcription_linked") {
        // Admin linked a transcription JSON while this page was open — merge in all
        // new segments so the annotator doesn't need to manually refresh.
        const incoming = (d as { segments: TranscriptSegment[] }).segments ?? []
        setData(prev => {
          if (!prev || incoming.length === 0) return prev
          const existingIds = new Set(prev.transcription_segments.map(s => s.id))
          const toAdd = incoming.filter(s => !existingIds.has(s.id))
          if (toAdd.length === 0) return prev
          const next = [...prev.transcription_segments, ...toAdd]
          next.sort((a, b) => a.start_time - b.start_time)
          return { ...prev, transcription_segments: next }
        })
      } else if (type === "lock_changed") {
        setData(prev => prev ? {
          ...prev,
          audio_file: {
            ...prev.audio_file,
            locked_speaker: d.locked_speaker as boolean,
            locked_gender: d.locked_gender as boolean,
            locked_transcription: d.locked_transcription as boolean,
            locked_emotion: d.locked_emotion as boolean,
          },
        } : prev)
      }
    }

    async function run() {
      while (!abortController.signal.aborted) {
        const token = localStorage.getItem("access_token")
        if (!token) break
        try {
          const res = await fetch(`/api/events/${fileId}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: abortController.signal,
          })
          if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`)
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = ""
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            const frames = buf.split("\n\n")
            buf = frames.pop() ?? ""
            for (const frame of frames) {
              for (const line of frame.split("\n")) {
                if (line.startsWith("data:")) handleEvent(line.slice(5).trim())
              }
            }
          }
          retryDelay = 1000
        } catch (err: unknown) {
          if (abortController.signal.aborted) break
          if (err instanceof Error && err.message.includes("401")) break
          await new Promise(r => setTimeout(r, retryDelay))
          retryDelay = Math.min(retryDelay * 2, 30_000)
        }
      }
    }

    run()
    return () => abortController.abort()
  }, [fileId])

  // Reset modal state whenever the file changes so stale open-state from a
  // previous navigation (Next.js App Router reuses the same component instance
  // across same-path navigations) never causes a modal to auto-open.
  useEffect(() => {
    setSegmentModal({ open: false, speaker: "", start: 0, end: 2 })
    setTrModal({ open: false, start: 0, end: 2, originalText: "", alignTo: "" })
  }, [fileId])

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

  // Fallback poll — only fires if the SSE connection is absent or drops.
  // SSE normally keeps state current, so this rarely triggers the banner.
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
        // Silent
      }
    }, 60_000)
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
    const labels = [...new Set(data.speaker_segments.map(s => s.speaker_label))]
    return labels.sort((a, b) => {
      if (a === null) return 1
      if (b === null) return -1
      const aM = a.match(/^speaker_(\d+)$/i)
      const bM = b.match(/^speaker_(\d+)$/i)
      if (aM && bM) return parseInt(aM[1]) - parseInt(bM[1])
      if (aM) return -1
      if (bM) return 1
      return a.localeCompare(b)
    })
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

  // Group transcription segments by the speaker with the most overlap.
  // Fallback: if no overlap, assign to the speaker whose segments are temporally nearest
  // (this ensures transcriptions "shift up" to the previous speaker when a speaker is deleted).
  const groupedTranscription = useMemo(() => {
    const grouped = new Map<string | null, TranscriptSegment[]>()
    if (!data || data.speaker_segments.length === 0) return grouped

    for (const t of data.transcription_segments) {
      const tMid = (t.start_time + t.end_time) / 2
      let bestLabel: string | null = null
      let bestScore = -Infinity

      for (const s of data.speaker_segments) {
        const overlap = Math.min(t.end_time, s.end_time) - Math.max(t.start_time, s.start_time)
        if (overlap > 0) {
          // Overlap wins — use it as primary signal
          if (overlap > bestScore) { bestScore = overlap; bestLabel = s.speaker_label }
        } else if (bestScore <= 0) {
          // No overlap yet — use negative distance as fallback score
          const sMid = (s.start_time + s.end_time) / 2
          const dist = -Math.abs(tMid - sMid)
          if (dist > bestScore) { bestScore = dist; bestLabel = s.speaker_label }
        }
      }

      if (bestLabel !== null) {
        if (!grouped.has(bestLabel)) grouped.set(bestLabel, [])
        grouped.get(bestLabel)!.push(t)
      }
    }
    return grouped
  }, [data])

  // Open all speaker accordions when file loads; restore session state if available
  useEffect(() => {
    if (!data) return
    const labels = [...new Set(data.speaker_segments.map(s => s.speaker_label ?? "__null__"))]
    const sessionKey = `annotate_${data.audio_file.id}`
    try {
      const saved = sessionStorage.getItem(sessionKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.accordions) setOpenAccordions(new Set(parsed.accordions))
        else setOpenAccordions(new Set(labels))
        if (parsed.segmentFilter) setSegmentFilter(parsed.segmentFilter)
      } else {
        setOpenAccordions(new Set(labels))
      }
    } catch {
      setOpenAccordions(new Set(labels))
    }
  }, [data?.audio_file.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAccordion = (key: string) => {
    setOpenAccordions(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      if (fileId) {
        try { sessionStorage.setItem(`annotate_${fileId}`, JSON.stringify({ accordions: [...next], segmentFilter: segmentFilterRef.current })) } catch {}
      }
      return next
    })
  }

  // Populate WaveSurfer regions whenever speaker segments or waveform readiness change.
  // All annotators see colour-coded regions for reference; only speaker annotators
  // can drag/resize them (controlled via onRegionUpdate / onRangeSelect props).
  useEffect(() => {
    if (!waveformReady || !data) return

    const draw = () => {
      if (!playerRef.current) return
      playerRef.current.clearRegions()
      for (const seg of data.speaker_segments) {
        playerRef.current.addRegion(
          String(seg.id),
          seg.start_time,
          seg.end_time,
          speakerColor(seg.speaker_label) + "40",
        )
      }
    }

    // playerRef is populated by the dynamic-imported WaveformPlayer after it mounts.
    // If it isn't available yet (dynamic import still in flight), defer by one frame.
    if (playerRef.current) {
      draw()
    } else {
      const raf = requestAnimationFrame(draw)
      return () => cancelAnimationFrame(raf)
    }
  }, [waveformReady, data])

  // Region drag/resize on waveform — update the open SegmentEditor's time fields (no auto-save)
  const handleRegionUpdate = useCallback(
    (id: string, start: number, end: number) => {
      editorRef.current?.updateTimes(
        parseFloat(start.toFixed(3)),
        parseFloat(end.toFixed(3)),
      )
    },
    [],
  )

  // Activate the selected segment's waveform region so it becomes resizable;
  // deactivate the previous one.
  const prevActiveRegionId = useRef<string | null>(null)
  useEffect(() => {
    const prevId = prevActiveRegionId.current
    const nextId = selection?.type === "speaker" ? String(selection.segment.id) : null

    if (prevId && prevId !== nextId) playerRef.current?.deactivateRegion(prevId)
    if (nextId) playerRef.current?.activateRegion(nextId)

    prevActiveRegionId.current = nextId
  }, [selection])

  const handleSaved = (type: SelectionType, updated: Segment | TranscriptSegment, previous?: Segment | TranscriptSegment) => {
    // Push undo entry (skip when undo itself calls handleSaved)
    if (previous && !isUndoing.current) {
      let prevValues: Record<string, unknown>
      if (type === "emotion") {
        const s = previous as Segment
        prevValues = { emotion: s.emotion ?? null, is_ambiguous: s.is_ambiguous ?? false, notes: s.notes ?? null }
      } else if (type === "speaker") {
        const s = previous as Segment
        prevValues = { speaker_label: s.speaker_label ?? null, gender: s.gender ?? null, is_ambiguous: s.is_ambiguous ?? false, notes: s.notes ?? null, start_time: s.start_time, end_time: s.end_time }
      } else {
        const s = previous as TranscriptSegment
        prevValues = { edited_text: s.edited_text ?? null, notes: s.notes ?? null, start_time: s.start_time, end_time: s.end_time }
      }
      undoStack.current = [
        ...undoStack.current.slice(-19),
        { segmentId: previous.id, type, prevValues, currentUpdatedAt: updated.updated_at },
      ]
    }

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

  const openSegmentModal = () => {
    const currentT = playerRef.current?.getCurrentTime() ?? 0
    const { start, end } = smartPlacement(data?.speaker_segments ?? [], currentT, waveformDuration)
    setSegmentModal({ open: true, speaker: speakerLabels[0] ?? "", start: parseFloat(start.toFixed(3)), end: parseFloat(end.toFixed(3)) })
  }

  // Waveform drag-to-select: pre-fill the Add Segment modal with the dragged range
  const handleRangeSelect = useCallback((start: number, end: number) => {
    if (!isSpeakerAnnotator || loadingRef.current) return
    setSegmentModal({ open: true, speaker: speakerLabels[0] ?? "", start: parseFloat(start.toFixed(3)), end: parseFloat(end.toFixed(3)) })
  }, [isSpeakerAnnotator, speakerLabels])

  // Undo — pop the stack and re-PATCH with previous values
  const undo = async () => {
    if (undoStack.current.length === 0) return
    const entry = undoStack.current[undoStack.current.length - 1]
    undoStack.current = undoStack.current.slice(0, -1)
    isUndoing.current = true
    try {
      const endpoint = entry.type === "transcription"
        ? `/api/segments/transcription/${entry.segmentId}`
        : `/api/segments/speaker/${entry.segmentId}`
      const res = await api.patch(endpoint, { ...entry.prevValues, updated_at: entry.currentUpdatedAt })
      handleSaved(entry.type, res.data)
      ToastWizard.standard("success", "Undone", undefined, 1500, true)
    } catch {
      ToastWizard.standard("error", "Undo failed", "The segment may have changed since the last save.", 3000, true)
    } finally {
      isUndoing.current = false
    }
  }
  undoRef.current = undo

  const openTrModal = () => {
    const currentT = playerRef.current?.getCurrentTime() ?? 0
    const { start, end } = smartPlacement(data?.transcription_segments ?? [], currentT, waveformDuration)
    setTrModal({ open: true, start: parseFloat(start.toFixed(3)), end: parseFloat(end.toFixed(3)), originalText: "", alignTo: "" })
  }

  const addSegment = async () => {
    if (!data) return
    setAddingSegment(true)
    try {
      await api.post("/api/segments/speaker", {
        audio_file_id: data.audio_file.id,
        start_time: segmentModal.start,
        end_time: segmentModal.end,
        speaker_label: segmentModal.speaker || null,
        gender: getGenderForSpeaker(segmentModal.speaker),
      })
      setSegmentModal(m => ({ ...m, open: false }))
      await load()
      ToastWizard.standard("success", "Segment added")
    } catch (err) {
      if (isLockedError(err)) ToastWizard.standard("warning", "Locked", "All annotators have submitted — no further changes allowed.")
      else ToastWizard.standard("error", "Failed to add segment")
    } finally {
      setAddingSegment(false)
    }
  }

  const addSpeaker = async () => {
    if (!data) return
    // Auto-generate the next speaker_N label
    const nums = data.speaker_segments
      .map(s => s.speaker_label?.match(/^speaker_(\d+)$/i))
      .filter(Boolean)
      .map(m => parseInt(m![1], 10))
    const label = `speaker_${nums.length > 0 ? Math.max(...nums) + 1 : 1}`
    setAddingSegment(true)
    try {
      const currentT = playerRef.current?.getCurrentTime() ?? 0
      const { start, end } = smartPlacement(data.speaker_segments, currentT, waveformDuration)
      await api.post("/api/segments/speaker", {
        audio_file_id: data.audio_file.id,
        start_time: start,
        end_time: end,
        speaker_label: label,
        gender: "unk",
      })
      await load()
      ToastWizard.standard("success", `Speaker "${label}" added`)
    } catch (err) {
      if (isLockedError(err)) ToastWizard.standard("warning", "Locked", "All annotators have submitted — no further changes allowed.")
      else ToastWizard.standard("error", "Failed to add speaker")
    } finally {
      setAddingSegment(false)
    }
  }

  const saveRemarks = async () => {
    if (!data) return
    setRemarksSaving(true)
    try {
      await api.patch(`/api/audio-files/${data.audio_file.id}/remarks`, { annotator_remarks: remarks || null })
      ToastWizard.standard("success", "Remarks saved")
      setRemarksOpen(false)
    } catch {
      ToastWizard.standard("error", "Failed to save remarks")
    } finally {
      setRemarksSaving(false)
    }
  }

  const deleteSpeaker = async (label: string) => {
    if (!data) return
    try {
      await api.delete(`/api/segments/speaker/by-label`, {
        params: { file_id: data.audio_file.id, speaker_label: label },
      })
      if (selection?.type === "speaker" && (selection.segment as Segment).speaker_label === label) {
        setSelection(null)
      }
      await load()
      ToastWizard.standard("success", `Speaker "${label}" and their segments deleted`)
    } catch (err) {
      if (isLockedError(err)) ToastWizard.standard("warning", "Locked", "All annotators have submitted — no further changes allowed.")
      else ToastWizard.standard("error", "Failed to delete speaker")
    }
  }

  const deleteSegment = async (segmentId: number) => {
    try {
      await api.delete(`/api/segments/speaker/${segmentId}`)
      setSelection(null)
      await load()
      ToastWizard.standard("success", "Segment deleted")
    } catch (err) {
      if (isLockedError(err)) ToastWizard.standard("warning", "Locked", "All annotators have submitted — no further changes allowed.")
      else ToastWizard.standard("error", "Failed to delete segment")
    }
  }

  const addTranscriptionSegment = async () => {
    if (!data) return
    setAddingSegment(true)
    try {
      // If aligned to a speaker segment, snap times
      const alignSeg = data.speaker_segments.find(s => String(s.id) === trModal.alignTo)
      const start = alignSeg ? alignSeg.start_time : trModal.start
      const end   = alignSeg ? alignSeg.end_time   : trModal.end
      await api.post("/api/segments/transcription", {
        audio_file_id: data.audio_file.id,
        start_time: start,
        end_time: end,
        original_text: trModal.originalText || "",
      })
      setTrModal(m => ({ ...m, open: false }))
      await load()
      ToastWizard.standard("success", "Transcription segment added")
    } catch (err) {
      if (isLockedError(err)) ToastWizard.standard("warning", "Locked", "All annotators have submitted — no further changes allowed.")
      else ToastWizard.standard("error", "Failed to add transcription segment")
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
    } catch (err) {
      if (isLockedError(err)) ToastWizard.standard("warning", "Locked", "All annotators have submitted — no further changes allowed.")
      else ToastWizard.standard("error", "Failed to delete transcription segment")
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await load()
    setHasUpdates(false)
    setRefreshing(false)
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      // Skip when user is typing in an input / textarea / contenteditable
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) return

      // Ctrl/Cmd+Z — undo last segment save
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault()
        undoRef.current()
        return
      }

      switch (e.key) {
        case " ":
          e.preventDefault()
          playerRef.current?.playPause()
          break
        case "ArrowLeft":
          e.preventDefault()
          playerRef.current?.seekTo(Math.max(0, (playerRef.current?.getCurrentTime() ?? 0) - 2))
          break
        case "ArrowRight":
          e.preventDefault()
          playerRef.current?.seekTo(Math.max(0, (playerRef.current?.getCurrentTime() ?? 0) + 2))
          break
        case "s":
        case "S":
          e.preventDefault()
          editorRef.current?.save()
          break
        case "n":
        case "N": {
          e.preventDefault()
          const d = dataRef.current
          if (!d || !d.assignments.some(a => a.task_type === "emotion")) break
          if (d.audio_file.emotion_gated) break
          const unfinished = d.emotion_segments.find(seg => !seg.emotion?.length)
          if (unfinished) setSelection({ type: "emotion", segment: unfinished })
          break
        }
        case "a":
        case "A":
          e.preventDefault()
          editorRef.current?.toggleAmbiguous()
          break
        case "?":
          e.preventDefault()
          setShowShortcuts(s => !s)
          break
        default:
          if (/^[1-8]$/.test(e.key) && e.key !== "") {
            e.preventDefault()
            if (!dataRef.current?.audio_file.emotion_gated) {
              editorRef.current?.setEmotion(EMOTIONS[parseInt(e.key, 10) - 1])
            }
          }
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, []) // stable — uses refs and dataRef for fresh values

  const markComplete = async (assignment: Assignment) => {
    setCompleting(c => ({ ...c, [assignment.id]: true }))
    try {
      await api.patch(`/api/assignments/${assignment.id}/status`, { status: "completed" })
      setData(prev =>
        prev ? { ...prev, assignments: prev.assignments.map(a => a.id === assignment.id ? { ...a, status: "completed" } : a) } : prev
      )
      ToastWizard.standard("success", `${assignment.task_type} marked complete`)
    } catch {
      ToastWizard.standard("error", "Failed to update task status")
    } finally {
      setCompleting(c => ({ ...c, [assignment.id]: false }))
    }
  }

  const undoComplete = async (assignment: Assignment) => {
    setCompleting(c => ({ ...c, [assignment.id]: true }))
    try {
      await api.patch(`/api/assignments/${assignment.id}/status`, { status: "in_progress" })
      setData(prev =>
        prev ? { ...prev, assignments: prev.assignments.map(a => a.id === assignment.id ? { ...a, status: "in_progress" } : a) } : prev
      )
      ToastWizard.standard("success", `${assignment.task_type} reopened`)
    } catch {
      ToastWizard.standard("error", "Failed to reopen task")
    } finally {
      setCompleting(c => ({ ...c, [assignment.id]: false }))
    }
  }

  // Keep segmentFilterRef current so toggleAccordion always reads the latest value
  useEffect(() => { segmentFilterRef.current = segmentFilter }, [segmentFilter])

  // Persist segmentFilter changes to sessionStorage
  useEffect(() => {
    if (!fileId) return
    try {
      const key = `annotate_${fileId}`
      const existing = JSON.parse(sessionStorage.getItem(key) ?? "{}")
      sessionStorage.setItem(key, JSON.stringify({ ...existing, segmentFilter }))
    } catch {}
  }, [segmentFilter, fileId])

  const filteredEmotionSegments = useMemo(() => {
    if (!data) return []
    const segs = data.emotion_segments
    if (segmentFilter === "unannotated") return segs.filter(s => !s.emotion?.length)
    if (segmentFilter === "ambiguous") return segs.filter(s => s.is_ambiguous)
    if (segmentFilter === "has_notes") return segs.filter(s => s.notes && s.notes.trim().length > 0)
    return segs
  }, [data, segmentFilter])

  if (!fileId) {
    return (
      <Box p={8} textAlign="center" color="fg.muted">
        <Text>No file selected. Go back and select a task.</Text>
      </Box>
    )
  }

  if (!data) {
    return (
      <Box p={8} display="flex" justifyContent="center">
        <Spinner />
      </Box>
    )
  }

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
      <Box px={4} py={2} borderBottomWidth="1px" borderColor="border" flexShrink={0}>
        {/* Row 1: back + file info + refresh */}
        <HStack gap={2} mb={1.5}>
          <IconButton aria-label="Back" size="sm" variant="ghost" onClick={() => router.push("/annotator")}>
            <ArrowLeft size={16} />
          </IconButton>
          <Box flex={1} minW={0}>
            <Heading size="sm" color="fg" truncate>{data.audio_file.filename}</Heading>
            <HStack gap={2} mt={0.5}>
              {data.audio_file.language && <Badge size="sm" colorPalette="blue">{data.audio_file.language}</Badge>}
              {duration > 0 && <Text fontSize="xs" color="fg.muted">{fmtTime(duration)}</Text>}
              {data.audio_file.num_speakers && (
                <Text fontSize="xs" color="fg.muted">{data.audio_file.num_speakers} spk</Text>
              )}
              {annotatorCount !== null && annotatorCount > 1 && (
                <Badge size="sm" colorPalette="teal" variant="subtle" title={`${annotatorCount} annotators assigned to this file`}>
                  👥 {annotatorCount} annotators
                </Badge>
              )}
            </HStack>
          </Box>
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
          <IconButton
            aria-label="Keyboard shortcuts"
            size="sm"
            variant="ghost"
            title="Keyboard shortcuts (?)"
            onClick={() => setShowShortcuts(s => !s)}
          >
            <Keyboard size={14} />
          </IconButton>
          <IconButton
            aria-label="Remarks for admin"
            size="sm"
            variant={remarks || data.audio_file.admin_response ? "solid" : "ghost"}
            colorPalette={data.audio_file.admin_response ? "blue" : remarks ? "orange" : "gray"}
            title="Remarks for admin"
            onClick={() => setRemarksOpen(true)}
          >
            <MessageSquare size={14} />
          </IconButton>
        </HStack>

        {/* Row 2: action buttons + assignment status pills */}
        <HStack gap={2} flexWrap="wrap">
          {/* Add Speaker */}
          {hasTask("speaker") && !data.audio_file.locked_speaker && (
            <Button size="sm" variant="outline" colorPalette="teal" loading={addingSegment} onClick={addSpeaker}>
              <Plus size={13} /> Speaker
            </Button>
          )}
          {/* Add Segment */}
          {hasTask("speaker") && !data.audio_file.locked_speaker && (
            <Button size="sm" variant="outline" colorPalette="teal" onClick={openSegmentModal}>
              <Plus size={13} /> Segment
            </Button>
          )}
          {/* Add Transcription */}
          {hasTask("transcription") && !data.audio_file.locked_transcription && (
            <Button size="sm" variant="outline" colorPalette="purple" onClick={openTrModal}>
              <Plus size={13} /> Transcription
            </Button>
          )}

          {/* Spacer */}
          <Box flex={1} />

          {/* Assignment status pills */}
          {data.assignments.map(a => {
            const isLocked =
              a.task_type === "speaker" ? data.audio_file.locked_speaker
              : a.task_type === "gender" ? data.audio_file.locked_gender
              : a.task_type === "transcription" ? data.audio_file.locked_transcription
              : a.task_type === "emotion" ? data.audio_file.locked_emotion
              : false
            return (
              <HStack key={a.id} gap={1}>
                <Badge
                  colorPalette={a.status === "completed" ? "green" : a.status === "in_progress" ? "blue" : "gray"}
                  size="sm"
                >
                  {a.task_type}
                </Badge>
                {isLocked ? (
                  <HStack gap={0.5} title="This task is locked — no further changes allowed">
                    <Lock size={11} color="var(--chakra-colors-orange-400)" />
                    <Text fontSize="10px" color="orange.400">locked</Text>
                  </HStack>
                ) : a.status === "completed" ? (
                  <Button size="xs" colorPalette="gray" variant="ghost" loading={completing[a.id]}
                    title="Undo — reopen this task" onClick={() => undoComplete(a)}>
                    ↩ Undo
                  </Button>
                ) : (
                  <Button size="xs" colorPalette="green" variant="outline" loading={completing[a.id]} onClick={() => markComplete(a)}>
                    <CheckCheck size={12} /> Done
                  </Button>
                )}
              </HStack>
            )
          })}
        </HStack>
      </Box>

      {/* Main body */}
      <Box flex={1} display="flex" overflow="hidden">
        <Box flex={1} display="flex" flexDir="column" overflow="hidden">

          {/* ── Sticky top: waveform + time ruler + color legend ── */}
          <Box px={4} pt={4} pb={2} bg="bg" borderBottomWidth="1px" borderColor="border" flexShrink={0}>
            <WaveformPlayer
              ref={playerRef}
              audioUrl={audioUrl}
              onTimeUpdate={setCurrentTime}
              onReady={(dur) => { setWaveformReady(true); setWaveformDuration(dur) }}
              onRegionUpdate={isSpeakerAnnotator ? handleRegionUpdate : undefined}
              onRangeSelect={isSpeakerAnnotator ? handleRangeSelect : undefined}
              height={80}
            />
            {duration > 0 && (
              <Box position="relative" h="16px" mt={1}>
                {Array.from({ length: Math.floor(duration / 10) + 1 }, (_, i) => i * 10).map(t => (
                  <Box key={t} position="absolute" left={`${(t / duration) * 100}%`} transform="translateX(-50%)">
                    <Text fontSize="9px" color="fg.muted" userSelect="none">{fmtTime(t)}</Text>
                  </Box>
                ))}
              </Box>
            )}
            {/* Color legend — single scrollable row so it never grows the sticky area */}
            <Box overflowX="auto" mt={2}>
              <HStack gap={4} flexWrap="nowrap" minW="max-content">
                {(hasTask("speaker") || hasTask("gender") || hasTask("transcription")) && (() => {
                  // Only show legend entries for speakers actually present in this file
                  const presentLabels = [...new Set(
                    data?.speaker_segments.map(s => s.speaker_label).filter(Boolean) as string[]
                  )].sort()
                  const hasUnknown = data?.speaker_segments.some(s => !s.speaker_label)
                  return (
                    <HStack gap={2} flexWrap="nowrap">
                      {presentLabels.map(label => (
                        <HStack key={label} gap={1} flexShrink={0}>
                          <Box w="8px" h="8px" rounded="full" bg={speakerColor(label)} flexShrink={0} />
                          <Text fontSize="9px" color="fg.muted">{label}</Text>
                        </HStack>
                      ))}
                      {hasUnknown && (
                        <HStack gap={1} flexShrink={0}>
                          <Box w="8px" h="8px" rounded="full" bg="#6b7280" flexShrink={0} />
                          <Text fontSize="9px" color="fg.muted">unknown</Text>
                        </HStack>
                      )}
                    </HStack>
                  )
                })()}
                {hasTask("emotion") && (
                  <HStack gap={2} flexWrap="nowrap">
                    {Object.entries(EMOTION_COLORS).map(([emo, color]) => (
                      <HStack key={emo} gap={1} flexShrink={0}>
                        <Box w="8px" h="8px" rounded="full" bg={color} flexShrink={0} />
                        <Text fontSize="9px" color="fg.muted">{emo}</Text>
                      </HStack>
                    ))}
                  </HStack>
                )}
              </HStack>
            </Box>
          </Box>

          {/* ── Scrollable bottom: speaker accordions + emotion ── */}
          <Box flex={1} minH={0} overflowY="auto" p={4} display="flex" flexDir="column" gap={4}
            opacity={loading ? 0.5 : 1} pointerEvents={loading ? "none" : undefined}
            transition="opacity 0.15s">

          {/* Segment tracks */}
          {data.assignments.length > 0 && (
            <VStack align="stretch" gap={3}>

              {/* Emotion filter chips — shown when emotion task assigned */}
              {hasTask("emotion") && !emotionGated && (
                <Flex gap={1.5} align="center" flexWrap="wrap">
                  {(["all", "unannotated", "ambiguous", "has_notes"] as const).map(f => {
                    const label = f === "all" ? `All (${data.emotion_segments.length})`
                      : f === "unannotated" ? `Unannotated (${data.emotion_segments.filter(s => !s.emotion?.length).length})`
                      : f === "ambiguous" ? `Ambiguous (${data.emotion_segments.filter(s => s.is_ambiguous).length})`
                      : `Has Notes (${data.emotion_segments.filter(s => s.notes?.trim()).length})`
                    return (
                      <Box
                        key={f}
                        as="button"
                        px={2} py="2px" fontSize="10px" rounded="full" borderWidth="1px"
                        borderColor={segmentFilter === f ? "blue.400" : "border"}
                        bg={segmentFilter === f ? "blue.900" : "bg.muted"}
                        color={segmentFilter === f ? "blue.300" : "fg.muted"}
                        cursor="pointer"
                        transition="all 0.1s"
                        onClick={() => setSegmentFilter(f)}
                      >
                        {label}
                      </Box>
                    )
                  })}
                </Flex>
              )}

              {/* Per-speaker accordion sections */}
              {(hasTask("speaker") || hasTask("transcription") || hasTask("gender") || (hasTask("emotion") && !emotionGated)) && uniqueSpeakerLanes.map(label => {
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

                      {/* Gender pills — always visible; only interactive with gender task */}
                      <HStack gap={1} onClick={e => e.stopPropagation()}>
                        {(["Male", "Female", "Mixed", "unk"] as const).map(g => (
                          <Box
                            key={g}
                            as={hasTask("gender") ? "button" : "span"}
                            px={2} py="1px" fontSize="10px" rounded="full" borderWidth="1px"
                            borderColor={currentGender === g ? genderColor(g) : "border"}
                            bg={currentGender === g ? genderColor(g) + "33" : "transparent"}
                            color={currentGender === g ? genderColor(g) : "fg.subtle"}
                            cursor={hasTask("gender") ? "pointer" : "default"}
                            opacity={hasTask("gender") || currentGender === g ? 1 : 0.4}
                            transition="all 0.1s"
                            title={g === "unk" ? "Unknown" : g}
                            onClick={() => { if (hasTask("gender") && label) propagateGender(label, g, -1) }}
                          >
                            {g === "unk" ? "?" : g}
                          </Box>
                        ))}
                      </HStack>

                      {/* Delete speaker button */}
                      {hasTask("speaker") && !data.audio_file.locked_speaker && (
                        <Box
                          as="button"
                          onClick={e => {
                            e.stopPropagation()
                            if (window.confirm(`Delete speaker "${label}" and all their segments?`)) {
                              deleteSpeaker(label ?? "")
                            }
                          }}
                          p={1}
                          rounded="sm"
                          color="fg.subtle"
                          cursor="pointer"
                          _hover={{ color: "red.400", bg: "red.900" }}
                          transition="all 0.1s"
                          title="Delete this speaker"
                        >
                          <Trash2 size={13} />
                        </Box>
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
                            highlightedId={hoveredSpeakerSegId ?? undefined}
                            getColor={(s: Segment) => speakerColor(s.speaker_label)}
                            getLabel={(s: Segment) => s.speaker_label ?? "?"}
                            onSelect={s => setSelection({ type: "speaker", segment: s })}
                          />
                        )}
                        {hasTask("transcription") && (() => {
                          if (trSegs.length === 0) {
                            return (
                              <Text fontSize="xs" color="orange.400" fontStyle="italic" py={1}>
                                ⚠ No transcription segments in this speaker's range.
                              </Text>
                            )
                          }
                          const spkBounds = new Set(speakerSegs.map(s => `${s.start_time.toFixed(3)}-${s.end_time.toFixed(3)}`))
                          const unlinked = trSegs.filter(t => !spkBounds.has(`${t.start_time.toFixed(3)}-${t.end_time.toFixed(3)}`)).length
                          return (
                            <Box display="flex" flexDir="column" gap={1}>
                              <SegmentTrack
                                label="Transcription"
                                segments={trSegs}
                                duration={duration}
                                currentTime={currentTime}
                                selectedId={selection?.type === "transcription" ? selection.segment.id : undefined}
                                getColor={(s: TranscriptSegment) => spkBounds.has(`${s.start_time.toFixed(3)}-${s.end_time.toFixed(3)}`) ? "#374151" : "#6b4c1a"}
                                getLabel={(s: TranscriptSegment) => s.edited_text ?? s.original_text ?? "—"}
                                onSelect={s => setSelection({ type: "transcription", segment: s })}
                                warningCount={unlinked}
                              />
                            </Box>
                          )
                        })()}
                        {hasTask("emotion") && !emotionGated && (() => {
                          const emoSegs = filteredEmotionSegments.filter(s => s.speaker_label === label)
                          if (emoSegs.length === 0) return null
                          const unannotated = emoSegs.filter(s => !s.emotion?.length).length
                          return (
                            <SegmentTrack
                              label="Emotion"
                              segments={emoSegs}
                              duration={duration}
                              currentTime={currentTime}
                              selectedId={selection?.type === "emotion" ? selection.segment.id : undefined}
                              getColor={(s: Segment) => s.emotion?.length ? emotionColor(s.emotion[0]) : "#374151"}
                              getLabel={(s: Segment) => {
                                if (!s.emotion?.length) return "—"
                                if (s.emotion.length === 1) {
                                  const e = s.emotion[0]
                                  return e.startsWith("Other:") ? `Other: (${e.slice(6)})` : e
                                }
                                return `${s.emotion.length} emotions`
                              }}
                              onSelect={s => setSelection({ type: "emotion", segment: s })}
                              warningCount={unannotated > 0 ? unannotated : undefined}
                              warningLabel="unannotated"
                            />
                          )
                        })()}
                      </Box>
                    )}
                  </Box>
                )
              })}

              {/* Transcription-only task (no speaker sections rendered above) */}
              {hasTask("transcription") && !hasTask("speaker") && !hasTask("gender") && uniqueSpeakerLanes.length === 0 && (() => {
                const spkBounds = new Set(data.speaker_segments.map(s => `${s.start_time.toFixed(3)}-${s.end_time.toFixed(3)}`))
                return (
                  <SegmentTrack
                    label="Transcription"
                    segments={data.transcription_segments}
                    duration={duration}
                    currentTime={currentTime}
                    selectedId={selection?.type === "transcription" ? selection.segment.id : undefined}
                    getColor={(s: TranscriptSegment) => spkBounds.has(`${s.start_time.toFixed(3)}-${s.end_time.toFixed(3)}`) ? "#374151" : "#6b4c1a"}
                    getLabel={(s: TranscriptSegment) => s.edited_text ?? s.original_text ?? "—"}
                    onSelect={s => setSelection({ type: "transcription", segment: s })}
                    warningCount={segmentMismatches.transcription}
                  />
                )
              })()}

            </VStack>
          )}

          </Box> {/* end scrollable bottom */}
        </Box> {/* end flex column */}

        {/* Segment editor sidebar — key forces remount on segment change */}
        {selection && (
          <SegmentEditor
            ref={editorRef}
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
            speakerSegments={
              selection.type === "transcription"
                ? (() => {
                    for (const [label, segs] of groupedTranscription) {
                      if (segs.some(s => s.id === selection.segment.id)) {
                        return data.speaker_segments.filter(sp => sp.speaker_label === label)
                      }
                    }
                    return data.speaker_segments
                  })()
                : data.speaker_segments
            }
            getGenderForSpeaker={getGenderForSpeaker}
            onSpeakerSegHover={setHoveredSpeakerSegId}
            canEditGender={hasTask("gender")}
            lockedSpeaker={data.audio_file.locked_speaker}
            lockedGender={data.audio_file.locked_gender}
            locked={
              selection.type === "transcription" ? data.audio_file.locked_transcription
              : selection.type === "emotion" ? data.audio_file.locked_emotion
              : false
            }
          />
        )}
      </Box>

      {/* ── Add Segment Modal ── */}
      <Dialog.Root open={segmentModal.open} onOpenChange={({ open }) => setSegmentModal(m => ({ ...m, open }))}>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" maxW="380px" w="full">
            <Dialog.Header borderBottomWidth="1px" borderColor="border" pb={3}>
              <Dialog.Title fontSize="md" color="fg">Add Speaker Segment</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body pt={4}>
              <VStack gap={4} align="stretch">
                <Field.Root>
                  <Field.Label fontSize="xs">Speaker</Field.Label>
                  <Select.Root
                    collection={createListCollection({
                      items: [
                        ...speakerLabels.map(l => ({ label: l, value: l })),
                        { label: "— none / new —", value: "" },
                      ],
                    })}
                    size="sm"
                    value={segmentModal.speaker ? [segmentModal.speaker] : [""]}
                    onValueChange={({ value }) => setSegmentModal(m => ({ ...m, speaker: value[0] ?? "" }))}
                  >
                    <Select.Trigger bg="bg.muted" borderColor="border">
                      <Select.ValueText placeholder="Select speaker…" />
                    </Select.Trigger>
                    <Select.Positioner>
                      <Select.Content>
                        {speakerLabels.map(l => (
                          <Select.Item key={l} item={{ label: l, value: l }}>{l}</Select.Item>
                        ))}
                        <Select.Item item={{ label: "— none / new —", value: "" }}>— none / new —</Select.Item>
                      </Select.Content>
                    </Select.Positioner>
                  </Select.Root>
                </Field.Root>
                <HStack gap={3}>
                  <Field.Root>
                    <Field.Label fontSize="xs">Start (s)</Field.Label>
                    <Input size="sm" type="number" step={0.001} min={0} bg="bg.muted" borderColor="border" color="fg"
                      value={segmentModal.start}
                      onChange={e => setSegmentModal(m => ({ ...m, start: parseFloat(e.target.value) || 0 }))} />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label fontSize="xs">End (s)</Field.Label>
                    <Input size="sm" type="number" step={0.001} min={0} bg="bg.muted" borderColor="border" color="fg"
                      value={segmentModal.end}
                      onChange={e => setSegmentModal(m => ({ ...m, end: parseFloat(e.target.value) || 0 }))} />
                  </Field.Root>
                </HStack>
                {segmentModal.end <= segmentModal.start && (
                  <Text fontSize="xs" color="red.400">End must be after start.</Text>
                )}
              </VStack>
            </Dialog.Body>
            <Dialog.Footer borderTopWidth="1px" borderColor="border" pt={3} gap={2}>
              <Button size="sm" variant="ghost" onClick={() => setSegmentModal(m => ({ ...m, open: false }))}>Cancel</Button>
              <Button size="sm" colorPalette="teal" loading={addingSegment}
                disabled={segmentModal.end <= segmentModal.start}
                onClick={addSegment}>
                Add Segment
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* ── Add Transcription Modal ── */}
      <Dialog.Root open={trModal.open} onOpenChange={({ open }) => setTrModal(m => ({ ...m, open }))}>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" maxW="420px" w="full">
            <Dialog.Header borderBottomWidth="1px" borderColor="border" pb={3}>
              <Dialog.Title fontSize="md" color="fg">Add Transcription Segment</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body pt={4}>
              <VStack gap={4} align="stretch">
                {/* Align to speaker segment */}
                {data && data.speaker_segments.length > 0 && (
                  <Field.Root>
                    <Field.Label fontSize="xs">Align to speaker segment <Text as="span" color="fg.subtle">(optional — snaps start/end)</Text></Field.Label>
                    <Select.Root
                      collection={createListCollection({
                        items: [
                          { label: "— manual times —", value: "" },
                          ...data.speaker_segments.map(s => ({
                            label: `${s.speaker_label ?? "?"} (${fmtTime(s.start_time)}–${fmtTime(s.end_time)})`,
                            value: String(s.id),
                          })),
                        ],
                      })}
                      size="sm"
                      value={[trModal.alignTo]}
                      onValueChange={({ value }) => {
                        const v = value[0] ?? ""
                        const seg = data.speaker_segments.find(s => String(s.id) === v)
                        setTrModal(m => ({
                          ...m,
                          alignTo: v,
                          start: seg ? seg.start_time : m.start,
                          end:   seg ? seg.end_time   : m.end,
                        }))
                      }}
                    >
                      <Select.Trigger bg="bg.muted" borderColor="border">
                        <Select.ValueText placeholder="— manual times —" />
                      </Select.Trigger>
                      <Select.Positioner>
                        <Select.Content>
                          <Select.Item item={{ label: "— manual times —", value: "" }}>— manual times —</Select.Item>
                          {data.speaker_segments.map(s => (
                            <Select.Item key={s.id} item={{ label: `${s.speaker_label ?? "?"} (${fmtTime(s.start_time)}–${fmtTime(s.end_time)})`, value: String(s.id) }}>
                              <Box display="inline-block" w="8px" h="8px" rounded="full" bg={speakerColor(s.speaker_label)} mr={2} flexShrink={0} />
                              {s.speaker_label ?? "?"} ({fmtTime(s.start_time)}–{fmtTime(s.end_time)})
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Positioner>
                    </Select.Root>
                  </Field.Root>
                )}
                <HStack gap={3}>
                  <Field.Root>
                    <Field.Label fontSize="xs">Start (s)</Field.Label>
                    <Input size="sm" type="number" step={0.001} min={0} bg="bg.muted" borderColor="border" color="fg"
                      value={trModal.start}
                      onChange={e => setTrModal(m => ({ ...m, start: parseFloat(e.target.value) || 0, alignTo: "" }))} />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label fontSize="xs">End (s)</Field.Label>
                    <Input size="sm" type="number" step={0.001} min={0} bg="bg.muted" borderColor="border" color="fg"
                      value={trModal.end}
                      onChange={e => setTrModal(m => ({ ...m, end: parseFloat(e.target.value) || 0, alignTo: "" }))} />
                  </Field.Root>
                </HStack>
                {trModal.end <= trModal.start && (
                  <Text fontSize="xs" color="red.400">End must be after start.</Text>
                )}
                <Field.Root>
                  <Field.Label fontSize="xs">Original text <Text as="span" color="fg.subtle">(optional)</Text></Field.Label>
                  <Textarea size="sm" rows={3} bg="bg.muted" borderColor="border" color="fg" fontFamily="mono" fontSize="xs"
                    placeholder="Leave blank to fill in later…"
                    value={trModal.originalText}
                    onChange={e => setTrModal(m => ({ ...m, originalText: e.target.value }))} />
                </Field.Root>
              </VStack>
            </Dialog.Body>
            <Dialog.Footer borderTopWidth="1px" borderColor="border" pt={3} gap={2}>
              <Button size="sm" variant="ghost" onClick={() => setTrModal(m => ({ ...m, open: false }))}>Cancel</Button>
              <Button size="sm" colorPalette="purple" loading={addingSegment}
                disabled={trModal.end <= trModal.start}
                onClick={addTranscriptionSegment}>
                Add Transcription
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* ── Keyboard Shortcuts Help ── */}
      <Dialog.Root open={showShortcuts} onOpenChange={({ open }) => setShowShortcuts(open)}>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" maxW="400px" w="full">
            <Dialog.Header borderBottomWidth="1px" borderColor="border" pb={3}>
              <Dialog.Title fontSize="md" color="fg">Keyboard Shortcuts</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body pt={3} pb={4}>
              <VStack align="stretch" gap={1}>
                {([
                  ["Space", "Play / Pause"],
                  ["← / →", "Seek ±2 seconds"],
                  ["S", "Save selected segment"],
                  ["N", "Jump to next unannotated emotion"],
                  ["1 – 8", "Set emotion (Neutral, Happy, Sad, Angry, Surprised, Fear, Disgust, Other)"],
                  ["A", "Toggle ambiguous on selected segment"],
                  ["Ctrl+Z", "Undo last segment save"],
                  ["?", "Toggle this help panel"],
                ] as [string, string][]).map(([key, desc]) => (
                  <HStack key={key} justify="space-between" py={1} borderBottomWidth="1px" borderColor="border" _last={{ borderBottomWidth: 0 }}>
                    <Text fontSize="xs" color="fg.muted">{desc}</Text>
                    <Box
                      px={2} py="1px" bg="bg.muted" borderWidth="1px" borderColor="border"
                      rounded="sm" fontFamily="mono" fontSize="xs" color="fg" flexShrink={0}
                    >
                      {key}
                    </Box>
                  </HStack>
                ))}
              </VStack>
              <Text fontSize="10px" color="fg.subtle" mt={3}>
                Shortcuts are disabled when an input or textarea is focused.
              </Text>
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* ── Remarks Modal ── */}
      <Dialog.Root open={remarksOpen} onOpenChange={({ open }) => setRemarksOpen(open)}>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" maxW="480px" w="full">
            <Dialog.Header borderBottomWidth="1px" borderColor="border" pb={3}>
              <Dialog.Title fontSize="md" color="fg">Remarks for Admin</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body pt={4} pb={4}>
              {data?.audio_file.admin_response && (
                <Box bg="blue.900" borderWidth="1px" borderColor="blue.800" rounded="md" px={3} py={2} mb={4}>
                  <Text fontSize="xs" fontWeight="semibold" color="blue.300" mb={1}>Admin Response</Text>
                  <Text fontSize="sm" color="blue.100" whiteSpace="pre-wrap">{data.audio_file.admin_response}</Text>
                </Box>
              )}
              <Textarea
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                placeholder="e.g. Language sounds like Mandarin, please update language field."
                rows={5}
                fontSize="sm"
                bg="bg.muted"
                borderColor="border"
                color="fg"
                resize="vertical"
              />
              <Text fontSize="10px" color="fg.subtle" mt={1}>
                Visible to admins. Last writer's note is kept — coordinate with co-annotators if needed.
              </Text>
            </Dialog.Body>
            <Dialog.Footer borderTopWidth="1px" borderColor="border" pt={3} gap={2}>
              <Button size="sm" variant="ghost" onClick={() => setRemarksOpen(false)}>Cancel</Button>
              <Button size="sm" colorPalette="blue" loading={remarksSaving} onClick={saveRemarks}>
                <Save size={13} /> Save Remarks
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
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
